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
  latitude: number | null;
  longitude: number | null;
  isAdaptiveHysteresisActive: boolean;
  minAdaptiveThreshold: number;
  maxAdaptiveThreshold: number;
  lastSolarIrradianceMj: number | null;
  lastSolarForecastCheckAt: Date | null;
  thermalWarningThreshold: number;
  thermalShutdownThreshold: number;
  isThermalProtectionActive?: boolean;
  thermalThrottleTempThreshold?: number;
  thermalCutoffTempThreshold?: number;
  thermalRecoveryTempThreshold?: number;
  thermalThrottleSpeedWatts?: number;
  isThermalThrottleActive?: boolean;
  isThermalCutoffActive?: boolean;
  lastThermalEventAt?: Date | null;
  lastThermalActionMessage?: string | null;
  lastBatteryTempCelsius: number | null;
  lastBatterySoh: number | null;
  lastBatteryCycles: number | null;
  maxRecordedBatteryTemp: number | null;
  lastBatteryPercentage?: number | null;
  isDynamicTariffActive: boolean;
  peakTariffPerKwh: number;
  intermediateTariffPerKwh: number;
  offPeakTariffPerKwh: number;
  peakStartTime: string;
  peakEndTime: string;
  intermediateStartTime1: string;
  intermediateEndTime1: string;
  intermediateStartTime2: string;
  intermediateEndTime2: string;
  peakReserveThreshold: number;
  // Feature 4.6: Suporte a Tarifação Horária Inteligente (Tarifa Branca / Time-of-Use)
  isTimeOfUseActive?: boolean;
  timeOfUseWeekdaysOnly?: boolean;
  intermediateStartTime?: string | null;
  intermediateEndTime?: string | null;
  peakDischargeReserveLimit?: number;
  blockAcChargingDuringPeak?: boolean;
  inverterMaxWatts: number;
  isAlertOnBlackout: boolean;
  isAlertOnGridRestore: boolean;
  isAlertOnOverload: boolean;
  isAlertOnThermalRisk: boolean;
  isAlertOnAtsFailure: boolean;
  alertCooldownMinutes: number;
  // Feature 3.2: Solar Smart Charging (Etapa 4)
  isSmartChargingActive: boolean;
  minAcChargingWatts: number;
  maxAcChargingWatts: number;
  currentAcChargingWatts: number;
  chargeOnlyOffPeak: boolean;
  cloudyPrechargeActive: boolean;
  lastSmartChargeAdjustAt: Date | null;
  // Feature 4.5: Automações Meteorológicas & Auto-Storm
  isAutoStormActive?: boolean;
  autoStormReserveThreshold?: number;
  autoStormRainThresholdMm?: number;
  autoStormPrechargeAc?: boolean;
  isStormAlertActive?: boolean;
  lastStormAlertCode?: number | null;
  lastStormAlertDescription?: string | null;
  lastStormAlertTriggeredAt?: Date | null;
  lastStormAlertEndedAt?: Date | null;
  // Parâmetros Financeiros de Retorno sobre Investimento (CAPEX / Payback)
  totalCapexBrl?: number;
  installationDate?: Date | null;
  annualEnergyInflationRate?: number;
  targetPaybackYears?: number;
  capexNotes?: string | null;
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
    outputWatts = 0,
    batteryTempCelsius?: number | null,
    batterySoh?: number | null,
    batteryCycles?: number | null
  ): Promise<void> {
    await this.databaseClient.syncExecutionLog.create({
      data: {
        userConfigurationId: configurationId,
        batteryPercentage: batteryPercentage,
        solarInputWatts: solarInputWatts,
        outputWatts: outputWatts,
        actionTriggered: actionTriggered,
        executionDetails: executionDetails,
        batteryTempCelsius: batteryTempCelsius ?? null,
        batterySoh: batterySoh ?? null,
        batteryCycles: batteryCycles ?? null,
      },
    });
  }

  public async updateBmsTelemetry(
    configurationId: string,
    bms: {
      tempCelsius: number;
      soh?: number | null;
      cycles?: number | null;
    }
  ): Promise<void> {
    const current = await this.databaseClient.userConfiguration.findUnique({
      where: { id: configurationId },
      select: { maxRecordedBatteryTemp: true },
    });
    const previousMax = current?.maxRecordedBatteryTemp ?? 0;
    const newMax = Math.max(previousMax, bms.tempCelsius);

    await this.databaseClient.userConfiguration.update({
      where: { id: configurationId },
      data: {
        lastBatteryTempCelsius: bms.tempCelsius,
        ...(bms.soh !== undefined && bms.soh !== null ? { lastBatterySoh: bms.soh } : {}),
        ...(bms.cycles !== undefined && bms.cycles !== null ? { lastBatteryCycles: bms.cycles } : {}),
        maxRecordedBatteryTemp: newMax,
      },
    });
  }

  public async updateSolarForecast(
    configurationId: string,
    irradianceMj: number
  ): Promise<void> {
    await this.databaseClient.userConfiguration.update({
      where: { id: configurationId },
      data: {
        lastSolarIrradianceMj: irradianceMj,
        lastSolarForecastCheckAt: new Date(),
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

    let lastBatteryPercentage: number | null = null;
    if (this.databaseClient?.syncExecutionLog?.findFirst) {
      try {
        const latestLog = await this.databaseClient.syncExecutionLog.findFirst({
          where: { userConfigurationId: rawRecord.id },
          orderBy: { executedAt: "desc" },
          select: { batteryPercentage: true },
        });
        if (latestLog && typeof latestLog.batteryPercentage === "number") {
          lastBatteryPercentage = latestLog.batteryPercentage;
        }
      } catch {
        // Fallback silencioso caso findFirst não esteja disponível no mock
      }
    }

    const candidateLastBattery =
      lastBatteryPercentage ??
      ((rawRecord as unknown as Record<string, unknown>)["lastBatteryPercentage"] as number | null) ??
      null;

    const resolvedTariffActive = Boolean(
      rawRecord.isTimeOfUseActive ?? rawRecord.isDynamicTariffActive ?? false
    );

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
      latitude: rawRecord.latitude ?? null,
      longitude: rawRecord.longitude ?? null,
      isAdaptiveHysteresisActive: rawRecord.isAdaptiveHysteresisActive ?? false,
      minAdaptiveThreshold: rawRecord.minAdaptiveThreshold ?? 20,
      maxAdaptiveThreshold: rawRecord.maxAdaptiveThreshold ?? 50,
      lastSolarIrradianceMj: rawRecord.lastSolarIrradianceMj ?? null,
      lastSolarForecastCheckAt: rawRecord.lastSolarForecastCheckAt ?? null,
      thermalWarningThreshold: rawRecord.thermalThrottleTempThreshold ?? rawRecord.thermalWarningThreshold ?? 42.0,
      thermalShutdownThreshold: rawRecord.thermalCutoffTempThreshold ?? rawRecord.thermalShutdownThreshold ?? 48.0,
      isThermalProtectionActive: rawRecord.isThermalProtectionActive ?? true,
      thermalThrottleTempThreshold: rawRecord.thermalThrottleTempThreshold ?? Math.round(rawRecord.thermalWarningThreshold ?? 42),
      thermalCutoffTempThreshold: rawRecord.thermalCutoffTempThreshold ?? Math.round(rawRecord.thermalShutdownThreshold ?? 48),
      thermalRecoveryTempThreshold: rawRecord.thermalRecoveryTempThreshold ?? 44,
      thermalThrottleSpeedWatts: rawRecord.thermalThrottleSpeedWatts ?? 200,
      isThermalThrottleActive: rawRecord.isThermalThrottleActive ?? false,
      isThermalCutoffActive: rawRecord.isThermalCutoffActive ?? false,
      lastThermalEventAt: rawRecord.lastThermalEventAt ?? null,
      lastThermalActionMessage: rawRecord.lastThermalActionMessage ?? null,
      lastBatteryTempCelsius: rawRecord.lastBatteryTempCelsius ?? null,
      lastBatterySoh: rawRecord.lastBatterySoh ?? null,
      lastBatteryCycles: rawRecord.lastBatteryCycles ?? null,
      maxRecordedBatteryTemp: rawRecord.maxRecordedBatteryTemp ?? null,
      lastBatteryPercentage: candidateLastBattery,
      isDynamicTariffActive: resolvedTariffActive,
      peakTariffPerKwh: rawRecord.peakTariffPerKwh ?? 1.85,
      intermediateTariffPerKwh: rawRecord.intermediateTariffPerKwh ?? 1.15,
      offPeakTariffPerKwh: rawRecord.offPeakTariffPerKwh ?? 0.65,
      peakStartTime: rawRecord.peakStartTime ?? "17:30",
      peakEndTime: rawRecord.peakEndTime ?? "20:30",
      intermediateStartTime1: rawRecord.intermediateStartTime1 ?? "16:30",
      intermediateEndTime1: rawRecord.intermediateEndTime1 ?? "17:30",
      intermediateStartTime2: rawRecord.intermediateStartTime2 ?? "20:30",
      intermediateEndTime2: rawRecord.intermediateEndTime2 ?? "21:30",
      peakReserveThreshold: rawRecord.peakReserveThreshold ?? 15,
      isTimeOfUseActive: resolvedTariffActive,
      timeOfUseWeekdaysOnly: rawRecord.timeOfUseWeekdaysOnly ?? true,
      intermediateStartTime: rawRecord.intermediateStartTime ?? rawRecord.intermediateStartTime1 ?? "16:30",
      intermediateEndTime: rawRecord.intermediateEndTime ?? rawRecord.intermediateEndTime2 ?? "21:30",
      peakDischargeReserveLimit: rawRecord.peakDischargeReserveLimit ?? rawRecord.peakReserveThreshold ?? 20,
      blockAcChargingDuringPeak: rawRecord.blockAcChargingDuringPeak ?? true,
      inverterMaxWatts: rawRecord.inverterMaxWatts ?? 2400,
      isAlertOnBlackout: rawRecord.isAlertOnBlackout ?? true,
      isAlertOnGridRestore: rawRecord.isAlertOnGridRestore ?? true,
      isAlertOnOverload: rawRecord.isAlertOnOverload ?? true,
      isAlertOnThermalRisk: rawRecord.isAlertOnThermalRisk ?? true,
      isAlertOnAtsFailure: rawRecord.isAlertOnAtsFailure ?? true,
      alertCooldownMinutes: rawRecord.alertCooldownMinutes ?? 10,
      isSmartChargingActive: rawRecord.isSmartChargingActive ?? false,
      minAcChargingWatts: rawRecord.minAcChargingWatts ?? 200,
      maxAcChargingWatts: rawRecord.maxAcChargingWatts ?? 1200,
      currentAcChargingWatts: rawRecord.currentAcChargingWatts ?? 400,
      chargeOnlyOffPeak: rawRecord.chargeOnlyOffPeak ?? true,
      cloudyPrechargeActive: rawRecord.cloudyPrechargeActive ?? true,
      lastSmartChargeAdjustAt: rawRecord.lastSmartChargeAdjustAt ?? null,
      isAutoStormActive: rawRecord.isAutoStormActive ?? false,
      autoStormReserveThreshold: rawRecord.autoStormReserveThreshold ?? 85,
      autoStormRainThresholdMm: rawRecord.autoStormRainThresholdMm ?? 20.0,
      autoStormPrechargeAc: rawRecord.autoStormPrechargeAc ?? true,
      isStormAlertActive: rawRecord.isStormAlertActive ?? false,
      lastStormAlertCode: rawRecord.lastStormAlertCode ?? null,
      lastStormAlertDescription: rawRecord.lastStormAlertDescription ?? null,
      lastStormAlertTriggeredAt: rawRecord.lastStormAlertTriggeredAt ?? null,
      lastStormAlertEndedAt: rawRecord.lastStormAlertEndedAt ?? null,
      totalCapexBrl: rawRecord.totalCapexBrl ?? 0.0,
      installationDate: rawRecord.installationDate ?? null,
      annualEnergyInflationRate: rawRecord.annualEnergyInflationRate ?? 6.5,
      targetPaybackYears: rawRecord.targetPaybackYears ?? 3.0,
      capexNotes: rawRecord.capexNotes ?? null,
    };
  }

  public async updateStormAlertStatus(
    configurationId: string,
    data: {
      isStormAlertActive: boolean;
      lastStormAlertCode?: number | null;
      lastStormAlertDescription?: string | null;
      lastStormAlertTriggeredAt?: Date | null;
      lastStormAlertEndedAt?: Date | null;
    }
  ): Promise<void> {
    await this.databaseClient.userConfiguration.update({
      where: { id: configurationId },
      data,
    });
  }

  public async updateThermalState(
    configurationId: string,
    data: {
      isThermalThrottleActive?: boolean;
      isThermalCutoffActive?: boolean;
      lastThermalEventAt?: Date | null;
      lastThermalActionMessage?: string | null;
    }
  ): Promise<void> {
    if (!this.databaseClient?.userConfiguration?.update) {
      return;
    }
    await this.databaseClient.userConfiguration.update({
      where: { id: configurationId },
      data,
    });
  }

  public async updateCurrentAcChargingWatts(
    configurationId: string,
    watts: number
  ): Promise<void> {
    await this.databaseClient.userConfiguration.update({
      where: { id: configurationId },
      data: {
        currentAcChargingWatts: watts,
        lastSmartChargeAdjustAt: new Date(),
      },
    });
  }
}
