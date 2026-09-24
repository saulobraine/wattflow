import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";
import { SolarGenerationWatts } from "../../domain/values/SolarGenerationWatts";
import { SolarReadingCollection, SolarTelemetryPoint } from "../../domain/models/SolarReadingCollection";

interface SolarChartPoint {
  time: string;
  watts: number;
  battery: number;
}

interface StatisticsResponseData {
  success: boolean;
  message?: string;
  data?: {
    currentWatts: number;
    peakWatts: number;
    averageWatts: number;
    estimatedEnergyWattHours: number;
    estimatedEnergyKwh: number;
    totalReadingsCount: number;
    chartPoints: SolarChartPoint[];
    recentLogs: Array<{
      id: string;
      batteryPercentage: number;
      solarInputWatts: number;
      actionTriggered: string;
      executionDetails: string | null;
      executedAt: string;
    }>;
  };
}

export default async function handleStatistics(
  request: NextApiRequest,
  response: NextApiResponse<StatisticsResponseData>
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", ["GET"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido.",
    });
    return;
  }

  const sessionUser = extractUserFromRequest(request);
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

  try {
    const configuration = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
      include: {
        syncExecutionLogs: {
          orderBy: { executedAt: "desc" },
          take: 100,
        },
      },
    });

    if (!configuration || configuration.syncExecutionLogs.length === 0) {
      response.status(200).json({
        success: true,
        data: {
          currentWatts: 0,
          peakWatts: 0,
          averageWatts: 0,
          estimatedEnergyWattHours: 0,
          estimatedEnergyKwh: 0,
          totalReadingsCount: 0,
          chartPoints: [],
          recentLogs: [],
        },
      });
      return;
    }

    const rawLogs = configuration.syncExecutionLogs;
    const telemetryPoints: SolarTelemetryPoint[] = rawLogs.map((log) => ({
      watts: new SolarGenerationWatts(log.solarInputWatts),
      batteryPercentage: log.batteryPercentage,
      timestamp: log.executedAt,
    }));

    const collection = new SolarReadingCollection(telemetryPoints);
    const peakWattsObject = collection.calculatePeakWatts();
    let numericPeakWatts = 0;
    peakWattsObject.transferNumericWatts((value) => {
      numericPeakWatts = value;
    });

    const averageWatts = collection.calculateAverageWatts();
    // Considera intervalo padrão de 60 segundos entre amostras do cron
    const estimatedWattHours = collection.calculateEstimatedEnergyWattHours(60);
    const estimatedKwh = Number((estimatedWattHours / 1000).toFixed(3));

    const latestLog = rawLogs[0];
    const currentWatts = latestLog ? latestLog.solarInputWatts : 0;

    // Converte os pontos para ordem cronológica (mais antigo para mais recente) para o gráfico
    const chartPoints: SolarChartPoint[] = [...rawLogs]
      .reverse()
      .map((log) => ({
        time: new Date(log.executedAt).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        watts: log.solarInputWatts,
        battery: log.batteryPercentage,
      }));

    const recentLogs = rawLogs.slice(0, 20).map((log) => ({
      id: log.id,
      batteryPercentage: log.batteryPercentage,
      solarInputWatts: log.solarInputWatts,
      actionTriggered: log.actionTriggered,
      executionDetails: log.executionDetails,
      executedAt: log.executedAt.toISOString(),
    }));

    response.status(200).json({
      success: true,
      data: {
        currentWatts,
        peakWatts: numericPeakWatts,
        averageWatts,
        estimatedEnergyWattHours: estimatedWattHours,
        estimatedEnergyKwh: estimatedKwh,
        totalReadingsCount: rawLogs.length,
        chartPoints,
        recentLogs,
      },
    });
  } catch (error) {
    console.error("Erro ao gerar estatísticas solares:", error);
    response.status(500).json({
      success: false,
      message: "Erro ao compilar telemetria de estatísticas.",
    });
  }
}
