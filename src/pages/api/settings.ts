import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
} from "../../infrastructure/auth/sessionHelper";
import {
  isAllowedEcoFlowEndpointRegion,
  resolveEcoFlowEndpointRegion,
} from "../../infrastructure/security/ecoflowAllowlist";
import {
  encryptSecretIfPresent,
  getEncryptionKey,
  isUnchangedOrMaskedSecret,
  maskSecretIrreversible,
} from "../../infrastructure/security/encryptionHelper";
import { decryptAndMigrateConfigurationSecrets } from "../../infrastructure/security/secretMigrationHelper";
import { EcoFlowMqttStreamService } from "../../infrastructure/services/EcoFlowMqttStreamService";
import { settingsPostBodySchema } from "../../infrastructure/security/apiSchemas";

export interface SettingsResponseData {
  ecoflowEndpointRegion: string;
  ecoflowAccessKey: string;
  hasEcoflowAccessSecret: boolean;
  ecoflowAccessSecretMasked: string;
  ecoflowSerialNumber: string;
  tuyaAccessId: string;
  hasTuyaAccessSecret: boolean;
  tuyaAccessSecretMasked: string;
  tuyaDeviceId: string;
  tuyaEndpointRegion: string;
  hasTelegramBotToken: boolean;
  telegramBotTokenMasked: string;
  telegramChatId: string;
  whatsappPhoneNumber: string;
  hasWhatsappApiKey: boolean;
  whatsappApiKeyMasked: string;
  isNotificationActive: boolean;
  atsLifespanCycles: number;
  atsCurrentCycles: number;
  atsLastSwitchedAt: string | null;
  energyCostPerKwh: number;
  currencySymbol: string;
  batteryCapacityWh: number;
  isStormModeActive: boolean;
  isDailyReportActive: boolean;
  dailyReportTime: string;
  lastDailyReportSentAt: string | null;
  latitude: number | null;
  longitude: number | null;
  isAdaptiveHysteresisActive: boolean;
  isDaylightOnlyActive: boolean;
  minAdaptiveThreshold: number;
  maxAdaptiveThreshold: number;
  thermalWarningThreshold: number;
  thermalShutdownThreshold: number;
  lastBatteryTempCelsius: number | null;
  lastBatterySoh: number | null;
  lastBatteryCycles: number | null;
  maxRecordedBatteryTemp: number | null;
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
  lastSmartChargeAdjustAt: string | null;
  // Feature 4.5: Automações Meteorológicas & Auto-Storm
  isAutoStormActive: boolean;
  autoStormReserveThreshold: number;
  autoStormRainThresholdMm: number;
  autoStormPrechargeAc: boolean;
  isStormAlertActive: boolean;
  lastStormAlertCode: number | null;
  lastStormAlertDescription: string | null;
  lastStormAlertTriggeredAt: string | null;
  lastStormAlertEndedAt: string | null;
  // Feature 4.6: Suporte a Tarifação Horária Inteligente (Tarifa Branca / Time-of-Use)
  isTimeOfUseActive: boolean;
  timeOfUseWeekdaysOnly: boolean;
  intermediateStartTime: string | null;
  intermediateEndTime: string | null;
  peakDischargeReserveLimit: number;
  blockAcChargingDuringPeak: boolean;
  // Feature BMS: Monitoramento de Saúde da Bateria & Proteção Térmica
  isThermalProtectionActive: boolean;
  thermalThrottleTempThreshold: number;
  thermalCutoffTempThreshold: number;
  thermalRecoveryTempThreshold: number;
  thermalThrottleSpeedWatts: number;
  isThermalThrottleActive: boolean;
  isThermalCutoffActive: boolean;
  lastThermalEventAt: string | null;
  lastThermalActionMessage: string | null;
  // Parâmetros Financeiros de Retorno sobre Investimento (CAPEX / Payback)
  totalCapexBrl: number;
  installationDate: string | null;
  annualEnergyInflationRate: number;
  targetPaybackYears: number;
  capexNotes: string | null;
}

interface SettingsResponseBody {
  success: boolean;
  message: string;
  data?: SettingsResponseData;
}

export default async function handleSettings(
  request: NextApiRequest,
  response: NextApiResponse<SettingsResponseBody>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno na configuração de autenticação do servidor.";
    response.status(500).json({
      success: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Por favor, faça login para acessar as configurações.",
    });
    return;
  }

  if (request.method === "POST") {
    if (!enforceCsrfProtection(request, response)) {
      return;
    }
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  if (request.method === "GET") {
    try {
      getEncryptionKey();
    } catch (keyError: unknown) {
      console.error("[Settings API] Falha de configuração ENCRYPTION_KEY:", keyError);
      response.status(500).json({
        success: false,
        message: "Erro interno de configuração da chave ENCRYPTION_KEY no servidor.",
      });
      return;
    }

    try {
      const existing = await prisma.userConfiguration.findUnique({
        where: { userId: extractedUserId },
      });

      if (!existing) {
        response.status(200).json({
          success: true,
          message: "Nenhuma configuração cadastrada.",
        });
        return;
      }

      const decryptedSecrets = await decryptAndMigrateConfigurationSecrets(prisma, existing);

      response.status(200).json({
        success: true,
        message: "Configurações carregadas com sucesso.",
        data: {
          ecoflowEndpointRegion: existing.ecoflowEndpointRegion,
          ecoflowAccessKey: existing.ecoflowAccessKey,
          hasEcoflowAccessSecret: decryptedSecrets.ecoflowAccessSecret.length > 0,
          ecoflowAccessSecretMasked: maskSecretIrreversible(decryptedSecrets.ecoflowAccessSecret),
          ecoflowSerialNumber: existing.ecoflowSerialNumber,
          tuyaAccessId: existing.tuyaAccessId || "",
          hasTuyaAccessSecret: decryptedSecrets.tuyaAccessSecret.length > 0,
          tuyaAccessSecretMasked: maskSecretIrreversible(decryptedSecrets.tuyaAccessSecret),
          tuyaDeviceId: existing.tuyaDeviceId || "",
          tuyaEndpointRegion: existing.tuyaEndpointRegion || "https://openapi.tuyaus.com",
          hasTelegramBotToken: decryptedSecrets.telegramBotToken.length > 0,
          telegramBotTokenMasked: maskSecretIrreversible(decryptedSecrets.telegramBotToken),
          telegramChatId: existing.telegramChatId || "",
          whatsappPhoneNumber: existing.whatsappPhoneNumber || "",
          hasWhatsappApiKey: decryptedSecrets.whatsappApiKey.length > 0,
          whatsappApiKeyMasked: maskSecretIrreversible(decryptedSecrets.whatsappApiKey),
          isNotificationActive: existing.isNotificationActive ?? true,
          atsLifespanCycles: existing.atsLifespanCycles ?? 10000,
          atsCurrentCycles: existing.atsCurrentCycles ?? 0,
          atsLastSwitchedAt: existing.atsLastSwitchedAt ? existing.atsLastSwitchedAt.toISOString() : null,
          energyCostPerKwh: existing.energyCostPerKwh ?? 0.92,
          currencySymbol: existing.currencySymbol ?? "R$",
          batteryCapacityWh: existing.batteryCapacityWh ?? 2048,
          isStormModeActive: existing.isStormModeActive ?? false,
          isDailyReportActive: existing.isDailyReportActive ?? true,
          dailyReportTime: existing.dailyReportTime || "21:00",
          lastDailyReportSentAt: existing.lastDailyReportSentAt ? existing.lastDailyReportSentAt.toISOString() : null,
          latitude: existing.latitude ?? null,
          longitude: existing.longitude ?? null,
          isAdaptiveHysteresisActive: existing.isAdaptiveHysteresisActive ?? false,
          isDaylightOnlyActive: existing.isDaylightOnlyActive ?? false,
          minAdaptiveThreshold: existing.minAdaptiveThreshold ?? 20,
          maxAdaptiveThreshold: existing.maxAdaptiveThreshold ?? 50,
          thermalWarningThreshold: existing.thermalWarningThreshold ?? 45.0,
          thermalShutdownThreshold: existing.thermalShutdownThreshold ?? 50.0,
          lastBatteryTempCelsius: existing.lastBatteryTempCelsius ?? null,
          lastBatterySoh: existing.lastBatterySoh ?? null,
          lastBatteryCycles: existing.lastBatteryCycles ?? null,
          maxRecordedBatteryTemp: existing.maxRecordedBatteryTemp ?? null,
          isDynamicTariffActive: existing.isDynamicTariffActive ?? false,
          peakTariffPerKwh: existing.peakTariffPerKwh ?? 1.85,
          intermediateTariffPerKwh: existing.intermediateTariffPerKwh ?? 1.15,
          offPeakTariffPerKwh: existing.offPeakTariffPerKwh ?? 0.65,
          peakStartTime: existing.peakStartTime || "17:30",
          peakEndTime: existing.peakEndTime || "20:30",
          intermediateStartTime1: existing.intermediateStartTime1 || "16:30",
          intermediateEndTime1: existing.intermediateEndTime1 || "17:30",
          intermediateStartTime2: existing.intermediateStartTime2 || "20:30",
          intermediateEndTime2: existing.intermediateEndTime2 || "21:30",
          peakReserveThreshold: existing.peakReserveThreshold ?? 15,
          inverterMaxWatts: existing.inverterMaxWatts ?? 2400,
          isAlertOnBlackout: existing.isAlertOnBlackout ?? true,
          isAlertOnGridRestore: existing.isAlertOnGridRestore ?? true,
          isAlertOnOverload: existing.isAlertOnOverload ?? true,
          isAlertOnThermalRisk: existing.isAlertOnThermalRisk ?? true,
          isAlertOnAtsFailure: existing.isAlertOnAtsFailure ?? true,
          alertCooldownMinutes: existing.alertCooldownMinutes ?? 10,
          isSmartChargingActive: existing.isSmartChargingActive ?? false,
          minAcChargingWatts: existing.minAcChargingWatts ?? 200,
          maxAcChargingWatts: existing.maxAcChargingWatts ?? 1200,
          currentAcChargingWatts: existing.currentAcChargingWatts ?? 400,
          chargeOnlyOffPeak: existing.chargeOnlyOffPeak ?? true,
          cloudyPrechargeActive: existing.cloudyPrechargeActive ?? true,
          lastSmartChargeAdjustAt: existing.lastSmartChargeAdjustAt?.toISOString() ?? null,
          isAutoStormActive: existing.isAutoStormActive ?? false,
          autoStormReserveThreshold: existing.autoStormReserveThreshold ?? 85,
          autoStormRainThresholdMm: existing.autoStormRainThresholdMm ?? 20.0,
          autoStormPrechargeAc: existing.autoStormPrechargeAc ?? true,
          isStormAlertActive: existing.isStormAlertActive ?? false,
          lastStormAlertCode: existing.lastStormAlertCode ?? null,
          lastStormAlertDescription: existing.lastStormAlertDescription ?? null,
          lastStormAlertTriggeredAt: existing.lastStormAlertTriggeredAt?.toISOString() ?? null,
          lastStormAlertEndedAt: existing.lastStormAlertEndedAt?.toISOString() ?? null,
          isTimeOfUseActive: existing.isTimeOfUseActive ?? existing.isDynamicTariffActive ?? false,
          timeOfUseWeekdaysOnly: existing.timeOfUseWeekdaysOnly ?? true,
          intermediateStartTime: existing.intermediateStartTime ?? existing.intermediateStartTime1 ?? "16:30",
          intermediateEndTime: existing.intermediateEndTime ?? existing.intermediateEndTime2 ?? "21:30",
          peakDischargeReserveLimit: existing.peakDischargeReserveLimit ?? existing.peakReserveThreshold ?? 20,
          blockAcChargingDuringPeak: existing.blockAcChargingDuringPeak ?? true,
          // Feature BMS: Monitoramento de Saúde da Bateria & Proteção Térmica
          isThermalProtectionActive: existing.isThermalProtectionActive ?? true,
          thermalThrottleTempThreshold: existing.thermalThrottleTempThreshold ?? 42,
          thermalCutoffTempThreshold: existing.thermalCutoffTempThreshold ?? 48,
          thermalRecoveryTempThreshold: existing.thermalRecoveryTempThreshold ?? 44,
          thermalThrottleSpeedWatts: existing.thermalThrottleSpeedWatts ?? 200,
          isThermalThrottleActive: existing.isThermalThrottleActive ?? false,
          isThermalCutoffActive: existing.isThermalCutoffActive ?? false,
          lastThermalEventAt: existing.lastThermalEventAt ? existing.lastThermalEventAt.toISOString() : null,
          lastThermalActionMessage: existing.lastThermalActionMessage ?? null,
          // Parâmetros de CAPEX / Payback
          totalCapexBrl: existing.totalCapexBrl ?? 0.0,
          installationDate: existing.installationDate ? existing.installationDate.toISOString() : null,
          annualEnergyInflationRate: existing.annualEnergyInflationRate ?? 6.5,
          targetPaybackYears: existing.targetPaybackYears ?? 3.0,
          capexNotes: existing.capexNotes ?? null,
        },
      });
      return;
    } catch (readError: unknown) {
      console.error("[Settings API] Erro interno ao carregar/decifrar configurações:", readError);
      response.status(500).json({
        success: false,
        message: "Erro interno ao carregar configurações.",
      });
      return;
    }
  }

  if (request.method === "POST") {
    const parsedBody = settingsPostBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      const issueMessage =
        parsedBody.error.issues[0]?.message ||
        "Dados de configuração inválidos ou excedem o tamanho máximo permitido.";
      response.status(400).json({
        success: false,
        message: issueMessage,
      });
      return;
    }

    const {
      ecoflowEndpointRegion,
      ecoflowAccessKey: normalizedAccessKey,
      ecoflowAccessSecret,
      ecoflowSerialNumber: normalizedSerialNumber,
      tuyaAccessId,
      tuyaAccessSecret,
      tuyaDeviceId,
      tuyaEndpointRegion,
      telegramBotToken,
      telegramChatId,
      whatsappPhoneNumber,
      whatsappApiKey,
      isNotificationActive,
      atsLifespanCycles,
      atsCurrentCycles,
      energyCostPerKwh,
      currencySymbol,
      batteryCapacityWh,
      isStormModeActive,
      isDailyReportActive,
      dailyReportTime,
      latitude,
      longitude,
      isAdaptiveHysteresisActive,
      isDaylightOnlyActive,
      minAdaptiveThreshold,
      maxAdaptiveThreshold,
      thermalWarningThreshold,
      thermalShutdownThreshold,
      isDynamicTariffActive,
      peakTariffPerKwh,
      intermediateTariffPerKwh,
      offPeakTariffPerKwh,
      peakStartTime,
      peakEndTime,
      intermediateStartTime1,
      intermediateEndTime1,
      intermediateStartTime2,
      intermediateEndTime2,
      peakReserveThreshold,
      inverterMaxWatts,
      isAlertOnBlackout,
      isAlertOnGridRestore,
      isAlertOnOverload,
      isAlertOnThermalRisk,
      isAlertOnAtsFailure,
      alertCooldownMinutes,
      isSmartChargingActive,
      minAcChargingWatts,
      maxAcChargingWatts,
      chargeOnlyOffPeak,
      cloudyPrechargeActive,
      isAutoStormActive,
      autoStormReserveThreshold,
      autoStormRainThresholdMm,
      autoStormPrechargeAc,
      isTimeOfUseActive,
      timeOfUseWeekdaysOnly,
      intermediateStartTime,
      intermediateEndTime,
      peakDischargeReserveLimit,
      blockAcChargingDuringPeak,
      isThermalProtectionActive,
      thermalThrottleTempThreshold,
      thermalCutoffTempThreshold,
      thermalRecoveryTempThreshold,
      thermalThrottleSpeedWatts,
      // Parâmetros de CAPEX / Payback
      totalCapexBrl,
      installationDate,
      annualEnergyInflationRate,
      targetPaybackYears,
      capexNotes,
    } = parsedBody.data;

    if (
      ecoflowEndpointRegion !== undefined &&
      ecoflowEndpointRegion !== "" &&
      !isAllowedEcoFlowEndpointRegion(ecoflowEndpointRegion)
    ) {
      response.status(400).json({
        success: false,
        message:
          "Região de endpoint EcoFlow inválida. Utilize apenas https://api.ecoflow.com ou https://api-e.ecoflow.com.",
      });
      return;
    }

    try {
      getEncryptionKey();
    } catch (keyError: unknown) {
      console.error("[Settings API] Falha de configuração ENCRYPTION_KEY:", keyError);
      response.status(500).json({
        success: false,
        message: "Erro interno de configuração da chave ENCRYPTION_KEY no servidor.",
      });
      return;
    }

    try {
      const existingConfig = await prisma.userConfiguration.findUnique({
        where: { userId: extractedUserId },
      });

      const existingDecrypted = await decryptAndMigrateConfigurationSecrets(
        prisma,
        existingConfig
      );

      const fallbackRegion = isAllowedEcoFlowEndpointRegion(existingConfig?.ecoflowEndpointRegion)
        ? existingConfig.ecoflowEndpointRegion.trim()
        : undefined;
      const validatedEndpointRegion =
        ecoflowEndpointRegion !== undefined && ecoflowEndpointRegion !== ""
          ? resolveEcoFlowEndpointRegion(ecoflowEndpointRegion)
          : resolveEcoFlowEndpointRegion(fallbackRegion);

      const resolvedPlainEcoFlowKey =
        typeof normalizedAccessKey === "string" && normalizedAccessKey.trim().length > 0
          ? normalizedAccessKey.trim()
          : existingConfig?.ecoflowAccessKey ?? "";

      const resolvedPlainEcoFlowSerial =
        typeof normalizedSerialNumber === "string" && normalizedSerialNumber.trim().length > 0
          ? normalizedSerialNumber.trim()
          : existingConfig?.ecoflowSerialNumber ?? "";

      const resolvedPlainEcoFlowSecret = isUnchangedOrMaskedSecret(ecoflowAccessSecret)
        ? existingDecrypted.ecoflowAccessSecret
        : (ecoflowAccessSecret as string).trim();

      if (!resolvedPlainEcoFlowKey || !resolvedPlainEcoFlowSecret || !resolvedPlainEcoFlowSerial) {
        response.status(400).json({
          success: false,
          message: "Access Key, Secret Key e Serial Number da EcoFlow são obrigatórios.",
        });
        return;
      }

      const resolvedPlainTuyaSecret = isUnchangedOrMaskedSecret(tuyaAccessSecret)
        ? existingDecrypted.tuyaAccessSecret
        : (tuyaAccessSecret as string).trim();

      const resolvedPlainTelegramToken = isUnchangedOrMaskedSecret(telegramBotToken)
        ? existingDecrypted.telegramBotToken
        : (telegramBotToken as string).trim();

      const resolvedPlainWhatsAppKey = isUnchangedOrMaskedSecret(whatsappApiKey)
        ? existingDecrypted.whatsappApiKey
        : (whatsappApiKey as string).trim();

      const encryptedEcoFlowSecret = encryptSecretIfPresent(resolvedPlainEcoFlowSecret);
      const encryptedTuyaSecret = encryptSecretIfPresent(resolvedPlainTuyaSecret);
      const encryptedTelegramToken = encryptSecretIfPresent(resolvedPlainTelegramToken);
      const encryptedWhatsAppKey = encryptSecretIfPresent(resolvedPlainWhatsAppKey);

      const resolvedTuyaAccessId =
        typeof tuyaAccessId === "string" ? tuyaAccessId.trim() : existingConfig?.tuyaAccessId ?? "";
      const resolvedTuyaDeviceId =
        typeof tuyaDeviceId === "string" ? tuyaDeviceId.trim() : existingConfig?.tuyaDeviceId ?? "";
      const resolvedTuyaEndpointRegion =
        typeof tuyaEndpointRegion === "string" && tuyaEndpointRegion.trim().length > 0
          ? tuyaEndpointRegion.trim()
          : existingConfig?.tuyaEndpointRegion || "https://openapi.tuyaus.com";
      const resolvedTelegramChatId =
        typeof telegramChatId === "string"
          ? telegramChatId.trim()
          : existingConfig?.telegramChatId ?? "";
      const resolvedWhatsappPhone =
        typeof whatsappPhoneNumber === "string"
          ? whatsappPhoneNumber.trim()
          : existingConfig?.whatsappPhoneNumber ?? "";
      const resolvedNotificationActive =
        typeof isNotificationActive === "boolean"
          ? isNotificationActive
          : existingConfig?.isNotificationActive ?? true;
      const resolvedAtsLifespanCycles =
        typeof atsLifespanCycles === "number"
          ? atsLifespanCycles
          : existingConfig?.atsLifespanCycles ?? 10000;
      const resolvedAtsCurrentCycles =
        typeof atsCurrentCycles === "number"
          ? atsCurrentCycles
          : existingConfig?.atsCurrentCycles ?? 0;
      const resolvedEnergyCostPerKwh =
        typeof energyCostPerKwh === "number"
          ? energyCostPerKwh
          : existingConfig?.energyCostPerKwh ?? 0.92;
      const resolvedCurrencySymbol =
        typeof currencySymbol === "string" && currencySymbol.trim().length > 0
          ? currencySymbol.trim()
          : existingConfig?.currencySymbol ?? "R$";
      const resolvedBatteryCapacityWh =
        typeof batteryCapacityWh === "number"
          ? batteryCapacityWh
          : existingConfig?.batteryCapacityWh ?? 2048;
      const resolvedStormModeActive =
        typeof isStormModeActive === "boolean"
          ? isStormModeActive
          : existingConfig?.isStormModeActive ?? false;
      const resolvedDailyReportActive =
        typeof isDailyReportActive === "boolean"
          ? isDailyReportActive
          : existingConfig?.isDailyReportActive ?? true;
      const resolvedDailyReportTime =
        typeof dailyReportTime === "string" && dailyReportTime.trim().length > 0
          ? dailyReportTime.trim()
          : existingConfig?.dailyReportTime ?? "21:00";
      const resolvedLatitude =
        latitude !== undefined ? latitude : existingConfig?.latitude ?? null;
      const resolvedLongitude =
        longitude !== undefined ? longitude : existingConfig?.longitude ?? null;
      const resolvedAdaptiveHysteresis =
        typeof isAdaptiveHysteresisActive === "boolean"
          ? isAdaptiveHysteresisActive
          : existingConfig?.isAdaptiveHysteresisActive ?? false;
      const resolvedDaylightOnly =
        typeof isDaylightOnlyActive === "boolean"
          ? isDaylightOnlyActive
          : existingConfig?.isDaylightOnlyActive ?? false;
      const resolvedMinAdaptive =
        typeof minAdaptiveThreshold === "number"
          ? minAdaptiveThreshold
          : existingConfig?.minAdaptiveThreshold ?? 20;
      const resolvedMaxAdaptive =
        typeof maxAdaptiveThreshold === "number"
          ? maxAdaptiveThreshold
          : existingConfig?.maxAdaptiveThreshold ?? 50;
      const resolvedThermalWarning =
        typeof thermalWarningThreshold === "number"
          ? thermalWarningThreshold
          : existingConfig?.thermalWarningThreshold ?? 45.0;
      const resolvedThermalShutdown =
        typeof thermalShutdownThreshold === "number"
          ? thermalShutdownThreshold
          : existingConfig?.thermalShutdownThreshold ?? 50.0;
      const resolvedTariffSyncActive =
        typeof isTimeOfUseActive === "boolean"
          ? isTimeOfUseActive
          : typeof isDynamicTariffActive === "boolean"
          ? isDynamicTariffActive
          : existingConfig?.isTimeOfUseActive ?? existingConfig?.isDynamicTariffActive ?? false;
      const resolvedDynamicTariff = resolvedTariffSyncActive;
      const resolvedPeakTariff =
        typeof peakTariffPerKwh === "number"
          ? peakTariffPerKwh
          : existingConfig?.peakTariffPerKwh ?? 1.85;
      const resolvedIntermediateTariff =
        typeof intermediateTariffPerKwh === "number"
          ? intermediateTariffPerKwh
          : existingConfig?.intermediateTariffPerKwh ?? 1.15;
      const resolvedOffPeakTariff =
        typeof offPeakTariffPerKwh === "number"
          ? offPeakTariffPerKwh
          : existingConfig?.offPeakTariffPerKwh ?? 0.65;
      const resolvedPeakStartTime =
        typeof peakStartTime === "string" && peakStartTime.trim().length > 0
          ? peakStartTime.trim()
          : existingConfig?.peakStartTime ?? "17:30";
      const resolvedPeakEndTime =
        typeof peakEndTime === "string" && peakEndTime.trim().length > 0
          ? peakEndTime.trim()
          : existingConfig?.peakEndTime ?? "20:30";
      const resolvedInterStartTime1 =
        typeof intermediateStartTime1 === "string" && intermediateStartTime1.trim().length > 0
          ? intermediateStartTime1.trim()
          : existingConfig?.intermediateStartTime1 ?? "16:30";
      const resolvedInterEndTime1 =
        typeof intermediateEndTime1 === "string" && intermediateEndTime1.trim().length > 0
          ? intermediateEndTime1.trim()
          : existingConfig?.intermediateEndTime1 ?? "17:30";
      const resolvedInterStartTime2 =
        typeof intermediateStartTime2 === "string" && intermediateStartTime2.trim().length > 0
          ? intermediateStartTime2.trim()
          : existingConfig?.intermediateStartTime2 ?? "20:30";
      const resolvedInterEndTime2 =
        typeof intermediateEndTime2 === "string" && intermediateEndTime2.trim().length > 0
          ? intermediateEndTime2.trim()
          : existingConfig?.intermediateEndTime2 ?? "21:30";
      const resolvedPeakReserve =
        typeof peakReserveThreshold === "number"
          ? peakReserveThreshold
          : existingConfig?.peakReserveThreshold ?? 15;
      const resolvedInverterMaxWatts =
        typeof inverterMaxWatts === "number"
          ? inverterMaxWatts
          : existingConfig?.inverterMaxWatts ?? 2400;
      const resolvedAlertBlackout =
        typeof isAlertOnBlackout === "boolean"
          ? isAlertOnBlackout
          : existingConfig?.isAlertOnBlackout ?? true;
      const resolvedAlertGridRestore =
        typeof isAlertOnGridRestore === "boolean"
          ? isAlertOnGridRestore
          : existingConfig?.isAlertOnGridRestore ?? true;
      const resolvedAlertOverload =
        typeof isAlertOnOverload === "boolean"
          ? isAlertOnOverload
          : existingConfig?.isAlertOnOverload ?? true;
      const resolvedAlertThermalRisk =
        typeof isAlertOnThermalRisk === "boolean"
          ? isAlertOnThermalRisk
          : existingConfig?.isAlertOnThermalRisk ?? true;
      const resolvedAlertAtsFailure =
        typeof isAlertOnAtsFailure === "boolean"
          ? isAlertOnAtsFailure
          : existingConfig?.isAlertOnAtsFailure ?? true;
      const resolvedAlertCooldown =
        typeof alertCooldownMinutes === "number"
          ? alertCooldownMinutes
          : existingConfig?.alertCooldownMinutes ?? 10;
      const resolvedSmartCharging =
        typeof isSmartChargingActive === "boolean"
          ? isSmartChargingActive
          : existingConfig?.isSmartChargingActive ?? false;
      const resolvedMinAcChargingWatts =
        typeof minAcChargingWatts === "number"
          ? minAcChargingWatts
          : existingConfig?.minAcChargingWatts ?? 200;
      const resolvedMaxAcChargingWatts =
        typeof maxAcChargingWatts === "number"
          ? maxAcChargingWatts
          : existingConfig?.maxAcChargingWatts ?? 1200;
      const resolvedChargeOnlyOffPeak =
        typeof chargeOnlyOffPeak === "boolean"
          ? chargeOnlyOffPeak
          : existingConfig?.chargeOnlyOffPeak ?? true;
      const resolvedCloudyPrecharge =
        typeof cloudyPrechargeActive === "boolean"
          ? cloudyPrechargeActive
          : existingConfig?.cloudyPrechargeActive ?? true;
      const resolvedAutoStormActive =
        typeof isAutoStormActive === "boolean"
          ? isAutoStormActive
          : existingConfig?.isAutoStormActive ?? false;
      const resolvedAutoStormReserve =
        typeof autoStormReserveThreshold === "number"
          ? autoStormReserveThreshold
          : existingConfig?.autoStormReserveThreshold ?? 85;
      const resolvedAutoStormRain =
        typeof autoStormRainThresholdMm === "number"
          ? autoStormRainThresholdMm
          : existingConfig?.autoStormRainThresholdMm ?? 20.0;
      const resolvedAutoStormPrecharge =
        typeof autoStormPrechargeAc === "boolean"
          ? autoStormPrechargeAc
          : existingConfig?.autoStormPrechargeAc ?? true;
      const resolvedTimeOfUseActive = resolvedTariffSyncActive;
      const resolvedTimeOfUseWeekdays =
        typeof timeOfUseWeekdaysOnly === "boolean"
          ? timeOfUseWeekdaysOnly
          : existingConfig?.timeOfUseWeekdaysOnly ?? true;
      const resolvedIntermediateStartTime =
        intermediateStartTime !== undefined
          ? intermediateStartTime
          : existingConfig?.intermediateStartTime ?? existingConfig?.intermediateStartTime1 ?? "16:30";
      const resolvedIntermediateEndTime =
        intermediateEndTime !== undefined
          ? intermediateEndTime
          : existingConfig?.intermediateEndTime ?? existingConfig?.intermediateEndTime2 ?? "21:30";
      const resolvedPeakDischargeReserve =
        typeof peakDischargeReserveLimit === "number"
          ? peakDischargeReserveLimit
          : typeof peakReserveThreshold === "number"
          ? peakReserveThreshold
          : existingConfig?.peakDischargeReserveLimit ?? existingConfig?.peakReserveThreshold ?? 20;
      const resolvedBlockAcChargingPeak =
        typeof blockAcChargingDuringPeak === "boolean"
          ? blockAcChargingDuringPeak
          : existingConfig?.blockAcChargingDuringPeak ?? true;
      const resolvedThermalProtection =
        typeof isThermalProtectionActive === "boolean"
          ? isThermalProtectionActive
          : existingConfig?.isThermalProtectionActive ?? true;
      const resolvedThermalThrottleTemp =
        typeof thermalThrottleTempThreshold === "number"
          ? thermalThrottleTempThreshold
          : existingConfig?.thermalThrottleTempThreshold ?? 42;
      const resolvedThermalCutoffTemp =
        typeof thermalCutoffTempThreshold === "number"
          ? thermalCutoffTempThreshold
          : existingConfig?.thermalCutoffTempThreshold ?? 48;
      const resolvedThermalRecoveryTemp =
        typeof thermalRecoveryTempThreshold === "number"
          ? thermalRecoveryTempThreshold
          : existingConfig?.thermalRecoveryTempThreshold ?? 44;
      const resolvedThermalThrottleSpeed =
        typeof thermalThrottleSpeedWatts === "number"
          ? thermalThrottleSpeedWatts
          : existingConfig?.thermalThrottleSpeedWatts ?? 200;
      const resolvedTotalCapex =
        typeof totalCapexBrl === "number" ? totalCapexBrl : existingConfig?.totalCapexBrl ?? 0.0;
      const resolvedInstallationDate =
        installationDate !== undefined
          ? installationDate
            ? new Date(installationDate)
            : null
          : existingConfig?.installationDate ?? new Date();
      const resolvedInflationRate =
        typeof annualEnergyInflationRate === "number"
          ? annualEnergyInflationRate
          : existingConfig?.annualEnergyInflationRate ?? 6.5;
      const resolvedTargetPaybackYears =
        typeof targetPaybackYears === "number"
          ? targetPaybackYears
          : existingConfig?.targetPaybackYears ?? 3.0;
      const resolvedCapexNotes =
        typeof capexNotes === "string" ? capexNotes.trim() : existingConfig?.capexNotes ?? null;

      await prisma.userConfiguration.upsert({
        where: { userId: extractedUserId },
        update: {
          ecoflowEndpointRegion: validatedEndpointRegion,
          ecoflowAccessKey: resolvedPlainEcoFlowKey,
          ecoflowAccessSecret: encryptedEcoFlowSecret,
          ecoflowSerialNumber: resolvedPlainEcoFlowSerial,
          tuyaAccessId: resolvedTuyaAccessId,
          tuyaAccessSecret: encryptedTuyaSecret,
          tuyaDeviceId: resolvedTuyaDeviceId,
          tuyaEndpointRegion: resolvedTuyaEndpointRegion,
          telegramBotToken: encryptedTelegramToken,
          telegramChatId: resolvedTelegramChatId,
          whatsappPhoneNumber: resolvedWhatsappPhone,
          whatsappApiKey: encryptedWhatsAppKey,
          isNotificationActive: resolvedNotificationActive,
          atsLifespanCycles: resolvedAtsLifespanCycles,
          atsCurrentCycles: resolvedAtsCurrentCycles,
          energyCostPerKwh: resolvedEnergyCostPerKwh,
          currencySymbol: resolvedCurrencySymbol,
          batteryCapacityWh: resolvedBatteryCapacityWh,
          isStormModeActive: resolvedStormModeActive,
          isDailyReportActive: resolvedDailyReportActive,
          dailyReportTime: resolvedDailyReportTime,
          latitude: resolvedLatitude,
          longitude: resolvedLongitude,
          isAdaptiveHysteresisActive: resolvedAdaptiveHysteresis,
          isDaylightOnlyActive: resolvedDaylightOnly,
          minAdaptiveThreshold: resolvedMinAdaptive,
          maxAdaptiveThreshold: resolvedMaxAdaptive,
          thermalWarningThreshold: resolvedThermalWarning,
          thermalShutdownThreshold: resolvedThermalShutdown,
          isDynamicTariffActive: resolvedDynamicTariff,
          peakTariffPerKwh: resolvedPeakTariff,
          intermediateTariffPerKwh: resolvedIntermediateTariff,
          offPeakTariffPerKwh: resolvedOffPeakTariff,
          peakStartTime: resolvedPeakStartTime,
          peakEndTime: resolvedPeakEndTime,
          intermediateStartTime1: resolvedInterStartTime1,
          intermediateEndTime1: resolvedInterEndTime1,
          intermediateStartTime2: resolvedInterStartTime2,
          intermediateEndTime2: resolvedInterEndTime2,
          peakReserveThreshold: resolvedPeakReserve,
          inverterMaxWatts: resolvedInverterMaxWatts,
          isAlertOnBlackout: resolvedAlertBlackout,
          isAlertOnGridRestore: resolvedAlertGridRestore,
          isAlertOnOverload: resolvedAlertOverload,
          isAlertOnThermalRisk: resolvedAlertThermalRisk,
          isAlertOnAtsFailure: resolvedAlertAtsFailure,
          alertCooldownMinutes: resolvedAlertCooldown,
          isSmartChargingActive: resolvedSmartCharging,
          minAcChargingWatts: resolvedMinAcChargingWatts,
          maxAcChargingWatts: resolvedMaxAcChargingWatts,
          chargeOnlyOffPeak: resolvedChargeOnlyOffPeak,
          cloudyPrechargeActive: resolvedCloudyPrecharge,
          isAutoStormActive: resolvedAutoStormActive,
          autoStormReserveThreshold: resolvedAutoStormReserve,
          autoStormRainThresholdMm: resolvedAutoStormRain,
          autoStormPrechargeAc: resolvedAutoStormPrecharge,
          isTimeOfUseActive: resolvedTimeOfUseActive,
          timeOfUseWeekdaysOnly: resolvedTimeOfUseWeekdays,
          intermediateStartTime: resolvedIntermediateStartTime,
          intermediateEndTime: resolvedIntermediateEndTime,
          peakDischargeReserveLimit: resolvedPeakDischargeReserve,
          blockAcChargingDuringPeak: resolvedBlockAcChargingPeak,
          isThermalProtectionActive: resolvedThermalProtection,
          thermalThrottleTempThreshold: resolvedThermalThrottleTemp,
          thermalCutoffTempThreshold: resolvedThermalCutoffTemp,
          thermalRecoveryTempThreshold: resolvedThermalRecoveryTemp,
          thermalThrottleSpeedWatts: resolvedThermalThrottleSpeed,
          totalCapexBrl: resolvedTotalCapex,
          installationDate: resolvedInstallationDate,
          annualEnergyInflationRate: resolvedInflationRate,
          targetPaybackYears: resolvedTargetPaybackYears,
          capexNotes: resolvedCapexNotes,
        },
        create: {
          userId: extractedUserId,
          ecoflowEndpointRegion: validatedEndpointRegion,
          ecoflowAccessKey: normalizedAccessKey,
          ecoflowAccessSecret: encryptedEcoFlowSecret,
          ecoflowSerialNumber: normalizedSerialNumber,
          tuyaAccessId: resolvedTuyaAccessId,
          tuyaAccessSecret: encryptedTuyaSecret,
          tuyaDeviceId: resolvedTuyaDeviceId,
          tuyaEndpointRegion: resolvedTuyaEndpointRegion,
          telegramBotToken: encryptedTelegramToken,
          telegramChatId: resolvedTelegramChatId,
          whatsappPhoneNumber: resolvedWhatsappPhone,
          whatsappApiKey: encryptedWhatsAppKey,
          isNotificationActive: resolvedNotificationActive,
          atsLifespanCycles: resolvedAtsLifespanCycles,
          atsCurrentCycles: resolvedAtsCurrentCycles,
          energyCostPerKwh: resolvedEnergyCostPerKwh,
          currencySymbol: resolvedCurrencySymbol,
          batteryCapacityWh: resolvedBatteryCapacityWh,
          isStormModeActive: resolvedStormModeActive,
          isDailyReportActive: resolvedDailyReportActive,
          dailyReportTime: resolvedDailyReportTime,
          latitude: resolvedLatitude,
          longitude: resolvedLongitude,
          isAdaptiveHysteresisActive: resolvedAdaptiveHysteresis,
          isDaylightOnlyActive: resolvedDaylightOnly,
          minAdaptiveThreshold: resolvedMinAdaptive,
          maxAdaptiveThreshold: resolvedMaxAdaptive,
          thermalWarningThreshold: resolvedThermalWarning,
          thermalShutdownThreshold: resolvedThermalShutdown,
          isDynamicTariffActive: resolvedDynamicTariff,
          peakTariffPerKwh: resolvedPeakTariff,
          intermediateTariffPerKwh: resolvedIntermediateTariff,
          offPeakTariffPerKwh: resolvedOffPeakTariff,
          peakStartTime: resolvedPeakStartTime,
          peakEndTime: resolvedPeakEndTime,
          intermediateStartTime1: resolvedInterStartTime1,
          intermediateEndTime1: resolvedInterEndTime1,
          intermediateStartTime2: resolvedInterStartTime2,
          intermediateEndTime2: resolvedInterEndTime2,
          peakReserveThreshold: resolvedPeakReserve,
          inverterMaxWatts: resolvedInverterMaxWatts,
          isAlertOnBlackout: resolvedAlertBlackout,
          isAlertOnGridRestore: resolvedAlertGridRestore,
          isAlertOnOverload: resolvedAlertOverload,
          isAlertOnThermalRisk: resolvedAlertThermalRisk,
          isAlertOnAtsFailure: resolvedAlertAtsFailure,
          alertCooldownMinutes: resolvedAlertCooldown,
          isSmartChargingActive: resolvedSmartCharging,
          minAcChargingWatts: resolvedMinAcChargingWatts,
          maxAcChargingWatts: resolvedMaxAcChargingWatts,
          chargeOnlyOffPeak: resolvedChargeOnlyOffPeak,
          cloudyPrechargeActive: resolvedCloudyPrecharge,
          isAutoStormActive: resolvedAutoStormActive,
          autoStormReserveThreshold: resolvedAutoStormReserve,
          autoStormRainThresholdMm: resolvedAutoStormRain,
          autoStormPrechargeAc: resolvedAutoStormPrecharge,
          isTimeOfUseActive: resolvedTimeOfUseActive,
          timeOfUseWeekdaysOnly: resolvedTimeOfUseWeekdays,
          intermediateStartTime: resolvedIntermediateStartTime,
          intermediateEndTime: resolvedIntermediateEndTime,
          peakDischargeReserveLimit: resolvedPeakDischargeReserve,
          blockAcChargingDuringPeak: resolvedBlockAcChargingPeak,
          isThermalProtectionActive: resolvedThermalProtection,
          thermalThrottleTempThreshold: resolvedThermalThrottleTemp,
          thermalCutoffTempThreshold: resolvedThermalCutoffTemp,
          thermalRecoveryTempThreshold: resolvedThermalRecoveryTemp,
          thermalThrottleSpeedWatts: resolvedThermalThrottleSpeed,
          totalCapexBrl: resolvedTotalCapex,
          installationDate: resolvedInstallationDate,
          annualEnergyInflationRate: resolvedInflationRate,
          targetPaybackYears: resolvedTargetPaybackYears,
          capexNotes: resolvedCapexNotes,
        },
      });

      EcoFlowMqttStreamService.getInstance().stopStream(extractedUserId);

      response.status(200).json({
        success: true,
        message: "Credenciais e configurações de notificação salvas com sucesso!",
      });
      return;
    } catch (writeError: unknown) {
      console.error("[Settings API] Erro interno ao cifrar/salvar configurações:", writeError);
      response.status(500).json({
        success: false,
        message: "Erro interno ao salvar configurações.",
      });
      return;
    }
  }

  response.setHeader("Allow", ["GET", "POST"]);
  response.status(405).json({
    success: false,
    message: "Método HTTP não permitido.",
  });
}
