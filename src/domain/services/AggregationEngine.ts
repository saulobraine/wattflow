import {
  TariffScheduleService,
  type DynamicTariffConfig,
  type TariffPeriod,
} from "./TariffScheduleService";

export type StatisticsRange = "24h" | "7d" | "30d" | "year" | "today-vs-yesterday";

export interface RawTelemetryLog {
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

export interface StatisticsHistorySummary {
  totalSolarGeneratedKwh: number;
  totalConsumedKwh: number;
  netEnergyKwh: number;
  peakSolarWatts: number;
  peakOutputWatts: number;
  averageBatteryPercentage: number;
  estimatedSavingsBrl: number;
  gridAvoidancePercentage: number;
}

export interface StatisticsHistoryPoint {
  timestamp: string;
  label: string;
  solarWatts: number;
  outputWatts: number;
  netWatts: number;
  batteryPercentage: number;
}

export interface TodayVsYesterdayPoint {
  time: string;
  solarWatts: number;
  outputWatts: number;
  batteryPercentage: number;
}

export interface StatisticsHistoryComparison {
  todayTotalKwh: number;
  yesterdayTotalKwh: number;
  divergencePercentage: number;
  todayPeakWatts: number;
  yesterdayPeakWatts: number;
  todayPoints: TodayVsYesterdayPoint[];
  yesterdayPoints: TodayVsYesterdayPoint[];
}

export interface StatisticsHistoryResponse {
  range: StatisticsRange;
  summary: StatisticsHistorySummary;
  points: StatisticsHistoryPoint[];
  comparison?: StatisticsHistoryComparison;
}

export interface AggregateOptions {
  logs: RawTelemetryLog[];
  range: StatisticsRange;
  referenceDate?: Date;
  energyCostPerKwh?: number;
  dynamicTariffConfig?: Partial<DynamicTariffConfig> | null;
  currencySymbol?: string;
}

export interface CsvExportOptions {
  range?: StatisticsRange;
  energyCostPerKwh?: number;
  dynamicTariffConfig?: Partial<DynamicTariffConfig> | null;
}

interface BrasiliaDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const MONTHS_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

export class AggregationEngine {
  /**
   * Extrai ano, mês, dia, hora e minuto no fuso horário oficial de Brasília (America/Sao_Paulo).
   */
  public static getBrasiliaParts(date: Date): BrasiliaDateParts {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    let year = 2026;
    let month = 1;
    let day = 1;
    let hour = 0;
    let minute = 0;
    for (const part of parts) {
      if (part.type === "year") year = parseInt(part.value, 10);
      if (part.type === "month") month = parseInt(part.value, 10);
      if (part.type === "day") day = parseInt(part.value, 10);
      if (part.type === "hour") {
        hour = parseInt(part.value, 10);
        if (hour === 24) hour = 0;
      }
      if (part.type === "minute") minute = parseInt(part.value, 10);
    }
    return { year, month, day, hour, minute };
  }

  /**
   * Retorna o timestamp UTC correspondente à meia-noite (00:00:00) de Brasília para a data informada.
   * Brasília é UTC-3 (00:00 BRT = 03:00 UTC).
   */
  public static getBrasiliaMidnight(date: Date, dayOffset = 0): Date {
    const { year, month, day } = AggregationEngine.getBrasiliaParts(date);
    return new Date(Date.UTC(year, month - 1, day + dayOffset, 3, 0, 0, 0));
  }

  /**
   * Retorna o timestamp UTC do início do mês (dia 1 às 00:00 BRT) para a data informada.
   */
  public static getBrasiliaMonthStart(year: number, month: number): Date {
    return new Date(Date.UTC(year, month - 1, 1, 3, 0, 0, 0));
  }

  /**
   * Converte logs brutos em pontos amostrais agregados por buckets temporais e calcula sumários.
   */
  public static aggregate(options: AggregateOptions): StatisticsHistoryResponse {
    const {
      logs,
      range,
      referenceDate,
      energyCostPerKwh = 0.92,
      dynamicTariffConfig,
    } = options;

    const refDate = referenceDate ? new Date(referenceDate) : new Date();
    const safeTariff = energyCostPerKwh > 0 ? energyCostPerKwh : 0.92;

    if (range === "today-vs-yesterday") {
      return AggregationEngine.aggregateTodayVsYesterday(
        logs,
        refDate,
        safeTariff,
        dynamicTariffConfig
      );
    }

    if (range === "year") {
      return AggregationEngine.aggregateYear(
        logs,
        refDate,
        safeTariff,
        dynamicTariffConfig
      );
    }

    return AggregationEngine.aggregateSlidingWindow(
      logs,
      range,
      refDate,
      safeTariff,
      dynamicTariffConfig
    );
  }

  private static aggregateSlidingWindow(
    logs: RawTelemetryLog[],
    range: "24h" | "7d" | "30d",
    refDate: Date,
    energyCostPerKwh: number,
    dynamicTariffConfig?: Partial<DynamicTariffConfig> | null
  ): StatisticsHistoryResponse {
    const endTime = refDate.getTime();
    let windowDurationMs = 24 * 60 * 60 * 1000;
    let bucketDurationMs = 15 * 60 * 1000; // 15m para 24h (~96 pontos)
    let bucketHours = 0.25;

    if (range === "7d") {
      windowDurationMs = 7 * 24 * 60 * 60 * 1000;
      bucketDurationMs = 60 * 60 * 1000; // 1h para 7d (168 pontos)
      bucketHours = 1.0;
    } else if (range === "30d") {
      windowDurationMs = 30 * 24 * 60 * 60 * 1000;
      bucketDurationMs = 4 * 60 * 60 * 1000; // 4h para 30d (180 pontos)
      bucketHours = 4.0;
    }

    const startTime = endTime - windowDurationMs;
    const bucketCount = Math.round(windowDurationMs / bucketDurationMs);

    // Pré-filtra e agrupa logs por índice de bucket
    const bucketLogs: RawTelemetryLog[][] = Array.from({ length: bucketCount }, () => []);

    for (const log of logs) {
      const logTime = new Date(log.executedAt).getTime();
      if (logTime >= startTime && logTime <= endTime) {
        let index = Math.floor((logTime - startTime) / bucketDurationMs);
        if (index >= bucketCount) {
          index = bucketCount - 1;
        }
        bucketLogs[index].push(log);
      }
    }

    const points: StatisticsHistoryPoint[] = [];
    let totalSolarKwh = 0;
    let totalConsumedKwh = 0;
    let peakSolarWatts = 0;
    let peakOutputWatts = 0;
    let totalBatterySum = 0;
    let batteryCount = 0;
    let totalSavingsBrl = 0;
    let lastKnownBattery = 50;

    // Se houver algum log prévio, inicializa com o último SOC conhecido
    if (logs.length > 0) {
      lastKnownBattery = logs[logs.length - 1].batteryPercentage;
    }

    for (let i = 0; i < bucketCount; i++) {
      const bucketStartTime = new Date(startTime + i * bucketDurationMs);
      const logsInBucket = bucketLogs[i];

      let solarWatts = 0;
      let outputWatts = 0;
      let batteryPercentage = lastKnownBattery;
      let rawAvgSolarWatts = 0;
      let rawAvgOutputWatts = 0;

      if (logsInBucket.length > 0) {
        let sumSolar = 0;
        let sumOutput = 0;
        let sumBattery = 0;

        for (const item of logsInBucket) {
          sumSolar += item.solarInputWatts;
          sumOutput += item.outputWatts;
          sumBattery += item.batteryPercentage;
          if (item.solarInputWatts > peakSolarWatts) {
            peakSolarWatts = item.solarInputWatts;
          }
          if (item.outputWatts > peakOutputWatts) {
            peakOutputWatts = item.outputWatts;
          }
        }

        rawAvgSolarWatts = sumSolar / logsInBucket.length;
        rawAvgOutputWatts = sumOutput / logsInBucket.length;

        solarWatts =
          rawAvgSolarWatts > 0 && rawAvgSolarWatts < 1
            ? Number(rawAvgSolarWatts.toFixed(2))
            : Math.round(rawAvgSolarWatts);
        outputWatts =
          rawAvgOutputWatts > 0 && rawAvgOutputWatts < 1
            ? Number(rawAvgOutputWatts.toFixed(2))
            : Math.round(rawAvgOutputWatts);
        batteryPercentage = Math.round(sumBattery / logsInBucket.length);
        lastKnownBattery = batteryPercentage;

        totalBatterySum += batteryPercentage;
        batteryCount++;
      }

      const netWatts = Number((solarWatts - outputWatts).toFixed(2));
      const bucketSolarKwh = (rawAvgSolarWatts * bucketHours) / 1000;
      const bucketConsumedKwh = (rawAvgOutputWatts * bucketHours) / 1000;

      totalSolarKwh += bucketSolarKwh;
      totalConsumedKwh += bucketConsumedKwh;

      const rate = AggregationEngine.resolveRate(
        bucketStartTime,
        energyCostPerKwh,
        dynamicTariffConfig
      );
      totalSavingsBrl += bucketSolarKwh * rate;

      points.push({
        timestamp: bucketStartTime.toISOString(),
        label: AggregationEngine.formatLabel(bucketStartTime, range),
        solarWatts,
        outputWatts,
        netWatts,
        batteryPercentage,
      });
    }

    const averageBatteryPercentage =
      batteryCount > 0 ? Math.round(totalBatterySum / batteryCount) : lastKnownBattery;

    const roundedSolarKwh = Number(totalSolarKwh.toFixed(2));
    const roundedConsumedKwh = Number(totalConsumedKwh.toFixed(2));
    const netEnergyKwh = Number((roundedSolarKwh - roundedConsumedKwh).toFixed(2));
    const gridAvoidancePercentage =
      roundedConsumedKwh > 0
        ? Math.min(
            100,
            Math.max(
              0,
              Number(((roundedSolarKwh / roundedConsumedKwh) * 100).toFixed(1))
            )
          )
        : roundedSolarKwh > 0
        ? 100
        : 0;

    return {
      range,
      summary: {
        totalSolarGeneratedKwh: roundedSolarKwh,
        totalConsumedKwh: roundedConsumedKwh,
        netEnergyKwh,
        peakSolarWatts,
        peakOutputWatts,
        averageBatteryPercentage,
        estimatedSavingsBrl: Number(totalSavingsBrl.toFixed(2)),
        gridAvoidancePercentage,
      },
      points,
    };
  }

  private static aggregateYear(
    logs: RawTelemetryLog[],
    refDate: Date,
    energyCostPerKwh: number,
    dynamicTariffConfig?: Partial<DynamicTariffConfig> | null
  ): StatisticsHistoryResponse {
    const { year: currentYear, month: currentMonth } =
      AggregationEngine.getBrasiliaParts(refDate);

    const points: StatisticsHistoryPoint[] = [];
    let totalSolarKwh = 0;
    let totalConsumedKwh = 0;
    let peakSolarWatts = 0;
    let peakOutputWatts = 0;
    let totalBatterySum = 0;
    let batteryCount = 0;
    let totalSavingsBrl = 0;
    let lastKnownBattery = 50;

    if (logs.length > 0) {
      lastKnownBattery = logs[logs.length - 1].batteryPercentage;
    }

    // 12 meses consolidados: de 11 meses atrás até o mês corrente
    for (let m = 11; m >= 0; m--) {
      let targetYear = currentYear;
      let targetMonth = currentMonth - m;
      while (targetMonth <= 0) {
        targetMonth += 12;
        targetYear -= 1;
      }

      const monthStart = AggregationEngine.getBrasiliaMonthStart(targetYear, targetMonth);
      let nextMonth = targetMonth + 1;
      let nextYear = targetYear;
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear += 1;
      }
      const monthEnd = AggregationEngine.getBrasiliaMonthStart(nextYear, nextMonth);

      const logsInMonth = logs.filter((l) => {
        const time = new Date(l.executedAt).getTime();
        return time >= monthStart.getTime() && time < monthEnd.getTime();
      });

      let solarWatts = 0;
      let outputWatts = 0;
      let batteryPercentage = lastKnownBattery;
      let rawAvgSolarWatts = 0;
      let rawAvgOutputWatts = 0;

      if (logsInMonth.length > 0) {
        let sumSolar = 0;
        let sumOutput = 0;
        let sumBattery = 0;

        for (const log of logsInMonth) {
          sumSolar += log.solarInputWatts;
          sumOutput += log.outputWatts;
          sumBattery += log.batteryPercentage;
          if (log.solarInputWatts > peakSolarWatts) peakSolarWatts = log.solarInputWatts;
          if (log.outputWatts > peakOutputWatts) peakOutputWatts = log.outputWatts;
        }

        rawAvgSolarWatts = sumSolar / logsInMonth.length;
        rawAvgOutputWatts = sumOutput / logsInMonth.length;

        solarWatts =
          rawAvgSolarWatts > 0 && rawAvgSolarWatts < 1
            ? Number(rawAvgSolarWatts.toFixed(2))
            : Math.round(rawAvgSolarWatts);
        outputWatts =
          rawAvgOutputWatts > 0 && rawAvgOutputWatts < 1
            ? Number(rawAvgOutputWatts.toFixed(2))
            : Math.round(rawAvgOutputWatts);
        batteryPercentage = Math.round(sumBattery / logsInMonth.length);
        lastKnownBattery = batteryPercentage;

        totalBatterySum += batteryPercentage;
        batteryCount++;
      }

      const monthHours =
        (monthEnd.getTime() - monthStart.getTime()) / (1000 * 60 * 60);
      const monthSolarKwh = (rawAvgSolarWatts * monthHours) / 1000;
      const monthConsumedKwh = (rawAvgOutputWatts * monthHours) / 1000;

      totalSolarKwh += monthSolarKwh;
      totalConsumedKwh += monthConsumedKwh;

      const rate = AggregationEngine.resolveRate(
        monthStart,
        energyCostPerKwh,
        dynamicTariffConfig
      );
      totalSavingsBrl += monthSolarKwh * rate;

      const label = `${MONTHS_PT[targetMonth - 1]}/${String(targetYear).slice(-2)}`;

      points.push({
        timestamp: monthStart.toISOString(),
        label,
        solarWatts,
        outputWatts,
        netWatts: Number((solarWatts - outputWatts).toFixed(2)),
        batteryPercentage,
      });
    }

    const averageBatteryPercentage =
      batteryCount > 0 ? Math.round(totalBatterySum / batteryCount) : lastKnownBattery;

    const roundedSolarKwh = Number(totalSolarKwh.toFixed(2));
    const roundedConsumedKwh = Number(totalConsumedKwh.toFixed(2));
    const netEnergyKwh = Number((roundedSolarKwh - roundedConsumedKwh).toFixed(2));
    const gridAvoidancePercentage =
      roundedConsumedKwh > 0
        ? Math.min(
            100,
            Math.max(
              0,
              Number(((roundedSolarKwh / roundedConsumedKwh) * 100).toFixed(1))
            )
          )
        : roundedSolarKwh > 0
        ? 100
        : 0;

    return {
      range: "year",
      summary: {
        totalSolarGeneratedKwh: roundedSolarKwh,
        totalConsumedKwh: roundedConsumedKwh,
        netEnergyKwh,
        peakSolarWatts,
        peakOutputWatts,
        averageBatteryPercentage,
        estimatedSavingsBrl: Number(totalSavingsBrl.toFixed(2)),
        gridAvoidancePercentage,
      },
      points,
    };
  }

  private static aggregateTodayVsYesterday(
    logs: RawTelemetryLog[],
    refDate: Date,
    energyCostPerKwh: number,
    dynamicTariffConfig?: Partial<DynamicTariffConfig> | null
  ): StatisticsHistoryResponse {
    const todayMidnight = AggregationEngine.getBrasiliaMidnight(refDate, 0);
    const yesterdayMidnight = AggregationEngine.getBrasiliaMidnight(refDate, -1);
    const yesterdayEnd = new Date(todayMidnight.getTime() - 1);

    const slotDurationMs = 15 * 60 * 1000; // 96 slots
    const totalSlots = 96;

    const yesterdayLogs = logs.filter((l) => {
      const time = new Date(l.executedAt).getTime();
      return time >= yesterdayMidnight.getTime() && time <= yesterdayEnd.getTime();
    });

    const todayLogs = logs.filter((l) => {
      const time = new Date(l.executedAt).getTime();
      return time >= todayMidnight.getTime() && time <= refDate.getTime();
    });

    const elapsedMsToday = Math.max(0, refDate.getTime() - todayMidnight.getTime());
    const currentSlotToday = Math.min(
      totalSlots - 1,
      Math.floor(elapsedMsToday / slotDurationMs)
    );

    let lastKnownYesterdayBattery = 50;
    if (yesterdayLogs.length > 0) {
      lastKnownYesterdayBattery = yesterdayLogs[0].batteryPercentage;
    }

    let lastKnownTodayBattery = lastKnownYesterdayBattery;
    if (todayLogs.length > 0) {
      lastKnownTodayBattery = todayLogs[0].batteryPercentage;
    }

    const yesterdayPoints: TodayVsYesterdayPoint[] = [];
    let yesterdayTotalKwh = 0;
    let yesterdayPeakWatts = 0;

    for (let slot = 0; slot < totalSlots; slot++) {
      const slotStartTime = yesterdayMidnight.getTime() + slot * slotDurationMs;
      const slotEndTime = slotStartTime + slotDurationMs;

      const items = yesterdayLogs.filter((l) => {
        const time = new Date(l.executedAt).getTime();
        return time >= slotStartTime && time < slotEndTime;
      });

      let solarWatts = 0;
      let outputWatts = 0;
      let batteryPercentage = lastKnownYesterdayBattery;
      let rawAvgSolarWatts = 0;
      let rawAvgOutputWatts = 0;

      if (items.length > 0) {
        let sumSolar = 0;
        let sumOutput = 0;
        let sumBattery = 0;
        for (const item of items) {
          sumSolar += item.solarInputWatts;
          sumOutput += item.outputWatts;
          sumBattery += item.batteryPercentage;
          if (item.solarInputWatts > yesterdayPeakWatts) {
            yesterdayPeakWatts = item.solarInputWatts;
          }
        }
        rawAvgSolarWatts = sumSolar / items.length;
        rawAvgOutputWatts = sumOutput / items.length;
        solarWatts =
          rawAvgSolarWatts > 0 && rawAvgSolarWatts < 1
            ? Number(rawAvgSolarWatts.toFixed(2))
            : Math.round(rawAvgSolarWatts);
        outputWatts =
          rawAvgOutputWatts > 0 && rawAvgOutputWatts < 1
            ? Number(rawAvgOutputWatts.toFixed(2))
            : Math.round(rawAvgOutputWatts);
        batteryPercentage = Math.round(sumBattery / items.length);
        lastKnownYesterdayBattery = batteryPercentage;
      }

      yesterdayTotalKwh += (rawAvgSolarWatts * 0.25) / 1000;

      yesterdayPoints.push({
        time: AggregationEngine.formatSlotTime(slot),
        solarWatts,
        outputWatts,
        batteryPercentage,
      });
    }

    const todayPoints: TodayVsYesterdayPoint[] = [];
    const points: StatisticsHistoryPoint[] = [];
    let todayTotalKwh = 0;
    let todayConsumedKwh = 0;
    let todayPeakWatts = 0;
    let peakOutputWatts = 0;
    let totalBatterySum = 0;
    let batteryCount = 0;
    let totalSavingsBrl = 0;

    for (let slot = 0; slot <= currentSlotToday; slot++) {
      const slotStartTime = todayMidnight.getTime() + slot * slotDurationMs;
      const slotEndTime = slotStartTime + slotDurationMs;

      const items = todayLogs.filter((l) => {
        const time = new Date(l.executedAt).getTime();
        return time >= slotStartTime && time < slotEndTime;
      });

      let solarWatts = 0;
      let outputWatts = 0;
      let batteryPercentage = lastKnownTodayBattery;
      let rawAvgSolarWatts = 0;
      let rawAvgOutputWatts = 0;

      if (items.length > 0) {
        let sumSolar = 0;
        let sumOutput = 0;
        let sumBattery = 0;
        for (const item of items) {
          sumSolar += item.solarInputWatts;
          sumOutput += item.outputWatts;
          sumBattery += item.batteryPercentage;
          if (item.solarInputWatts > todayPeakWatts) {
            todayPeakWatts = item.solarInputWatts;
          }
          if (item.outputWatts > peakOutputWatts) {
            peakOutputWatts = item.outputWatts;
          }
        }
        rawAvgSolarWatts = sumSolar / items.length;
        rawAvgOutputWatts = sumOutput / items.length;
        solarWatts =
          rawAvgSolarWatts > 0 && rawAvgSolarWatts < 1
            ? Number(rawAvgSolarWatts.toFixed(2))
            : Math.round(rawAvgSolarWatts);
        outputWatts =
          rawAvgOutputWatts > 0 && rawAvgOutputWatts < 1
            ? Number(rawAvgOutputWatts.toFixed(2))
            : Math.round(rawAvgOutputWatts);
        batteryPercentage = Math.round(sumBattery / items.length);
        lastKnownTodayBattery = batteryPercentage;

        totalBatterySum += batteryPercentage;
        batteryCount++;
      }

      const slotSolarKwh = (rawAvgSolarWatts * 0.25) / 1000;
      const slotConsumedKwh = (rawAvgOutputWatts * 0.25) / 1000;
      todayTotalKwh += slotSolarKwh;
      todayConsumedKwh += slotConsumedKwh;

      const rate = AggregationEngine.resolveRate(
        new Date(slotStartTime),
        energyCostPerKwh,
        dynamicTariffConfig
      );
      totalSavingsBrl += slotSolarKwh * rate;

      const timeLabel = AggregationEngine.formatSlotTime(slot);

      todayPoints.push({
        time: timeLabel,
        solarWatts,
        outputWatts,
        batteryPercentage,
      });

      points.push({
        timestamp: new Date(slotStartTime).toISOString(),
        label: timeLabel,
        solarWatts,
        outputWatts,
        netWatts: Number((solarWatts - outputWatts).toFixed(2)),
        batteryPercentage,
      });
    }

    let divergencePercentage = 0;
    if (yesterdayTotalKwh > 0) {
      divergencePercentage = Number(
        (((todayTotalKwh - yesterdayTotalKwh) / yesterdayTotalKwh) * 100).toFixed(1)
      );
    } else if (todayTotalKwh > 0) {
      divergencePercentage = 100.0;
    }

    const roundedTodaySolarKwh = Number(todayTotalKwh.toFixed(2));
    const roundedTodayConsumedKwh = Number(todayConsumedKwh.toFixed(2));
    const netEnergyKwh = Number(
      (roundedTodaySolarKwh - roundedTodayConsumedKwh).toFixed(2)
    );

    const averageBatteryPercentage =
      batteryCount > 0 ? Math.round(totalBatterySum / batteryCount) : lastKnownTodayBattery;

    const gridAvoidancePercentage =
      roundedTodayConsumedKwh > 0
        ? Math.min(
            100,
            Math.max(
              0,
              Number(
                ((roundedTodaySolarKwh / roundedTodayConsumedKwh) * 100).toFixed(1)
              )
            )
          )
        : roundedTodaySolarKwh > 0
        ? 100
        : 0;

    return {
      range: "today-vs-yesterday",
      summary: {
        totalSolarGeneratedKwh: roundedTodaySolarKwh,
        totalConsumedKwh: roundedTodayConsumedKwh,
        netEnergyKwh,
        peakSolarWatts: todayPeakWatts,
        peakOutputWatts,
        averageBatteryPercentage,
        estimatedSavingsBrl: Number(totalSavingsBrl.toFixed(2)),
        gridAvoidancePercentage,
      },
      points,
      comparison: {
        todayTotalKwh: roundedTodaySolarKwh,
        yesterdayTotalKwh: Number(yesterdayTotalKwh.toFixed(2)),
        divergencePercentage,
        todayPeakWatts,
        yesterdayPeakWatts,
        todayPoints,
        yesterdayPoints,
      },
    };
  }

  /**
   * Sanitiza qualquer valor de célula contra CSV Injection (Formula Injection) e formata conforme RFC 4180.
   */
  public static sanitizeCsvValue(val: unknown): string {
    if (val === null || val === undefined) {
      return "";
    }
    const str = String(val);
    let sanitized = str;

    // Se o valor for string textual e iniciar com =, +, -, @ ou \t, prefixa com apóstrofo '
    if (typeof val === "string" && /^[=+\-@\t\r]/.test(str)) {
      sanitized = `'${str}`;
    }

    // RFC 4180: envolve em aspas se contiver vírgula, aspas ou quebras de linha
    if (/[",\r\n]/.test(sanitized)) {
      return `"${sanitized.replace(/"/g, '""')}"`;
    }

    return sanitized;
  }

  /**
   * Converte pontos amostrais em conteúdo CSV sanitizado com cabeçalhos RFC 4180 e codificação UTF-8 com BOM.
   */
  public static exportToCsv(
    points: StatisticsHistoryPoint[],
    options: CsvExportOptions = {}
  ): string {
    const {
      range = "24h",
      energyCostPerKwh = 0.92,
      dynamicTariffConfig,
    } = options;

    let bucketHours = 0.25;
    if (range === "7d") bucketHours = 1.0;
    else if (range === "30d") bucketHours = 4.0;
    else if (range === "year") bucketHours = 720; // ~30 dias/mês

    const headers = [
      "Data_Hora",
      "Bateria_SOC_Percent",
      "Geracao_Solar_Watts",
      "Consumo_Residencial_Watts",
      "Saldo_Liquido_Watts",
      "Fonte_Ativa",
      "Faixa_Tarifaria",
      "Economia_Estimada_BRL",
    ];

    const lines: string[] = [headers.join(",")];

    for (const point of points) {
      const date = new Date(point.timestamp);
      const activeSource = point.outputWatts > 0 ? "SOLAR" : "CONCESSIONARIA";

      let tariffPeriodName = "CONVENCIONAL";
      let rate = energyCostPerKwh;

      if (dynamicTariffConfig?.isDynamicTariffActive) {
        const schedule = TariffScheduleService.getInstance();
        const fullConfig: DynamicTariffConfig = {
          isDynamicTariffActive: true,
          peakTariffPerKwh: dynamicTariffConfig.peakTariffPerKwh ?? 1.85,
          intermediateTariffPerKwh: dynamicTariffConfig.intermediateTariffPerKwh ?? 1.15,
          offPeakTariffPerKwh: dynamicTariffConfig.offPeakTariffPerKwh ?? 0.65,
          peakStartTime: dynamicTariffConfig.peakStartTime ?? "17:30",
          peakEndTime: dynamicTariffConfig.peakEndTime ?? "20:30",
          intermediateStartTime1: dynamicTariffConfig.intermediateStartTime1 ?? "16:30",
          intermediateEndTime1: dynamicTariffConfig.intermediateEndTime1 ?? "17:30",
          intermediateStartTime2: dynamicTariffConfig.intermediateStartTime2 ?? "20:30",
          intermediateEndTime2: dynamicTariffConfig.intermediateEndTime2 ?? "21:30",
          energyCostPerKwh,
        };
        const evaluation = schedule.evaluate(fullConfig, date);
        rate = evaluation.rate;
        if (evaluation.period === "PEAK") {
          tariffPeriodName = "PONTA";
        } else if (evaluation.period === "INTERMEDIATE") {
          tariffPeriodName = "INTERMEDIARIA";
        } else {
          tariffPeriodName = "FORA_PONTA";
        }
      }

      const pointKwh = (point.solarWatts * bucketHours) / 1000;
      const estimatedSavingsBrl = Number((pointKwh * rate).toFixed(2));

      const row = [
        AggregationEngine.sanitizeCsvValue(point.timestamp),
        AggregationEngine.sanitizeCsvValue(point.batteryPercentage),
        AggregationEngine.sanitizeCsvValue(point.solarWatts),
        AggregationEngine.sanitizeCsvValue(point.outputWatts),
        AggregationEngine.sanitizeCsvValue(point.netWatts),
        AggregationEngine.sanitizeCsvValue(activeSource),
        AggregationEngine.sanitizeCsvValue(tariffPeriodName),
        AggregationEngine.sanitizeCsvValue(estimatedSavingsBrl.toFixed(2)),
      ];

      lines.push(row.join(","));
    }

    // Prefixo UTF-8 BOM (\uFEFF) para compatibilidade nativa com Excel
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
  }

  private static resolveRate(
    date: Date,
    energyCostPerKwh: number,
    dynamicTariffConfig?: Partial<DynamicTariffConfig> | null
  ): number {
    if (!dynamicTariffConfig?.isDynamicTariffActive) {
      return energyCostPerKwh;
    }
    const schedule = TariffScheduleService.getInstance();
    const fullConfig: DynamicTariffConfig = {
      isDynamicTariffActive: true,
      peakTariffPerKwh: dynamicTariffConfig.peakTariffPerKwh ?? 1.85,
      intermediateTariffPerKwh: dynamicTariffConfig.intermediateTariffPerKwh ?? 1.15,
      offPeakTariffPerKwh: dynamicTariffConfig.offPeakTariffPerKwh ?? 0.65,
      peakStartTime: dynamicTariffConfig.peakStartTime ?? "17:30",
      peakEndTime: dynamicTariffConfig.peakEndTime ?? "20:30",
      intermediateStartTime1: dynamicTariffConfig.intermediateStartTime1 ?? "16:30",
      intermediateEndTime1: dynamicTariffConfig.intermediateEndTime1 ?? "17:30",
      intermediateStartTime2: dynamicTariffConfig.intermediateStartTime2 ?? "20:30",
      intermediateEndTime2: dynamicTariffConfig.intermediateEndTime2 ?? "21:30",
      energyCostPerKwh,
    };
    return schedule.evaluate(fullConfig, date).rate;
  }

  private static formatLabel(date: Date, range: "24h" | "7d" | "30d"): string {
    const { month, day, hour, minute } = AggregationEngine.getBrasiliaParts(date);
    const hourStr = String(hour).padStart(2, "0");
    const minuteStr = String(minute).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    const monthStr = String(month).padStart(2, "0");

    if (range === "24h") {
      return `${hourStr}:${minuteStr}`;
    }
    if (range === "7d") {
      return `${dayStr}/${monthStr} ${hourStr}:${minuteStr}`;
    }
    return `${dayStr}/${monthStr} ${hourStr}h`;
  }

  private static formatSlotTime(slot: number): string {
    const totalMinutes = slot * 15;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
}
