import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";
import {
  isAllowedEcoFlowEndpointRegion,
  resolveEcoFlowEndpointRegion,
} from "../../infrastructure/security/ecoflowAllowlist";

interface SettingsResponseBody {
  success: boolean;
  message: string;
  data?: {
    ecoflowEndpointRegion: string;
    ecoflowAccessKey: string;
    ecoflowAccessSecret?: string;
    ecoflowAccessSecretMasked: string;
    ecoflowSerialNumber: string;
    telegramBotToken?: string;
    telegramBotTokenMasked: string;
    telegramChatId: string;
    whatsappPhoneNumber: string;
    whatsappApiKey?: string;
    whatsappApiKeyMasked: string;
    isNotificationActive: boolean;
  };
}

export default async function handleSettings(
  request: NextApiRequest,
  response: NextApiResponse<SettingsResponseBody>
): Promise<void> {
  let sessionUser: ReturnType<typeof extractUserFromRequest> = null;
  try {
    sessionUser = extractUserFromRequest(request);
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

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  if (request.method === "GET") {
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

    response.status(200).json({
      success: true,
      message: "Configurações carregadas com sucesso.",
      data: {
        ecoflowEndpointRegion: existing.ecoflowEndpointRegion,
        ecoflowAccessKey: existing.ecoflowAccessKey,
        ecoflowAccessSecret: existing.ecoflowAccessSecret || "",
        ecoflowAccessSecretMasked: existing.ecoflowAccessSecret || "",
        ecoflowSerialNumber: existing.ecoflowSerialNumber,
        telegramBotToken: existing.telegramBotToken || "",
        telegramBotTokenMasked: existing.telegramBotToken || "",
        telegramChatId: existing.telegramChatId || "",
        whatsappPhoneNumber: existing.whatsappPhoneNumber || "",
        whatsappApiKey: existing.whatsappApiKey || "",
        whatsappApiKeyMasked: existing.whatsappApiKey || "",
        isNotificationActive: existing.isNotificationActive ?? true,
      },
    });
    return;
  }

  if (request.method === "POST") {
    const {
      ecoflowEndpointRegion,
      ecoflowAccessKey,
      ecoflowAccessSecret,
      ecoflowSerialNumber,
      telegramBotToken,
      telegramChatId,
      whatsappPhoneNumber,
      whatsappApiKey,
      isNotificationActive,
    } = request.body;

    if (!ecoflowAccessKey || !ecoflowAccessSecret || !ecoflowSerialNumber) {
      response.status(400).json({
        success: false,
        message: "Access Key, Secret Key e Serial Number da EcoFlow são obrigatórios.",
      });
      return;
    }

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

    const validatedEndpointRegion = resolveEcoFlowEndpointRegion(ecoflowEndpointRegion);

    const isMasked = (value?: string) => !value || value.includes("••••");

    const existingConfig = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
    });

    const finalEcoFlowSecret = isMasked(ecoflowAccessSecret)
      ? existingConfig?.ecoflowAccessSecret || ""
      : ecoflowAccessSecret.trim();

    const finalTelegramToken = isMasked(telegramBotToken)
      ? existingConfig?.telegramBotToken || ""
      : (telegramBotToken || "").trim();

    const finalWhatsAppKey = isMasked(whatsappApiKey)
      ? existingConfig?.whatsappApiKey || ""
      : (whatsappApiKey || "").trim();

    await prisma.userConfiguration.upsert({
      where: { userId: extractedUserId },
      update: {
        ecoflowEndpointRegion: validatedEndpointRegion,
        ecoflowAccessKey: ecoflowAccessKey.trim(),
        ecoflowAccessSecret: finalEcoFlowSecret,
        ecoflowSerialNumber: ecoflowSerialNumber.trim(),
        telegramBotToken: finalTelegramToken,
        telegramChatId: (telegramChatId || "").trim(),
        whatsappPhoneNumber: (whatsappPhoneNumber || "").trim(),
        whatsappApiKey: finalWhatsAppKey,
        isNotificationActive: isNotificationActive ?? true,
      },
      create: {
        userId: extractedUserId,
        ecoflowEndpointRegion: validatedEndpointRegion,
        ecoflowAccessKey: ecoflowAccessKey.trim(),
        ecoflowAccessSecret: finalEcoFlowSecret,
        ecoflowSerialNumber: ecoflowSerialNumber.trim(),
        telegramBotToken: finalTelegramToken,
        telegramChatId: (telegramChatId || "").trim(),
        whatsappPhoneNumber: (whatsappPhoneNumber || "").trim(),
        whatsappApiKey: finalWhatsAppKey,
        isNotificationActive: isNotificationActive ?? true,
      },
    });

    response.status(200).json({
      success: true,
      message: "Credenciais e configurações de notificação salvas com sucesso!",
    });
    return;
  }

  response.setHeader("Allow", ["GET", "POST"]);
  response.status(405).json({
    success: false,
    message: "Método HTTP não permitido.",
  });
}
