import { PrismaClient, UserConfiguration as PrismaUserConfiguration } from "@prisma/client";
import { AccessKey } from "../../domain/values/AccessKey";
import { AccessSecret } from "../../domain/values/AccessSecret";
import { DeviceSerialNumber } from "../../domain/values/DeviceSerialNumber";
import { PercentageValue } from "../../domain/values/PercentageValue";
import { AutomationProfile } from "../../domain/models/AutomationProfile";
import { AutomationThresholdPair } from "../../domain/models/AutomationThresholdPair";
import { CredentialsBundle } from "../../domain/models/CredentialsBundle";
import { DevicePair } from "../../domain/models/DevicePair";
import { EcoFlowCredentials } from "../../domain/models/EcoFlowCredentials";
import { OrchestratorConfiguration } from "../../domain/models/OrchestratorConfiguration";
import { NotificationConfig } from "../notifications/NotificationDispatcher";
import { getEncryptionKey } from "../security/encryptionHelper";
import { decryptAndMigrateConfigurationSecrets } from "../security/secretMigrationHelper";

export interface RetrievedConfigurationRecord {
  databaseRecordId: string;
  ecoflowEndpointRegion: string;
  isAutomationActive: boolean;
  notificationConfig: NotificationConfig;
  configuration: OrchestratorConfiguration;
  atsLifespanCycles: number;
  atsCurrentCycles: number;
  atsLastSwitchedAt: Date | null;
  energyCostPerKwh: number;
  currencySymbol: string;
  batteryCapacityWh: number;
  isStormModeActive: boolean;
  isDailyReportActive: boolean;
  dailyReportTime: string;
  lastDailyReportSentAt: Date | null;
}

/**
 * Repositório para carregar configurações do PostgreSQL/Supabase.
 * Focado 100% na integração EcoFlow para chave de transferência automática (ATS) e notificações.
 *
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
    getEncryptionKey();

    const rawRecord = await this.databaseClient.userConfiguration.findFirst({
      where: {
        isAutomationActive: true,
        ecoflowAccessKey: { not: "" },
        ecoflowSerialNumber: { not: "" },
      },
    });

    if (!rawRecord) {
      return null;
    }

    return this.mapRecordToConfiguration(rawRecord);
  }

  public async findActiveConfigurationByUserId(userId: string): Promise<RetrievedConfigurationRecord | null> {
    getEncryptionKey();

    const rawRecord = await this.databaseClient.userConfiguration.findUnique({
      where: { userId },
    });

    if (!rawRecord) {
      return null;
    }

    const trimmedAccessKey = rawRecord.ecoflowAccessKey.trim();
    const trimmedSerialNumber = rawRecord.ecoflowSerialNumber.trim();
    const hasEcoFlow = trimmedAccessKey.length > 0 && trimmedSerialNumber.length > 0;
    if (!hasEcoFlow) {
      return null;
    }

    return this.mapRecordToConfiguration(rawRecord);
  }

  public async findAllActiveConfigurations(): Promise<RetrievedConfigurationRecord[]> {
    getEncryptionKey();

    const rawRecords = await this.databaseClient.userConfiguration.findMany({
      where: {
        ecoflowAccessKey: { not: "" },
        ecoflowSerialNumber: { not: "" },
      },
    });

    const results: RetrievedConfigurationRecord[] = [];
    for (const record of rawRecords) {
      await this.appendMappedRecordSafely(record, results);
    }
    return results;
  }

  public async recordExecutionLog(
    configurationId: string,
    batteryPercentage: number,
    actionTriggered: string,
    executionDetails: string,
    solarInputWatts = 0,
    outputWatts = 0
  ): Promise<void> {
    await this.databaseClient.syncExecutionLog.create({
      data: {
        userConfigurationId: configurationId,
        batteryPercentage: batteryPercentage,
        solarInputWatts: solarInputWatts,
        outputWatts: outputWatts,
        actionTriggered: actionTriggered,
        executionDetails: executionDetails,
      },
    });
  }

  public async findLatestExecutionLog(configurationId: string): Promise<{
    batteryPercentage: number;
    actionTriggered: string;
    executedAt: Date;
  } | null> {
    return this.databaseClient.syncExecutionLog.findFirst({
      where: { userConfigurationId: configurationId },
      orderBy: { executedAt: "desc" },
      select: {
        batteryPercentage: true,
        actionTriggered: true,
        executedAt: true,
      },
    });
  }

  public async incrementAtsCycle(configurationId: string): Promise<number> {
    const updated = await this.databaseClient.userConfiguration.update({
      where: { id: configurationId },
      data: {
        atsCurrentCycles: { increment: 1 },
        atsLastSwitchedAt: new Date(),
      },
      select: { atsCurrentCycles: true },
    });
    return updated.atsCurrentCycles;
  }

  public async setStormMode(userId: string, isStormModeActive: boolean): Promise<boolean> {
    const updated = await this.databaseClient.userConfiguration.update({
      where: { userId },
      data: { isStormModeActive },
      select: { isStormModeActive: true },
    });
    return updated.isStormModeActive;
  }

  private async appendMappedRecordSafely(
    record: PrismaUserConfiguration,
    accumulator: RetrievedConfigurationRecord[]
  ): Promise<void> {
    try {
      const mapped = await this.mapRecordToConfiguration(record);
      accumulator.push(mapped);
    } catch (mappingError: unknown) {
      const detail =
        mappingError instanceof Error ? mappingError.message : "erro ao decifrar/mapear registro";
      console.warn(
        `[ConfigurationRepository] Ignorando configuração inválida (${record.id}): ${detail}`
      );
    }
  }

  private async mapRecordToConfiguration(
    rawRecord: PrismaUserConfiguration
  ): Promise<RetrievedConfigurationRecord> {
    const decryptedSecrets = await decryptAndMigrateConfigurationSecrets(
      this.databaseClient,
      rawRecord
    );

    const ecoflowKey = new AccessKey(rawRecord.ecoflowAccessKey);
    const ecoflowSecret = new AccessSecret(decryptedSecrets.ecoflowAccessSecret);
    const ecoflowCredentials = new EcoFlowCredentials(ecoflowKey, ecoflowSecret);

    const credentialsBundle = new CredentialsBundle(ecoflowCredentials);

    const ecoflowDevice = new DeviceSerialNumber(rawRecord.ecoflowSerialNumber);
    const devicePair = new DevicePair(ecoflowDevice);

    const onThreshold = new PercentageValue(rawRecord.turnOnThreshold);
    const offThreshold = new PercentageValue(rawRecord.turnOffThreshold);
    const thresholdPair = new AutomationThresholdPair(onThreshold, offThreshold);

    const automationProfile = new AutomationProfile(devicePair, thresholdPair);
    const configuration = new OrchestratorConfiguration(credentialsBundle, automationProfile);

    return {
      databaseRecordId: rawRecord.id,
      ecoflowEndpointRegion: rawRecord.ecoflowEndpointRegion,
      isAutomationActive: rawRecord.isAutomationActive,
      notificationConfig: {
        telegramBotToken: decryptedSecrets.telegramBotToken,
        telegramChatId: rawRecord.telegramChatId,
        whatsappPhoneNumber: rawRecord.whatsappPhoneNumber,
        whatsappApiKey: decryptedSecrets.whatsappApiKey,
        isNotificationActive: rawRecord.isNotificationActive,
      },
      configuration,
      atsLifespanCycles: rawRecord.atsLifespanCycles ?? 10000,
      atsCurrentCycles: rawRecord.atsCurrentCycles ?? 0,
      atsLastSwitchedAt: rawRecord.atsLastSwitchedAt ?? null,
      energyCostPerKwh: rawRecord.energyCostPerKwh ?? 0.92,
      currencySymbol: rawRecord.currencySymbol ?? "R$",
      batteryCapacityWh: rawRecord.batteryCapacityWh ?? 2048,
      isStormModeActive: rawRecord.isStormModeActive ?? false,
      isDailyReportActive: rawRecord.isDailyReportActive ?? true,
      dailyReportTime: rawRecord.dailyReportTime ?? "21:00",
      lastDailyReportSentAt: rawRecord.lastDailyReportSentAt ?? null,
    };
  }
}
