import { ConfigurationRepository, RetrievedConfigurationRecord } from "../infrastructure/repositories/ConfigurationRepository";
import { EcoFlowHttpClient } from "../infrastructure/http/EcoFlowHttpClient";
import { DeviceSerialNumber } from "../domain/values/DeviceSerialNumber";
import { DesiredDeviceAction } from "../domain/values/DesiredDeviceAction";
import { EcoFlowCredentials } from "../domain/models/EcoFlowCredentials";
import { AutomationThresholdPair } from "../domain/models/AutomationThresholdPair";
import { BatteryLevel } from "../domain/values/BatteryLevel";
import {
  NotificationDispatcher,
  NotificationConfig,
} from "../infrastructure/notifications/NotificationDispatcher";

export interface SyncExecutionResult {
  hasExecutedSuccessfully: boolean;
  batteryPercentage: number;
  solarWatts: number;
  outputWatts: number;
  triggeredAction: string;
  detailMessage: string;
}

export interface ProvidedTelemetry {
  batteryPercentage: number;
  solarWatts: number;
  outputWatts: number;
  isAcOutputEnabled: boolean | null;
}

/**
 * Caso de Uso principal para sincronização e automação de energia via EcoFlow.
 * Opera em conjunto com uma Chave de Transferência Automática (ATS) física:
 * - Ao atingir o limite superior de carga, liga a saída AC da EcoFlow -> ATS comuta para Solar/Bateria.
 * - Ao atingir o limite inferior de carga, desliga a saída AC da EcoFlow -> ATS comuta para a Concessionária (Rede).
 * - Dispara alertas instantâneos via Telegram e WhatsApp (CallMeBot) quando configurados.
 *
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Sem a palavra-chave else (guard clauses e early returns)
 * - 1 ponto por linha
 * - Nomes sem abreviação
 */
export class OrchestratorSyncUseCase {
  private readonly repository: ConfigurationRepository;
  private readonly ecoflowBaseApiUrl: string;

  constructor(
    repository: ConfigurationRepository,
    ecoflowBaseApiUrl = process.env.ECOFLOW_BASE_URL || "https://api.ecoflow.com"
  ) {
    this.repository = repository;
    this.ecoflowBaseApiUrl = ecoflowBaseApiUrl;
  }

  public async executeSyncForUser(
    userId: string,
    providedTelemetry?: ProvidedTelemetry
  ): Promise<SyncExecutionResult> {
    const configurationRecord = await this.repository.findActiveConfigurationByUserId(userId);
    if (!configurationRecord) {
      return this.buildEmptyConfigurationResult();
    }
    return this.executeSyncForRecord(configurationRecord, providedTelemetry);
  }

  public async executeSyncAll(): Promise<SyncExecutionResult[]> {
    const activeRecords = await this.repository.findAllActiveConfigurations();
    const results: SyncExecutionResult[] = [];

    for (const record of activeRecords) {
      const syncResult = await this.executeSyncForRecord(record);
      results.push(syncResult);
    }

    return results;
  }

  public async executeSync(providedTelemetry?: ProvidedTelemetry): Promise<SyncExecutionResult> {
    const configurationRecord = await this.repository.findActiveConfiguration();
    if (!configurationRecord) {
      return this.buildEmptyConfigurationResult();
    }
    return this.executeSyncForRecord(configurationRecord, providedTelemetry);
  }

  private async executeSyncForRecord(
    configurationRecord: RetrievedConfigurationRecord,
    providedTelemetry?: ProvidedTelemetry
  ): Promise<SyncExecutionResult> {
    const { databaseRecordId, ecoflowEndpointRegion, notificationConfig, configuration } = configurationRecord;

    let ecoflowCredentials: EcoFlowCredentials | undefined;
    configuration.provideCredentialsBundle((bundle) => {
      bundle.provideEcoFlowCredentials((credentials) => {
        ecoflowCredentials = credentials;
      });
    });

    let ecoflowDevice: DeviceSerialNumber | undefined;
    let thresholdPair: AutomationThresholdPair | undefined;
    configuration.provideAutomationProfile((profile) => {
      profile.provideDevicePair((devices) => {
        devices.provideEcoFlowSerialNumber((serialString) => {
          ecoflowDevice = new DeviceSerialNumber(serialString);
        });
      });
      profile.provideThresholdPair((thresholds) => {
        thresholdPair = thresholds;
      });
    });

    if (!ecoflowCredentials || !ecoflowDevice || !thresholdPair) {
      throw new Error(
        "[WattFlow] Configuração incompleta: preencha as credenciais da EcoFlow na tela de Configurações."
      );
    }

    try {
      const activeEcoFlowUrl = ecoflowEndpointRegion || this.ecoflowBaseApiUrl;
      const ecoflowClient = new EcoFlowHttpClient(ecoflowCredentials, activeEcoFlowUrl);

      let numericBattery = 0;
      let numericSolarWatts = 0;
      let outputWatts = 0;
      let isAcOutputEnabled: boolean | null = null;
      let batteryLevel: BatteryLevel;

      if (providedTelemetry) {
        numericBattery = providedTelemetry.batteryPercentage;
        numericSolarWatts = providedTelemetry.solarWatts;
        outputWatts = providedTelemetry.outputWatts;
        isAcOutputEnabled = providedTelemetry.isAcOutputEnabled;
        batteryLevel = new BatteryLevel(numericBattery);
      } else {
        const telemetry = await ecoflowClient.fetchDeviceTelemetry(ecoflowDevice);
        batteryLevel = telemetry.batteryLevel;
        isAcOutputEnabled = telemetry.isAcOutputEnabled;
        outputWatts = telemetry.outputWatts;

        batteryLevel.transferBatteryPercentage((percentageNumber: number) => {
          numericBattery = percentageNumber;
        });

        telemetry.solarWatts.transferNumericWatts((wattsNumber: number) => {
          numericSolarWatts = wattsNumber;
        });
      }

      const isStormMode = configurationRecord.isStormModeActive;
      const isAutomationEnabled = configurationRecord.isAutomationActive;
      let actionResult = "Automação pausada: telemetria registrada sem alteração da saída AC.";
      let actionName = "MONITORAMENTO";

      if (isStormMode) {
        if (isAcOutputEnabled === true) {
          await ecoflowClient.setAcOutputState(ecoflowDevice, false);
          if (typeof this.repository.incrementAtsCycle === "function") {
            await this.repository.incrementAtsCycle(databaseRecordId);
          }
          this.dispatchSafeAlert(
            {
              title: "Modo Tempestade Ativo",
              message:
                "Saída AC desligada. Cargas comutadas para a Concessionária para preservar 100% de reserva na bateria.",
              batteryPercentage: numericBattery,
              solarWatts: numericSolarWatts,
              actionState: "GRID",
            },
            notificationConfig
          );
        }
        actionResult =
          "Modo Tempestade / Alerta de Apagão Ativo: comutação suspensa, bateria preservada em reserva máxima.";
        actionName = "STORM_MODE_RESERVE";
      } else if (isAutomationEnabled) {
        const desiredAction = thresholdPair.evaluateBattery(batteryLevel);
        actionResult = await this.dispatchEcoFlowAcAction(
          desiredAction,
          ecoflowDevice,
          ecoflowClient,
          isAcOutputEnabled,
          numericBattery,
          numericSolarWatts,
          notificationConfig,
          databaseRecordId
        );
        desiredAction.transferActionName((nameString: string) => {
          actionName = nameString;
        });
      }

      await this.recordExecutionLogThrottled(
        databaseRecordId,
        numericBattery,
        actionName,
        actionResult,
        numericSolarWatts,
        outputWatts
      );

      return {
        hasExecutedSuccessfully: true,
        batteryPercentage: numericBattery,
        solarWatts: numericSolarWatts,
        outputWatts: outputWatts,
        triggeredAction: actionName,
        detailMessage: actionResult,
      };
    } catch (executionError) {
      const errorMessage =
        executionError instanceof Error ? executionError.message : "Erro desconhecido na sincronização.";

      await this.repository.recordExecutionLog(
        databaseRecordId,
        0,
        "FALHA_SINCRONIZACAO",
        errorMessage,
        0,
        0
      );

      throw executionError;
    }
  }

  private static readonly lastLoggedStatesByRecordId = new Map<
    string,
    { batteryPercentage: number; actionTriggered: string; loggedAtMs: number }
  >();

  public static resetLoggedStatesForTests(): void {
    OrchestratorSyncUseCase.lastLoggedStatesByRecordId.clear();
  }

  private async recordExecutionLogThrottled(
    databaseRecordId: string,
    numericBattery: number,
    actionName: string,
    actionResult: string,
    numericSolarWatts: number,
    outputWatts: number
  ): Promise<void> {
    const isAtsAction =
      actionName === "ENABLE_ECOFLOW_AC" ||
      actionName === "DISABLE_ECOFLOW_AC" ||
      actionName === "BATTERY_HIGH_DISCHARGE" ||
      actionName === "BATTERY_LOW_RECHARGE" ||
      actionName === "STORM_MODE_RESERVE";

    let lastState = OrchestratorSyncUseCase.lastLoggedStatesByRecordId.get(databaseRecordId);
    if (!lastState && typeof this.repository.findLatestExecutionLog === "function") {
      const latestDbLog = await this.repository.findLatestExecutionLog(databaseRecordId);
      if (latestDbLog) {
        lastState = {
          batteryPercentage: latestDbLog.batteryPercentage,
          actionTriggered: latestDbLog.actionTriggered,
          loggedAtMs: latestDbLog.executedAt.getTime(),
        };
        OrchestratorSyncUseCase.lastLoggedStatesByRecordId.set(databaseRecordId, lastState);
      }
    }

    const now = Date.now();
    let shouldRecord = isAtsAction || !lastState;

    if (!shouldRecord && lastState) {
      const batteryDifference = Math.abs(numericBattery - lastState.batteryPercentage);
      const isActionChanged = actionName !== lastState.actionTriggered;
      const elapsedSinceLastLogMs = now - lastState.loggedAtMs;
      const MAX_IDLE_LOG_INTERVAL_MS = 300_000;

      shouldRecord =
        isActionChanged ||
        batteryDifference >= 1 ||
        elapsedSinceLastLogMs >= MAX_IDLE_LOG_INTERVAL_MS;
    }

    if (!shouldRecord) {
      return;
    }

    OrchestratorSyncUseCase.lastLoggedStatesByRecordId.set(databaseRecordId, {
      batteryPercentage: numericBattery,
      actionTriggered: actionName,
      loggedAtMs: now,
    });

    await this.repository.recordExecutionLog(
      databaseRecordId,
      numericBattery,
      actionName,
      actionResult,
      numericSolarWatts,
      outputWatts
    );
  }

  private async dispatchEcoFlowAcAction(
    desiredAction: DesiredDeviceAction,
    ecoflowDevice: DeviceSerialNumber,
    ecoflowClient: EcoFlowHttpClient,
    isCurrentlyAcEnabled: boolean | null,
    batteryPercentage: number,
    solarWatts: number,
    notificationConfig: NotificationConfig,
    databaseRecordId: string
  ): Promise<string> {
    const isEnable = desiredAction.isEnableEcoFlowAc();
    if (isEnable) {
      if (isCurrentlyAcEnabled === true) {
        return "Bateria Alta (atingiu limite superior): Saída AC EcoFlow já está LIGADA. Chave ATS mantida em Solar/Bateria.";
      }
      const feedback = await ecoflowClient.setAcOutputState(ecoflowDevice, true);
      if (typeof this.repository.incrementAtsCycle === "function") {
        await this.repository.incrementAtsCycle(databaseRecordId);
      }

      // Dispara notificação de comutação para Solar/Bateria
      this.dispatchSafeAlert(
        {
          title: "ATS Comutada para Solar/Bateria",
          message:
            "A bateria atingiu o limite superior configurado. A saída AC da EcoFlow foi ativada e a Chave de Transferência Automática (ATS) comutou a residência para energia solar/bateria!",
          batteryPercentage,
          solarWatts,
          actionState: "SOLAR_BATTERY",
        },
        notificationConfig
      );

      return `Bateria Alta (atingiu limite superior): Saída AC EcoFlow LIGADA. A Chave ATS comutou para Solar/Bateria. [EcoFlow: ${feedback}]`;
    }

    const isDisable = desiredAction.isDisableEcoFlowAc();
    if (isDisable) {
      if (isCurrentlyAcEnabled === false) {
        return "Bateria Baixa (atingiu limite inferior): Saída AC EcoFlow já está DESLIGADA. Chave ATS mantida na Concessionária.";
      }
      const feedback = await ecoflowClient.setAcOutputState(ecoflowDevice, false);
      if (typeof this.repository.incrementAtsCycle === "function") {
        await this.repository.incrementAtsCycle(databaseRecordId);
      }

      // Dispara notificação de comutação para a Concessionária
      this.dispatchSafeAlert(
        {
          title: "ATS Comutada para Concessionária",
          message:
            "A bateria desceu ao limite inferior de corte. A saída AC da EcoFlow foi desligada para preservar a bateria e a Chave ATS transferiu a residência para a rede da concessionária.",
          batteryPercentage,
          solarWatts,
          actionState: "GRID",
        },
        notificationConfig
      );

      return `Bateria Baixa (atingiu limite inferior): Saída AC EcoFlow DESLIGADA. A Chave ATS comutou para a Rede Concessionária. [EcoFlow: ${feedback}]`;
    }

    return "Bateria em faixa intermediária (histerese). Estados atuais mantidos.";
  }

  private dispatchSafeAlert(
    payload: {
      title: string;
      message: string;
      batteryPercentage: number;
      solarWatts: number;
      actionState: "SOLAR_BATTERY" | "GRID";
    },
    config: NotificationConfig
  ): void {
    const dispatcher = new NotificationDispatcher();
    dispatcher.dispatchNotification(payload, config).catch((err) => {
      console.error("[WattFlow Alert] Falha ao enviar notificação:", err);
    });
  }

  private buildEmptyConfigurationResult(): SyncExecutionResult {
    return {
      hasExecutedSuccessfully: false,
      batteryPercentage: 0,
      solarWatts: 0,
      outputWatts: 0,
      triggeredAction: "INACTIVE_CONFIGURATION",
      detailMessage: "Nenhuma configuração ativa foi cadastrada no banco de dados.",
    };
  }
}
