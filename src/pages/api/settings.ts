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
  minAdaptiveThreshold: number;
  maxAdaptiveThreshold: number;
  thermalWarningThreshold: number;
  thermalShutdownThreshold: number;
  lastBatteryTempCelsius: number | null;
  lastBatterySoh: number | null;
  lastBatteryCycles: number | null;
  maxRecordedBatteryTemp: number | null;
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
          minAdaptiveThreshold: existing.minAdaptiveThreshold ?? 20,
          maxAdaptiveThreshold: existing.maxAdaptiveThreshold ?? 50,
          thermalWarningThreshold: existing.thermalWarningThreshold ?? 45.0,
          thermalShutdownThreshold: existing.thermalShutdownThreshold ?? 50.0,
          lastBatteryTempCelsius: existing.lastBatteryTempCelsius ?? null,
          lastBatterySoh: existing.lastBatterySoh ?? null,
          lastBatteryCycles: existing.lastBatteryCycles ?? null,
          maxRecordedBatteryTemp: existing.maxRecordedBatteryTemp ?? null,
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
      minAdaptiveThreshold,
      maxAdaptiveThreshold,
      thermalWarningThreshold,
      thermalShutdownThreshold,
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

      const resolvedPlainEcoFlowSecret = isUnchangedOrMaskedSecret(ecoflowAccessSecret)
        ? existingDecrypted.ecoflowAccessSecret
        : (ecoflowAccessSecret as string).trim();

      if (!resolvedPlainEcoFlowSecret) {
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

      await prisma.userConfiguration.upsert({
        where: { userId: extractedUserId },
        update: {
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
          minAdaptiveThreshold: resolvedMinAdaptive,
          maxAdaptiveThreshold: resolvedMaxAdaptive,
          thermalWarningThreshold: resolvedThermalWarning,
          thermalShutdownThreshold: resolvedThermalShutdown,
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
          minAdaptiveThreshold: resolvedMinAdaptive,
          maxAdaptiveThreshold: resolvedMaxAdaptive,
          thermalWarningThreshold: resolvedThermalWarning,
          thermalShutdownThreshold: resolvedThermalShutdown,
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
