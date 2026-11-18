import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { EcoFlowMqttStreamService } from "../../infrastructure/services/EcoFlowMqttStreamService";

const MIN_CRON_SECRET_LENGTH = 32;

export default async function handleMqttStream(
  request: NextApiRequest,
  response: NextApiResponse
): Promise<void> {
  const secretToken = process.env.CRON_SECRET_TOKEN;
  if (!secretToken || secretToken.trim().length < MIN_CRON_SECRET_LENGTH) {
    response.status(500).json({
      success: false,
      message: "Variável de ambiente CRON_SECRET_TOKEN obrigatória não configurada ou com menos de 32 caracteres.",
    });
    return;
  }

  const rawHeaderToken = request.headers["x-cron-token"];
  const headerToken = Array.isArray(rawHeaderToken) ? rawHeaderToken[0] : rawHeaderToken;
  const rawQueryToken = request.query.token;
  const queryToken = Array.isArray(rawQueryToken) ? rawQueryToken[0] : rawQueryToken;
  const providedToken = headerToken || queryToken;

  const isTokenValid =
    typeof providedToken === "string" &&
    providedToken.length > 0 &&
    providedToken === secretToken;

  if (!isTokenValid) {
    response.status(401).json({
      success: false,
      message: "Token de autorização inválido.",
    });
    return;
  }

  try {
    const rawUserId = request.query.userId;
    const targetUserId =
      typeof rawUserId === "string" && rawUserId.trim().length > 0
        ? rawUserId.trim()
        : undefined;

    const streamService = EcoFlowMqttStreamService.getInstance();
    const isConnected = targetUserId
      ? streamService.isStreamConnected(targetUserId)
      : streamService.isStreamConnected();

    if (!isConnected) {
      if (targetUserId) {
        await streamService.startWithActiveConfiguration(prisma, targetUserId);
      } else {
        await streamService.startWithActiveConfiguration(prisma);
      }
    }

    const latestTelemetry = targetUserId
      ? streamService.getLatestTelemetry(targetUserId)
      : streamService.getLatestTelemetry();

    response.status(200).json({
      success: true,
      isConnected: targetUserId
        ? streamService.isStreamConnected(targetUserId)
        : streamService.isStreamConnected(),
      latestTelemetry,
      message: "Stream MQTT oficial EcoFlow ativo com keep-alive de 60s.",
    });
  } catch (caughtError: unknown) {
    const errorMessage =
      caughtError instanceof Error
        ? caughtError.message
        : "Falha interna ao inicializar ou consultar o stream MQTT.";

    response.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
}
