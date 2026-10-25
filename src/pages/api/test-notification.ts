import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";
import {
  NotificationDispatcher,
  NotificationPayload,
} from "../../infrastructure/notifications/NotificationDispatcher";

interface TestNotificationRequestBody {
  channel: "TELEGRAM" | "WHATSAPP";
  telegramBotToken?: string;
  telegramChatId?: string;
  whatsappPhoneNumber?: string;
  whatsappApiKey?: string;
}

interface TestNotificationApiResponse {
  success: boolean;
  message: string;
  channel: "TELEGRAM" | "WHATSAPP";
  errorDetails?: string;
}

export default async function handleTestNotification(
  request: NextApiRequest,
  response: NextApiResponse<TestNotificationApiResponse>
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize POST.",
      channel: "TELEGRAM",
    });
    return;
  }

  const sessionUser = extractUserFromRequest(request);
  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Faça login para testar as notificações.",
      channel: "TELEGRAM",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const body = (request.body ?? {}) as TestNotificationRequestBody;
  const channel = body.channel === "WHATSAPP" ? "WHATSAPP" : "TELEGRAM";

  const savedConfiguration = await prisma.userConfiguration.findUnique({
    where: { userId: extractedUserId },
  });

  const isMasked = (value?: string) => !value || value.includes("••••");
  const dispatcher = new NotificationDispatcher();

  const dispatchTime = new Date();
  const timeFormatted = dispatchTime.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const samplePayload: NotificationPayload = {
    title: `Teste de Notificação (${channel === "TELEGRAM" ? "Telegram" : "WhatsApp"})`,
    message:
      "Esta é uma mensagem de teste enviada pelo WattFlow. O canal foi validado com sucesso e está pronto para receber alertas de comutação da chave ATS e status da bateria EcoFlow!",
    batteryPercentage: 94,
    solarWatts: 450,
    actionState: "SOLAR_BATTERY",
    timestamp: dispatchTime,
  };

  if (channel === "TELEGRAM") {
    const effectiveToken = isMasked(body.telegramBotToken)
      ? savedConfiguration?.telegramBotToken || ""
      : body.telegramBotToken?.trim() || "";

    const effectiveChatId = body.telegramChatId?.trim() || savedConfiguration?.telegramChatId || "";

    if (!effectiveToken || !effectiveChatId) {
      response.status(400).json({
        success: false,
        message: "Preencha o Bot Token e o Chat ID do Telegram antes de realizar o teste.",
        channel: "TELEGRAM",
      });
      return;
    }

    const result = await dispatcher.dispatchTelegramOnly(samplePayload, effectiveToken, effectiveChatId);

    response.status(200).json({
      success: result.isSuccess,
      message: result.isSuccess
        ? `Mensagem de teste enviada com sucesso no Telegram às ${timeFormatted}!`
        : `Falha ao enviar mensagem no Telegram: ${result.errorMessage || "Erro desconhecido"}`,
      channel: "TELEGRAM",
      errorDetails: result.errorMessage,
    });
    return;
  }

  // Canal WHATSAPP
  const effectivePhone =
    body.whatsappPhoneNumber?.trim() || savedConfiguration?.whatsappPhoneNumber || "";

  const effectiveKey = isMasked(body.whatsappApiKey)
    ? savedConfiguration?.whatsappApiKey || ""
    : body.whatsappApiKey?.trim() || "";

  if (!effectivePhone || !effectiveKey) {
    response.status(400).json({
      success: false,
      message:
        "Preencha o Número de WhatsApp (com DDI e DDD) e a API Key do CallMeBot antes de realizar o teste.",
      channel: "WHATSAPP",
    });
    return;
  }

  const result = await dispatcher.dispatchWhatsAppOnly(samplePayload, effectivePhone, effectiveKey);

  response.status(200).json({
    success: result.isSuccess,
    message: result.isSuccess
      ? `Mensagem de teste enfileirada com sucesso no WhatsApp às ${timeFormatted}!`
      : `Falha ao enviar mensagem no WhatsApp: ${result.errorMessage || "Erro desconhecido"}`,
    channel: "WHATSAPP",
    errorDetails: result.errorMessage,
  });
}
