export type ThermalRiskLevel = "OPTIMAL" | "WARM" | "THROTTLED" | "CRITICAL_CUTOFF";

export interface BatteryHealthMetrics {
  currentTempCelsius: number | null;
  maxRecordedTempCelsius: number | null;
  thermalRiskLevel: ThermalRiskLevel;
  isThermalProtectionActive: boolean;
  isThermalThrottleActive: boolean;
  isThermalCutoffActive: boolean;
  thermalWarningThreshold: number;
  thermalShutdownThreshold: number;
  thermalThrottleSpeedWatts: number;
  bmsSohPercentage: number | null;
  bmsCycleCount: number | null;
  nominalLifespanCycles: number;
  remainingCyclesEstimate: number;
  estimatedHealthPercentage: number;
  estimatedYearsRemaining: number;
  dailyCycleRate: number;
  voltageVolts: number | null;
  amperageAmps: number | null;
  powerWatts: number | null;
  recentThermalTrend: Array<{ time: string; temperatureCelsius: number }>;
}

export interface ThermalRiskEvaluationResult {
  riskLevel: ThermalRiskLevel;
  shouldCutoff: boolean;
  shouldThrottle: boolean;
  shouldRecover: boolean;
}

export interface RawBatteryTelemetryParams {
  temp?: number | null;
  bmsMasterTemp?: number | null;
  cycles?: number | null;
  bmsMasterCycles?: number | null;
  soh?: number | null;
  bmsMasterSoh?: number | null;
  volts?: number | null;
  bmsMasterVolts?: number | null;
  amps?: number | null;
  bmsMasterAmps?: number | null;
  watts?: number | null;
}

export interface BatteryHealthConfig {
  isThermalProtectionActive?: boolean;
  thermalWarningThreshold?: number;
  thermalShutdownThreshold?: number;
  thermalThrottleTempThreshold?: number;
  thermalCutoffTempThreshold?: number;
  thermalRecoveryTempThreshold?: number;
  thermalThrottleSpeedWatts?: number;
  isThermalThrottleActive?: boolean;
  isThermalCutoffActive?: boolean;
  maxRecordedBatteryTemp?: number | null;
  dailyCycleRate?: number;
  nominalLifespanCycles?: number;
}

/**
 * Serviço de domínio para monitoramento de saúde da bateria (LiFePO4/LFP),
 * avaliação de ciclos de vida útil e proteção térmica preventiva do BMS.
 */
export class BatteryHealthService {
  private static instance: BatteryHealthService | null = null;
  private readonly thermalTrend = new Map<string, Array<{ time: string; temperatureCelsius: number }>>();
  private readonly MAX_TREND_POINTS = 24;

  public static getInstance(): BatteryHealthService {
    if (!BatteryHealthService.instance) {
      BatteryHealthService.instance = new BatteryHealthService();
    }
    return BatteryHealthService.instance;
  }

  public evaluateThermalRisk(
    currentTemp: number | null,
    config: {
      isThermalProtectionActive: boolean;
      thermalWarningThreshold: number;
      thermalShutdownThreshold: number;
      thermalRecoveryTempThreshold?: number;
      isThermalCutoffActive?: boolean;
    }
  ): ThermalRiskEvaluationResult {
    if (!config.isThermalProtectionActive || currentTemp === null || isNaN(currentTemp)) {
      return {
        riskLevel: "OPTIMAL",
        shouldCutoff: false,
        shouldThrottle: false,
        shouldRecover: false,
      };
    }

    const warningLimit = config.thermalWarningThreshold;
    const cutoffLimit = config.thermalShutdownThreshold;
    const recoveryLimit = config.thermalRecoveryTempThreshold ?? Math.max(30, cutoffLimit - 4.0);

    // Se já estava em cutoff, aplica histerese de recuperação estrita (-4°C)
    if (config.isThermalCutoffActive) {
      if (currentTemp > recoveryLimit) {
        return {
          riskLevel: "CRITICAL_CUTOFF",
          shouldCutoff: true,
          shouldThrottle: false,
          shouldRecover: false,
        };
      }

      // Temperatura caiu para <= recoveryLimit: desarma cutoff e avalia novo estado
      const isStillWarm = currentTemp >= warningLimit;
      return {
        riskLevel: isStillWarm ? "THROTTLED" : currentTemp >= 38 ? "WARM" : "OPTIMAL",
        shouldCutoff: false,
        shouldThrottle: isStillWarm,
        shouldRecover: true,
      };
    }

    if (currentTemp >= cutoffLimit) {
      return {
        riskLevel: "CRITICAL_CUTOFF",
        shouldCutoff: true,
        shouldThrottle: false,
        shouldRecover: false,
      };
    }

    if (currentTemp >= warningLimit) {
      return {
        riskLevel: "THROTTLED",
        shouldCutoff: false,
        shouldThrottle: true,
        shouldRecover: false,
      };
    }

    if (currentTemp >= 38.0) {
      return {
        riskLevel: "WARM",
        shouldCutoff: false,
        shouldThrottle: false,
        shouldRecover: false,
      };
    }

    return {
      riskLevel: "OPTIMAL",
      shouldCutoff: false,
      shouldThrottle: false,
      shouldRecover: false,
    };
  }

  public calculateLifespanEstimate(
    cycles: number | null,
    soh: number | null,
    nominalCycles = 3000,
    dailyRate = 1.0
  ): { remainingCycles: number; healthPercentage: number; estimatedYears: number } {
    const cycleCount = Math.max(0, cycles ?? 0);
    const remainingCycles = Math.max(0, nominalCycles - cycleCount);

    // Curva analítica LiFePO4: 100% SOH até 80% ao atingir nominalCycles (perda de 20% em 3000 ciclos)
    const analyticalSoh = Math.max(0, Math.min(100, Math.round(100 - (cycleCount / nominalCycles) * 20)));
    const healthPercentage = (soh !== null && soh !== undefined && soh > 0) ? soh : analyticalSoh;

    const safeDailyRate = dailyRate > 0 ? dailyRate : 1.0;
    const estimatedYears = Number((remainingCycles / (365 * safeDailyRate)).toFixed(1));

    return {
      remainingCycles,
      healthPercentage,
      estimatedYears,
    };
  }

  public evaluateBatteryHealth(
    rawParams: RawBatteryTelemetryParams,
    config: BatteryHealthConfig = {},
    configurationId = "default"
  ): BatteryHealthMetrics {
    const temp = rawParams.bmsMasterTemp ?? rawParams.temp ?? null;
    const cycles = rawParams.bmsMasterCycles ?? rawParams.cycles ?? null;
    const soh = rawParams.bmsMasterSoh ?? rawParams.soh ?? null;
    const volts = rawParams.bmsMasterVolts ?? rawParams.volts ?? null;
    const amps = rawParams.bmsMasterAmps ?? rawParams.amps ?? null;
    const watts = rawParams.watts ?? (volts !== null && amps !== null ? Number((volts * amps).toFixed(1)) : null);

    const isThermalProtectionActive = config.isThermalProtectionActive ?? true;
    const thermalWarningThreshold = config.thermalThrottleTempThreshold ?? config.thermalWarningThreshold ?? 42.0;
    const thermalShutdownThreshold = config.thermalCutoffTempThreshold ?? config.thermalShutdownThreshold ?? 48.0;
    const thermalRecoveryTempThreshold = config.thermalRecoveryTempThreshold ?? Math.max(30, thermalShutdownThreshold - 4.0);
    const thermalThrottleSpeedWatts = config.thermalThrottleSpeedWatts ?? 200;
    const nominalLifespanCycles = config.nominalLifespanCycles ?? 3000;
    const dailyCycleRate = config.dailyCycleRate ?? 1.0;

    const previousCutoff = Boolean(config.isThermalCutoffActive);

    const riskEvaluation = this.evaluateThermalRisk(temp, {
      isThermalProtectionActive,
      thermalWarningThreshold,
      thermalShutdownThreshold,
      thermalRecoveryTempThreshold,
      isThermalCutoffActive: previousCutoff,
    });

    const isThermalCutoffActive = riskEvaluation.shouldCutoff;
    const isThermalThrottleActive = riskEvaluation.shouldThrottle;

    const lifespan = this.calculateLifespanEstimate(cycles, soh, nominalLifespanCycles, dailyCycleRate);

    // Registro na tendência recente
    if (temp !== null) {
      this.recordThermalPoint(configurationId, temp);
    }
    const recentThermalTrend = this.thermalTrend.get(configurationId) ?? [];

    const previousMax = config.maxRecordedBatteryTemp ?? 0;
    const maxRecordedTempCelsius = temp !== null ? Math.max(previousMax, temp) : previousMax || null;

    return {
      currentTempCelsius: temp,
      maxRecordedTempCelsius,
      thermalRiskLevel: riskEvaluation.riskLevel,
      isThermalProtectionActive,
      isThermalThrottleActive,
      isThermalCutoffActive,
      thermalWarningThreshold,
      thermalShutdownThreshold,
      thermalThrottleSpeedWatts,
      bmsSohPercentage: soh,
      bmsCycleCount: cycles,
      nominalLifespanCycles,
      remainingCyclesEstimate: lifespan.remainingCycles,
      estimatedHealthPercentage: lifespan.healthPercentage,
      estimatedYearsRemaining: lifespan.estimatedYears,
      dailyCycleRate,
      voltageVolts: volts,
      amperageAmps: amps,
      powerWatts: watts,
      recentThermalTrend,
    };
  }

  public recordThermalPoint(configurationId: string, tempCelsius: number): void {
    const list = this.thermalTrend.get(configurationId) ?? [];
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    list.push({ time: timeStr, temperatureCelsius: Number(tempCelsius.toFixed(1)) });
    if (list.length > this.MAX_TREND_POINTS) {
      list.shift();
    }
    this.thermalTrend.set(configurationId, list);
  }

  public clearTrendForTests(): void {
    this.thermalTrend.clear();
  }
}
