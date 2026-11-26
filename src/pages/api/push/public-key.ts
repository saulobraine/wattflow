import type { NextApiRequest, NextApiResponse } from "next";
import { WebPushService } from "../../../infrastructure/notifications/WebPushService";
import {
  checkRateLimit,
  extractClientIp,
  sendRateLimitExceeded,
} from "../../../infrastructure/security/rateLimiter";

interface PublicKeyResponse {
  success: boolean;
  publicKey?: string;
  message?: string;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_IP = 60;

export default async function handleGetPublicKey(
  request: NextApiRequest,
  response: NextApiResponse<PublicKeyResponse>
): Promise<void> {
  response.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");

  if (request.method !== "GET") {
    response.setHeader("Allow", ["GET"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize GET.",
    });
    return;
  }

  const clientIp = extractClientIp(request);
  const ipLimit = checkRateLimit(`push:pubkey:ip:${clientIp}`, MAX_REQUESTS_PER_IP, FIVE_MINUTES_MS);
  if (!ipLimit.allowed) {
    sendRateLimitExceeded(response, ipLimit.retryAfterSeconds);
    return;
  }

  try {
    const pushService = WebPushService.getInstance();
    const publicKey = pushService.getPublicKey();

    response.status(200).json({
      success: true,
      publicKey,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Erro interno ao obter chave pública VAPID.";
    response.status(500).json({
      success: false,
      message: errorMsg,
    });
  }
}
