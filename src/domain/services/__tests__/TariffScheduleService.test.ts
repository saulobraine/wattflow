import { describe, it, expect, beforeEach } from "vitest";
import {
  TariffScheduleService,
  DynamicTariffConfig,
} from "../TariffScheduleService";

describe("TariffScheduleService (Domínio Puro - Tarifa Branca ANEEL)", () => {
  let service: TariffScheduleService;

  const baseConfig: DynamicTariffConfig = {
    isDynamicTariffActive: true,
    peakTariffPerKwh: 1.85,
    intermediateTariffPerKwh: 1.15,
    offPeakTariffPerKwh: 0.65,
    peakStartTime: "17:30",
    peakEndTime: "20:30",
    intermediateStartTime1: "16:30",
    intermediateEndTime1: "17:30",
    intermediateStartTime2: "20:30",
    intermediateEndTime2: "21:30",
    energyCostPerKwh: 0.92,
  };

  beforeEach(() => {
    service = TariffScheduleService.getInstance();
  });

  describe("Horário de Brasília & Utilitários", () => {
    it("converte string de horário 'HH:MM' em minutos desde a meia-noite", () => {
      expect(service.parseTimeToMinutes("00:00")).toBe(0);
      expect(service.parseTimeToMinutes("01:30")).toBe(90);
      expect(service.parseTimeToMinutes("17:30")).toBe(1050);
      expect(service.parseTimeToMinutes("20:30")).toBe(1230);
      expect(service.parseTimeToMinutes("23:59")).toBe(1439);
      expect(service.parseTimeToMinutes("invalido", 100)).toBe(100);
      expect(service.parseTimeToMinutes("", 50)).toBe(50);
    });

    it("extrai corretamente dia da semana e horário oficial de Brasília", () => {
      // 2026-11-20T21:00:00Z -> Em Brasília (UTC-3) é 2026-11-20 (Sexta-feira, dayOfWeek=5), 18:00
      const utcFriday18hBrasilia = new Date("2026-11-20T21:00:00.000Z");
      const bsb = service.getBrasiliaTime(utcFriday18hBrasilia);

      expect(bsb.dayOfWeek).toBe(5); // Sexta
      expect(bsb.hours).toBe(18);
      expect(bsb.minutes).toBe(0);
      expect(bsb.timeString).toBe("18:00");
    });
  });

  describe("Regra de Fim de Semana (ANEEL: 100% Fora de Ponta)", () => {
    it("classifica Sábado e Domingo como Fora de Ponta (OFF_PEAK) mesmo no horário que seria de ponta", () => {
      // Sábado 2026-11-21 às 18:00 Brasília (21:00 UTC)
      const saturdayPeakHour = new Date("2026-11-21T21:00:00.000Z");
      expect(service.isWeekend(saturdayPeakHour)).toBe(true);

      const resultSat = service.evaluate(baseConfig, saturdayPeakHour);
      expect(resultSat.period).toBe("OFF_PEAK");
      expect(resultSat.rate).toBe(0.65);
      expect(resultSat.isDynamicActive).toBe(true);
      expect(resultSat.description).toContain("Fim de Semana: Tarifa Fora de Ponta Integral");

      // Domingo 2026-11-22 às 19:30 Brasília (22:30 UTC)
      const sundayPeakHour = new Date("2026-11-22T22:30:00.000Z");
      expect(service.isWeekend(sundayPeakHour)).toBe(true);

      const resultSun = service.evaluate(baseConfig, sundayPeakHour);
      expect(resultSun.period).toBe("OFF_PEAK");
      expect(resultSun.rate).toBe(0.65);
    });
  });

  describe("Dias Úteis (Segunda a Sexta)", () => {
    it("identifica Horário de Ponta (PEAK) entre 17:30 e 20:30", () => {
      // Sexta 2026-11-20 às 17:30 Brasília (20:30 UTC)
      const peakStart = new Date("2026-11-20T20:30:00.000Z");
      const resStart = service.evaluate(baseConfig, peakStart);
      expect(resStart.period).toBe("PEAK");
      expect(resStart.rate).toBe(1.85);
      expect(resStart.description).toContain("Horário de Ponta Ativo");

      // Sexta 2026-11-20 às 19:00 Brasília (22:00 UTC)
      const peakMid = new Date("2026-11-20T22:00:00.000Z");
      const resMid = service.evaluate(baseConfig, peakMid);
      expect(resMid.period).toBe("PEAK");
      expect(resMid.rate).toBe(1.85);

      // Sexta 2026-11-20 às 20:29 Brasília (23:29 UTC)
      const peakLastMinute = new Date("2026-11-20T23:29:00.000Z");
      const resLast = service.evaluate(baseConfig, peakLastMinute);
      expect(resLast.period).toBe("PEAK");
      expect(resLast.rate).toBe(1.85);
    });

    it("identifica Horário Intermediário 1 (16:30 - 17:30)", () => {
      // Sexta 2026-11-20 às 17:00 Brasília (20:00 UTC)
      const inter1 = new Date("2026-11-20T20:00:00.000Z");
      const res = service.evaluate(baseConfig, inter1);

      expect(res.period).toBe("INTERMEDIATE");
      expect(res.rate).toBe(1.15);
      expect(res.description).toContain("Horário Intermediário");
    });

    it("identifica Horário Intermediário 2 (20:30 - 21:30)", () => {
      // Sexta 2026-11-20 às 21:00 Brasília (00:00 UTC do dia seguinte)
      const inter2 = new Date("2026-11-21T00:00:00.000Z");
      const res = service.evaluate(baseConfig, inter2);

      expect(res.period).toBe("INTERMEDIATE");
      expect(res.rate).toBe(1.15);
      expect(res.description).toContain("Horário Intermediário");
    });

    it("identifica Fora de Ponta (OFF_PEAK) nos demais horários do dia útil", () => {
      // Sexta 2026-11-20 às 12:00 Brasília (15:00 UTC)
      const noon = new Date("2026-11-20T15:00:00.000Z");
      const resNoon = service.evaluate(baseConfig, noon);
      expect(resNoon.period).toBe("OFF_PEAK");
      expect(resNoon.rate).toBe(0.65);
      expect(resNoon.description).toContain("Fora de Ponta");

      // Sexta 2026-11-20 às 02:00 Brasília (05:00 UTC)
      const dawn = new Date("2026-11-20T05:00:00.000Z");
      const resDawn = service.evaluate(baseConfig, dawn);
      expect(resDawn.period).toBe("OFF_PEAK");
      expect(resDawn.rate).toBe(0.65);

      // Sexta 2026-11-20 às 22:00 Brasília (01:00 UTC do dia seguinte)
      const night = new Date("2026-11-21T01:00:00.000Z");
      const resNight = service.evaluate(baseConfig, night);
      expect(resNight.period).toBe("OFF_PEAK");
      expect(resNight.rate).toBe(0.65);
    });
  });

  describe("Fallback quando Tarifa Dinâmica está Inativa", () => {
    it("retorna tarifa convencional fixa e período OFF_PEAK quando isDynamicTariffActive é falso", () => {
      const inactiveConfig: DynamicTariffConfig = {
        ...baseConfig,
        isDynamicTariffActive: false,
        energyCostPerKwh: 0.95,
      };

      // Mesmo em horário de ponta
      const peakDate = new Date("2026-11-20T21:00:00.000Z");
      const res = service.evaluate(inactiveConfig, peakDate);

      expect(res.period).toBe("OFF_PEAK");
      expect(res.rate).toBe(0.95);
      expect(res.isDynamicActive).toBe(false);
      expect(res.description).toContain("Tarifa Convencional Fixa");
    });

    it("usa 0.92 como tarifa fixa de fallback se energyCostPerKwh não for especificado ou for inválido", () => {
      const inactiveConfig: DynamicTariffConfig = {
        ...baseConfig,
        isDynamicTariffActive: false,
        energyCostPerKwh: 0,
      };

      const res = service.evaluate(inactiveConfig);
      expect(res.rate).toBe(0.92);
      expect(res.period).toBe("OFF_PEAK");
      expect(res.isDynamicActive).toBe(false);
    });
  });
});
