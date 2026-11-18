import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { EcoFlowMqttStreamService } from "../../infrastructure/services/EcoFlowMqttStreamService";
import { verifyCronRequestAuthorization } from "../../infrastructure/security/cronAuthHelper";

export default async function handleMqttStream(
  request: NextApiRequest,
  response: NextApiResponse
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  const { hasValidSecretConfigured, isAuthorized } = verifyCronRequestAuthorization(
    request,
    process.env.CRON_SECRET_TOKEN
  );

  if (!hasValidSecretConfigured) {
    response.status(500).json({
      success: false,
      message:
        "Variável de ambiente CRON_SECRET_TOKEN obrigatória não configurada ou com menos de 32 caracteres.",
    });
    return;
  }

  if (!isAuthorized) {
    response.status(401).json({
      success: false,
      message: "Token de autorização inválido ou ausente no cabeçalho HTTP.",
    });
    return;
  }

  if (process.env.DISABLE_LOCAL_CRON === "true") {
    response.status(200).json({
      success: true,
      skipped: true,
      isConnected: false,
      latestTelemetry: null,
      message: "Stream MQTT local desativado (DISABLE_LOCAL_CRON=true).",
    });
    return;
  }

  try {
    const rawUserId = request.query.userId;
    const targetUserId =
      typeof rawUserId === "string" && rawUserId.trim().length > 0 && rawUserId.trim().length <= 128
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
    console.error("[MqttStream API] Erro interno ao inicializar stream:", caughtError);
    response.status(500).json({
      success: false,
      message: "Falha interna ao inicializar ou consultar o stream MQTT.",
    });
  }
}
