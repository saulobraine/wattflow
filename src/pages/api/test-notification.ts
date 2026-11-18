import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
} from "../../infrastructure/auth/sessionHelper";
import {
  NotificationDispatcher,
  NotificationPayload,
} from "../../infrastructure/notifications/NotificationDispatcher";
import { isUnchangedOrMaskedSecret } from "../../infrastructure/security/encryptionHelper";
import { decryptAndMigrateConfigurationSecrets } from "../../infrastructure/security/secretMigrationHelper";
import {
  checkRateLimit,
  extractClientIp,
  sendRateLimitExceeded,
} from "../../infrastructure/security/rateLimiter";
import { testNotificationPostBodySchema } from "../../infrastructure/security/apiSchemas";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const MAX_NOTIF_PER_IP = 10;
const MAX_NOTIF_PER_USER = 5;

interface TestNotificationApiResponse {
  success: boolean;
  message: string;
  channel?: "TELEGRAM" | "WHATSAPP";
  errorDetails?: string;
}

export default async function handleTestNotification(
  request: NextApiRequest,
  response: NextApiResponse<TestNotificationApiResponse>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize POST.",
      channel: "TELEGRAM",
    });
    return;
  }

  const clientIp = extractClientIp(request);
  const ipLimit = checkRateLimit(`testnotif:ip:${clientIp}`, MAX_NOTIF_PER_IP, FIVE_MINUTES_MS);
  if (!ipLimit.allowed) {
    sendRateLimitExceeded(response, ipLimit.retryAfterSeconds);
    return;
  }

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno de configuração de autenticação.";
    response.status(500).json({
      success: false,
      message: authMessage,
      channel: "TELEGRAM",
    });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Faça login para testar as notificações.",
      channel: "TELEGRAM",
    });
    return;
  }

  if (!enforceCsrfProtection(request, response)) {
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const userLimit = checkRateLimit(
    `testnotif:user:${extractedUserId}`,
    MAX_NOTIF_PER_USER,
    ONE_MINUTE_MS
  );
  if (!userLimit.allowed) {
    sendRateLimitExceeded(response, userLimit.retryAfterSeconds);
    return;
  }

  const parsedBody = testNotificationPostBodySchema.safeParse(request.body ?? {});
  if (!parsedBody.success) {
    const issueMessage =
      parsedBody.error.issues[0]?.message ||
      "Canal ou dados de notificação inválidos.";
    response.status(400).json({
      success: false,
      message: issueMessage,
      channel: "TELEGRAM",
    });
    return;
  }

  const body = parsedBody.data;
  const channel = body.channel;

  const savedConfiguration = await prisma.userConfiguration.findUnique({
    where: { userId: extractedUserId },
  });

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
    let effectiveToken = "";
    try {
      if (isUnchangedOrMaskedSecret(body.telegramBotToken)) {
        const decryptedSecrets = await decryptAndMigrateConfigurationSecrets(
          prisma,
          savedConfiguration
        );
        effectiveToken = decryptedSecrets.telegramBotToken;
      } else {
        effectiveToken = (body.telegramBotToken as string).trim();
      }
    } catch (cryptoError: unknown) {
      console.error("[TestNotification API] Falha ao decifrar token Telegram:", cryptoError);
      response.status(500).json({
        success: false,
        message: "Falha interna ao carregar token do Telegram armazenado.",
        channel: "TELEGRAM",
      });
      return;
    }

    const effectiveChatId =
      (typeof body.telegramChatId === "string" ? body.telegramChatId.trim() : "") ||
      savedConfiguration?.telegramChatId ||
      "";

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

  const effectivePhone =
    (typeof body.whatsappPhoneNumber === "string" ? body.whatsappPhoneNumber.trim() : "") ||
    savedConfiguration?.whatsappPhoneNumber ||
    "";

  let effectiveKey = "";
  try {
    if (isUnchangedOrMaskedSecret(body.whatsappApiKey)) {
      const decryptedSecrets = await decryptAndMigrateConfigurationSecrets(
        prisma,
        savedConfiguration
      );
      effectiveKey = decryptedSecrets.whatsappApiKey;
    } else {
      effectiveKey = (body.whatsappApiKey as string).trim();
    }
  } catch (cryptoError: unknown) {
    console.error("[TestNotification API] Falha ao decifrar chave WhatsApp:", cryptoError);
    response.status(500).json({
      success: false,
      message: "Falha interna ao carregar chave do WhatsApp armazenada.",
      channel: "WHATSAPP",
    });
    return;
  }

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
