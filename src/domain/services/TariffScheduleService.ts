export type TariffPeriod = "PEAK" | "INTERMEDIATE" | "OFF_PEAK";

export interface DynamicTariffConfig {
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
  peakDischargeReserveLimit?: number;
  peakReserveThreshold?: number;
  blockAcChargingDuringPeak?: boolean;
  currencySymbol?: string;
  energyCostPerKwh?: number;
}

export interface TariffEvaluationResult {
  period: TariffPeriod;
  rate: number;
  isDynamicActive: boolean;
  description: string;
}

export interface TariffStatusDetail {
  isTimeOfUseActive: boolean;
  currentPeriod: TariffPeriod;
  currentRate: number;
  currencySymbol: string;
  isPeakActive: boolean;
  isChargingBlocked: boolean;
  isWeekend: boolean;
  timeStringBrasilia: string;
  nextPeriod: TariffPeriod;
  nextTransitionTime: string;
  minutesToNextTransition: number;
  nextTransition?: {
    period: TariffPeriod;
    time: string;
    minutesRemaining: number;
  };
  dischargeReserveLimit: number;
  description: string;
}

/**
 * Serviço de domínio puro para resolução de faixas tarifárias (Tarifa Branca ANEEL).
 * Avalia o período e a tarifa ativa com base no horário oficial de Brasília (America/Sao_Paulo).
 *
 * Regras Oficiais ANEEL:
 * - Fins de semana (Sábado e Domingo): 100% Fora de Ponta (OFF_PEAK) se timeOfUseWeekdaysOnly === true.
 * - Dias úteis (Segunda a Sexta):
 *   - Ponta (PEAK): tipicamente 17h30 às 20h30.
 *   - Intermediário (INTERMEDIATE): 1h antes e 1h depois da ponta (ex: 16h30-17h30 e 20h30-21h30).
 *   - Fora de Ponta (OFF_PEAK): restante das 24 horas.
 */
export class TariffScheduleService {
  private static instance: TariffScheduleService | null = null;

  public static getInstance(): TariffScheduleService {
    if (!TariffScheduleService.instance) {
      TariffScheduleService.instance = new TariffScheduleService();
    }
    return TariffScheduleService.instance;
  }

  public getBrasiliaTime(date: Date = new Date()): {
    dayOfWeek: number;
    hours: number;
    minutes: number;
    timeInMinutes: number;
    timeString: string;
  } {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour12: false,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    const parts = formatter.formatToParts(date);
    let weekdayStr = "";
    let hourStr = "0";
    let minuteStr = "0";

    for (const part of parts) {
      if (part.type === "weekday") {
        weekdayStr = part.value;
      }
      if (part.type === "hour") {
        hourStr = part.value;
      }
      if (part.type === "minute") {
        minuteStr = part.value;
      }
    }

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const dayOfWeek = weekdayMap[weekdayStr] ?? date.getDay();
    let hours = parseInt(hourStr, 10);
    if (hours === 24) {
      hours = 0;
    }
    const minutes = parseInt(minuteStr, 10);
    const timeInMinutes = hours * 60 + minutes;
    const timeString = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;

    return { dayOfWeek, hours, minutes, timeInMinutes, timeString };
  }

  public parseTimeToMinutes(timeStr: string | null | undefined, defaultMinutes = 0): number {
    if (!timeStr || !timeStr.includes(":")) {
      return defaultMinutes;
    }
    const [h, m] = timeStr.split(":").map((v) => parseInt(v.trim(), 10));
    if (isNaN(h) || isNaN(m)) {
      return defaultMinutes;
    }
    return h * 60 + m;
  }

  public minutesToTimeString(minutes: number): string {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(normalized / 60);
    const m = normalized % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }

  public isWeekend(date: Date = new Date()): boolean {
    const { dayOfWeek } = this.getBrasiliaTime(date);
    return dayOfWeek === 0 || dayOfWeek === 6;
  }

  public evaluate(config: DynamicTariffConfig, date: Date = new Date()): TariffEvaluationResult {
    const detail = this.evaluateTariffPeriod(config, date);
    return {
      period: detail.currentPeriod,
      rate: detail.currentRate,
      isDynamicActive: detail.isTimeOfUseActive,
      description: detail.description,
    };
  }

  public evaluateTariffPeriod(
    config: DynamicTariffConfig,
    date: Date = new Date()
  ): TariffStatusDetail {
    const isTimeOfUseActive = Boolean(
      config.isTimeOfUseActive ?? config.isDynamicTariffActive ?? false
    );
    const timeOfUseWeekdaysOnly = config.timeOfUseWeekdaysOnly ?? true;
    const currencySymbol = config.currencySymbol || "R$";
    const dischargeReserveLimit =
      config.peakDischargeReserveLimit ?? config.peakReserveThreshold ?? 20;
    const blockAcChargingDuringPeak = config.blockAcChargingDuringPeak ?? true;

    const conventionalRate =
      config.energyCostPerKwh && config.energyCostPerKwh > 0 ? config.energyCostPerKwh : 0.92;
    const peakRate =
      config.peakTariffPerKwh && config.peakTariffPerKwh > 0 ? config.peakTariffPerKwh : 1.85;
    const interRate =
      config.intermediateTariffPerKwh && config.intermediateTariffPerKwh > 0
        ? config.intermediateTariffPerKwh
        : 1.15;
    const offPeakRate =
      config.offPeakTariffPerKwh && config.offPeakTariffPerKwh > 0
        ? config.offPeakTariffPerKwh
        : 0.65;

    const { dayOfWeek, timeInMinutes, timeString } = this.getBrasiliaTime(date);
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (!isTimeOfUseActive) {
      return {
        isTimeOfUseActive: false,
        currentPeriod: "OFF_PEAK",
        currentRate: conventionalRate,
        currencySymbol,
        isPeakActive: false,
        isChargingBlocked: false,
        isWeekend,
        timeStringBrasilia: timeString,
        nextPeriod: "OFF_PEAK",
        nextTransitionTime: "--:--",
        minutesToNextTransition: 0,
        nextTransition: {
          period: "OFF_PEAK",
          time: "--:--",
          minutesRemaining: 0,
        },
        dischargeReserveLimit,
        description: `Tarifa Convencional Fixa (${currencySymbol} ${conventionalRate.toFixed(2)}/kWh)`,
      };
    }

    const peakStart = this.parseTimeToMinutes(config.peakStartTime ?? "17:30", 17 * 60 + 30);
    const peakEnd = this.parseTimeToMinutes(config.peakEndTime ?? "20:30", 20 * 60 + 30);

    const rawInterStart =
      config.intermediateStartTime ?? config.intermediateStartTime1 ?? "16:30";
    const rawInterEnd =
      config.intermediateEndTime ?? config.intermediateEndTime2 ?? "21:30";

    const inter1Start = this.parseTimeToMinutes(rawInterStart, 16 * 60 + 30);
    const inter1End = peakStart;
    const inter2Start = peakEnd;
    const inter2End = this.parseTimeToMinutes(rawInterEnd, 21 * 60 + 30);

    const hasInter1 = inter1Start < inter1End;
    const hasInter2 = inter2Start < inter2End;
    const firstActiveWindowStart = hasInter1 ? inter1Start : peakStart;
    const firstActiveWindowPeriod: TariffPeriod = hasInter1 ? "INTERMEDIATE" : "PEAK";

    // Regra ANEEL: Fins de semana 100% Fora de Ponta se timeOfUseWeekdaysOnly === true
    if (isWeekend && timeOfUseWeekdaysOnly) {
      let minutesToTransition = 0;
      if (dayOfWeek === 6) {
        minutesToTransition = (1440 - timeInMinutes) + 1440 + firstActiveWindowStart;
      } else {
        minutesToTransition = (1440 - timeInMinutes) + firstActiveWindowStart;
      }
      const transitionTimeStr = this.minutesToTimeString(firstActiveWindowStart);

      return {
        isTimeOfUseActive: true,
        currentPeriod: "OFF_PEAK",
        currentRate: offPeakRate,
        currencySymbol,
        isPeakActive: false,
        isChargingBlocked: false,
        isWeekend: true,
        timeStringBrasilia: timeString,
        nextPeriod: firstActiveWindowPeriod,
        nextTransitionTime: transitionTimeStr,
        minutesToNextTransition: minutesToTransition,
        nextTransition: {
          period: firstActiveWindowPeriod,
          time: transitionTimeStr,
          minutesRemaining: minutesToTransition,
        },
        dischargeReserveLimit,
        description: `Fim de Semana: Tarifa Fora de Ponta Integral (${currencySymbol} ${offPeakRate.toFixed(2)}/kWh)`,
      };
    }

    let currentPeriod: TariffPeriod = "OFF_PEAK";
    let currentRate = offPeakRate;
    let nextPeriod: TariffPeriod = "OFF_PEAK";
    let nextTransitionMinutes = 0;
    let minutesRemaining = 0;
    let description = "";

    if (timeInMinutes < firstActiveWindowStart) {
      currentPeriod = "OFF_PEAK";
      currentRate = offPeakRate;
      nextPeriod = firstActiveWindowPeriod;
      nextTransitionMinutes = firstActiveWindowStart;
      minutesRemaining = firstActiveWindowStart - timeInMinutes;
      description = `Fora de Ponta (${timeString}): Tarifa Econômica (${currencySymbol} ${offPeakRate.toFixed(2)}/kWh)`;
    } else if (hasInter1 && timeInMinutes >= inter1Start && timeInMinutes < inter1End) {
      currentPeriod = "INTERMEDIATE";
      currentRate = interRate;
      nextPeriod = "PEAK";
      nextTransitionMinutes = peakStart;
      minutesRemaining = peakStart - timeInMinutes;
      description = `Horário Intermediário (${timeString}): Tarifa Intermediária (${currencySymbol} ${interRate.toFixed(2)}/kWh)`;
    } else if (timeInMinutes >= peakStart && timeInMinutes < peakEnd) {
      currentPeriod = "PEAK";
      currentRate = peakRate;
      nextPeriod = hasInter2 ? "INTERMEDIATE" : "OFF_PEAK";
      nextTransitionMinutes = peakEnd;
      minutesRemaining = peakEnd - timeInMinutes;
      description = `Horário de Ponta Ativo (${timeString}): Tarifa Máxima (${currencySymbol} ${peakRate.toFixed(2)}/kWh)`;
    } else if (hasInter2 && timeInMinutes >= inter2Start && timeInMinutes < inter2End) {
      currentPeriod = "INTERMEDIATE";
      currentRate = interRate;
      nextPeriod = "OFF_PEAK";
      nextTransitionMinutes = inter2End;
      minutesRemaining = inter2End - timeInMinutes;
      description = `Horário Intermediário (${timeString}): Tarifa Intermediária (${currencySymbol} ${interRate.toFixed(2)}/kWh)`;
    } else {
      currentPeriod = "OFF_PEAK";
      currentRate = offPeakRate;
      nextPeriod = firstActiveWindowPeriod;
      nextTransitionMinutes = firstActiveWindowStart;
      if (dayOfWeek === 5 && timeOfUseWeekdaysOnly) {
        minutesRemaining = (1440 - timeInMinutes) + 2880 + firstActiveWindowStart;
      } else {
        minutesRemaining = (1440 - timeInMinutes) + firstActiveWindowStart;
      }
      description = `Fora de Ponta Noturno (${timeString}): Tarifa Econômica (${currencySymbol} ${offPeakRate.toFixed(2)}/kWh)`;
    }

    const isPeakActive = currentPeriod === "PEAK";
    const isChargingBlocked = isTimeOfUseActive && isPeakActive && blockAcChargingDuringPeak;
    const transitionTimeStr = this.minutesToTimeString(nextTransitionMinutes);

    return {
      isTimeOfUseActive: true,
      currentPeriod,
      currentRate,
      currencySymbol,
      isPeakActive,
      isChargingBlocked,
      isWeekend,
      timeStringBrasilia: timeString,
      nextPeriod,
      nextTransitionTime: transitionTimeStr,
      minutesToNextTransition: minutesRemaining,
      nextTransition: {
        period: nextPeriod,
        time: transitionTimeStr,
        minutesRemaining,
      },
      dischargeReserveLimit,
      description,
    };
  }
}
