export type TariffPeriod = "PEAK" | "INTERMEDIATE" | "OFF_PEAK";

export interface DynamicTariffConfig {
  isDynamicTariffActive: boolean;
  peakTariffPerKwh: number;
  intermediateTariffPerKwh: number;
  offPeakTariffPerKwh: number;
  peakStartTime: string;
  peakEndTime: string;
  intermediateStartTime1: string;
  intermediateEndTime1: string;
  intermediateStartTime2: string;
  intermediateEndTime2: string;
  energyCostPerKwh?: number;
}

export interface TariffEvaluationResult {
  period: TariffPeriod;
  rate: number;
  isDynamicActive: boolean;
  description: string;
}

/**
 * Serviço de domínio puro para resolução de faixas tarifárias (Tarifa Branca ANEEL).
 * Avalia o período e a tarifa ativa com base no horário oficial de Brasília (America/Sao_Paulo).
 *
 * Regras Oficiais ANEEL:
 * - Fins de semana (Sábado e Domingo): 100% Fora de Ponta (OFF_PEAK).
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

    // Mapeamento de dia da semana: 0 = Dom, 1 = Seg, ..., 6 = Sáb
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
    // Em Intl hour12: false às 24h pode vir como 24
    if (hours === 24) {
      hours = 0;
    }
    const minutes = parseInt(minuteStr, 10);
    const timeInMinutes = hours * 60 + minutes;
    const timeString = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;

    return { dayOfWeek, hours, minutes, timeInMinutes, timeString };
  }

  public parseTimeToMinutes(timeStr: string, defaultMinutes = 0): number {
    if (!timeStr || !timeStr.includes(":")) {
      return defaultMinutes;
    }
    const [h, m] = timeStr.split(":").map((v) => parseInt(v.trim(), 10));
    if (isNaN(h) || isNaN(m)) {
      return defaultMinutes;
    }
    return h * 60 + m;
  }

  public isWeekend(date: Date = new Date()): boolean {
    const { dayOfWeek } = this.getBrasiliaTime(date);
    return dayOfWeek === 0 || dayOfWeek === 6; // 0 = Domingo, 6 = Sábado
  }

  public evaluate(config: DynamicTariffConfig, date: Date = new Date()): TariffEvaluationResult {
    if (!config.isDynamicTariffActive) {
      const flatRate = config.energyCostPerKwh && config.energyCostPerKwh > 0 ? config.energyCostPerKwh : 0.92;
      return {
        period: "OFF_PEAK",
        rate: flatRate,
        isDynamicActive: false,
        description: `Tarifa Convencional Fixa (${flatRate.toFixed(2)}/kWh)`,
      };
    }

    // Fins de semana são 100% Fora de Ponta pela ANEEL
    if (this.isWeekend(date)) {
      const offPeakRate = config.offPeakTariffPerKwh > 0 ? config.offPeakTariffPerKwh : 0.65;
      return {
        period: "OFF_PEAK",
        rate: offPeakRate,
        isDynamicActive: true,
        description: `Fim de Semana: Tarifa Fora de Ponta Integral (${offPeakRate.toFixed(2)}/kWh)`,
      };
    }

    const { timeInMinutes, timeString } = this.getBrasiliaTime(date);

    const peakStart = this.parseTimeToMinutes(config.peakStartTime, 17 * 60 + 30);
    const peakEnd = this.parseTimeToMinutes(config.peakEndTime, 20 * 60 + 30);

    const inter1Start = this.parseTimeToMinutes(config.intermediateStartTime1, 16 * 60 + 30);
    const inter1End = this.parseTimeToMinutes(config.intermediateEndTime1, 17 * 60 + 30);

    const inter2Start = this.parseTimeToMinutes(config.intermediateStartTime2, 20 * 60 + 30);
    const inter2End = this.parseTimeToMinutes(config.intermediateEndTime2, 21 * 60 + 30);

    // 1. Horário de Ponta
    if (timeInMinutes >= peakStart && timeInMinutes < peakEnd) {
      const peakRate = config.peakTariffPerKwh > 0 ? config.peakTariffPerKwh : 1.85;
      return {
        period: "PEAK",
        rate: peakRate,
        isDynamicActive: true,
        description: `Horário de Ponta Ativo (${timeString}): Tarifa Máxima (${peakRate.toFixed(2)}/kWh)`,
      };
    }

    // 2. Horário Intermediário (janela 1 ou 2)
    const inWindow1 = timeInMinutes >= inter1Start && timeInMinutes < inter1End;
    const inWindow2 = timeInMinutes >= inter2Start && timeInMinutes < inter2End;

    if (inWindow1 || inWindow2) {
      const interRate = config.intermediateTariffPerKwh > 0 ? config.intermediateTariffPerKwh : 1.15;
      return {
        period: "INTERMEDIATE",
        rate: interRate,
        isDynamicActive: true,
        description: `Horário Intermediário (${timeString}): Tarifa Intermediária (${interRate.toFixed(2)}/kWh)`,
      };
    }

    // 3. Fora de Ponta
    const offPeakRate = config.offPeakTariffPerKwh > 0 ? config.offPeakTariffPerKwh : 0.65;
    return {
      period: "OFF_PEAK",
      rate: offPeakRate,
      isDynamicActive: true,
      description: `Fora de Ponta (${timeString}): Tarifa Econômica (${offPeakRate.toFixed(2)}/kWh)`,
    };
  }
}
