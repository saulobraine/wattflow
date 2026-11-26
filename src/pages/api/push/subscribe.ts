import type { NextApiRequest, NextApiResponse } from "next";
import { WebPushService } from "../../../infrastructure/notifications/WebPushService";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import { pushSubscribeBodySchema } from "../../../infrastructure/security/apiSchemas";
import {
  checkRateLimit,
  extractClientIp,
  sendRateLimitExceeded,
} from "../../../infrastructure/security/rateLimiter";

interface SubscribeResponse {
  success: boolean;
  message: string;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_IP = 30;

export default async function handlePushSubscribe(
  request: NextApiRequest,
  response: NextApiResponse<SubscribeResponse>
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
  const ipLimit = checkRateLimit(`push:sub:ip:${clientIp}`, MAX_REQUESTS_PER_IP, FIVE_MINUTES_MS);
  if (!ipLimit.allowed) {
    sendRateLimitExceeded(response, ipLimit.retryAfterSeconds);
    return;
  }

  let userId: string | undefined;
  try {
    const sessionUser = await extractUserFromRequest(request);
    if (sessionUser) {
      sessionUser.provideIdentity((id) => {
        userId = id;
      });
    }
  } catch {
    // Permite subscrição anônima vinculada ao dispositivo caso ainda não autenticado
  }

  const parseResult = pushSubscribeBodySchema.safeParse(request.body ?? {});
  if (!parseResult.success) {
    response.status(400).json({
      success: false,
      message: parseResult.error.issues[0]?.message || "Payload de inscrição inválido.",
    });
    return;
  }

  const bodyData = parseResult.data;
  const subscriptionData = bodyData.subscription
    ? {
        endpoint: bodyData.subscription.endpoint,
        keys: bodyData.subscription.keys,
        expirationTime: bodyData.subscription.expirationTime,
        userId,
      }
    : {
        endpoint: bodyData.endpoint as string,
        keys: bodyData.keys as { p256dh: string; auth: string },
        userId,
      };

  try {
    const pushService = WebPushService.getInstance();
    await pushService.saveSubscription(subscriptionData, userId);

    response.status(200).json({
      success: true,
      message: "Inscrição Web Push registrada com sucesso.",
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Erro interno ao registrar inscrição.";
    response.status(500).json({
      success: false,
      message: errorMsg,
    });
  }
}
