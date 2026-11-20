import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  TariffScheduleService,
  DynamicTariffConfig,
} from "../TariffScheduleService";
import {
  OrchestratorSyncUseCase,
  ProvidedTelemetry,
} from "../../../application/OrchestratorSyncUseCase";
import {
  ConfigurationRepository,
  RetrievedConfigurationRecord,
} from "../../../infrastructure/repositories/ConfigurationRepository";
import { EcoFlowHttpClient } from "../../../infrastructure/http/EcoFlowHttpClient";
import { AccessKey } from "../../values/AccessKey";
import { AccessSecret } from "../../values/AccessSecret";
import { EcoFlowCredentials } from "../../models/EcoFlowCredentials";
import { CredentialsBundle } from "../../models/CredentialsBundle";
import { DeviceSerialNumber } from "../../values/DeviceSerialNumber";
import { DevicePair } from "../../models/DevicePair";
import { AutomationThresholdPair } from "../../models/AutomationThresholdPair";
import { PercentageValue } from "../../values/PercentageValue";
import { AutomationProfile } from "../../models/AutomationProfile";
import { OrchestratorConfiguration } from "../../models/OrchestratorConfiguration";
import { settingsPostBodySchema } from "../../../infrastructure/security/apiSchemas";

const { mockFindUniqueConfig } = vi.hoisted(() => ({
  mockFindUniqueConfig: vi.fn(),
}));

vi.mock("../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    userConfiguration: {
      findUnique: mockFindUniqueConfig,
    },
  },
}));

vi.mock("../../../infrastructure/auth/sessionHelper", () => ({
  extractUserFromRequest: vi.fn().mockResolvedValue({
    provideIdentity: (fn: (id: string) => void) => fn("user-tariff-test"),
  }),
}));

import handleTariffStatus from "../../../pages/api/tariff/status";

function buildMockConfigRecord(
  databaseRecordId: string,
  overrides: Partial<RetrievedConfigurationRecord> = {}
): RetrievedConfigurationRecord {
  const credentialsBundle = new CredentialsBundle(
    new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("as-test"))
  );
  const devicePair = new DevicePair(new DeviceSerialNumber("EF-DELTA2-TEST"));
  const thresholdPair = new AutomationThresholdPair(
    new PercentageValue(90),
    new PercentageValue(30)
  );
  const profile = new AutomationProfile(devicePair, thresholdPair);
  const configuration = new OrchestratorConfiguration(credentialsBundle, profile);

  return {
    databaseRecordId,
    ecoflowEndpointRegion: "https://api.ecoflow.com",
    isAutomationActive: true,
    notificationConfig: { isNotificationActive: true },
    configuration,
    atsLifespanCycles: 10000,
    atsCurrentCycles: 120,
    atsLastSwitchedAt: new Date(),
    energyCostPerKwh: 0.92,
    currencySymbol: "R$",
    batteryCapacityWh: 2048,
    isStormModeActive: false,
    isDailyReportActive: true,
    dailyReportTime: "21:00",
    lastDailyReportSentAt: null,
    latitude: -23.55,
    longitude: -46.63,
    isAdaptiveHysteresisActive: false,
    minAdaptiveThreshold: 20,
    maxAdaptiveThreshold: 50,
    lastSolarIrradianceMj: null,
    lastSolarForecastCheckAt: null,
    thermalWarningThreshold: 45.0,
    thermalShutdownThreshold: 50.0,
    lastBatteryTempCelsius: null,
    lastBatterySoh: null,
    lastBatteryCycles: null,
    maxRecordedBatteryTemp: null,
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
    peakReserveThreshold: 15,
    inverterMaxWatts: 2400,
    isAlertOnBlackout: true,
    isAlertOnGridRestore: true,
    isAlertOnOverload: true,
    isAlertOnThermalRisk: true,
    isAlertOnAtsFailure: true,
    alertCooldownMinutes: 10,
    isSmartChargingActive: false,
    minAcChargingWatts: 200,
    maxAcChargingWatts: 1200,
    currentAcChargingWatts: 400,
    chargeOnlyOffPeak: true,
    cloudyPrechargeActive: true,
    lastSmartChargeAdjustAt: null,
    isAutoStormActive: false,
    autoStormReserveThreshold: 85,
    autoStormRainThresholdMm: 20.0,
    autoStormPrechargeAc: true,
    isStormAlertActive: false,
    lastStormAlertCode: null,
    lastStormAlertDescription: null,
    lastStormAlertTriggeredAt: null,
    lastStormAlertEndedAt: null,
    // Feature 4.6:
    isTimeOfUseActive: true,
    timeOfUseWeekdaysOnly: true,
    intermediateStartTime: "16:30",
    intermediateEndTime: "21:30",
    peakDischargeReserveLimit: 20,
    blockAcChargingDuringPeak: true,
    ...overrides,
  };
}

function createMockReqRes(method: string, headers: Record<string, string> = {}) {
  const req = {
    method,
    headers,
    query: {},
  } as unknown as NextApiRequest;

  let statusCode = 200;
  let responseData: unknown = null;
  const resHeaders: Record<string, string | string[]> = {};

  const res = {
    setHeader: vi.fn((key: string, value: string | string[]) => {
      resHeaders[key] = value;
      return res;
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      responseData = payload;
      return res;
    }),
    get statusCode() {
      return statusCode;
    },
    get body() {
      return responseData;
    },
    get headers() {
      return resHeaders;
    },
  } as unknown as NextApiResponse & { statusCode: number; body: any; headers: Record<string, any> };

  return { req, res };
}

describe("Feature 4.6: Tarifação Horária Inteligente (Tarifa Branca / Time-of-Use)", () => {
  let service: TariffScheduleService;

  const standardConfig: DynamicTariffConfig = {
    isTimeOfUseActive: true,
    timeOfUseWeekdaysOnly: true,
    peakStartTime: "17:30",
    peakEndTime: "20:30",
    intermediateStartTime: "16:30",
    intermediateEndTime: "21:30",
    peakDischargeReserveLimit: 20,
    blockAcChargingDuringPeak: true,
    peakTariffPerKwh: 1.85,
    intermediateTariffPerKwh: 1.15,
    offPeakTariffPerKwh: 0.65,
    energyCostPerKwh: 0.92,
    currencySymbol: "R$",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = TariffScheduleService.getInstance();
    OrchestratorSyncUseCase.resetLoggedStatesForTests();
  });

  describe("TariffScheduleService - Avaliação Detalhada e Contagem Regressiva", () => {
    it("converte minutos para string formatada HH:mm", () => {
      expect(service.minutesToTimeString(0)).toBe("00:00");
      expect(service.minutesToTimeString(65)).toBe("01:05");
      expect(service.minutesToTimeString(1050)).toBe("17:30");
      expect(service.minutesToTimeString(1230)).toBe("20:30");
    });

    it("retorna tarifa convencional fixa e sem transição quando isTimeOfUseActive é falso", () => {
      const inactiveConfig: DynamicTariffConfig = {
        ...standardConfig,
        isTimeOfUseActive: false,
        isDynamicTariffActive: false,
      };

      const result = service.evaluateTariffPeriod(inactiveConfig);
      expect(result.isTimeOfUseActive).toBe(false);
      expect(result.currentPeriod).toBe("OFF_PEAK");
      expect(result.currentRate).toBe(0.92);
      expect(result.isPeakActive).toBe(false);
      expect(result.isChargingBlocked).toBe(false);
      expect(result.minutesToNextTransition).toBe(0);
      expect(result.nextTransitionTime).toBe("--:--");
    });

    it("aplica regra ANEEL de fim de semana: 100% Fora de Ponta no Sábado com contagem até Segunda", () => {
      // Sábado 2026-11-21 às 18:00 Brasília (21:00 UTC) -> seria ponta se fosse dia útil
      const saturday = new Date("2026-11-21T21:00:00.000Z");
      const result = service.evaluateTariffPeriod(standardConfig, saturday);

      expect(result.isTimeOfUseActive).toBe(true);
      expect(result.isWeekend).toBe(true);
      expect(result.currentPeriod).toBe("OFF_PEAK");
      expect(result.currentRate).toBe(0.65);
      expect(result.isPeakActive).toBe(false);
      expect(result.isChargingBlocked).toBe(false);
      expect(result.nextPeriod).toBe("INTERMEDIATE");
      expect(result.nextTransitionTime).toBe("16:30");
      // 18:00 (1080 min): resto de sábado (360) + domingo (1440) + seg até 16:30 (990) = 2790 min
      expect(result.minutesToNextTransition).toBe(2790);
      expect(result.nextTransition?.minutesRemaining).toBe(2790);
    });

    it("aplica regra ANEEL de fim de semana: Domingo com contagem até Segunda", () => {
      // Domingo 2026-11-22 às 10:00 Brasília (13:00 UTC)
      const sunday = new Date("2026-11-22T13:00:00.000Z");
      const result = service.evaluateTariffPeriod(standardConfig, sunday);

      expect(result.isWeekend).toBe(true);
      expect(result.currentPeriod).toBe("OFF_PEAK");
      expect(result.nextPeriod).toBe("INTERMEDIATE");
      // 10:00 (600 min): resto de domingo (840) + seg até 16:30 (990) = 1830 min
      expect(result.minutesToNextTransition).toBe(1830);
    });

    it("identifica Fora de Ponta diurno em dia útil (ex: 10:00) e calcula minutos até Intermediário (16:30)", () => {
      // Sexta 2026-11-20 às 10:00 Brasília (13:00 UTC)
      const fridayMorning = new Date("2026-11-20T13:00:00.000Z");
      const result = service.evaluateTariffPeriod(standardConfig, fridayMorning);

      expect(result.currentPeriod).toBe("OFF_PEAK");
      expect(result.currentRate).toBe(0.65);
      expect(result.isPeakActive).toBe(false);
      expect(result.isChargingBlocked).toBe(false);
      expect(result.nextPeriod).toBe("INTERMEDIATE");
      expect(result.nextTransitionTime).toBe("16:30");
      // 10:00 (600) até 16:30 (990) = 390 min
      expect(result.minutesToNextTransition).toBe(390);
    });

    it("identifica Horário Intermediário 1 (17:00) e calcula minutos até a Ponta (17:30)", () => {
      // Sexta 2026-11-20 às 17:00 Brasília (20:00 UTC)
      const fridayInter1 = new Date("2026-11-20T20:00:00.000Z");
      const result = service.evaluateTariffPeriod(standardConfig, fridayInter1);

      expect(result.currentPeriod).toBe("INTERMEDIATE");
      expect(result.currentRate).toBe(1.15);
      expect(result.isPeakActive).toBe(false);
      expect(result.isChargingBlocked).toBe(false);
      expect(result.nextPeriod).toBe("PEAK");
      expect(result.nextTransitionTime).toBe("17:30");
      // 17:00 (1020) até 17:30 (1050) = 30 min
      expect(result.minutesToNextTransition).toBe(30);
    });

    it("identifica Horário de Ponta (18:00) com bloqueio de recarga AC e contagem regressiva", () => {
      // Sexta 2026-11-20 às 18:00 Brasília (21:00 UTC)
      const fridayPeak = new Date("2026-11-20T21:00:00.000Z");
      const result = service.evaluateTariffPeriod(standardConfig, fridayPeak);

      expect(result.currentPeriod).toBe("PEAK");
      expect(result.currentRate).toBe(1.85);
      expect(result.isPeakActive).toBe(true);
      expect(result.isChargingBlocked).toBe(true);
      expect(result.nextPeriod).toBe("INTERMEDIATE");
      expect(result.nextTransitionTime).toBe("20:30");
      // 18:00 (1080) até 20:30 (1230) = 150 min
      expect(result.minutesToNextTransition).toBe(150);
    });

    it("desabilita isChargingBlocked se blockAcChargingDuringPeak for falso", () => {
      const noBlockConfig: DynamicTariffConfig = {
        ...standardConfig,
        blockAcChargingDuringPeak: false,
      };

      const fridayPeak = new Date("2026-11-20T21:00:00.000Z");
      const result = service.evaluateTariffPeriod(noBlockConfig, fridayPeak);

      expect(result.isPeakActive).toBe(true);
      expect(result.isChargingBlocked).toBe(false);
    });

    it("identifica Horário Intermediário 2 (21:00) e calcula minutos até Fora de Ponta (21:30)", () => {
      // Sexta 2026-11-20 às 21:00 Brasília (00:00 UTC do dia seguinte)
      const fridayInter2 = new Date("2026-11-21T00:00:00.000Z");
      const result = service.evaluateTariffPeriod(standardConfig, fridayInter2);

      expect(result.currentPeriod).toBe("INTERMEDIATE");
      expect(result.currentRate).toBe(1.15);
      expect(result.isPeakActive).toBe(false);
      expect(result.isChargingBlocked).toBe(false);
      expect(result.nextPeriod).toBe("OFF_PEAK");
      expect(result.nextTransitionTime).toBe("21:30");
      expect(result.minutesToNextTransition).toBe(30);
    });

    it("calcula transição para Segunda-feira na Sexta-feira à noite após 21:30", () => {
      // Sexta 2026-11-20 às 22:00 Brasília (01:00 UTC do dia seguinte)
      const fridayNight = new Date("2026-11-21T01:00:00.000Z");
      const result = service.evaluateTariffPeriod(standardConfig, fridayNight);

      expect(result.currentPeriod).toBe("OFF_PEAK");
      expect(result.nextPeriod).toBe("INTERMEDIATE");
      expect(result.nextTransitionTime).toBe("16:30");
      // 22:00 (1320): resto sex (120) + sab/dom (2880) + seg (990) = 3990 min
      expect(result.minutesToNextTransition).toBe(3990);
    });
  });

  describe("OrchestratorSyncUseCase - Automação de Comutação & Bloqueio na Ponta", () => {
    it("liga saída AC (comuta ATS para bateria) e bloqueia recarga AC da rede (0W) durante a Ponta quando SOC > reserva", async () => {
      // Simula horário de ponta: Sexta 18:00
      vi.spyOn(TariffScheduleService.prototype, "getBrasiliaTime").mockReturnValue({
        dayOfWeek: 5,
        hours: 18,
        minutes: 0,
        timeInMinutes: 18 * 60,
        timeString: "18:00",
      });

      const spySetAcOutput = vi
        .spyOn(EcoFlowHttpClient.prototype, "setAcOutputState")
        .mockResolvedValue("SUCCESS");
      const spySetAcSpeed = vi
        .spyOn(EcoFlowHttpClient.prototype, "setAcChargingSpeed")
        .mockResolvedValue({ isSuccess: true, feedbackMessage: "OK" });

      const config = buildMockConfigRecord("config-peak-1", {
        isTimeOfUseActive: true,
        peakDischargeReserveLimit: 20,
        blockAcChargingDuringPeak: true,
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(config),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(121),
        updateCurrentAcChargingWatts: vi.fn().mockResolvedValue(undefined),
        findLatestExecutionLog: vi.fn().mockResolvedValue(null),
      } as unknown as ConfigurationRepository;

      // Telemetria: bateria 60% (> 20%), mas saída AC estava desligada
      const telemetry: ProvidedTelemetry = {
        batteryPercentage: 60,
        solarWatts: 0,
        outputWatts: 0,
        isAcOutputEnabled: false,
      };

      const orchestrator = new OrchestratorSyncUseCase(mockRepo);
      const result = await orchestrator.executeSyncForUser("user-1", telemetry);

      expect(result.triggeredAction).toBe("ENABLE_ECOFLOW_AC");
      expect(result.detailMessage).toContain("Horário de Ponta Ativo: Saída AC ligada");

      // 1. Bloqueio de recarga AC: enviado comando 0W
      expect(spySetAcSpeed).toHaveBeenCalledWith(expect.anything(), 0);
      expect(mockRepo.updateCurrentAcChargingWatts).toHaveBeenCalledWith("config-peak-1", 0);

      // 2. Comutação ATS: ligada saída AC para priorizar bateria
      expect(spySetAcOutput).toHaveBeenCalledWith(expect.anything(), true);
      expect(mockRepo.incrementAtsCycle).toHaveBeenCalledWith("config-peak-1");
    });

    it("desliga saída AC (comuta ATS para rede) durante a Ponta quando a bateria atinge o limite de reserva (SOC <= 20%)", async () => {
      vi.spyOn(TariffScheduleService.prototype, "getBrasiliaTime").mockReturnValue({
        dayOfWeek: 5,
        hours: 19,
        minutes: 0,
        timeInMinutes: 19 * 60,
        timeString: "19:00",
      });

      const spySetAcOutput = vi
        .spyOn(EcoFlowHttpClient.prototype, "setAcOutputState")
        .mockResolvedValue("SUCCESS");
      const spySetAcSpeed = vi
        .spyOn(EcoFlowHttpClient.prototype, "setAcChargingSpeed")
        .mockResolvedValue({ isSuccess: true, feedbackMessage: "OK" });

      const config = buildMockConfigRecord("config-peak-2", {
        isTimeOfUseActive: true,
        peakDischargeReserveLimit: 20,
        blockAcChargingDuringPeak: true,
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(config),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(122),
        updateCurrentAcChargingWatts: vi.fn().mockResolvedValue(undefined),
        findLatestExecutionLog: vi.fn().mockResolvedValue(null),
      } as unknown as ConfigurationRepository;

      // Telemetria: bateria caiu para 18% (<= 20% limite) e AC estava ligada
      const telemetry: ProvidedTelemetry = {
        batteryPercentage: 18,
        solarWatts: 0,
        outputWatts: 450,
        isAcOutputEnabled: true,
      };

      const orchestrator = new OrchestratorSyncUseCase(mockRepo);
      const result = await orchestrator.executeSyncForUser("user-2", telemetry);

      expect(result.triggeredAction).toBe("DISABLE_ECOFLOW_AC");
      expect(result.detailMessage).toContain("Reserva de Ponta Atingida (18% <= 20%)");
      expect(spySetAcOutput).toHaveBeenCalledWith(expect.anything(), false);
      expect(mockRepo.incrementAtsCycle).toHaveBeenCalledWith("config-peak-2");
    });

    it("prevalência absoluta do Modo Auto-Storm sobre a Tarifa Branca: comuta para rede e preserva emergência", async () => {
      // Mesmo se estiver no horário de ponta
      vi.spyOn(TariffScheduleService.prototype, "getBrasiliaTime").mockReturnValue({
        dayOfWeek: 5,
        hours: 18,
        minutes: 30,
        timeInMinutes: 18 * 60 + 30,
        timeString: "18:30",
      });

      const spySetAcOutput = vi
        .spyOn(EcoFlowHttpClient.prototype, "setAcOutputState")
        .mockResolvedValue("SUCCESS");
      const spySetAcSpeed = vi
        .spyOn(EcoFlowHttpClient.prototype, "setAcChargingSpeed")
        .mockResolvedValue({ isSuccess: true, feedbackMessage: "OK" });

      const config = buildMockConfigRecord("config-storm-precedence", {
        isTimeOfUseActive: true,
        isAutoStormActive: true,
        autoStormReserveThreshold: 85,
        autoStormPrechargeAc: true,
        latitude: -23.55,
        longitude: -46.63,
      });

      // Simula API de meteorologia detectando tempestade severa WMO 99
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          daily: {
            time: ["2026-11-20"],
            weather_code: [99],
            precipitation_sum: [50.0],
            precipitation_probability_max: [95],
            wind_speed_10m_max: [70.0],
            temperature_2m_max: [25.0],
            temperature_2m_min: [18.0],
          },
        }),
      } as Response);

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(config),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(123),
        updateStormAlertStatus: vi.fn().mockResolvedValue(undefined),
        updateCurrentAcChargingWatts: vi.fn().mockResolvedValue(undefined),
        findLatestExecutionLog: vi.fn().mockResolvedValue(null),
      } as unknown as ConfigurationRepository;

      const telemetry: ProvidedTelemetry = {
        batteryPercentage: 60,
        solarWatts: 0,
        outputWatts: 300,
        isAcOutputEnabled: true,
      };

      const orchestrator = new OrchestratorSyncUseCase(mockRepo);
      const result = await orchestrator.executeSyncForUser("user-3", telemetry);

      // Auto-Storm vence: aciona AUTO_STORM_DEFENSE, desliga AC e pré-recarrega em 1200W (em vez de descarregar na ponta)
      expect(result.triggeredAction).toBe("AUTO_STORM_DEFENSE");
      expect(spySetAcOutput).toHaveBeenCalledWith(expect.anything(), false);
      expect(spySetAcSpeed).toHaveBeenCalledWith(expect.anything(), 1200);
    });
  });

  describe("Validação Zod de Time-of-Use em settingsPostBodySchema", () => {
    it("aceita parâmetros válidos de Tarifa Branca", () => {
      const valid = {
        ecoflowAccessKey: "ak-test",
        ecoflowSerialNumber: "EF-TEST",
        isTimeOfUseActive: true,
        timeOfUseWeekdaysOnly: true,
        peakStartTime: "17:30",
        peakEndTime: "20:30",
        intermediateStartTime: "16:30",
        intermediateEndTime: "21:30",
        peakDischargeReserveLimit: 25,
        blockAcChargingDuringPeak: true,
      };

      const result = settingsPostBodySchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejeita peakDischargeReserveLimit fora do intervalo [10, 50]", () => {
      expect(settingsPostBodySchema.shape.peakDischargeReserveLimit.safeParse(5).success).toBe(false);
      expect(settingsPostBodySchema.shape.peakDischargeReserveLimit.safeParse(60).success).toBe(false);
      expect(settingsPostBodySchema.shape.peakDischargeReserveLimit.safeParse(20).success).toBe(true);
    });

    it("rejeita horários em formato inválido", () => {
      expect(settingsPostBodySchema.shape.peakStartTime.safeParse("25:00").success).toBe(false);
      expect(settingsPostBodySchema.shape.peakStartTime.safeParse("17:65").success).toBe(false);
      expect(settingsPostBodySchema.shape.peakStartTime.safeParse("17:30").success).toBe(true);
    });
  });

  describe("Endpoint REST GET /api/tariff/status", () => {
    it("rejeita métodos diferentes de GET com 405", async () => {
      const { req, res } = createMockReqRes("POST");
      await handleTariffStatus(req, res);

      expect(res.statusCode).toBe(405);
      expect(res.body.success).toBe(false);
    });

    it("retorna 404 se o usuário não possuir configuração cadastrada", async () => {
      mockFindUniqueConfig.mockResolvedValue(null);

      const { req, res } = createMockReqRes("GET");
      await handleTariffStatus(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain("não encontrada");
    });

    it("retorna status detalhado e contagem regressiva quando autenticado", async () => {
      mockFindUniqueConfig.mockResolvedValue({
        id: "config-test-1",
        userId: "user-tariff-test",
        isTimeOfUseActive: true,
        timeOfUseWeekdaysOnly: true,
        peakStartTime: "17:30",
        peakEndTime: "20:30",
        intermediateStartTime: "16:30",
        intermediateEndTime: "21:30",
        peakDischargeReserveLimit: 20,
        blockAcChargingDuringPeak: true,
        peakTariffPerKwh: 1.85,
        intermediateTariffPerKwh: 1.15,
        offPeakTariffPerKwh: 0.65,
        currencySymbol: "R$",
      });

      const { req, res } = createMockReqRes("GET");
      await handleTariffStatus(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.isTimeOfUseActive).toBe(true);
      expect(res.body.data.nextTransition).toBeDefined();
      expect(res.body.data.nextTransition.time).toBeDefined();
      expect(typeof res.body.data.nextTransition.minutesRemaining).toBe("number");
    });
  });
});
