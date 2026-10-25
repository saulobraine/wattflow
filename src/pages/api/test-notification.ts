import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";
import {
  NotificationDispatcher,
  NotificationConfig,
  NotificationDispatchResult,
} from "../../infrastructure/notifications/NotificationDispatcher";

interface TestNotificationRequestBody {
  telegramBotToken?: string;
  telegramChatId?: string;
  whatsappPhoneNumber?: string;
  whatsappApiKey?: string;
}

interface TestNotificationApiResponse {
  success: boolean;
  message: string;
  data?: NotificationDispatchResult;
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
    });
    return;
  }

  const sessionUser = extractUserFromRequest(request);
  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Faça login para testar as notificações.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const body = (request.body ?? {}) as TestNotificationRequestBody;

  const savedConfiguration = await prisma.userConfiguration.findUnique({
    where: { userId: extractedUserId },
  });

  const isMasked = (value?: string) => !value || value.includes("••••");

  const effectiveTelegramToken = isMasked(body.telegramBotToken)
    ? savedConfiguration?.telegramBotToken || ""
    : body.telegramBotToken?.trim() || "";

  const effectiveTelegramChatId = body.telegramChatId?.trim() || savedConfiguration?.telegramChatId || "";

  const effectiveWhatsAppPhone =
    body.whatsappPhoneNumber?.trim() || savedConfiguration?.whatsappPhoneNumber || "";

  const effectiveWhatsAppKey = isMasked(body.whatsappApiKey)
    ? savedConfiguration?.whatsappApiKey || ""
    : body.whatsappApiKey?.trim() || "";

  const config: NotificationConfig = {
    telegramBotToken: effectiveTelegramToken,
    telegramChatId: effectiveTelegramChatId,
    whatsappPhoneNumber: effectiveWhatsAppPhone,
    whatsappApiKey: effectiveWhatsAppKey,
    isNotificationActive: true,
  };

  const hasAnyChannel = Boolean(
    (config.telegramBotToken && config.telegramChatId) ||
      (config.whatsappPhoneNumber && config.whatsappApiKey)
  );

  if (!hasAnyChannel) {
    response.status(400).json({
      success: false,
      message:
        "Preencha ao menos um canal (Token e Chat ID do Telegram, ou Telefone e Chave de API do WhatsApp).",
    });
    return;
  }

  const dispatcher = new NotificationDispatcher();

  const result = await dispatcher.dispatchNotification(
    {
      title: "Teste de Notificação Concluído",
      message:
        "Esta é uma mensagem de teste enviada pelo WattFlow. O canal configurado está funcionando perfeitamente para alertas de comutação da chave ATS e telemetria da EcoFlow!",
      batteryPercentage: 95,
      solarWatts: 420,
      actionState: "SOLAR_BATTERY",
    },
    config
  );

  const isOverallSuccess = result.telegramSuccess || result.whatsappSuccess;

  response.status(200).json({
    success: isOverallSuccess,
    message: result.summaryMessage,
    data: result,
  });
}
