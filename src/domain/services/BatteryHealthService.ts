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
  isAnalyticalBms?: boolean;
  hardwareStatus?: string;
  isVoltageEstimated?: boolean;
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
  batteryPercentage?: number | null;
  atsCurrentCycles?: number | null;
  accumulatedThroughputKwh?: number | null;
  isAnalyticalBms?: boolean;
  hardwareStatus?: string;
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
  batteryCapacityWh?: number | null;
  atsCurrentCycles?: number | null;
  ecoflowSerialNumber?: string | null;
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

  /**
   * Estima a tensão (Volts) de saída da bateria com base na curva de descarga LiFePO4 (LFP)
   * e no estado de carga atual (SOC %).
   */
  public estimateVoltageFromSoc(soc: number, nominalVoltage = 25.6): number {
    const clampedSoc = Math.max(0, Math.min(100, soc));
    const cellCount = nominalVoltage > 40 ? 16 : nominalVoltage > 20 ? 8 : 4;
    let cellVolts: number;
    if (clampedSoc <= 0) {
      cellVolts = 2.50;
    } else if (clampedSoc < 10) {
      cellVolts = 2.50 + (clampedSoc / 10) * 0.50; // 2.50V - 3.00V
    } else if (clampedSoc < 20) {
      cellVolts = 3.00 + ((clampedSoc - 10) / 10) * 0.20; // 3.00V - 3.20V
    } else if (clampedSoc < 90) {
      cellVolts = 3.20 + ((clampedSoc - 20) / 70) * 0.16; // 3.20V - 3.36V (platô LiFePO4 estável)
    } else {
      cellVolts = 3.36 + ((clampedSoc - 90) / 10) * 0.24; // 3.36V - 3.60V
    }
    return Number((cellVolts * cellCount).toFixed(1));
  }

  /**
   * Calcula ciclos analíticos equivalentes acumulados a partir das transferências da ATS
   * ou pelo throughput energético acumulado em kWh.
   */
  public calculateAnalyticalCycles(
    atsCurrentCycles = 0,
    accumulatedThroughputKwh = 0,
    batteryCapacityWh = 768
  ): number {
    const safeCapacity = batteryCapacityWh > 0 ? batteryCapacityWh : 768;
    const throughputCycles = Math.round((accumulatedThroughputKwh * 1000) / safeCapacity);
    return Math.max(atsCurrentCycles, throughputCycles);
  }

  public evaluateBatteryHealth(
    rawParams: RawBatteryTelemetryParams,
    config: BatteryHealthConfig = {},
    configurationId = "default"
  ): BatteryHealthMetrics {
    const temp = rawParams.bmsMasterTemp ?? rawParams.temp ?? null;
    let cycles = rawParams.bmsMasterCycles ?? rawParams.cycles ?? null;
    let soh = rawParams.bmsMasterSoh ?? rawParams.soh ?? null;
    let volts = rawParams.bmsMasterVolts ?? rawParams.volts ?? null;
    const amps = rawParams.bmsMasterAmps ?? rawParams.amps ?? null;

    const nominalLifespanCycles = config.nominalLifespanCycles ?? 3000;
    const dailyCycleRate = config.dailyCycleRate ?? 1.0;
    const nominalVoltage = (config.batteryCapacityWh ?? 768) > 1500 ? 51.2 : 25.6;

    let isVoltageEstimated = false;
    let isAnalyticalBms = Boolean(rawParams.isAnalyticalBms);

    if (
      cycles === null &&
      (rawParams.atsCurrentCycles !== undefined ||
        config.atsCurrentCycles !== undefined ||
        rawParams.accumulatedThroughputKwh !== undefined)
    ) {
      cycles = this.calculateAnalyticalCycles(
        rawParams.atsCurrentCycles ?? config.atsCurrentCycles ?? 0,
        rawParams.accumulatedThroughputKwh ?? 0,
        config.batteryCapacityWh ?? 768
      );
      isAnalyticalBms = true;
    }

    if (soh === null && cycles !== null) {
      soh = Math.max(80, Math.min(100, Math.round(100 - (cycles / nominalLifespanCycles) * 20)));
      isAnalyticalBms = true;
    }

    if (volts === null && rawParams.batteryPercentage !== undefined && rawParams.batteryPercentage !== null) {
      volts = this.estimateVoltageFromSoc(rawParams.batteryPercentage, nominalVoltage);
      isVoltageEstimated = true;
      isAnalyticalBms = true;
    }

    const watts = rawParams.watts ?? (volts !== null && amps !== null ? Number((volts * amps).toFixed(1)) : null);

    const hardwareStatus =
      rawParams.hardwareStatus ??
      (temp === null
        ? "Hardware EMS Ativo / Proteção Térmica Integrada"
        : "Sensores Térmicos Físicos Conectados");

    if (temp === null) {
      isAnalyticalBms = true;
    }

    const isThermalProtectionActive = config.isThermalProtectionActive ?? true;
    const thermalWarningThreshold = config.thermalThrottleTempThreshold ?? config.thermalWarningThreshold ?? 42.0;
    const thermalShutdownThreshold = config.thermalCutoffTempThreshold ?? config.thermalShutdownThreshold ?? 48.0;
    const thermalRecoveryTempThreshold = config.thermalRecoveryTempThreshold ?? Math.max(30, thermalShutdownThreshold - 4.0);
    const thermalThrottleSpeedWatts = config.thermalThrottleSpeedWatts ?? 200;

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
      isAnalyticalBms,
      hardwareStatus,
      isVoltageEstimated,
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
