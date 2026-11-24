import {
  TariffScheduleService,
  type DynamicTariffConfig,
  type TariffPeriod,
} from "./TariffScheduleService";

export type ReportPeriod = "24h" | "7d" | "30d" | "month" | "custom";
export type ReportFormat = "csv" | "pdf" | "json";

export interface ReportExecutiveSummary {
  periodLabel: string;
  startDateIso: string;
  endDateIso: string;
  totalSolarGeneratedKwh: number;
  averageDailySolarKwh: number;
  peakSolarWatts: number;
  peakSolarAt: string;
  totalResidentialConsumedKwh: number;
  peakResidentialOutputWatts: number;
  peakResidentialAt: string;
  netEnergyBalanceKwh: number;
  totalEstimatedSavingsBrl: number;
  peakPeriodSavingsBrl: number;
  offPeakPeriodSavingsBrl: number;
  solarCoveragePercentage: number;
  atsOperationMetrics: {
    hoursOnBattery: number;
    hoursOnGrid: number;
    batteryDutyCyclePercentage: number;
    gridDutyCyclePercentage: number;
    totalAtsSwitchesCount: number;
  };
  bmsHealthSummary: {
    averageSocPercentage: number;
    minTempCelsius: number;
    maxTempCelsius: number;
    averageTempCelsius: number;
    thermalThrottlingEventsCount: number;
    thermalCutoffEventsCount: number;
    estimatedCyclesConsumed: number;
    currentSohPercentage: number | null;
  };
}

export interface ReportDataPoint {
  timestampIso: string;
  formattedDatePtBr: string;
  batterySoc: number;
  solarWatts: number;
  outputWatts: number;
  netWatts: number;
  activeSource: "BATTERY" | "GRID";
  tariffPeriod: "PEAK" | "INTERMEDIATE" | "OFF_PEAK";
  savingsBrl: number;
  batteryTempCelsius: number | null;
  bmsEventNote: string;
}

export interface ConsolidatedReport {
  summary: ReportExecutiveSummary;
  dataPoints: ReportDataPoint[];
}

export interface RawReportLog {
  executedAt: Date | string;
  solarInputWatts: number;
  outputWatts: number;
  batteryPercentage: number;
  actionTriggered?: string | null;
  executionDetails?: string | null;
  batteryTempCelsius?: number | null;
  batterySoh?: number | null;
  batteryCycles?: number | null;
}

export interface ReportConfigInput {
  energyCostPerKwh?: number;
  currencySymbol?: string;
  batteryCapacityWh?: number;
  isDynamicTariffActive?: boolean;
  isTimeOfUseActive?: boolean;
  timeOfUseWeekdaysOnly?: boolean;
  peakTariffPerKwh?: number;
  intermediateTariffPerKwh?: number;
  offPeakTariffPerKwh?: number;
  peakStartTime?: string;
  peakEndTime?: string;
  intermediateStartTime?: string | null;
  intermediateEndTime?: string | null;
  intermediateStartTime1?: string;
  intermediateEndTime1?: string;
  intermediateStartTime2?: string;
  intermediateEndTime2?: string;
  thermalWarningThreshold?: number;
  thermalShutdownThreshold?: number;
  thermalThrottleTempThreshold?: number;
  thermalCutoffTempThreshold?: number;
  thermalRecoveryTempThreshold?: number;
  thermalThrottleSpeedWatts?: number;
  lastBatterySoh?: number | null;
  lastBatteryCycles?: number | null;
}

const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/**
 * Serviço de domínio puro para compilação estatística multi-período,
 * cálculo de duty cycle da chave ATS, métricas de saúde BMS e exportação
 * estruturada em CSV (RFC 4180 pt-BR) e visualização executiva para impressão A4 / PDF.
 */
export class AnalyticalReportService {
  private static instance: AnalyticalReportService | null = null;

  public static getInstance(): AnalyticalReportService {
    if (!AnalyticalReportService.instance) {
      AnalyticalReportService.instance = new AnalyticalReportService();
    }
    return AnalyticalReportService.instance;
  }

  /**
   * Resolve as datas de início e fim e o rótulo descritivo com base no período solicitado.
   */
  public resolveDateRange(
    period: ReportPeriod,
    startDateStr?: string,
    endDateStr?: string,
    referenceDate: Date = new Date()
  ): { startDate: Date; endDate: Date; periodLabel: string } {
    const ref = new Date(referenceDate);

    if (period === "24h") {
      const startDate = new Date(ref.getTime() - 24 * 60 * 60 * 1000);
      return {
        startDate,
        endDate: ref,
        periodLabel: "Últimas 24 Horas",
      };
    }

    if (period === "7d") {
      const startDate = new Date(ref.getTime() - 7 * 24 * 60 * 60 * 1000);
      return {
        startDate,
        endDate: ref,
        periodLabel: "Últimos 7 Dias",
      };
    }

    if (period === "month") {
      const brasiliaDateParts = this.getBrasiliaParts(ref);
      const startDate = this.createBrasiliaDate(brasiliaDateParts.year, brasiliaDateParts.month, 1, 0, 0, 0);
      const monthName = MONTH_NAMES_PT[brasiliaDateParts.month - 1] ?? "Mês Atual";
      return {
        startDate,
        endDate: ref,
        periodLabel: `Mês Atual (${monthName}/${brasiliaDateParts.year})`,
      };
    }

    if (period === "custom") {
      let parsedStart: Date | null = null;
      let parsedEnd: Date | null = null;

      if (startDateStr && startDateStr.trim().length > 0) {
        const cleanStart = startDateStr.trim();
        parsedStart = cleanStart.includes("T")
          ? new Date(cleanStart)
          : new Date(`${cleanStart}T00:00:00.000-03:00`);
      }

      if (endDateStr && endDateStr.trim().length > 0) {
        const cleanEnd = endDateStr.trim();
        parsedEnd = cleanEnd.includes("T")
          ? new Date(cleanEnd)
          : new Date(`${cleanEnd}T23:59:59.999-03:00`);
      }

      if (parsedStart && !isNaN(parsedStart.getTime()) && parsedEnd && !isNaN(parsedEnd.getTime())) {
        if (parsedStart.getTime() > parsedEnd.getTime()) {
          const swap = parsedStart;
          parsedStart = parsedEnd;
          parsedEnd = swap;
        }
        return {
          startDate: parsedStart,
          endDate: parsedEnd,
          periodLabel: `Personalizado (${this.formatPtBrDate(parsedStart)} a ${this.formatPtBrDate(parsedEnd)})`,
        };
      }
    }

    // Default: "30d"
    const startDate = new Date(ref.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      startDate,
      endDate: ref,
      periodLabel: "Últimos 30 Dias",
    };
  }

  /**
   * Determina se o ponto de telemetria operou com a alimentação via BATERIA solar ou REDE CONCESSIONÁRIA.
   */
  public isBatterySource(log: RawReportLog): boolean {
    const action = log.actionTriggered ?? "";
    if (action === "ENABLE_ECOFLOW_AC") {
      return true;
    }

    const isCutoffAction =
      action === "DISABLE_ECOFLOW_AC" ||
      action === "AUTO_STORM_DEFENSE" ||
      action === "THERMAL_CUTOFF_PROTECTION" ||
      action === "THERMAL_PROTECTION_DISARM";

    if (isCutoffAction) {
      return false;
    }

    return log.outputWatts > 0;
  }

  /**
   * Consolida métricas executivas e gera array de pontos analíticos detalhados.
   */
  public consolidateReport(params: {
    logs: RawReportLog[];
    config: ReportConfigInput;
    period: ReportPeriod;
    startDate: Date;
    endDate: Date;
    periodLabel?: string;
  }): ConsolidatedReport {
    const { logs, config, period, startDate, endDate } = params;
    const periodLabel = params.periodLabel ?? this.resolveDateRange(period, undefined, undefined, endDate).periodLabel;

    const sortedLogs = [...logs].sort((a, b) => {
      const timeA = a.executedAt instanceof Date ? a.executedAt.getTime() : new Date(a.executedAt).getTime();
      const timeB = b.executedAt instanceof Date ? b.executedAt.getTime() : new Date(b.executedAt).getTime();
      return timeA - timeB;
    });

    const totalDurationMs = Math.max(1, endDate.getTime() - startDate.getTime());
    const totalPeriodHours = Number((totalDurationMs / (1000 * 60 * 60)).toFixed(1));

    const tariffSchedule = TariffScheduleService.getInstance();
    const tariffConfig: DynamicTariffConfig = {
      isDynamicTariffActive: config.isDynamicTariffActive,
      isTimeOfUseActive: config.isTimeOfUseActive,
      timeOfUseWeekdaysOnly: config.timeOfUseWeekdaysOnly,
      peakTariffPerKwh: config.peakTariffPerKwh,
      intermediateTariffPerKwh: config.intermediateTariffPerKwh,
      offPeakTariffPerKwh: config.offPeakTariffPerKwh,
      peakStartTime: config.peakStartTime,
      peakEndTime: config.peakEndTime,
      intermediateStartTime: config.intermediateStartTime ?? config.intermediateStartTime1,
      intermediateEndTime: config.intermediateEndTime ?? config.intermediateEndTime2,
      energyCostPerKwh: config.energyCostPerKwh,
      currencySymbol: config.currencySymbol,
    };

    const thermalCutoffThreshold = config.thermalCutoffTempThreshold ?? config.thermalShutdownThreshold ?? 48.0;
    const thermalThrottleThreshold = config.thermalThrottleTempThreshold ?? config.thermalWarningThreshold ?? 42.0;

    let accumulatedBatteryDurationMs = 0;
    let accumulatedGridDurationMs = 0;
    let accumulatedSolarKwh = 0;
    let accumulatedResidentialKwh = 0;
    let peakPeriodSavings = 0;
    let offPeakPeriodSavings = 0;

    let peakSolarWatts = 0;
    let peakSolarAt = startDate.toISOString();
    let peakResidentialWatts = 0;
    let peakResidentialAt = startDate.toISOString();

    let atsSwitchesCount = 0;
    let previousSource: "BATTERY" | "GRID" | null = null;

    let thermalThrottleEvents = 0;
    let thermalCutoffEvents = 0;

    const dataPoints: ReportDataPoint[] = [];

    for (let i = 0; i < sortedLogs.length; i++) {
      const currentLog = sortedLogs[i];
      const currentDate = currentLog.executedAt instanceof Date ? currentLog.executedAt : new Date(currentLog.executedAt);

      // Cálculo do delta temporal para integração de energia
      let deltaMs = 300_000; // fallback padrão de 5 minutos
      if (i < sortedLogs.length - 1) {
        const nextLog = sortedLogs[i + 1];
        const nextDate = nextLog.executedAt instanceof Date ? nextLog.executedAt : new Date(nextLog.executedAt);
        deltaMs = nextDate.getTime() - currentDate.getTime();
      } else {
        const remainingMs = endDate.getTime() - currentDate.getTime();
        deltaMs = remainingMs > 0 ? remainingMs : 300_000;
      }

      // Limita deltas para evitar distorções se houver lacuna longa sem logs
      const clampedDeltaMs = Math.max(1000, Math.min(2 * 60 * 60 * 1000, deltaMs));
      const deltaHours = clampedDeltaMs / (1000 * 60 * 60);

      const isBattery = this.isBatterySource(currentLog);
      const activeSource: "BATTERY" | "GRID" = isBattery ? "BATTERY" : "GRID";

      if (previousSource !== null && activeSource !== previousSource) {
        atsSwitchesCount += 1;
      }
      previousSource = activeSource;

      if (activeSource === "BATTERY") {
        accumulatedBatteryDurationMs += clampedDeltaMs;
      } else {
        accumulatedGridDurationMs += clampedDeltaMs;
      }

      const solarWatts = Math.max(0, currentLog.solarInputWatts ?? 0);
      const outputWatts = Math.max(0, currentLog.outputWatts ?? 0);
      const netWatts = solarWatts - outputWatts;

      if (solarWatts > peakSolarWatts) {
        peakSolarWatts = solarWatts;
        peakSolarAt = currentDate.toISOString();
      }
      if (outputWatts > peakResidentialWatts) {
        peakResidentialWatts = outputWatts;
        peakResidentialAt = currentDate.toISOString();
      }

      const pointSolarKwh = (solarWatts * deltaHours) / 1000;
      const pointConsumedKwh = (outputWatts * deltaHours) / 1000;

      accumulatedSolarKwh += pointSolarKwh;
      accumulatedResidentialKwh += pointConsumedKwh;

      const tariffEval = tariffSchedule.evaluate(tariffConfig, currentDate);
      const activeRate = tariffEval.rate > 0 ? tariffEval.rate : config.energyCostPerKwh ?? 0.92;

      let pointSavings = 0;
      if (activeSource === "BATTERY") {
        pointSavings = pointConsumedKwh * activeRate;
        if (tariffEval.period === "PEAK") {
          peakPeriodSavings += pointSavings;
        } else {
          offPeakPeriodSavings += pointSavings;
        }
      }

      // Verificação de eventos BMS
      const temp = currentLog.batteryTempCelsius;
      let bmsEventNote = "Operação Normal";

      if (temp !== null && temp !== undefined && temp >= thermalCutoffThreshold) {
        thermalCutoffEvents += 1;
        bmsEventNote = "Alerta: Corte Térmico BMS";
      } else if (temp !== null && temp !== undefined && temp >= thermalThrottleThreshold) {
        thermalThrottleEvents += 1;
        bmsEventNote = "Alerta: Throttling Térmico BMS";
      } else if (currentLog.actionTriggered === "AUTO_STORM_DEFENSE") {
        bmsEventNote = "Modo Tempestade Ativo";
      } else if (currentLog.actionTriggered === "THERMAL_PROTECTION_DISARM") {
        thermalCutoffEvents += 1;
        bmsEventNote = "Desarme Térmico Crítico";
      } else if (currentLog.executionDetails && currentLog.executionDetails.trim().length > 0) {
        bmsEventNote = currentLog.executionDetails.trim();
      }

      dataPoints.push({
        timestampIso: currentDate.toISOString(),
        formattedDatePtBr: this.formatPtBrDateTime(currentDate),
        batterySoc: Math.round(currentLog.batteryPercentage),
        solarWatts: Math.round(solarWatts),
        outputWatts: Math.round(outputWatts),
        netWatts: Math.round(netWatts),
        activeSource,
        tariffPeriod: tariffEval.period,
        savingsBrl: Number(pointSavings.toFixed(2)),
        batteryTempCelsius: temp !== null && temp !== undefined ? Number(temp.toFixed(1)) : null,
        bmsEventNote,
      });
    }

    // Normalização temporal estrita do Duty Cycle
    const trackedTotalMs = accumulatedBatteryDurationMs + accumulatedGridDurationMs;
    let hoursOnBattery: number;
    let hoursOnGrid: number;
    let batteryDutyCyclePercentage: number;
    let gridDutyCyclePercentage: number;

    if (trackedTotalMs > 0) {
      const batteryRatio = accumulatedBatteryDurationMs / trackedTotalMs;
      hoursOnBattery = Number((totalPeriodHours * batteryRatio).toFixed(1));
      hoursOnGrid = Number(Math.max(0, totalPeriodHours - hoursOnBattery).toFixed(1));
      batteryDutyCyclePercentage = Number((batteryRatio * 100).toFixed(1));
      gridDutyCyclePercentage = Number((100 - batteryDutyCyclePercentage).toFixed(1));
    } else {
      hoursOnBattery = 0;
      hoursOnGrid = totalPeriodHours;
      batteryDutyCyclePercentage = 0;
      gridDutyCyclePercentage = 100;
    }

    // Métricas de saúde do BMS
    const socValues = sortedLogs.map((l) => l.batteryPercentage).filter((s) => typeof s === "number" && !isNaN(s));
    const averageSocPercentage = socValues.length > 0 ? Math.round(socValues.reduce((a, b) => a + b, 0) / socValues.length) : 0;

    const tempValues = sortedLogs
      .map((l) => l.batteryTempCelsius)
      .filter((t): t is number => t !== null && t !== undefined && !isNaN(t));

    const minTempCelsius = tempValues.length > 0 ? Number(Math.min(...tempValues).toFixed(1)) : 25.0;
    const maxTempCelsius = tempValues.length > 0 ? Number(Math.max(...tempValues).toFixed(1)) : 25.0;
    const averageTempCelsius =
      tempValues.length > 0
        ? Number((tempValues.reduce((a, b) => a + b, 0) / tempValues.length).toFixed(1))
        : 25.0;

    const batteryCapacityWh = config.batteryCapacityWh ?? 2048;
    const estimatedCyclesConsumed = Number(((accumulatedResidentialKwh * 1000) / batteryCapacityWh).toFixed(1));

    let currentSohPercentage: number | null = null;
    for (let j = sortedLogs.length - 1; j >= 0; j--) {
      if (sortedLogs[j].batterySoh !== null && sortedLogs[j].batterySoh !== undefined) {
        currentSohPercentage = sortedLogs[j].batterySoh ?? null;
        break;
      }
    }
    if (currentSohPercentage === null && config.lastBatterySoh !== undefined) {
      currentSohPercentage = config.lastBatterySoh ?? null;
    }

    const totalDays = Math.max(1, totalPeriodHours / 24);
    const averageDailySolarKwh = Number((accumulatedSolarKwh / totalDays).toFixed(2));
    const totalSolarGeneratedKwh = Number(accumulatedSolarKwh.toFixed(2));
    const totalResidentialConsumedKwh = Number(accumulatedResidentialKwh.toFixed(2));
    const netEnergyBalanceKwh = Number((totalSolarGeneratedKwh - totalResidentialConsumedKwh).toFixed(2));

    const solarCoveragePercentage =
      totalResidentialConsumedKwh > 0
        ? Number(Math.min(100, (totalSolarGeneratedKwh / totalResidentialConsumedKwh) * 100).toFixed(1))
        : 100.0;

    const totalEstimatedSavingsBrl = Number((peakPeriodSavings + offPeakPeriodSavings).toFixed(2));

    const summary: ReportExecutiveSummary = {
      periodLabel,
      startDateIso: startDate.toISOString(),
      endDateIso: endDate.toISOString(),
      totalSolarGeneratedKwh,
      averageDailySolarKwh,
      peakSolarWatts: Math.round(peakSolarWatts),
      peakSolarAt,
      totalResidentialConsumedKwh,
      peakResidentialOutputWatts: Math.round(peakResidentialWatts),
      peakResidentialAt,
      netEnergyBalanceKwh,
      totalEstimatedSavingsBrl,
      peakPeriodSavingsBrl: Number(peakPeriodSavings.toFixed(2)),
      offPeakPeriodSavingsBrl: Number(offPeakPeriodSavings.toFixed(2)),
      solarCoveragePercentage,
      atsOperationMetrics: {
        hoursOnBattery,
        hoursOnGrid,
        batteryDutyCyclePercentage,
        gridDutyCyclePercentage,
        totalAtsSwitchesCount: atsSwitchesCount,
      },
      bmsHealthSummary: {
        averageSocPercentage,
        minTempCelsius,
        maxTempCelsius,
        averageTempCelsius,
        thermalThrottlingEventsCount: thermalThrottleEvents,
        thermalCutoffEventsCount: thermalCutoffEvents,
        estimatedCyclesConsumed,
        currentSohPercentage,
      },
    };

    return {
      summary,
      dataPoints,
    };
  }

  /**
   * Sanitiza qualquer valor de célula contra Formula Injection em planilhas eletrônicas.
   * Prefixos perigosos '=', '+', '-', '@' são neutralizados com um apóstrofo inicial (').
   */
  public sanitizeCsvCell(raw: unknown, delimiter = ";"): string {
    if (raw === null || raw === undefined) {
      return "";
    }

    let text = String(raw);
    const trimmedStart = text.trimStart();

    // Proteção contra CSV/DDE Injection
    if (typeof raw === "string" && (/^[=+\-@\t\r|%]/.test(text) || /^[=+\-@\t\r|%]/.test(trimmedStart))) {
      text = `'${text}`;
    }

    // Se contiver delimitador, quebras de linha ou aspas, encapsula em aspas duplas RFC 4180
    if (text.includes(delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r")) {
      text = `"${text.replace(/"/g, '""')}"`;
    }

    return text;
  }

  /**
   * Formata número para o padrão pt-BR com separador decimal de vírgula.
   */
  public formatNumberPtBr(num: number | null | undefined, decimals = 2): string {
    if (num === null || num === undefined || isNaN(num)) {
      return "";
    }
    return num.toFixed(decimals).replace(".", ",");
  }

  /**
   * Formata data para o padrão pt-BR DD/MM/AAAA.
   */
  public formatPtBrDate(date: Date): string {
    const parts = this.getBrasiliaParts(date);
    const day = String(parts.day).padStart(2, "0");
    const month = String(parts.month).padStart(2, "0");
    return `${day}/${month}/${parts.year}`;
  }

  /**
   * Formata data e hora para o padrão pt-BR DD/MM/AAAA HH:mm:ss.
   */
  public formatPtBrDateTime(date: Date): string {
    const parts = this.getBrasiliaParts(date);
    const day = String(parts.day).padStart(2, "0");
    const month = String(parts.month).padStart(2, "0");
    const hour = String(parts.hour).padStart(2, "0");
    const minute = String(parts.minute).padStart(2, "0");
    const second = String(parts.second).padStart(2, "0");
    return `${day}/${month}/${parts.year} ${hour}:${minute}:${second}`;
  }

  /**
   * Gera o arquivo CSV estruturado (RFC 4180 pt-BR) com BOM UTF-8 (\uFEFF)
   * e cabeçalho executivo de metadados.
   */
  public generateCsv(report: ConsolidatedReport, options: { delimiter?: ";" | "," } = {}): string {
    const delimiter = options.delimiter ?? ";";
    const { summary, dataPoints } = report;

    const startDate = new Date(summary.startDateIso);
    const endDate = new Date(summary.endDateIso);
    const now = new Date();

    const lines: string[] = [];

    // Cabeçalho Executivo de Metadados
    lines.push("# RELATÓRIO ANALÍTICO WATTFLOW - FECHAMENTO OPERACIONAL");
    lines.push(
      `# Período: ${this.formatPtBrDate(startDate)} a ${this.formatPtBrDate(endDate)} | Emissão: ${this.formatPtBrDateTime(now)}`
    );
    lines.push(
      `# Energia Solar Gerada: ${this.formatNumberPtBr(summary.totalSolarGeneratedKwh)} kWh | Economia Financeira: R$ ${this.formatNumberPtBr(summary.totalEstimatedSavingsBrl)}`
    );
    lines.push(
      `# Horas em Bateria: ${this.formatNumberPtBr(summary.atsOperationMetrics.hoursOnBattery, 1)} h (${this.formatNumberPtBr(summary.atsOperationMetrics.batteryDutyCyclePercentage, 1)}%) | Horas na Concessionária: ${this.formatNumberPtBr(summary.atsOperationMetrics.hoursOnGrid, 1)} h (${this.formatNumberPtBr(summary.atsOperationMetrics.gridDutyCyclePercentage, 1)}%)`
    );
    lines.push(
      `# Comutações da ATS: ${summary.atsOperationMetrics.totalAtsSwitchesCount} ciclos | Pico de Carga Residencial: ${summary.peakResidentialOutputWatts} W`
    );
    lines.push(
      `# Temperatura Máxima do BMS: ${this.formatNumberPtBr(summary.bmsHealthSummary.maxTempCelsius, 1)} °C | SOC Médio: ${this.formatNumberPtBr(summary.bmsHealthSummary.averageSocPercentage, 1)} %`
    );
    lines.push("#");

    // Título das Colunas
    const headers = [
      "Data_Hora",
      "Bateria_SOC_Percent",
      "Geracao_Solar_Watts",
      "Consumo_Residencial_Watts",
      "Saldo_Liquido_Watts",
      "Fonte_Ativa",
      "Faixa_Tarifaria",
      "Economia_Estimada_BRL",
      "Temp_Bateria_Celsius",
      "Notas_Operacionais",
    ];
    lines.push(headers.map((h) => this.sanitizeCsvCell(h, delimiter)).join(delimiter));

    // Linhas de Dados
    for (const point of dataPoints) {
      const row = [
        this.sanitizeCsvCell(point.formattedDatePtBr, delimiter),
        this.formatNumberPtBr(point.batterySoc, 0),
        this.formatNumberPtBr(point.solarWatts, 0),
        this.formatNumberPtBr(point.outputWatts, 0),
        this.formatNumberPtBr(point.netWatts, 0),
        this.sanitizeCsvCell(point.activeSource, delimiter),
        this.sanitizeCsvCell(point.tariffPeriod, delimiter),
        this.formatNumberPtBr(point.savingsBrl, 2),
        point.batteryTempCelsius !== null ? this.formatNumberPtBr(point.batteryTempCelsius, 1) : "",
        this.sanitizeCsvCell(point.bmsEventNote, delimiter),
      ];
      lines.push(row.join(delimiter));
    }

    // Prefixa BOM UTF-8 para abertura nativa no Excel pt-BR
    return `\uFEFF${lines.join("\r\n")}`;
  }

  /**
   * Gera documento HTML executivo otimizado para impressão A4 / conversão em PDF.
   */
  public generatePrintableHtml(report: ConsolidatedReport, brandingTitle = "WattFlow"): string {
    const { summary, dataPoints } = report;
    const now = new Date();
    const emissionStr = this.formatPtBrDateTime(now);
    const startStr = this.formatPtBrDate(new Date(summary.startDateIso));
    const endStr = this.formatPtBrDate(new Date(summary.endDateIso));

    const rowsHtml = dataPoints
      .slice(0, 100)
      .map(
        (p) => `
        <tr>
          <td>${p.formattedDatePtBr}</td>
          <td style="text-align: right;">${p.batterySoc}%</td>
          <td style="text-align: right;">${p.solarWatts} W</td>
          <td style="text-align: right;">${p.outputWatts} W</td>
          <td style="text-align: right; color: ${p.netWatts >= 0 ? "#16a34a" : "#dc2626"};">${p.netWatts} W</td>
          <td><span class="badge ${p.activeSource.toLowerCase()}">${p.activeSource === "BATTERY" ? "Bateria" : "Rede"}</span></td>
          <td>${p.tariffPeriod}</td>
          <td style="text-align: right;">R$ ${this.formatNumberPtBr(p.savingsBrl)}</td>
          <td style="text-align: right;">${p.batteryTempCelsius !== null ? `${this.formatNumberPtBr(p.batteryTempCelsius, 1)}°C` : "-"}</td>
        </tr>`
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${brandingTitle} - Relatório Analítico Executivo</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 15mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background: #fff; margin: 0; padding: 20px; font-size: 12px; line-height: 1.4; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { margin: 0; font-size: 20px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; }
    .header p { margin: 4px 0 0; color: #64748b; font-size: 11px; }
    .meta-box { text-align: right; font-size: 11px; color: #475569; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; page-break-inside: avoid; }
    .kpi-title { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 600; margin-bottom: 4px; }
    .kpi-value { font-size: 16px; font-weight: 700; color: #0f172a; }
    .kpi-sub { font-size: 10px; color: #16a34a; margin-top: 2px; }
    .section-title { font-size: 14px; font-weight: 700; color: #0f172a; border-left: 4px solid #f59e0b; padding-left: 8px; margin: 20px 0 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; }
    th { background: #f1f5f9; text-align: left; padding: 6px 8px; border-bottom: 1px solid #cbd5e1; font-weight: 600; color: #334155; }
    td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) { background: #fafafa; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600; text-transform: uppercase; }
    .badge.battery { background: #dcfce7; color: #15803d; }
    .badge.grid { background: #f1f5f9; color: #475569; }
    .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${brandingTitle} - Relatório Analítico</h1>
      <p>Fechamento Operacional & Prestação de Contas Fotovoltaica</p>
    </div>
    <div class="meta-box">
      <div><strong>Período:</strong> ${startStr} a ${endStr}</div>
      <div><strong>Emissão:</strong> ${emissionStr}</div>
      <div><strong>Rótulo:</strong> ${summary.periodLabel}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-title">Energia Solar Gerada</div>
      <div class="kpi-value">${this.formatNumberPtBr(summary.totalSolarGeneratedKwh)} kWh</div>
      <div class="kpi-sub">Média Diária: ${this.formatNumberPtBr(summary.averageDailySolarKwh)} kWh/dia</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Economia Financeira</div>
      <div class="kpi-value">R$ ${this.formatNumberPtBr(summary.totalEstimatedSavingsBrl)}</div>
      <div class="kpi-sub">Ponta: R$ ${this.formatNumberPtBr(summary.peakPeriodSavingsBrl)} | F. Ponta: R$ ${this.formatNumberPtBr(summary.offPeakPeriodSavingsBrl)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Duty Cycle ATS (Bateria)</div>
      <div class="kpi-value">${this.formatNumberPtBr(summary.atsOperationMetrics.batteryDutyCyclePercentage, 1)}%</div>
      <div class="kpi-sub">${this.formatNumberPtBr(summary.atsOperationMetrics.hoursOnBattery, 1)} h em Bateria | ${this.formatNumberPtBr(summary.atsOperationMetrics.hoursOnGrid, 1)} h na Rede</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Saúde BMS LiFePO4</div>
      <div class="kpi-value">${summary.bmsHealthSummary.currentSohPercentage ? `${summary.bmsHealthSummary.currentSohPercentage}% SOH` : `${summary.bmsHealthSummary.averageSocPercentage}% SOC Médio`}</div>
      <div class="kpi-sub">Temp Máx: ${this.formatNumberPtBr(summary.bmsHealthSummary.maxTempCelsius, 1)}°C | Ciclos: ~${this.formatNumberPtBr(summary.bmsHealthSummary.estimatedCyclesConsumed, 1)}</div>
    </div>
  </div>

  <div class="section-title">Amostragem Operacional Recente (Primeiros 100 Registros)</div>
  <table>
    <thead>
      <tr>
        <th>Data / Hora</th>
        <th style="text-align: right;">SOC</th>
        <th style="text-align: right;">Solar</th>
        <th style="text-align: right;">Consumo</th>
        <th style="text-align: right;">Saldo</th>
        <th>Fonte</th>
        <th>Faixa</th>
        <th style="text-align: right;">Economia</th>
        <th style="text-align: right;">Temp</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="footer">
    <div>Sistema WattFlow • Automação Solar EcoFlow • Documento Autêntico</div>
    <div>Página 1 de 1</div>
  </div>
</body>
</html>`;
  }

  private getBrasiliaParts(date: Date): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  } {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    let year = 2026;
    let month = 1;
    let day = 1;
    let hour = 0;
    let minute = 0;
    let second = 0;

    for (const part of parts) {
      if (part.type === "year") year = parseInt(part.value, 10);
      if (part.type === "month") month = parseInt(part.value, 10);
      if (part.type === "day") day = parseInt(part.value, 10);
      if (part.type === "hour") hour = parseInt(part.value, 10);
      if (part.type === "minute") minute = parseInt(part.value, 10);
      if (part.type === "second") second = parseInt(part.value, 10);
    }

    return { year, month, day, hour, minute, second };
  }

  private createBrasiliaDate(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number
  ): Date {
    const isoString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000-03:00`;
    return new Date(isoString);
  }
}
