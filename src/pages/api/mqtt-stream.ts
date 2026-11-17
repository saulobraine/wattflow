import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { EcoFlowMqttStreamService } from "../../infrastructure/services/EcoFlowMqttStreamService";

export default async function handleMqttStream(
  request: NextApiRequest,
  response: NextApiResponse
): Promise<void> {
  const secretToken = process.env.CRON_SECRET_TOKEN || "wattflow_secret_token_123";
  const providedToken = request.query.token || request.headers["x-cron-token"];

  const isTokenValid = providedToken === secretToken;
  if (!isTokenValid) {
    response.status(401).json({
      success: false,
      message: "Token de autorização inválido.",
    });
    return;
  }

  const streamService = EcoFlowMqttStreamService.getInstance();
  const isConnected = streamService.isStreamConnected();

  if (!isConnected) {
    await streamService.startWithActiveConfiguration(prisma);
  }

  const latestTelemetry = streamService.getLatestTelemetry();

  response.status(200).json({
    success: true,
    isConnected: streamService.isStreamConnected(),
    latestTelemetry,
    message: "Stream MQTT oficial EcoFlow ativo com keep-alive de 60s.",
  });
}
