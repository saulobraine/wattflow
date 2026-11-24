import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenMeteoSolarForecastService,
  isWithinDaylightWindow,
  type SolarForecastResult,
} from "../OpenMeteoSolarForecastService";
import { settingsPostBodySchema } from "../../security/apiSchemas";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { DeviceSerialNumber } from "../../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { AutomationThresholdPair } from "../../../domain/models/AutomationThresholdPair";
import { PercentageValue } from "../../../domain/values/PercentageValue";
import { AutomationProfile } from "../../../domain/models/AutomationProfile";
import { DevicePair } from "../../../domain/models/DevicePair";
import { CredentialsBundle } from "../../../domain/models/CredentialsBundle";
import { OrchestratorConfiguration } from "../../../domain/models/OrchestratorConfiguration";
import { BatteryLevel } from "../../../domain/values/BatteryLevel";
import { SolarGenerationWatts } from "../../../domain/values/SolarGenerationWatts";
import type { RetrievedConfigurationRecord } from "../../repositories/ConfigurationRepository";
import { EcoFlowMqttStreamService } from "../EcoFlowMqttStreamService";

const {
  mockFetchDeviceTelemetry,
  mockSetAcOutputState,
  mockSetAcChargingSpeed,
} = vi.hoisted(() => ({
  mockFetchDeviceTelemetry: vi.fn(),
  mockSetAcOutputState: vi.fn(),
  mockSetAcChargingSpeed: vi.fn(),
}));

vi.mock("../../http/EcoFlowHttpClient", () => ({
  EcoFlowHttpClient: vi.fn(function () {
    return {
      fetchDeviceTelemetry: mockFetchDeviceTelemetry,
      setAcOutputState: mockSetAcOutputState,
      setAcChargingSpeed: mockSetAcChargingSpeed,
    };
  }),
}));

function buildMockRecord(recordId: string, overrides: Partial<RetrievedConfigurationRecord> = {}): RetrievedConfigurationRecord {
  const credentials = new EcoFlowCredentials(new AccessKey("ak-daylight"), new AccessSecret("as-daylight"));
  const bundle = new CredentialsBundle(credentials);
  const serial = new DeviceSerialNumber("SN-DAYLIGHT-TEST");
  const devices = new DevicePair(serial);
  const thresholds = new AutomationThresholdPair(
    new PercentageValue(85),
    new PercentageValue(30)
  );
  const profile = new AutomationProfile(devices, thresholds);
  const configuration = new OrchestratorConfiguration(bundle, profile);

  return {
    databaseRecordId: recordId,
    ecoflowEndpointRegion: "https://api.ecoflow.com",
    isAutomationActive: true,
    notificationConfig: {
      telegramBotToken: "",
      telegramChatId: "",
      whatsappPhoneNumber: "",
      whatsappApiKey: "",
      isNotificationActive: false,
    },
    configuration,
    atsLifespanCycles: 10000,
    atsCurrentCycles: 50,
    atsLastSwitchedAt: null,
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
    isDaylightOnlyActive: false,
    lastSolarIrradianceMj: null,
    lastSolarForecastCheckAt: null,
    thermalWarningThreshold: 42,
    thermalShutdownThreshold: 48,
    lastBatteryTempCelsius: 30,
    lastBatterySoh: 99,
    lastBatteryCycles: 50,
    maxRecordedBatteryTemp: 35,
    lastBatteryPercentage: 65,
    isDynamicTariffActive: false,
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
    ...overrides,
  };
}

describe("Operação Exclusiva em Período Solar (Daylight Only Automation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDeviceTelemetry.mockResolvedValue({
      batteryLevel: new BatteryLevel(80),
      solarWatts: new SolarGenerationWatts(250),
      outputWatts: 150,
      isAcOutputEnabled: true,
    });
    mockSetAcOutputState.mockResolvedValue("SUCCESS");
    mockSetAcChargingSpeed.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Função Utilitária isWithinDaylightWindow", () => {
    it("retorna true quando o horário está no meio do dia solar (ex: 12:00)", () => {
      const now = new Date("2026-11-21T12:00:00");
      const result = isWithinDaylightWindow("05:30", "18:30", now);
      expect(result).toBe(true);
    });

    it("retorna false quando é de madrugada antes do nascer do sol (ex: 04:30)", () => {
      const now = new Date("2026-11-21T04:30:00");
      const result = isWithinDaylightWindow("05:30", "18:30", now);
      expect(result).toBe(false);
    });

    it("retorna false quando é à noite após o pôr do sol (ex: 21:00)", () => {
      const now = new Date("2026-11-21T21:00:00");
      const result = isWithinDaylightWindow("05:30", "18:30", now);
      expect(result).toBe(false);
    });

    it("interpreta timestamps ISO do Open-Meteo corretamente", () => {
      const nowMidday = new Date("2026-11-21T14:15:00");
      const nowNight = new Date("2026-11-21T22:30:00");
      const sunriseIso = "2026-11-21T05:20";
      const sunsetIso = "2026-11-21T18:45";

      expect(isWithinDaylightWindow(sunriseIso, sunsetIso, nowMidday)).toBe(true);
      expect(isWithinDaylightWindow(sunriseIso, sunsetIso, nowNight)).toBe(false);
    });

    it("aplica fallback padrão (06:00 às 18:00) quando sunrise ou sunset forem nulos", () => {
      const nowMidday = new Date("2026-11-21T11:00:00");
      const nowNight = new Date("2026-11-21T23:00:00");

      expect(isWithinDaylightWindow(null, null, nowMidday)).toBe(true);
      expect(isWithinDaylightWindow(null, null, nowNight)).toBe(false);
    });
  });

  describe("Validação de Schema (settingsPostBodySchema)", () => {
    it("aceita isDaylightOnlyActive como booleano", () => {
      const resultTrue = settingsPostBodySchema.safeParse({ isDaylightOnlyActive: true });
      expect(resultTrue.success).toBe(true);

      const resultFalse = settingsPostBodySchema.safeParse({ isDaylightOnlyActive: false });
      expect(resultFalse.success).toBe(true);
    });

    it("rejeita isDaylightOnlyActive quando não for booleano", () => {
      const result = settingsPostBodySchema.safeParse({ isDaylightOnlyActive: "sim" });
      expect(result.success).toBe(false);
    });
  });

  describe("OpenMeteoSolarForecastService - Sunrise, Sunset e Daylight", () => {
    it("inclui sunrise, sunset e isDaylight no retorno de getForecast", async () => {
      const service = OpenMeteoSolarForecastService.getInstance();
      service.clearCacheForTests();

      const mockResponse = {
        daily: {
          shortwave_radiation_sum: [19.5],
          sunshine_duration: [36000],
          weathercode: [0],
          time: ["2026-11-21"],
          sunrise: ["2026-11-21T05:15"],
          sunset: ["2026-11-21T18:40"],
        },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.getForecast(-23.55, -46.63);

      expect(result.sunrise).toBe("2026-11-21T05:15");
      expect(result.sunset).toBe("2026-11-21T18:40");
      expect(typeof result.isDaylight).toBe("boolean");
    });

    it("aplica fallback gracioso quando a chamada HTTP falhar", async () => {
      const service = OpenMeteoSolarForecastService.getInstance();
      service.clearCacheForTests();

      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network Error"));

      const result = await service.getForecast(-23.55, -46.63);

      expect(result.sunrise).toBe("06:00");
      expect(result.sunset).toBe("18:00");
      expect(typeof result.isDaylight).toBe("boolean");
    });
  });

  describe("OrchestratorSyncUseCase - Comportamento de Suspensão Noturna", () => {
    it("suspende a sincronização e telemetria à noite quando isDaylightOnlyActive está ativo", async () => {
      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn(),
        findAllActiveConfigurations: vi.fn(),
        findActiveConfiguration: vi.fn(),
      };

      const record = buildMockRecord("rec-night", {
        isDaylightOnlyActive: true,
        latitude: -23.55,
        longitude: -46.63,
        lastBatteryPercentage: 72,
      });

      mockRepo.findActiveConfigurationByUserId.mockResolvedValue(record);

      const solarService = OpenMeteoSolarForecastService.getInstance();
      vi.spyOn(solarService, "getForecast").mockResolvedValue({
        irradianceMj: 15,
        sunshineDurationSeconds: 28000,
        weatherCode: 1,
        expectationLevel: "SOLAR_GOOD",
        effectiveTurnOffThreshold: 25,
        forecastDate: "2026-11-21",
        isCached: false,
        fetchedAt: new Date(),
        forecastSummary: "Boa radiação",
        peakSunHours: 4.2,
        irradianceKwhM2: 4.2,
        estimatedDailyGenerationKwh: 3.5,
        sunrise: "05:30",
        sunset: "18:30",
        isDaylight: false, // Simula período noturno
      });

      // Simula horário noturno (22:00)
      vi.setSystemTime(new Date("2026-11-21T22:00:00"));

      const useCase = new OrchestratorSyncUseCase(mockRepo as any, "https://api.ecoflow.com");
      const result = await useCase.executeSyncForUser("user-daylight-test");

      expect(result.hasExecutedSuccessfully).toBe(true);
      expect(result.triggeredAction).toBe("NONE");
      expect(result.actionTaken).toBe("NONE");
      expect(result.isDaylightStandby).toBe(true);
      expect(result.detailMessage).toContain("Modo Noturno (Standby)");
      expect(result.batteryPercentage).toBe(72);

      // Garante que nenhuma chamada foi feita à EcoFlow
      expect(mockFetchDeviceTelemetry).not.toHaveBeenCalled();
      expect(mockSetAcOutputState).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("executa a sincronização normalmente durante o dia quando isDaylightOnlyActive está ativo", async () => {
      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn(),
        findAllActiveConfigurations: vi.fn(),
        findActiveConfiguration: vi.fn(),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        updateBatteryState: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(undefined),
        updateCurrentAcChargingWatts: vi.fn().mockResolvedValue(undefined),
      };

      const record = buildMockRecord("rec-day", {
        isDaylightOnlyActive: true,
        latitude: -23.55,
        longitude: -46.63,
        lastBatteryPercentage: 75,
      });

      mockRepo.findActiveConfigurationByUserId.mockResolvedValue(record);

      const solarService = OpenMeteoSolarForecastService.getInstance();
      vi.spyOn(solarService, "getForecast").mockResolvedValue({
        irradianceMj: 20,
        sunshineDurationSeconds: 36000,
        weatherCode: 0,
        expectationLevel: "SOLAR_EXCELLENT",
        effectiveTurnOffThreshold: 20,
        forecastDate: "2026-11-21",
        isCached: false,
        fetchedAt: new Date(),
        forecastSummary: "Sol pleno",
        peakSunHours: 5.5,
        irradianceKwhM2: 5.5,
        estimatedDailyGenerationKwh: 4.8,
        sunrise: "05:30",
        sunset: "18:30",
        isDaylight: true,
      });

      // Simula horário diurno (12:00)
      vi.setSystemTime(new Date("2026-11-21T12:00:00"));

      const useCase = new OrchestratorSyncUseCase(mockRepo as any, "https://api.ecoflow.com");
      const result = await useCase.executeSyncForUser("user-daylight-day");

      expect(result.hasExecutedSuccessfully).toBe(true);
      expect(result.isDaylightStandby).toBeFalsy();
      expect(mockFetchDeviceTelemetry).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("executa a sincronização normalmente à noite se isDaylightOnlyActive estiver desativado", async () => {
      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn(),
        findAllActiveConfigurations: vi.fn(),
        findActiveConfiguration: vi.fn(),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        updateBatteryState: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(undefined),
        updateCurrentAcChargingWatts: vi.fn().mockResolvedValue(undefined),
      };

      const record = buildMockRecord("rec-inactive", {
        isDaylightOnlyActive: false,
        latitude: -23.55,
        longitude: -46.63,
      });

      mockRepo.findActiveConfigurationByUserId.mockResolvedValue(record);

      // Simula horário noturno (23:00)
      vi.setSystemTime(new Date("2026-11-21T23:00:00"));

      const useCase = new OrchestratorSyncUseCase(mockRepo as any, "https://api.ecoflow.com");
      const result = await useCase.executeSyncForUser("user-inactive");

      expect(result.hasExecutedSuccessfully).toBe(true);
      expect(result.isDaylightStandby).toBeFalsy();
      expect(mockFetchDeviceTelemetry).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("EcoFlowMqttStreamService - Daylight Only Night Log Pause", () => {
    afterEach(() => {
      vi.useRealTimers();
      EcoFlowMqttStreamService.getInstance().stopStream();
    });

    it("isDaylightNow identifica corretamente noite e suspende logs quando isDaylightOnlyActive = true", () => {
      const service = EcoFlowMqttStreamService.getInstance();
      const mockUserState = {
        client: null,
        latestTelemetry: null,
        subscribedTopic: null,
        lastPersistTimeMs: 0,
        lastPersistedAcState: null,
        isConnecting: false,
        lastEvaluatedSoc: null,
        lastEvaluatedAcState: null,
        lastEvaluationTimeMs: 0,
        isEvaluatingAutomation: false,
        isDaylightOnlyActive: true,
        latitude: -23.55,
        longitude: -46.63,
        sunrise: "06:00",
        sunset: "18:00",
        lastSolarCheckTimeMs: 0,
      };

      // À noite (22:00)
      vi.setSystemTime(new Date("2026-11-21T22:00:00"));
      expect(service.isDaylightNow(mockUserState as any)).toBe(false);

      // De dia (12:00)
      vi.setSystemTime(new Date("2026-11-21T12:00:00"));
      expect(service.isDaylightNow(mockUserState as any)).toBe(true);

      // À noite mas com isDaylightOnlyActive = false (deve liberar logs normalmente)
      mockUserState.isDaylightOnlyActive = false;
      vi.setSystemTime(new Date("2026-11-21T22:00:00"));
      expect(service.isDaylightNow(mockUserState as any)).toBe(true);
    });

    it("updateDaylightConfig atualiza dinamicamente as flags no userState", () => {
      const service = EcoFlowMqttStreamService.getInstance();
      const userId = "user-dyn-daylight";

      // Cria o estado interno chamando updateDaylightConfig
      service.updateDaylightConfig(userId, true, -23.55, -46.63, "05:45", "18:45");

      // Simula horário noturno (20:00)
      vi.setSystemTime(new Date("2026-11-21T20:00:00"));
      const userState = (service as any).streamsByUser?.get(userId);
      expect(userState).toBeDefined();
      expect(service.isDaylightNow(userState)).toBe(false);

      // Desliga dinamicamente
      service.updateDaylightConfig(userId, false);
      expect(service.isDaylightNow(userState)).toBe(true);
    });
  });
});
