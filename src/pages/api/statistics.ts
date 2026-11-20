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

export interface AtsHealthMetrics {
  lifespanCycles: number;
  currentCycles: number;
  remainingCycles: number;
  healthPercentage: number;
  estimatedYearsRemaining: number;
  dailyRate: number;
  atsLastSwitchedAt: string | null;
  status: "EXCELLENT" | "GOOD" | "ATTENTION" | "CRITICAL";
  isProratedEstimate?: boolean;
}

export interface FinancialSavingsMetrics {
  todayKwh: number;
  todaySavings: number;
  monthKwh: number;
  monthSavings: number;
  totalKwh: number;
  totalSavings: number;
  energyCostPerKwh: number;
  currencySymbol: string;
}

export interface AutonomyEstimateMetrics {
  runtimeMinutes: number | null;
  formattedRuntime: string;
  isRecharging: boolean;
  isIdle: boolean;
  netDrainWatts: number;
  remainingWh: number;
  status: "CHARGING" | "DISCHARGING" | "IDLE" | "DEPLETED";
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
    atsHealth: AtsHealthMetrics;
    financialSavings: FinancialSavingsMetrics;
    autonomyEstimate: AutonomyEstimateMetrics;
  };
}

function calculateFinancialSavings(
  todayKwh: number,
  monthKwh: number,
  totalKwh: number,
  energyCostPerKwh: number,
  currencySymbol: string
): FinancialSavingsMetrics {
  const safeTariff = energyCostPerKwh > 0 ? energyCostPerKwh : 0.92;
  const safeSymbol = currencySymbol || "R$";

  return {
    todayKwh: Number(todayKwh.toFixed(2)),
    todaySavings: Number((todayKwh * safeTariff).toFixed(2)),
    monthKwh: Number(monthKwh.toFixed(2)),
    monthSavings: Number((monthKwh * safeTariff).toFixed(2)),
    totalKwh: Number(totalKwh.toFixed(2)),
    totalSavings: Number((totalKwh * safeTariff).toFixed(2)),
    energyCostPerKwh: safeTariff,
    currencySymbol: safeSymbol,
  };
}

function calculateAutonomyEstimate(
  batteryCapacityWh: number,
  batteryPercentage: number,
  solarInputWatts: number,
  outputWatts: number
): AutonomyEstimateMetrics {
  const safeCapacity = batteryCapacityWh > 0 ? batteryCapacityWh : 2048;
  const clampedPercentage = Math.max(0, Math.min(100, batteryPercentage));
  const remainingWh = Math.round(safeCapacity * (clampedPercentage / 100));
  const netDrainWatts = outputWatts - solarInputWatts;

  if (clampedPercentage <= 0) {
    return {
      runtimeMinutes: 0,
      formattedRuntime: "0h 00m",
      isRecharging: false,
      isIdle: false,
      netDrainWatts,
      remainingWh: 0,
      status: "DEPLETED",
    };
  }

  if (outputWatts <= 5) {
    const isRecharging = solarInputWatts > 10;
    return {
      runtimeMinutes: null,
      formattedRuntime: isRecharging ? "Em Carga / Solar" : "Standby / Sem Carga",
      isRecharging,
      isIdle: true,
      netDrainWatts,
      remainingWh,
      status: isRecharging ? "CHARGING" : "IDLE",
    };
  }

  if (solarInputWatts >= outputWatts) {
    return {
      runtimeMinutes: null,
      formattedRuntime: "Em Carga / Solar",
      isRecharging: true,
      isIdle: false,
      netDrainWatts,
      remainingWh,
      status: "CHARGING",
    };
  }

  const runtimeHours = remainingWh / netDrainWatts;
  const runtimeMinutes = Math.round(runtimeHours * 60);
  const hours = Math.floor(runtimeMinutes / 60);
  const mins = runtimeMinutes % 60;
  const formattedRuntime = `${hours}h ${mins.toString().padStart(2, "0")}m`;
  const status = clampedPercentage <= 5 ? "DEPLETED" : "DISCHARGING";

  return {
    runtimeMinutes,
    formattedRuntime,
    isRecharging: false,
    isIdle: false,
    netDrainWatts,
    remainingWh,
    status,
  };
}

function calculateAtsHealth(
  configuration: {
    atsLifespanCycles?: number | null;
    atsCurrentCycles?: number | null;
    atsLastSwitchedAt?: Date | null;
    createdAt?: Date;
  } | null,
  recentSwitchCount: number,
  spanDays: number
): AtsHealthMetrics {
  const lifespan = configuration?.atsLifespanCycles ?? 10000;
  const current = configuration?.atsCurrentCycles ?? 0;
  const remaining = Math.max(0, lifespan - current);
  const healthPercentage =
    lifespan > 0
      ? Math.max(0, Math.min(100, Number(((remaining / lifespan) * 100).toFixed(1))))
      : 0;

  let status: "EXCELLENT" | "GOOD" | "ATTENTION" | "CRITICAL" = "EXCELLENT";
  if (healthPercentage < 20) {
    status = "CRITICAL";
  } else if (healthPercentage < 50) {
    status = "ATTENTION";
  } else if (healthPercentage < 80) {
    status = "GOOD";
  }

  let dailyRate = 2.0;
  let isProratedEstimate = true;

  if (spanDays >= 2 && recentSwitchCount > 0) {
    dailyRate = Number((recentSwitchCount / spanDays).toFixed(2));
    isProratedEstimate = false;
  } else if (configuration?.createdAt) {
    const totalDaysActive = (Date.now() - configuration.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (totalDaysActive >= 2 && current > 0) {
      dailyRate = Number((current / totalDaysActive).toFixed(2));
      isProratedEstimate = false;
    }
  }

  const effectiveDailyRate = dailyRate > 0 ? dailyRate : 2.0;
  const estimatedYearsRemaining = Number((remaining / (effectiveDailyRate * 365)).toFixed(1));

  return {
    lifespanCycles: lifespan,
    currentCycles: current,
    remainingCycles: remaining,
    healthPercentage,
    estimatedYearsRemaining,
    dailyRate: Number(dailyRate.toFixed(2)),
    atsLastSwitchedAt: configuration?.atsLastSwitchedAt
      ? configuration.atsLastSwitchedAt.toISOString()
      : null,
    status,
    isProratedEstimate,
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

  try {
    const liveService = new LiveTelemetryService(prisma);
    await liveService.syncIfStale(extractedUserId, 2000);

    const nowTimestamp = Date.now();
    const twentyFourHoursAgo = new Date(nowTimestamp - 24 * 60 * 60 * 1000);
    const thirtyMinutesAgo = new Date(nowTimestamp - 30 * 60 * 1000);

    // Busca as leituras das últimas 24 horas para o cálculo de energia acumulada do dia
    const configuration = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
      include: {
        syncExecutionLogs: {
          where: {
            executedAt: { gte: twentyFourHoursAgo },
          },
          orderBy: { executedAt: "desc" },
        },
      },
    });

    let rawLogs24h = configuration?.syncExecutionLogs ?? [];

    // Fallback: se houver poucos registros na janela de 24h, busca as amostras mais recentes disponíveis
    if (rawLogs24h.length === 0 && configuration) {
      rawLogs24h = await prisma.syncExecutionLog.findMany({
        where: { userConfigurationId: configuration.id },
        orderBy: { executedAt: "desc" },
        take: 100,
      });
    }

    let recentSwitchCount = 0;
    let switchSpanDays = 0;

    if (configuration) {
      const thirtyDaysAgo = new Date(nowTimestamp - 30 * 24 * 60 * 60 * 1000);
      const switchingLogs = await prisma.syncExecutionLog.findMany({
        where: {
          userConfigurationId: configuration.id,
          executedAt: { gte: thirtyDaysAgo },
          actionTriggered: {
            in: [
              "ENABLE_ECOFLOW_AC",
              "DISABLE_ECOFLOW_AC",
              "BATTERY_HIGH_DISCHARGE",
              "BATTERY_LOW_RECHARGE",
            ],
          },
        },
        orderBy: { executedAt: "asc" },
      });

      recentSwitchCount = switchingLogs.length;
      if (switchingLogs.length >= 2) {
        const firstTime = switchingLogs[0].executedAt.getTime();
        const lastTime = switchingLogs[switchingLogs.length - 1].executedAt.getTime();
        switchSpanDays = Math.max(1, (lastTime - firstTime) / (1000 * 60 * 60 * 24));
      }
    }

    const atsHealth = calculateAtsHealth(configuration, recentSwitchCount, switchSpanDays);

    if (!configuration || rawLogs24h.length === 0) {
      const defaultFinancialSavings = calculateFinancialSavings(
        0,
        0,
        0,
        configuration?.energyCostPerKwh ?? 0.92,
        configuration?.currencySymbol ?? "R$"
      );
      const defaultAutonomy = calculateAutonomyEstimate(
        configuration?.batteryCapacityWh ?? 2048,
        0,
        0,
        0
      );

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
          atsHealth,
          financialSavings: defaultFinancialSavings,
          autonomyEstimate: defaultAutonomy,
        },
      });
      return;
    }

    // Leitura instantânea mais recente
    const latestLog = rawLogs24h[0];
    const currentWatts = latestLog ? latestLog.solarInputWatts : 0;
    const currentOutputWatts = latestLog ? (latestLog.outputWatts ?? 0) : 0;
    const netWatts = currentWatts - currentOutputWatts;

    // Métricas de energia acumulada da janela das últimas 24 horas (maxWindowHours = 24)
    const telemetryPoints24h: SolarTelemetryPoint[] = rawLogs24h.map((log) => ({
      watts: new SolarGenerationWatts(log.solarInputWatts),
      outputWatts: log.outputWatts ?? 0,
      batteryPercentage: log.batteryPercentage,
      timestamp: log.executedAt,
    }));

    const collection24h = new SolarReadingCollection(telemetryPoints24h);
    const peakWattsObject = collection24h.calculatePeakWatts();
    let numericPeakWatts = 0;
    peakWattsObject.transferNumericWatts((value) => {
      numericPeakWatts = value;
    });

    const averageWatts24h = collection24h.calculateAverageWatts();
    const averageOutputWatts24h = collection24h.calculateAverageOutputWatts();

    const estimatedEnergyWattHours = collection24h.calculateAccumulatedEnergyWattHours(24);
    const estimatedEnergyKwh = Number((estimatedEnergyWattHours / 1000).toFixed(3));

    const estimatedConsumedWattHours = collection24h.calculateAccumulatedConsumedWattHours(24);
    const estimatedConsumedKwh = Number((estimatedConsumedWattHours / 1000).toFixed(3));

    const netEnergyWattHours = collection24h.calculateAccumulatedNetEnergyWattHours(24);
    const netEnergyKwh = Number((netEnergyWattHours / 1000).toFixed(3));

    // Filtra especificamente a janela dos últimos 30 minutos para compor os 6 baldes médios do gráfico horizontal
    let rawLogs30m = rawLogs24h.filter(
      (log) => log.executedAt.getTime() >= thirtyMinutesAgo.getTime()
    );

    if (rawLogs30m.length === 0) {
      rawLogs30m = rawLogs24h.slice(0, 30);
    }

    const bucketDurationMs = 5 * 60 * 1000;
    const newestLogTime = rawLogs30m[0].executedAt.getTime();
    const isWithinRecentWindow = newestLogTime >= (nowTimestamp - 30 * 60 * 1000);
    const windowEndTime = isWithinRecentWindow ? nowTimestamp : newestLogTime;
    const windowStartTime = windowEndTime - 30 * 60 * 1000;

    const chartPoints: SolarChartPoint[] = [];
    const totalBuckets = 6;

    for (let i = 0; i < totalBuckets; i++) {
      const bucketStart = windowStartTime + i * bucketDurationMs;
      const bucketEnd = bucketStart + bucketDurationMs;

      const bucketLogs = rawLogs30m.filter((log) => {
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

    // Se nenhum balde foi capturado pela janela estrita de 30m, cria baldes proporcionais a partir das amostras disponíveis
    if (chartPoints.length === 0 && rawLogs30m.length > 0) {
      const sortedLogs = [...rawLogs30m].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
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

    const recentLogs = rawLogs24h.slice(0, 30).map((log) => ({
      id: log.id,
      batteryPercentage: log.batteryPercentage,
      solarInputWatts: log.solarInputWatts,
      outputWatts: log.outputWatts ?? 0,
      actionTriggered: log.actionTriggered,
      executionDetails: log.executionDetails,
      executedAt: log.executedAt.toISOString(),
    }));

    const todayKwh = estimatedEnergyKwh;
    let monthKwh = todayKwh;
    let totalKwh = todayKwh;

    if (configuration) {
      const startOfMonth = new Date(nowTimestamp);
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const monthLogs = await prisma.syncExecutionLog.findMany({
        where: {
          userConfigurationId: configuration.id,
          executedAt: { gte: startOfMonth },
        },
        select: {
          solarInputWatts: true,
          outputWatts: true,
          batteryPercentage: true,
          executedAt: true,
        },
        orderBy: { executedAt: "asc" },
      });

      if (monthLogs.length > 0) {
        const monthPoints: SolarTelemetryPoint[] = monthLogs.map((log) => ({
          watts: new SolarGenerationWatts(log.solarInputWatts),
          outputWatts: log.outputWatts ?? 0,
          batteryPercentage: log.batteryPercentage,
          timestamp: log.executedAt,
        }));
        const monthCollection = new SolarReadingCollection(monthPoints);
        const monthHours = Math.max(1, Math.ceil((nowTimestamp - startOfMonth.getTime()) / (1000 * 60 * 60)));
        const monthWh = monthCollection.calculateAccumulatedEnergyWattHours(monthHours);
        monthKwh = Math.max(todayKwh, Number((monthWh / 1000).toFixed(2)));
      }

      const oldestLog = await prisma.syncExecutionLog.findFirst({
        where: { userConfigurationId: configuration.id },
        orderBy: { executedAt: "asc" },
        select: { executedAt: true },
      });

      if (oldestLog && oldestLog.executedAt < startOfMonth) {
        const totalDays = Math.max(1, (nowTimestamp - oldestLog.executedAt.getTime()) / (1000 * 60 * 60 * 24));
        const daysInMonthSoFar = Math.max(1, (nowTimestamp - startOfMonth.getTime()) / (1000 * 60 * 60 * 24));
        const avgDailyKwh = monthKwh / daysInMonthSoFar;
        totalKwh = Math.max(monthKwh, Number((avgDailyKwh * totalDays).toFixed(2)));
      } else {
        totalKwh = monthKwh;
      }
    }

    const financialSavings = calculateFinancialSavings(
      todayKwh,
      monthKwh,
      totalKwh,
      configuration?.energyCostPerKwh ?? 0.92,
      configuration?.currencySymbol ?? "R$"
    );

    const latestBattery = latestLog ? latestLog.batteryPercentage : 0;
    const autonomyEstimate = calculateAutonomyEstimate(
      configuration?.batteryCapacityWh ?? 2048,
      latestBattery,
      currentWatts,
      currentOutputWatts
    );

    response.status(200).json({
      success: true,
      data: {
        currentWatts,
        currentOutputWatts,
        netWatts,
        peakWatts: numericPeakWatts,
        averageWatts: averageWatts24h,
        averageOutputWatts: averageOutputWatts24h,
        estimatedEnergyWattHours,
        estimatedEnergyKwh,
        estimatedConsumedWattHours,
        estimatedConsumedKwh,
        netEnergyWattHours,
        netEnergyKwh,
        totalReadingsCount: rawLogs24h.length,
        chartPoints,
        recentLogs,
        atsHealth,
        financialSavings,
        autonomyEstimate,
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
