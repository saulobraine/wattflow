import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";
import { SolarGenerationWatts } from "../../domain/values/SolarGenerationWatts";
import { SolarReadingCollection, SolarTelemetryPoint } from "../../domain/models/SolarReadingCollection";
import { LiveTelemetryService } from "../../infrastructure/services/LiveTelemetryService";

interface SolarChartPoint {
  time: string;
  watts: number;
  outputWatts: number;
  netWatts: number;
  battery: number;
}

interface StatisticsResponseData {
  success: boolean;
  message?: string;
  data?: {
    currentWatts: number;
    currentOutputWatts: number;
    netWatts: number;
    peakWatts: number;
    averageWatts: number;
    averageOutputWatts: number;
    estimatedEnergyWattHours: number;
    estimatedEnergyKwh: number;
    estimatedConsumedWattHours: number;
    estimatedConsumedKwh: number;
    netEnergyWattHours: number;
    netEnergyKwh: number;
    totalReadingsCount: number;
    chartPoints: SolarChartPoint[];
    recentLogs: Array<{
      id: string;
      batteryPercentage: number;
      solarInputWatts: number;
      outputWatts: number;
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
    const liveService = new LiveTelemetryService(prisma);
    await liveService.syncIfStale(extractedUserId, 2000);

    const configuration = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
      include: {
        syncExecutionLogs: {
          orderBy: { executedAt: "desc" },
          take: 10,
        },
      },
    });

    if (!configuration || configuration.syncExecutionLogs.length === 0) {
      response.status(200).json({
        success: true,
        data: {
          currentWatts: 0,
          currentOutputWatts: 0,
          netWatts: 0,
          peakWatts: 0,
          averageWatts: 0,
          averageOutputWatts: 0,
          estimatedEnergyWattHours: 0,
          estimatedEnergyKwh: 0,
          estimatedConsumedWattHours: 0,
          estimatedConsumedKwh: 0,
          netEnergyWattHours: 0,
          netEnergyKwh: 0,
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
      outputWatts: log.outputWatts ?? 0,
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
    const averageOutputWatts = collection.calculateAverageOutputWatts();

    // Considera intervalo padrão de 60 segundos entre amostras do cron
    const estimatedWattHours = collection.calculateEstimatedEnergyWattHours(60);
    const estimatedKwh = Number((estimatedWattHours / 1000).toFixed(3));

    const estimatedConsumedWattHours = collection.calculateEstimatedConsumedWattHours(60);
    const estimatedConsumedKwh = Number((estimatedConsumedWattHours / 1000).toFixed(3));

    const netEnergyWattHours = collection.calculateNetEnergyWattHours(60);
    const netEnergyKwh = Number((netEnergyWattHours / 1000).toFixed(3));

    const latestLog = rawLogs[0];
    const currentWatts = latestLog ? latestLog.solarInputWatts : 0;
    const currentOutputWatts = latestLog ? (latestLog.outputWatts ?? 0) : 0;
    const netWatts = currentWatts - currentOutputWatts;

    // Converte os pontos para ordem cronológica (mais antigo para mais recente) para o gráfico (10 pontos)
    const chartPoints: SolarChartPoint[] = [...rawLogs]
      .reverse()
      .map((log) => {
        const generationWatts = log.solarInputWatts;
        const consumptionWatts = log.outputWatts ?? 0;
        return {
          time: new Date(log.executedAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          watts: generationWatts,
          outputWatts: consumptionWatts,
          netWatts: generationWatts - consumptionWatts,
          battery: log.batteryPercentage,
        };
      });

    const recentLogs = rawLogs.slice(0, 10).map((log) => ({
      id: log.id,
      batteryPercentage: log.batteryPercentage,
      solarInputWatts: log.solarInputWatts,
      outputWatts: log.outputWatts ?? 0,
      actionTriggered: log.actionTriggered,
      executionDetails: log.executionDetails,
      executedAt: log.executedAt.toISOString(),
    }));

    response.status(200).json({
      success: true,
      data: {
        currentWatts,
        currentOutputWatts,
        netWatts,
        peakWatts: numericPeakWatts,
        averageWatts,
        averageOutputWatts,
        estimatedEnergyWattHours: estimatedWattHours,
        estimatedEnergyKwh: estimatedKwh,
        estimatedConsumedWattHours: estimatedConsumedWattHours,
        estimatedConsumedKwh: estimatedConsumedKwh,
        netEnergyWattHours: netEnergyWattHours,
        netEnergyKwh: netEnergyKwh,
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
