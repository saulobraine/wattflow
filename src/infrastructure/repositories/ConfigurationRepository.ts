import { PrismaClient, UserConfiguration as PrismaUserConfiguration } from "@prisma/client";
import { AccessKey } from "../../domain/values/AccessKey";
import { AccessSecret } from "../../domain/values/AccessSecret";
import { DeviceIdentifier } from "../../domain/values/DeviceIdentifier";
import { DeviceSerialNumber } from "../../domain/values/DeviceSerialNumber";
import { PercentageValue } from "../../domain/values/PercentageValue";
import { AutomationProfile } from "../../domain/models/AutomationProfile";
import { AutomationThresholdPair } from "../../domain/models/AutomationThresholdPair";
import { CredentialsBundle } from "../../domain/models/CredentialsBundle";
import { DevicePair } from "../../domain/models/DevicePair";
import { EcoFlowCredentials } from "../../domain/models/EcoFlowCredentials";
import { OrchestratorConfiguration } from "../../domain/models/OrchestratorConfiguration";
import { TuyaCredentials } from "../../domain/models/TuyaCredentials";

export interface RetrievedConfigurationRecord {
  databaseRecordId: string;
  tuyaEndpointRegion: string;
  ecoflowEndpointRegion: string;
  configuration: OrchestratorConfiguration;
}

/**
 * Repositório para carregar configurações do PostgreSQL/Supabase.
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - Sem abreviações
 * - 1 ponto por linha
 */
export class ConfigurationRepository {
  private readonly databaseClient: PrismaClient;

  constructor(databaseClient: PrismaClient) {
    this.databaseClient = databaseClient;
  }

  public async findActiveConfiguration(): Promise<RetrievedConfigurationRecord | null> {
    const rawRecord = await this.databaseClient.userConfiguration.findFirst({
      where: {
        isAutomationActive: true,
        tuyaAccessId: { not: "" },
        ecoflowAccessKey: { not: "" },
      },
    });

    if (!rawRecord) {
      return null;
    }

    return this.mapRecordToConfiguration(rawRecord);
  }

  public async findActiveConfigurationByUserId(userId: string): Promise<RetrievedConfigurationRecord | null> {
    const rawRecord = await this.databaseClient.userConfiguration.findUnique({
      where: { userId },
    });

    if (!rawRecord) {
      return null;
    }

    const hasTuya = rawRecord.tuyaAccessId.trim().length > 0;
    const hasEcoFlow = rawRecord.ecoflowAccessKey.trim().length > 0;
    if (!hasTuya || !hasEcoFlow) {
      return null;
    }

    return this.mapRecordToConfiguration(rawRecord);
  }

  public async findAllActiveConfigurations(): Promise<RetrievedConfigurationRecord[]> {
    const rawRecords = await this.databaseClient.userConfiguration.findMany({
      where: {
        isAutomationActive: true,
        tuyaAccessId: { not: "" },
        ecoflowAccessKey: { not: "" },
      },
    });

    const results: RetrievedConfigurationRecord[] = [];
    for (const record of rawRecords) {
      const mapped = this.mapRecordToConfiguration(record);
      results.push(mapped);
    }
    return results;
  }

  public async recordExecutionLog(
    configurationId: string,
    batteryPercentage: number,
    actionTriggered: string,
    executionDetails: string,
    solarInputWatts = 0
  ): Promise<void> {
    await this.databaseClient.syncExecutionLog.create({
      data: {
        userConfigurationId: configurationId,
        batteryPercentage: batteryPercentage,
        solarInputWatts: solarInputWatts,
        actionTriggered: actionTriggered,
        executionDetails: executionDetails,
      },
    });
  }

  private mapRecordToConfiguration(rawRecord: PrismaUserConfiguration): RetrievedConfigurationRecord {
    const tuyaKey = new AccessKey(rawRecord.tuyaAccessId);
    const tuyaSecret = new AccessSecret(rawRecord.tuyaAccessSecret);
    const tuyaCredentials = new TuyaCredentials(tuyaKey, tuyaSecret);

    const ecoflowKey = new AccessKey(rawRecord.ecoflowAccessKey);
    const ecoflowSecret = new AccessSecret(rawRecord.ecoflowAccessSecret);
    const ecoflowCredentials = new EcoFlowCredentials(ecoflowKey, ecoflowSecret);

    const credentialsBundle = new CredentialsBundle(tuyaCredentials, ecoflowCredentials);

    const tuyaDevice = new DeviceIdentifier(rawRecord.tuyaDeviceId);
    const ecoflowDevice = new DeviceSerialNumber(rawRecord.ecoflowSerialNumber);
    const devicePair = new DevicePair(tuyaDevice, ecoflowDevice);

    const onThreshold = new PercentageValue(rawRecord.turnOnThreshold);
    const offThreshold = new PercentageValue(rawRecord.turnOffThreshold);
    const thresholdPair = new AutomationThresholdPair(onThreshold, offThreshold);

    const automationProfile = new AutomationProfile(devicePair, thresholdPair);
    const configuration = new OrchestratorConfiguration(credentialsBundle, automationProfile);

    return {
      databaseRecordId: rawRecord.id,
      tuyaEndpointRegion: rawRecord.tuyaEndpointRegion,
      ecoflowEndpointRegion: rawRecord.ecoflowEndpointRegion,
      configuration,
    };
  }
}
