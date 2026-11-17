import { ConfigurationRepository, RetrievedConfigurationRecord } from "../infrastructure/repositories/ConfigurationRepository";
import { EcoFlowHttpClient } from "../infrastructure/http/EcoFlowHttpClient";
import { DeviceSerialNumber } from "../domain/values/DeviceSerialNumber";
import { DesiredDeviceAction } from "../domain/values/DesiredDeviceAction";
import { EcoFlowCredentials } from "../domain/models/EcoFlowCredentials";
import { AutomationThresholdPair } from "../domain/models/AutomationThresholdPair";
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

  public async executeSyncForUser(userId: string): Promise<SyncExecutionResult> {
    const configurationRecord = await this.repository.findActiveConfigurationByUserId(userId);
    if (!configurationRecord) {
      return this.buildEmptyConfigurationResult();
    }
    return this.executeSyncForRecord(configurationRecord);
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

  public async executeSync(): Promise<SyncExecutionResult> {
    const configurationRecord = await this.repository.findActiveConfiguration();
    if (!configurationRecord) {
      return this.buildEmptyConfigurationResult();
    }
    return this.executeSyncForRecord(configurationRecord);
  }

  private async executeSyncForRecord(configurationRecord: RetrievedConfigurationRecord): Promise<SyncExecutionResult> {
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
      const telemetry = await ecoflowClient.fetchDeviceTelemetry(ecoflowDevice);
      const batteryLevel = telemetry.batteryLevel;
      const solarWatts = telemetry.solarWatts;
      const outputWatts = telemetry.outputWatts;

      let numericBattery = 0;
      batteryLevel.transferBatteryPercentage((percentageNumber: number) => {
        numericBattery = percentageNumber;
      });

      let numericSolarWatts = 0;
      solarWatts.transferNumericWatts((wattsNumber: number) => {
        numericSolarWatts = wattsNumber;
      });

      const isAutomationEnabled = configurationRecord.isAutomationActive;
      let actionResult = "Automação pausada: telemetria registrada sem alteração da saída AC.";
      let actionName = "MONITORAMENTO";

      if (isAutomationEnabled) {
        const desiredAction = thresholdPair.evaluateBattery(batteryLevel);
        actionResult = await this.dispatchEcoFlowAcAction(
          desiredAction,
          ecoflowDevice,
          ecoflowClient,
          telemetry.isAcOutputEnabled,
          numericBattery,
          numericSolarWatts,
          notificationConfig
        );
        desiredAction.transferActionName((nameString: string) => {
          actionName = nameString;
        });
      }

      await this.repository.recordExecutionLog(
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

  private async dispatchEcoFlowAcAction(
    desiredAction: DesiredDeviceAction,
    ecoflowDevice: DeviceSerialNumber,
    ecoflowClient: EcoFlowHttpClient,
    isCurrentlyAcEnabled: boolean | null,
    batteryPercentage: number,
    solarWatts: number,
    notificationConfig: NotificationConfig
  ): Promise<string> {
    const isEnable = desiredAction.isEnableEcoFlowAc();
    if (isEnable) {
      if (isCurrentlyAcEnabled === true) {
        return "Bateria Alta (atingiu limite superior): Saída AC EcoFlow já está LIGADA. Chave ATS mantida em Solar/Bateria.";
      }
      const feedback = await ecoflowClient.setAcOutputState(ecoflowDevice, true);

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
