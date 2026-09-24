import { ConfigurationRepository, RetrievedConfigurationRecord } from "../infrastructure/repositories/ConfigurationRepository";
import { EcoFlowHttpClient } from "../infrastructure/http/EcoFlowHttpClient";
import { TuyaHttpClient } from "../infrastructure/http/TuyaHttpClient";
import { DeviceCommandCode } from "../domain/values/DeviceCommandCode";
import { DeviceIdentifier } from "../domain/values/DeviceIdentifier";
import { DeviceSerialNumber } from "../domain/values/DeviceSerialNumber";
import { TuyaCommand } from "../domain/models/TuyaCommand";
import { TuyaCommandCollection } from "../domain/models/TuyaCommandCollection";
import { DesiredDeviceAction } from "../domain/values/DesiredDeviceAction";
import { TuyaCredentials } from "../domain/models/TuyaCredentials";
import { EcoFlowCredentials } from "../domain/models/EcoFlowCredentials";
import { AutomationThresholdPair } from "../domain/models/AutomationThresholdPair";

export interface SyncExecutionResult {
  hasExecutedSuccessfully: boolean;
  batteryPercentage: number;
  solarWatts: number;
  triggeredAction: string;
  detailMessage: string;
}

/**
 * Caso de Uso principal para sincronização e orquestração de energia.
 * Integração inteligente entre a estação EcoFlow e a tomada Tuya.
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
    const { databaseRecordId, tuyaEndpointRegion, ecoflowEndpointRegion, configuration } = configurationRecord;

    let tuyaCredentials: TuyaCredentials | undefined;
    let ecoflowCredentials: EcoFlowCredentials | undefined;
    configuration.provideCredentialsBundle((bundle) => {
      bundle.provideTuyaCredentials((credentials) => {
        tuyaCredentials = credentials;
      });
      bundle.provideEcoFlowCredentials((credentials) => {
        ecoflowCredentials = credentials;
      });
    });

    let tuyaDevice: DeviceIdentifier | undefined;
    let ecoflowDevice: DeviceSerialNumber | undefined;
    let thresholdPair: AutomationThresholdPair | undefined;
    configuration.provideAutomationProfile((profile) => {
      profile.provideDevicePair((devices) => {
        devices.provideTuyaIdentifier((identifierString) => {
          tuyaDevice = new DeviceIdentifier(identifierString);
        });
        devices.provideEcoFlowSerialNumber((serialString) => {
          ecoflowDevice = new DeviceSerialNumber(serialString);
        });
      });
      profile.provideThresholdPair((thresholds) => {
        thresholdPair = thresholds;
      });
    });

    if (!tuyaCredentials || !ecoflowCredentials || !tuyaDevice || !ecoflowDevice || !thresholdPair) {
      throw new Error(
        "[WattFlow] Configuração incompleta: preencha as credenciais da Tuya e EcoFlow na tela de Configurações."
      );
    }

    try {
      const activeEcoFlowUrl = ecoflowEndpointRegion || this.ecoflowBaseApiUrl;
      const ecoflowClient = new EcoFlowHttpClient(ecoflowCredentials, activeEcoFlowUrl);
      const telemetry = await ecoflowClient.fetchDeviceTelemetry(ecoflowDevice);
      const batteryLevel = telemetry.batteryLevel;
      const solarWatts = telemetry.solarWatts;

      let numericBattery = 0;
      batteryLevel.transferBatteryPercentage((percentageNumber: number) => {
        numericBattery = percentageNumber;
      });

      let numericSolarWatts = 0;
      solarWatts.transferNumericWatts((wattsNumber: number) => {
        numericSolarWatts = wattsNumber;
      });

      const desiredAction = thresholdPair.evaluateBattery(batteryLevel);
      const tuyaClient = new TuyaHttpClient(tuyaCredentials, tuyaEndpointRegion);

      const actionResult = await this.dispatchCoordinatedActions(
        desiredAction,
        tuyaDevice,
        tuyaClient,
        ecoflowDevice,
        ecoflowClient
      );

      let actionName = "";
      desiredAction.transferActionName((nameString: string) => {
        actionName = nameString;
      });

      await this.repository.recordExecutionLog(
        databaseRecordId,
        numericBattery,
        actionName,
        actionResult,
        numericSolarWatts
      );

      return {
        hasExecutedSuccessfully: true,
        batteryPercentage: numericBattery,
        solarWatts: numericSolarWatts,
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
        0
      );

      throw executionError;
    }
  }

  private async dispatchCoordinatedActions(
    desiredAction: DesiredDeviceAction,
    tuyaDevice: DeviceIdentifier,
    tuyaClient: TuyaHttpClient,
    ecoflowDevice: DeviceSerialNumber,
    ecoflowClient: EcoFlowHttpClient
  ): Promise<string> {
    const isHighDischarge = desiredAction.isBatteryHighDischarge();
    if (isHighDischarge) {
      // 1. Desliga a Tomada Tuya PRIMEIRO
      const switchCode = DeviceCommandCode.standardSwitch();
      const command = TuyaCommand.createTurnOff(switchCode);
      const collection = TuyaCommandCollection.singleCommand(command);
      await tuyaClient.sendDeviceCommands(tuyaDevice, collection);

      // 2. Tempo Morto (Dead-Time) de 2.500ms para abertura física dos relés
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // 3. Somente após a Tuya estar desligada, liga a Saída AC da EcoFlow
      const ecoflowFeedback = await ecoflowClient.setAcOutputState(ecoflowDevice, true);
      return `Bateria Alta (atingiu limite superior): Tomada Tuya DESLIGADA e Saída AC EcoFlow ATIVADA. [EcoFlow: ${ecoflowFeedback}]`;
    }

    const isLowRecharge = desiredAction.isBatteryLowRecharge();
    if (isLowRecharge) {
      // 1. Desliga a Saída AC da EcoFlow PRIMEIRO
      const ecoflowFeedback = await ecoflowClient.setAcOutputState(ecoflowDevice, false);
      const isEcoflowFailed = ecoflowFeedback.includes("Falha") || ecoflowFeedback.includes("Erro");
      if (isEcoflowFailed) {
        throw new Error(
          `[Bloqueio de Segurança] Falha ao desligar Saída AC da EcoFlow (${ecoflowFeedback}). A Tomada Tuya NÃO foi ligada para evitar queima do inversor por retorno de rede.`
        );
      }

      // 2. Tempo Morto (Dead-Time) de 2.500ms para desenergização de relés e capacitores
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // 3. Somente após a EcoFlow estar desligada, liga a Tomada Tuya
      const switchCode = DeviceCommandCode.standardSwitch();
      const command = TuyaCommand.createTurnOn(switchCode);
      const collection = TuyaCommandCollection.singleCommand(command);
      await tuyaClient.sendDeviceCommands(tuyaDevice, collection);

      return `Bateria Baixa (atingiu limite inferior): Saída AC EcoFlow DESATIVADA e Tomada Tuya LIGADA. [EcoFlow: ${ecoflowFeedback}]`;
    }

    return "Bateria em faixa intermediária (histerese). Estados atuais mantidos.";
  }

  private buildEmptyConfigurationResult(): SyncExecutionResult {
    return {
      hasExecutedSuccessfully: false,
      batteryPercentage: 0,
      solarWatts: 0,
      triggeredAction: "INACTIVE_CONFIGURATION",
      detailMessage: "Nenhuma configuração ativa foi cadastrada no banco de dados.",
    };
  }
}
