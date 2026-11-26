import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";
import { SolarGenerationWatts } from "../../domain/values/SolarGenerationWatts";
import { SolarReadingCollection, SolarTelemetryPoint } from "../../domain/models/SolarReadingCollection";
import { LiveTelemetryService } from "../../infrastructure/services/LiveTelemetryService";
import { EcoFlowMqttStreamService } from "../../infrastructure/services/EcoFlowMqttStreamService";
import {
  OpenMeteoSolarForecastService,
  type SolarExpectationLevel,
} from "../../infrastructure/services/OpenMeteoSolarForecastService";
import {
  TariffScheduleService,
  type TariffPeriod,
  type DynamicTariffConfig,
} from "../../domain/services/TariffScheduleService";
import { BatteryHealthService } from "../../domain/services/BatteryHealthService";

export type { SolarExpectationLevel, TariffPeriod };

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
  isDynamicTariffActive?: boolean;
  currentTariffPeriod?: TariffPeriod;
  currentTariffRate?: number;
  peakSavingsToday?: number;
  offPeakSavingsToday?: number;
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

export interface SolarForecastMetrics {
  isAdaptiveActive: boolean;
  radiationMj: number | null;
  expectation: SolarExpectationLevel | null;
  effectiveTurnOffThreshold: number;
  forecastSummary: string;
  sunshineDurationSeconds?: number;
  weatherCode?: number;
  lastForecastCheckAt?: string | null;
  peakSunHours?: number | null;
  irradianceKwhM2?: number | null;
  estimatedDailyGenerationKwh?: number | null;
  isDaylightOnlyActive?: boolean;
  sunrise?: string | null;
  sunset?: string | null;
  isDaylight?: boolean;
}

export interface BmsAnalyticsMetrics {
  temperatureCelsius: number | null;
  maxRecordedTemp: number | null;
  sohPercentage: number | null;
  bmsCycles: number | null;
  thermalStatus: "NORMAL" | "WARM" | "HOT" | "CRITICAL";
  thermalWarningThreshold: number;
  thermalShutdownThreshold: number;
  voltageVolts: number | null;
  amperageAmps: number | null;
  recentThermalTrend: Array<{
    time: string;
    temperatureCelsius: number;
  }>;
  hardwareStatus?: string;
  isAnalyticalBms?: boolean;
  isVoltageEstimated?: boolean;
}

export interface ApplianceSimulationMetrics {
  totalSimulatedWatts: number;
  simulatedRuntimeMinutes: number;
  formattedSimulatedRuntime: string;
  baselineRuntimeMinutes: number | null;
  formattedBaselineRuntime: string;
  runtimeDeltaMinutes: number | null;
  activeAppliancesCount: number;
  totalAppliancesCount: number;
}

interface StatisticsCacheEntry {
  data: NonNullable<StatisticsResponseData["data"]>;
  cachedAt: number;
}

const statisticsMemoryCache = new Map<string, StatisticsCacheEntry>();
export const STATISTICS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos (TTL para previsão solar Open-Meteo e agregações)

export function clearStatisticsCache(): void {
  statisticsMemoryCache.clear();
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
      batteryTempCelsius?: number | null;
      batterySoh?: number | null;
      batteryCycles?: number | null;
    }>;
    atsHealth: AtsHealthMetrics;
    financialSavings: FinancialSavingsMetrics;
    autonomyEstimate: AutonomyEstimateMetrics;
    solarForecast: SolarForecastMetrics;
    bmsAnalytics: BmsAnalyticsMetrics;
    applianceSimulation: ApplianceSimulationMetrics;
  };
}

function calculateFinancialSavings(
  todayKwh: number,
  monthKwh: number,
  totalKwh: number,
  energyCostPerKwh: number,
  currencySymbol: string,
  dynamicConfig?: Partial<DynamicTariffConfig> | null,
  rawLogs24h?: Array<{ solarInputWatts: number; outputWatts?: number; executedAt: Date }>
): FinancialSavingsMetrics {
  const safeTariff = energyCostPerKwh > 0 ? energyCostPerKwh : 0.92;
  const safeSymbol = currencySymbol || "R$";
  const isDynamic = Boolean(dynamicConfig?.isDynamicTariffActive);

  if (!isDynamic || !dynamicConfig) {
    return {
      todayKwh: Number(todayKwh.toFixed(2)),
      todaySavings: Number((todayKwh * safeTariff).toFixed(2)),
      monthKwh: Number(monthKwh.toFixed(2)),
      monthSavings: Number((monthKwh * safeTariff).toFixed(2)),
      totalKwh: Number(totalKwh.toFixed(2)),
      totalSavings: Number((totalKwh * safeTariff).toFixed(2)),
      energyCostPerKwh: safeTariff,
      currencySymbol: safeSymbol,
      isDynamicTariffActive: false,
      currentTariffPeriod: "OFF_PEAK",
      currentTariffRate: safeTariff,
      peakSavingsToday: 0,
      offPeakSavingsToday: Number((todayKwh * safeTariff).toFixed(2)),
    };
  }

  const scheduleService = TariffScheduleService.getInstance();
  const fullConfig: DynamicTariffConfig = {
    isDynamicTariffActive: true,
    peakTariffPerKwh: dynamicConfig.peakTariffPerKwh ?? 1.85,
    intermediateTariffPerKwh: dynamicConfig.intermediateTariffPerKwh ?? 1.15,
    offPeakTariffPerKwh: dynamicConfig.offPeakTariffPerKwh ?? 0.65,
    peakStartTime: dynamicConfig.peakStartTime ?? "17:30",
    peakEndTime: dynamicConfig.peakEndTime ?? "20:30",
    intermediateStartTime1: dynamicConfig.intermediateStartTime1 ?? "16:30",
    intermediateEndTime1: dynamicConfig.intermediateEndTime1 ?? "17:30",
    intermediateStartTime2: dynamicConfig.intermediateStartTime2 ?? "20:30",
    intermediateEndTime2: dynamicConfig.intermediateEndTime2 ?? "21:30",
    energyCostPerKwh: safeTariff,
  };

  const currentEval = scheduleService.evaluate(fullConfig);

  let peakSavingsToday = 0;
  let offPeakSavingsToday = 0;
  let weightedTodaySavings = 0;

  if (rawLogs24h && rawLogs24h.length > 0) {
    const totalWattsSum = rawLogs24h.reduce((acc, l) => acc + l.solarInputWatts, 0);

    for (const log of rawLogs24h) {
      const evalAtLog = scheduleService.evaluate(fullConfig, log.executedAt);
      const logShareOfTotal =
        totalWattsSum > 0 ? log.solarInputWatts / totalWattsSum : 1 / rawLogs24h.length;
      const logKwh = todayKwh * logShareOfTotal;
      const logSavings = logKwh * evalAtLog.rate;

      if (evalAtLog.period === "PEAK") {
        peakSavingsToday += logSavings;
      } else {
        offPeakSavingsToday += logSavings;
      }
      weightedTodaySavings += logSavings;
    }
  } else {
    weightedTodaySavings = todayKwh * currentEval.rate;
    if (currentEval.period === "PEAK") {
      peakSavingsToday = weightedTodaySavings;
    } else {
      offPeakSavingsToday = weightedTodaySavings;
    }
  }

  const effectiveDailyRate = todayKwh > 0 ? weightedTodaySavings / todayKwh : currentEval.rate;
  const monthSavings = Number((monthKwh * effectiveDailyRate).toFixed(2));
  const totalSavings = Number((totalKwh * effectiveDailyRate).toFixed(2));

  return {
    todayKwh: Number(todayKwh.toFixed(2)),
    todaySavings: Number(weightedTodaySavings.toFixed(2)),
    monthKwh: Number(monthKwh.toFixed(2)),
    monthSavings,
    totalKwh: Number(totalKwh.toFixed(2)),
    totalSavings,
    energyCostPerKwh: currentEval.rate,
    currencySymbol: safeSymbol,
    isDynamicTariffActive: true,
    currentTariffPeriod: currentEval.period,
    currentTariffRate: currentEval.rate,
    peakSavingsToday: Number(peakSavingsToday.toFixed(2)),
    offPeakSavingsToday: Number(offPeakSavingsToday.toFixed(2)),
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

export function calculateAtsHealth(
  configuration: {
    atsLifespanCycles?: number | null;
    atsCurrentCycles?: number | null;
    atsLastSwitchedAt?: Date | string | null;
    createdAt?: Date | string | null;
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

  const totalDaysActive = configuration?.createdAt
    ? (Date.now() - new Date(configuration.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    : 0;

  // 1. Fonte Primária: Contador canônico (atsCurrentCycles) dividido pelo tempo ativo da configuração
  if (totalDaysActive >= 2 && current > 0) {
    const canonicalRate = current / totalDaysActive;
    if (canonicalRate > 0 && canonicalRate <= 20) {
      dailyRate = Number(canonicalRate.toFixed(2));
      isProratedEstimate = false;
    }
  }

  // 2. Fonte Secundária: Logs de comutações recentes reais dos últimos 30 dias (se a primária não foi aplicável)
  if (isProratedEstimate && spanDays >= 2 && recentSwitchCount > 0) {
    const recentRate = recentSwitchCount / spanDays;
    if (recentRate > 0 && recentRate <= 20) {
      dailyRate = Number(recentRate.toFixed(2));
      isProratedEstimate = false;
    }
  }

  // 3. Guard de Sanidade Física: Residencial opera tipicamente de 1 a 6 vezes/dia.
  // Se dailyRate > 20 ou <= 0, reseta para 2.0 como estimativa conservadora.
  if (dailyRate <= 0 || dailyRate > 20) {
    dailyRate = 2.0;
    isProratedEstimate = true;
  }

  const effectiveDailyRate = dailyRate > 0 ? dailyRate : 2.0;
  const estimatedYearsRemaining =
    remaining === 0
      ? 0
      : Number((remaining / (effectiveDailyRate * 365)).toFixed(1));

  let lastSwitchedIso: string | null = null;
  if (configuration?.atsLastSwitchedAt) {
    lastSwitchedIso =
      typeof configuration.atsLastSwitchedAt === "string"
        ? configuration.atsLastSwitchedAt
        : configuration.atsLastSwitchedAt.toISOString();
  }

  return {
    lifespanCycles: lifespan,
    currentCycles: current,
    remainingCycles: remaining,
    healthPercentage,
    estimatedYearsRemaining,
    dailyRate: Number(dailyRate.toFixed(2)),
    atsLastSwitchedAt: lastSwitchedIso,
    status,
    isProratedEstimate,
  };
}

async function buildSolarForecastMetrics(
  configuration: {
    latitude?: number | null;
    longitude?: number | null;
    isAdaptiveHysteresisActive?: boolean;
    isDaylightOnlyActive?: boolean;
    minAdaptiveThreshold?: number;
    maxAdaptiveThreshold?: number;
    lastSolarIrradianceMj?: number | null;
    lastSolarForecastCheckAt?: Date | null;
  } | null
): Promise<SolarForecastMetrics> {
  const isAdaptiveActive = configuration?.isAdaptiveHysteresisActive ?? false;
  const isDaylightOnlyActive = configuration?.isDaylightOnlyActive ?? false;
  const minAdaptive = configuration?.minAdaptiveThreshold ?? 20;
  const maxAdaptive = configuration?.maxAdaptiveThreshold ?? 50;

  if (
    configuration?.latitude !== null &&
    configuration?.latitude !== undefined &&
    configuration?.longitude !== null &&
    configuration?.longitude !== undefined
  ) {
    try {
      const forecastService = OpenMeteoSolarForecastService.getInstance();
      const forecast = await forecastService.getForecast(
        configuration.latitude,
        configuration.longitude,
        minAdaptive,
        maxAdaptive
      );
      return {
        isAdaptiveActive,
        radiationMj: forecast.irradianceMj,
        expectation: forecast.expectationLevel,
        effectiveTurnOffThreshold: forecast.effectiveTurnOffThreshold,
        forecastSummary: forecast.forecastSummary,
        sunshineDurationSeconds: forecast.sunshineDurationSeconds,
        weatherCode: forecast.weatherCode,
        lastForecastCheckAt: configuration.lastSolarForecastCheckAt
          ? configuration.lastSolarForecastCheckAt.toISOString()
          : null,
        peakSunHours: forecast.peakSunHours,
        irradianceKwhM2: forecast.irradianceKwhM2,
        estimatedDailyGenerationKwh: forecast.estimatedDailyGenerationKwh,
        isDaylightOnlyActive,
        sunrise: forecast.sunrise,
        sunset: forecast.sunset,
        isDaylight: forecast.isDaylight,
      };
    } catch {
      // Fallback gracioso
    }
  }

  return {
    isAdaptiveActive,
    radiationMj: configuration?.lastSolarIrradianceMj ?? null,
    expectation: null,
    effectiveTurnOffThreshold: minAdaptive,
    forecastSummary:
      "Coordenadas geográficas não configuradas. Previsão solar desativada.",
    lastForecastCheckAt: configuration?.lastSolarForecastCheckAt
      ? configuration.lastSolarForecastCheckAt.toISOString()
      : null,
    peakSunHours: null,
    irradianceKwhM2: null,
    estimatedDailyGenerationKwh: null,
    isDaylightOnlyActive,
    sunrise: null,
    sunset: null,
    isDaylight: true,
  };
}

function buildBmsAnalyticsMetrics(
  configuration: {
    thermalWarningThreshold?: number | null;
    thermalShutdownThreshold?: number | null;
    lastBatteryTempCelsius?: number | null;
    lastBatterySoh?: number | null;
    lastBatteryCycles?: number | null;
    maxRecordedBatteryTemp?: number | null;
    atsCurrentCycles?: number | null;
    batteryCapacityWh?: number | null;
  } | null,
  liveTelemetry: {
    batteryTempCelsius?: number | null;
    batterySoh?: number | null;
    batteryCycles?: number | null;
    batteryVolts?: number | null;
    batteryAmps?: number | null;
    batteryPercentage?: number | null;
  } | null,
  rawLogs: Array<{ executedAt: Date; batteryTempCelsius?: number | null }>,
  latestBatteryPercentage?: number | null
): BmsAnalyticsMetrics {
  const warning = configuration?.thermalWarningThreshold ?? 45.0;
  const shutdown = configuration?.thermalShutdownThreshold ?? 50.0;

  const currentTemp =
    liveTelemetry?.batteryTempCelsius !== undefined && liveTelemetry?.batteryTempCelsius !== null
      ? liveTelemetry.batteryTempCelsius
      : configuration?.lastBatteryTempCelsius ?? null;

  let maxTemp = configuration?.maxRecordedBatteryTemp ?? null;
  if (currentTemp !== null) {
    maxTemp = maxTemp !== null ? Math.max(maxTemp, currentTemp) : currentTemp;
  }

  const batteryHealthService = BatteryHealthService.getInstance();
  let isAnalyticalBms = false;
  let isVoltageEstimated = false;

  let cycles =
    liveTelemetry?.batteryCycles !== undefined && liveTelemetry?.batteryCycles !== null
      ? liveTelemetry.batteryCycles
      : configuration?.lastBatteryCycles ?? null;

  if (
    cycles === null &&
    configuration?.atsCurrentCycles !== undefined &&
    configuration?.atsCurrentCycles !== null
  ) {
    const throughputKwh =
      (configuration.atsCurrentCycles * (configuration.batteryCapacityWh ?? 768)) / 1000;
    cycles = batteryHealthService.calculateAnalyticalCycles(
      configuration.atsCurrentCycles,
      throughputKwh,
      configuration.batteryCapacityWh ?? 768
    );
    isAnalyticalBms = true;
  }

  let soh =
    liveTelemetry?.batterySoh !== undefined && liveTelemetry?.batterySoh !== null
      ? liveTelemetry.batterySoh
      : configuration?.lastBatterySoh ?? null;

  if (soh === null && cycles !== null) {
    soh = Math.max(80, Math.min(100, Math.round(100 - (cycles / 3000) * 20)));
    isAnalyticalBms = true;
  }

  let volts = liveTelemetry?.batteryVolts ?? null;
  const currentSoc =
    liveTelemetry?.batteryPercentage !== undefined && liveTelemetry?.batteryPercentage !== null
      ? liveTelemetry.batteryPercentage
      : latestBatteryPercentage ?? null;

  if (volts === null && currentSoc !== null && currentSoc !== undefined) {
    const nominalVoltage = (configuration?.batteryCapacityWh ?? 768) > 1500 ? 51.2 : 25.6;
    volts = batteryHealthService.estimateVoltageFromSoc(currentSoc, nominalVoltage);
    isVoltageEstimated = true;
    isAnalyticalBms = true;
  }

  const hardwareStatus =
    currentTemp === null
      ? "Hardware EMS Ativo / Proteção Térmica Integrada"
      : "Sensores Térmicos Físicos Conectados";

  if (currentTemp === null) {
    isAnalyticalBms = true;
  }

  let thermalStatus: "NORMAL" | "WARM" | "HOT" | "CRITICAL" = "NORMAL";
  if (currentTemp !== null) {
    if (currentTemp >= shutdown) {
      thermalStatus = "CRITICAL";
    } else if (currentTemp >= warning) {
      thermalStatus = "HOT";
    } else if (currentTemp >= 38.0) {
      thermalStatus = "WARM";
    }
  }

  const recentThermalTrend = rawLogs
    .filter((log) => typeof log.batteryTempCelsius === "number")
    .slice(0, 20)
    .map((log) => ({
      time: log.executedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      temperatureCelsius: log.batteryTempCelsius as number,
    }))
    .reverse();

  return {
    temperatureCelsius: currentTemp,
    maxRecordedTemp: maxTemp,
    sohPercentage: soh,
    bmsCycles: cycles,
    thermalStatus,
    thermalWarningThreshold: warning,
    thermalShutdownThreshold: shutdown,
    voltageVolts: volts,
    amperageAmps: liveTelemetry?.batteryAmps ?? null,
    recentThermalTrend,
    hardwareStatus,
    isAnalyticalBms,
    isVoltageEstimated,
  };
}

function buildApplianceSimulationMetrics(
  applianceProfiles: Array<{ averageWatts: number; isActiveInSimulation: boolean }> | undefined,
  batteryCapacityWh: number,
  batteryPercentage: number,
  baselineRuntimeMinutes: number | null
): ApplianceSimulationMetrics {
  const appliances = applianceProfiles ?? [];
  const activeAppliances = appliances.filter((a) => a.isActiveInSimulation);
  const totalSimulatedWatts = activeAppliances.reduce((sum, a) => sum + a.averageWatts, 0);

  const safeCapacity = batteryCapacityWh > 0 ? batteryCapacityWh : 2048;
  const clampedPercentage = Math.max(0, Math.min(100, batteryPercentage));
  const remainingWh = Math.round(safeCapacity * (clampedPercentage / 100));

  const simulatedRuntimeMinutes =
    totalSimulatedWatts > 0
      ? Math.round((remainingWh / Math.max(10, totalSimulatedWatts)) * 60)
      : 0;

  const formatMins = (mins: number) => {
    if (mins <= 0) return "0m";
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h === 0 ? `${m}m` : `${h}h ${m.toString().padStart(2, "0")}m`;
  };

  const runtimeDeltaMinutes =
    baselineRuntimeMinutes !== null && simulatedRuntimeMinutes > 0
      ? simulatedRuntimeMinutes - baselineRuntimeMinutes
      : null;

  return {
    totalSimulatedWatts,
    simulatedRuntimeMinutes,
    formattedSimulatedRuntime: formatMins(simulatedRuntimeMinutes),
    baselineRuntimeMinutes,
    formattedBaselineRuntime: formatMins(baselineRuntimeMinutes ?? 0),
    runtimeDeltaMinutes,
    activeAppliancesCount: activeAppliances.length,
    totalAppliancesCount: appliances.length,
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

  const isTest = process.env.NODE_ENV === "test";
  const enableCacheInTest = request.headers?.["x-enable-cache"] === "true";
  const skipCache =
    (isTest && !enableCacheInTest) ||
    request.headers?.["x-skip-cache"] === "true" ||
    request.query?.fresh === "true";

  if (!skipCache && statisticsMemoryCache.has(extractedUserId)) {
    const cachedEntry = statisticsMemoryCache.get(extractedUserId)!;
    const isCacheValid = Date.now() - cachedEntry.cachedAt < STATISTICS_CACHE_TTL_MS;

    if (isCacheValid) {
      const liveMqtt = EcoFlowMqttStreamService.getInstance().getLatestTelemetry(extractedUserId);
      const cachedData = { ...cachedEntry.data };

      if (liveMqtt) {
        if (typeof liveMqtt.solarInputWatts === "number") {
          cachedData.currentWatts = liveMqtt.solarInputWatts;
        }
        if (typeof liveMqtt.outputWatts === "number") {
          cachedData.currentOutputWatts = liveMqtt.outputWatts;
          cachedData.netWatts = (cachedData.currentWatts || 0) - liveMqtt.outputWatts;
        }
        if (typeof liveMqtt.batteryTempCelsius === "number") {
          const currentTemp = liveMqtt.batteryTempCelsius;
          const warning = cachedData.bmsAnalytics?.thermalWarningThreshold ?? 45;
          const shutdown = cachedData.bmsAnalytics?.thermalShutdownThreshold ?? 50;
          let thermalStatus: "NORMAL" | "WARM" | "HOT" | "CRITICAL" = "NORMAL";
          if (currentTemp >= shutdown) {
            thermalStatus = "CRITICAL";
          } else if (currentTemp >= warning) {
            thermalStatus = "HOT";
          } else if (currentTemp >= 38.0) {
            thermalStatus = "WARM";
          }
          cachedData.bmsAnalytics = {
            ...cachedData.bmsAnalytics,
            temperatureCelsius: currentTemp,
            thermalStatus,
          };
        }
      }

      response.setHeader("X-Cache", "HIT");
      response.status(200).json({
        success: true,
        data: cachedData,
      });
      return;
    }
  }

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
        applianceProfiles: true,
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

      // Filtrar apenas comutações físicas reais, ignorando logs onde o estado foi apenas mantido (polling repetido)
      const realSwitchingLogs = switchingLogs.filter((log) => {
        const details = (log.executionDetails || "").toLowerCase();
        const isMaintained =
          details.includes("mantida") ||
          details.includes("mantido") ||
          details.includes("já está ligada") ||
          details.includes("já está desligada") ||
          details.includes("estados atuais mantidos") ||
          log.actionTriggered === "HOLD_CURRENT_STATE";

        if (isMaintained) {
          return false;
        }

        const isRealAction =
          log.actionTriggered === "ENABLE_ECOFLOW_AC" ||
          log.actionTriggered === "DISABLE_ECOFLOW_AC";
        const hasSwitchKeyword =
          details.includes("comutou") ||
          details.includes("transferida") ||
          details.includes("cargas transferidas");

        return isRealAction || hasSwitchKeyword;
      });

      recentSwitchCount = realSwitchingLogs.length;
      if (realSwitchingLogs.length >= 2) {
        const firstTime = realSwitchingLogs[0].executedAt.getTime();
        const lastTime = realSwitchingLogs[realSwitchingLogs.length - 1].executedAt.getTime();
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
        configuration?.currencySymbol ?? "R$",
        configuration
      );
      const defaultAutonomy = calculateAutonomyEstimate(
        configuration?.batteryCapacityWh ?? 2048,
        0,
        0,
        0
      );
      const liveSnapshot = EcoFlowMqttStreamService.getInstance().getLatestTelemetry(extractedUserId);
      const defaultSolarForecast = await buildSolarForecastMetrics(configuration);
      const defaultBms = buildBmsAnalyticsMetrics(configuration, liveSnapshot, [], 0);
      const defaultApplianceSimulation = buildApplianceSimulationMetrics(
        configuration?.applianceProfiles,
        configuration?.batteryCapacityWh ?? 2048,
        0,
        defaultAutonomy.runtimeMinutes
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
          solarForecast: defaultSolarForecast,
          bmsAnalytics: defaultBms,
          applianceSimulation: defaultApplianceSimulation,
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
    const newestLogTime = rawLogs30m[0]?.executedAt ? rawLogs30m[0].executedAt.getTime() : nowTimestamp;
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
      batteryTempCelsius: log.batteryTempCelsius ?? null,
      batterySoh: log.batterySoh ?? null,
      batteryCycles: log.batteryCycles ?? null,
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
          executedAt: {
            gte: startOfMonth,
            lte: new Date(nowTimestamp),
          },
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
      configuration?.currencySymbol ?? "R$",
      configuration,
      rawLogs24h
    );

    const latestBattery = latestLog ? latestLog.batteryPercentage : 0;
    const autonomyEstimate = calculateAutonomyEstimate(
      configuration?.batteryCapacityWh ?? 2048,
      latestBattery,
      currentWatts,
      currentOutputWatts
    );

    const liveSnapshot = EcoFlowMqttStreamService.getInstance().getLatestTelemetry(extractedUserId);
    const solarForecast = await buildSolarForecastMetrics(configuration);
    const bmsAnalytics = buildBmsAnalyticsMetrics(configuration, liveSnapshot, rawLogs24h, latestBattery);
    const applianceSimulation = buildApplianceSimulationMetrics(
      configuration?.applianceProfiles,
      configuration?.batteryCapacityWh ?? 2048,
      latestBattery,
      autonomyEstimate.runtimeMinutes
    );

    const finalStatisticsData: NonNullable<StatisticsResponseData["data"]> = {
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
      solarForecast,
      bmsAnalytics,
      applianceSimulation,
    };

    statisticsMemoryCache.set(extractedUserId, {
      data: finalStatisticsData,
      cachedAt: Date.now(),
    });

    response.setHeader("X-Cache", "MISS");
    response.status(200).json({
      success: true,
      data: finalStatisticsData,
    });
  } catch (error) {
    console.error("Erro ao gerar estatísticas solares:", error);
    response.status(500).json({
      success: false,
      message: "Erro ao compilar telemetria de estatísticas.",
    });
  }
}
