import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SolarSmartChargingService,
  SmartChargingEvaluationParams,
} from "../SolarSmartChargingService";
import { TariffScheduleService } from "../TariffScheduleService";

describe("SolarSmartChargingService (Feature 3.2: Modulação de Recarga AC)", () => {
  let service: SolarSmartChargingService;

  const baseParams: SmartChargingEvaluationParams = {
    isSmartChargingActive: true,
    minAcChargingWatts: 200,
    maxAcChargingWatts: 1200,
    currentAcChargingWatts: 400,
    chargeOnlyOffPeak: true,
    cloudyPrechargeActive: true,
    isStormModeActive: false,
    batteryPercentage: 60,
    solarWatts: 300,
    outputWatts: 200,
    solarForecastLevel: "SOLAR_GOOD",
    tariffConfig: {
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
    },
    currentDate: new Date("2026-11-20T15:00:00.000Z"), // 12:00 Brasília (OFF_PEAK)
  };

  beforeEach(() => {
    service = SolarSmartChargingService.getInstance();
    vi.restoreAllMocks();
  });

  it("não envia comando quando isSmartChargingActive for falso", () => {
    const result = service.evaluate({
      ...baseParams,
      isSmartChargingActive: false,
    });

    expect(result.isSmartChargingActive).toBe(false);
    expect(result.shouldSendAdjustCommand).toBe(false);
    expect(result.reason).toContain("desativado");
  });

  describe("Precedência do Modo Tempestade", () => {
    it("eleva a recarga AC para maxAcChargingWatts quando o Modo Tempestade estiver ativo", () => {
      const result = service.evaluate({
        ...baseParams,
        isStormModeActive: true,
        currentAcChargingWatts: 300,
        maxAcChargingWatts: 1200,
      });

      expect(result.targetWatts).toBe(1200);
      expect(result.shouldSendAdjustCommand).toBe(true);
      expect(result.reason).toContain("Modo Tempestade Ativo");
    });
  });

  describe("Bloqueio no Horário de Ponta", () => {
    it("restringe a recarga AC ao mínimo (200W) durante o Horário de Ponta (17h30-20h30 em dia útil)", () => {
      // 18:00 Brasília (21:00 UTC) em dia útil
      const peakDate = new Date("2026-11-20T21:00:00.000Z");

      const result = service.evaluate({
        ...baseParams,
        currentDate: peakDate,
        chargeOnlyOffPeak: true,
        currentAcChargingWatts: 800,
        minAcChargingWatts: 200,
      });

      expect(result.targetWatts).toBe(200);
      expect(result.shouldSendAdjustCommand).toBe(true);
      expect(result.reason).toContain("Horário de Ponta Ativo");
    });
  });

  describe("Pré-Recarga Noturna Econômica", () => {
    it("ativa pré-recarga suave de 400W na madrugada (03h00) quando a previsão for SOLAR_POOR e bateria < 85%", () => {
      // 03:00 Brasília (06:00 UTC)
      const nightDate = new Date("2026-11-20T06:00:00.000Z");

      const result = service.evaluate({
        ...baseParams,
        currentDate: nightDate,
        cloudyPrechargeActive: true,
        solarForecastLevel: "SOLAR_POOR",
        batteryPercentage: 50,
        currentAcChargingWatts: 200,
      });

      expect(result.targetWatts).toBe(400);
      expect(result.shouldSendAdjustCommand).toBe(true);
      expect(result.reason).toContain("Pré-recarga noturna econômica ativa");
    });

    it("não ativa pré-recarga noturna se a bateria já estiver em 85% ou mais", () => {
      const nightDate = new Date("2026-11-20T06:00:00.000Z");

      const result = service.evaluate({
        ...baseParams,
        currentDate: nightDate,
        cloudyPrechargeActive: true,
        solarForecastLevel: "SOLAR_POOR",
        batteryPercentage: 90,
        currentAcChargingWatts: 200,
      });

      expect(result.targetWatts).not.toBe(400);
      expect(result.reason).not.toContain("Pré-recarga noturna");
    });
  });

  describe("Flutuação e Equilíbrio de Carga", () => {
    it("reduz para a potência mínima quando a bateria atinge 95% ou mais", () => {
      const result = service.evaluate({
        ...baseParams,
        batteryPercentage: 98,
        currentAcChargingWatts: 600,
        minAcChargingWatts: 200,
      });

      expect(result.targetWatts).toBe(200);
      expect(result.shouldSendAdjustCommand).toBe(true);
      expect(result.reason).toContain("flutuação");
    });

    it("aplica banda morta de 50W para evitar comandos repetidos à API quando a diferença é insignificante", () => {
      const result = service.evaluate({
        ...baseParams,
        isStormModeActive: true,
        maxAcChargingWatts: 1200,
        currentAcChargingWatts: 1180, // Diferença de apenas 20W (< 50W)
      });

      expect(result.targetWatts).toBe(1200);
      expect(result.shouldSendAdjustCommand).toBe(false);
    });
  });
});
