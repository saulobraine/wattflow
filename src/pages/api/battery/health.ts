import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import { EcoFlowMqttStreamService } from "../../../infrastructure/services/EcoFlowMqttStreamService";
import {
  BatteryHealthService,
  BatteryHealthMetrics,
  RawBatteryTelemetryParams,
} from "../../../domain/services/BatteryHealthService";

export interface BatteryHealthApiResponse {
  success: boolean;
  message?: string;
  data?: BatteryHealthMetrics;
}

export default async function handleBatteryHealth(
  request: NextApiRequest,
  response: NextApiResponse<BatteryHealthApiResponse>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");

  if (request.method !== "GET") {
    response.setHeader("Allow", ["GET"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido.",
    });
    return;
  }

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno de autenticação.";
    response.status(500).json({
      success: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Por favor, faça login para acessar a telemetria da bateria.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  try {
    const configuration = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
    });

    if (!configuration) {
      response.status(404).json({
        success: false,
        message: "Configuração do usuário não encontrada.",
      });
      return;
    }

    const latestLog = await prisma.syncExecutionLog.findFirst({
      where: { userConfigurationId: configuration.id },
      orderBy: { executedAt: "desc" },
    });

    const streamService = EcoFlowMqttStreamService.getInstance();
    const liveTelemetry = streamService.getLatestTelemetry(extractedUserId, 300_000);

    const temp =
      liveTelemetry?.batteryTempCelsius ??
      latestLog?.batteryTempCelsius ??
      configuration.lastBatteryTempCelsius ??
      null;

    const cycles =
      liveTelemetry?.batteryCycles ??
      latestLog?.batteryCycles ??
      configuration.lastBatteryCycles ??
      null;

    const soh =
      liveTelemetry?.batterySoh ??
      latestLog?.batterySoh ??
      configuration.lastBatterySoh ??
      null;

    const volts = liveTelemetry?.batteryVolts ?? null;
    const amps = liveTelemetry?.batteryAmps ?? null;
    const watts =
      volts !== null && amps !== null ? Number((volts * amps).toFixed(1)) : null;

    const rawParams: RawBatteryTelemetryParams = {
      temp,
      cycles,
      soh,
      volts,
      amps,
      watts,
    };

    const batteryHealthService = BatteryHealthService.getInstance();
    const metrics = batteryHealthService.evaluateBatteryHealth(
      rawParams,
      configuration,
      configuration.id
    );

    response.status(200).json({
      success: true,
      data: metrics,
    });
  } catch (error: unknown) {
    console.error("[BatteryHealth API] Erro ao obter saúde da bateria:", error);
    response.status(500).json({
      success: false,
      message: "Erro interno ao processar dados de saúde da bateria.",
    });
  }
}
