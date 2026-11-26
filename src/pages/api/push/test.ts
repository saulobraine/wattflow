import type { NextApiRequest, NextApiResponse } from "next";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
} from "../../../infrastructure/auth/sessionHelper";
import { WebPushService } from "../../../infrastructure/notifications/WebPushService";
import { pushTestBodySchema } from "../../../infrastructure/security/apiSchemas";
import {
  checkRateLimit,
  extractClientIp,
  sendRateLimitExceeded,
} from "../../../infrastructure/security/rateLimiter";

interface PushTestResponse {
  success: boolean;
  message: string;
  totalSent?: number;
  failed?: number;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const MAX_NOTIF_PER_IP = 10;
const MAX_NOTIF_PER_USER = 5;

export default async function handlePushTest(
  request: NextApiRequest,
  response: NextApiResponse<PushTestResponse>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize POST.",
    });
    return;
  }

  const clientIp = extractClientIp(request);
  const ipLimit = checkRateLimit(`push:test:ip:${clientIp}`, MAX_NOTIF_PER_IP, FIVE_MINUTES_MS);
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
    });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Faça login para testar as notificações push.",
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
    `push:test:user:${extractedUserId}`,
    MAX_NOTIF_PER_USER,
    ONE_MINUTE_MS
  );
  if (!userLimit.allowed) {
    sendRateLimitExceeded(response, userLimit.retryAfterSeconds);
    return;
  }

  const parseResult = pushTestBodySchema.safeParse(request.body ?? {});
  if (!parseResult.success) {
    response.status(400).json({
      success: false,
      message: parseResult.error.issues[0]?.message || "Payload de teste inválido.",
    });
    return;
  }

  const { title, message, subscription } = parseResult.data;
  const pushService = WebPushService.getInstance();
  const pushPayload = {
    title: title || "⚡ WattFlow - Teste de Notificação Web Push",
    message: message || "As notificações push para comutação de rede/bateria estão funcionando perfeitamente!",
    actionState: "INFO" as const,
    timestamp: new Date(),
    url: "/",
    tag: "wattflow-push-test",
  };

  try {
    if (subscription) {
      const sendResult = await pushService.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          userId: extractedUserId,
        },
        pushPayload
      );

      if (!sendResult.isSuccess) {
        response.status(502).json({
          success: false,
          message: sendResult.errorMessage || "Falha ao enviar notificação para a inscrição fornecida.",
        });
        return;
      }

      response.status(200).json({
        success: true,
        message: "Notificação push de teste enviada com sucesso para o dispositivo.",
        totalSent: 1,
      });
      return;
    }

    const broadcastResult = await pushService.broadcastNotification(pushPayload, extractedUserId);
    if (broadcastResult.totalSent === 0 && broadcastResult.failed > 0) {
      response.status(502).json({
        success: false,
        message: "Falha ao entregar notificação push aos dispositivos cadastrados.",
        totalSent: 0,
        failed: broadcastResult.failed,
      });
      return;
    }

    if (broadcastResult.totalSent === 0 && broadcastResult.failed === 0) {
      response.status(200).json({
        success: true,
        message: "Nenhum dispositivo inscrito encontrado. Ative o Push neste navegador primeiro.",
        totalSent: 0,
        failed: 0,
      });
      return;
    }

    response.status(200).json({
      success: true,
      message: `Notificação push de teste enviada com sucesso para ${broadcastResult.totalSent} dispositivo(s).`,
      totalSent: broadcastResult.totalSent,
      failed: broadcastResult.failed,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Erro desconhecido ao despachar teste push.";
    response.status(500).json({
      success: false,
      message: errorMsg,
    });
  }
}
