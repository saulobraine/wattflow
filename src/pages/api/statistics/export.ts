import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import { statisticsExportQuerySchema } from "../../../infrastructure/security/apiSchemas";
import {
  AggregationEngine,
  type StatisticsRange,
} from "../../../domain/services/AggregationEngine";

export default async function handleStatisticsExport(
  request: NextApiRequest,
  response: NextApiResponse
): Promise<void> {
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

  const queryValidation = statisticsExportQuerySchema.safeParse(request.query);
  if (!queryValidation.success) {
    response.status(400).json({
      success: false,
      message:
        queryValidation.error.issues[0]?.message ?? "Parâmetros de exportação inválidos.",
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
    } else {
      windowStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }

    const logs = await prisma.syncExecutionLog.findMany({
      where: {
        userConfigurationId: configuration.id,
        executedAt: { gte: windowStart },
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
      take: 10000,
    });

    const aggregated = AggregationEngine.aggregate({
      logs,
      range: range as StatisticsRange,
      referenceDate: now,
      energyCostPerKwh: configuration.energyCostPerKwh,
      dynamicTariffConfig: configuration,
      currencySymbol: configuration.currencySymbol,
    });

    const csvContent = AggregationEngine.exportToCsv(aggregated.points, {
      range: range as StatisticsRange,
      energyCostPerKwh: configuration.energyCostPerKwh,
      dynamicTariffConfig: configuration,
    });

    const { year, month, day } = AggregationEngine.getBrasiliaParts(now);
    const dateFormatted = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const filename = `wattflow-telemetria-${range}-${dateFormatted}.csv`;

    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    response.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");

    response.status(200).send(csvContent);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Erro interno ao exportar telemetria.";
    response.status(500).json({
      success: false,
      message,
    });
  }
}
