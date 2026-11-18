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
