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

  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");

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

    const nowTimestamp = Date.now();
    const thirtyMinutesAgo = new Date(nowTimestamp - 30 * 60 * 1000);

    const configuration = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
      include: {
        syncExecutionLogs: {
          where: {
            executedAt: { gte: thirtyMinutesAgo },
          },
          orderBy: { executedAt: "desc" },
        },
      },
    });

    let rawLogs = configuration?.syncExecutionLogs ?? [];

    // Fallback: caso o sistema tenha sido iniciado recentemente ou não haja logs nos últimos 30 min
    if (rawLogs.length === 0 && configuration) {
      rawLogs = await prisma.syncExecutionLog.findMany({
        where: { userConfigurationId: configuration.id },
        orderBy: { executedAt: "desc" },
        take: 30,
      });
    }

    if (!configuration || rawLogs.length === 0) {
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

    // Leitura instantânea mais recente
    const latestLog = rawLogs[0];
    const currentWatts = latestLog ? latestLog.solarInputWatts : 0;
    const currentOutputWatts = latestLog ? (latestLog.outputWatts ?? 0) : 0;
    const netWatts = currentWatts - currentOutputWatts;

    // Métricas de energia acumulada da janela dos 30 minutos
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

    const estimatedWattHours = collection.calculateEstimatedEnergyWattHours(60);
    const estimatedKwh = Number((estimatedWattHours / 1000).toFixed(3));

    const estimatedConsumedWattHours = collection.calculateEstimatedConsumedWattHours(60);
    const estimatedConsumedKwh = Number((estimatedConsumedWattHours / 1000).toFixed(3));

    const netEnergyWattHours = collection.calculateNetEnergyWattHours(60);
    const netEnergyKwh = Number((netEnergyWattHours / 1000).toFixed(3));

    // Agrupamento por baldes de 5 em 5 minutos nos últimos 30 minutos
    const bucketDurationMs = 5 * 60 * 1000;
    const newestLogTime = rawLogs[0].executedAt.getTime();
    const isWithinRecentWindow = newestLogTime >= (nowTimestamp - 30 * 60 * 1000);
    const windowEndTime = isWithinRecentWindow ? nowTimestamp : newestLogTime;
    const windowStartTime = windowEndTime - 30 * 60 * 1000;

    const chartPoints: SolarChartPoint[] = [];
    const totalBuckets = 6;

    for (let i = 0; i < totalBuckets; i++) {
      const bucketStart = windowStartTime + i * bucketDurationMs;
      const bucketEnd = bucketStart + bucketDurationMs;

      const bucketLogs = rawLogs.filter((log) => {
        const logTime = log.executedAt.getTime();
        return logTime >= bucketStart && logTime <= bucketEnd;
      });

      if (bucketLogs.length > 0) {
        const sumWatts = bucketLogs.reduce((acc, log) => acc + log.solarInputWatts, 0);
        const sumOut = bucketLogs.reduce((acc, log) => acc + (log.outputWatts ?? 0), 0);
        const avgBucketWatts = Math.round(sumWatts / bucketLogs.length);
        const avgBucketOut = Math.round(sumOut / bucketLogs.length);
        const representativeLog = bucketLogs[0];

        chartPoints.push({
          time: new Date(bucketEnd).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          watts: avgBucketWatts,
          outputWatts: avgBucketOut,
          netWatts: avgBucketWatts - avgBucketOut,
          battery: representativeLog.batteryPercentage,
        });
      }
    }

    // Se nenhum balde foi capturado pela janela estrita (ex: logs isolados no fallback), cria baldes baseados no range real
    if (chartPoints.length === 0 && rawLogs.length > 0) {
      const sortedLogs = [...rawLogs].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
      const minLogTime = sortedLogs[0].executedAt.getTime();
      const maxLogTime = sortedLogs[sortedLogs.length - 1].executedAt.getTime();
      const spanMs = Math.max(maxLogTime - minLogTime, bucketDurationMs);
      const stepCount = Math.min(Math.ceil(spanMs / bucketDurationMs), 6);

      for (let i = 0; i < stepCount; i++) {
        const bStart = minLogTime + i * bucketDurationMs;
        const bEnd = bStart + bucketDurationMs;
        const bLogs = sortedLogs.filter((l) => {
          const t = l.executedAt.getTime();
          return t >= bStart && t <= bEnd;
        });

        if (bLogs.length > 0) {
          const sumWatts = bLogs.reduce((acc, l) => acc + l.solarInputWatts, 0);
          const sumOut = bLogs.reduce((acc, l) => acc + (l.outputWatts ?? 0), 0);
          const avgWatts = Math.round(sumWatts / bLogs.length);
          const avgOut = Math.round(sumOut / bLogs.length);
          const repLog = bLogs[bLogs.length - 1];

          chartPoints.push({
            time: new Date(bEnd).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            watts: avgWatts,
            outputWatts: avgOut,
            netWatts: avgWatts - avgOut,
            battery: repLog.batteryPercentage,
          });
        }
      }
    }

    const recentLogs = rawLogs.slice(0, 30).map((log) => ({
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
