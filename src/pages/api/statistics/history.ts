import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import { statisticsHistoryQuerySchema } from "../../../infrastructure/security/apiSchemas";
import {
  AggregationEngine,
  type StatisticsHistoryResponse,
} from "../../../domain/services/AggregationEngine";

export default async function handleStatisticsHistory(
  request: NextApiRequest,
  response: NextApiResponse<StatisticsHistoryResponse | { success: boolean; message: string }>
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", ["GET"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido.",
    });
    return;
  }

  response.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");

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
      message: "Usuário não autenticado.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const queryValidation = statisticsHistoryQuerySchema.safeParse(request.query);
  if (!queryValidation.success) {
    response.status(400).json({
      success: false,
      message:
        queryValidation.error.issues[0]?.message ?? "Parâmetros de consulta inválidos.",
    });
    return;
  }

  const { range } = queryValidation.data;

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

    const now = new Date();
    let windowStart: Date;

    if (range === "24h") {
      windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (range === "7d") {
      windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === "30d") {
      windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (range === "year") {
      windowStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    } else {
      // today-vs-yesterday: busca desde o início de ontem (00:00 BRT)
      windowStart = AggregationEngine.getBrasiliaMidnight(now, -1);
    }

    const logs = await prisma.syncExecutionLog.findMany({
      where: {
        userConfigurationId: configuration.id,
        executedAt: {
          gte: windowStart,
          lte: now,
        },
      },
      select: {
        executedAt: true,
        solarInputWatts: true,
        outputWatts: true,
        batteryPercentage: true,
        actionTriggered: true,
        executionDetails: true,
        batteryTempCelsius: true,
        batterySoh: true,
        batteryCycles: true,
      },
      orderBy: { executedAt: "asc" },
    });

    const result = AggregationEngine.aggregate({
      logs,
      range,
      referenceDate: now,
      energyCostPerKwh: configuration.energyCostPerKwh,
      dynamicTariffConfig: configuration,
      currencySymbol: configuration.currencySymbol,
    });

    response.status(200).json(result);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Erro interno ao processar estatísticas.";
    response.status(500).json({
      success: false,
      message,
    });
  }
}
