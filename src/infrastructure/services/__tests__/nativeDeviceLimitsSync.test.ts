import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchDeviceTelemetry,
  mockSetAcOutputState,
  mockSetAcChargingSpeed,
  mockEvaluateWeatherRisk,
  mockGetForecast,
  mockEvaluateTariffPeriod,
} = vi.hoisted(() => ({
  mockFetchDeviceTelemetry: vi.fn(),
  mockSetAcOutputState: vi.fn(),
  mockSetAcChargingSpeed: vi.fn(),
  mockEvaluateWeatherRisk: vi.fn(),
  mockGetForecast: vi.fn(),
  mockEvaluateTariffPeriod: vi.fn(),
}));

vi.mock("../../http/EcoFlowHttpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http/EcoFlowHttpClient")>();
  return {
    ...actual,
    EcoFlowHttpClient: vi.fn(function (creds, url) {
      const real = new actual.EcoFlowHttpClient(creds, url);
      return Object.assign(real, {
        fetchDeviceTelemetry: mockFetchDeviceTelemetry,
        setAcOutputState: mockSetAcOutputState,
        setAcChargingSpeed: mockSetAcChargingSpeed,
      });
    }),
  };
});

vi.mock("../OpenMeteoSolarForecastService", () => {
  const instance = {
    evaluateWeatherRisk: mockEvaluateWeatherRisk,
    getForecast: mockGetForecast,
  };
  return {
    OpenMeteoSolarForecastService: {
      getInstance: () => instance,
    },
    SolarExpectationLevel: {
      EXCELLENT: "EXCELLENT",
      GOOD: "GOOD",
      MODERATE: "MODERATE",
      LOW: "LOW",
      POOR: "POOR",
    },
  };
});

vi.mock("../../../domain/services/TariffScheduleService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../domain/services/TariffScheduleService")>();
  const realInstance = actual.TariffScheduleService.getInstance();
  return {
    ...actual,
    TariffScheduleService: {
      getInstance: () =>
        Object.assign(realInstance, {
          evaluateTariffPeriod: mockEvaluateTariffPeriod,
        }),
    },
  };
});

import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { DeviceSerialNumber } from "../../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
import { AutomationThresholdPair } from "../../../domain/models/AutomationThresholdPair";
import { PercentageValue } from "../../../domain/values/PercentageValue";
import { AutomationProfile } from "../../../domain/models/AutomationProfile";
import { DevicePair } from "../../../domain/models/DevicePair";
import { CredentialsBundle } from "../../../domain/models/CredentialsBundle";
import { OrchestratorConfiguration } from "../../../domain/models/OrchestratorConfiguration";
import { EcoFlowMqttStreamService } from "../EcoFlowMqttStreamService";
import { EcoFlowHttpClient } from "../../http/EcoFlowHttpClient";

function buildMockRecord(recordId: string, overrides: Record<string, unknown> = {}) {
  const credentials = new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("as-test"));
  const bundle = new CredentialsBundle(credentials);
  const serial = new DeviceSerialNumber("SN-LIMITS-TEST");
  const devices = new DevicePair(serial);
  const thresholds = new AutomationThresholdPair(
    new PercentageValue((overrides.turnOnThreshold as number) ?? 85),
    new PercentageValue((overrides.turnOffThreshold as number) ?? 35)
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
    lastBatteryTempCelsius: 30,
    lastBatterySoh: 100,
    lastBatteryCycles: 50,
    isThermalProtectionActive: false,
    isAutoStormActive: false,
    isStormModeActive: false,
    isSmartChargingActive: false,
    isAdaptiveHysteresisActive: false,
    minAdaptiveThreshold: 20,
    maxAdaptiveThreshold: 50,
    latitude: -23.5505,
    longitude: -46.6333,
    peakReserveThreshold: 20,
    peakDischargeReserveLimit: 20,
    ...overrides,
  };
}

describe("Native Device Limits Sync (EcoFlow Max/Min SoC)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    OrchestratorSyncUseCase.resetLoggedStatesForTests();
    OrchestratorSyncUseCase.resetActiveUserSyncsForTests();
    mockSetAcOutputState.mockResolvedValue("SUCCESS");
    mockSetAcChargingSpeed.mockResolvedValue(true);
    mockEvaluateTariffPeriod.mockReturnValue({
      isTimeOfUseActive: false,
      currentPeriod: "OFF_PEAK",
      currentRate: 0.65,
      currencySymbol: "R$",
    });
    mockEvaluateWeatherRisk.mockResolvedValue({
      isStormRisk: false,
      weatherCode: 0,
      weatherDescription: "Céu limpo",
      windSpeedMaxKmh: 10,
      precipitationSumMm: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("EcoFlowMqttStreamService SoC Limits Extraction", () => {
    let service: EcoFlowMqttStreamService;

    beforeEach(() => {
      service = EcoFlowMqttStreamService.getInstance();
    });

    it("should extract maxChargeSoc and minDsgSoc from flat dotted keys", () => {
      const flatPayload = {
        "bms_emsStatus.maxChargeSoc": 80,
        "bms_emsStatus.minDsgSoc": 15,
      };

      const maxSoc = service.extractMaxChargeSoc(flatPayload);
      const minSoc = service.extractMinDsgSoc(flatPayload);

      expect(maxSoc).toBe(80);
      expect(minSoc).toBe(15);
    });

    it("should extract maxChargeSoc and minDsgSoc from alternate flat keys (pd & ems)", () => {
      const pdPayload = {
        "pd.maxChgSoc": 85,
        "pd.minDsgSoc": 10,
      };

      const maxSoc = service.extractMaxChargeSoc(pdPayload);
      const minSoc = service.extractMinDsgSoc(pdPayload);

      expect(maxSoc).toBe(85);
      expect(minSoc).toBe(10);
    });

    it("should extract maxChargeSoc and minDsgSoc from nested structures", () => {
      const nestedPayload = {
        bmsMaster: {
          maxChargeSoc: 90,
          minDsgSoc: 20,
        },
      };

      const maxSoc = service.extractMaxChargeSoc(nestedPayload);
      const minSoc = service.extractMinDsgSoc(nestedPayload);

      expect(maxSoc).toBe(90);
      expect(minSoc).toBe(20);
    });

    it("should return null when max/min SoC keys are absent", () => {
      const emptyPayload = {
        "mppt.inWatts": 250,
        "inv.outWatts": 120,
      };

      const maxSoc = service.extractMaxChargeSoc(emptyPayload);
      const minSoc = service.extractMinDsgSoc(emptyPayload);

      expect(maxSoc).toBeNull();
      expect(minSoc).toBeNull();
    });
  });

  describe("EcoFlowHttpClient SoC Limits Extraction", () => {
    it("should extract maxChargeSoc and minDsgSoc correctly from quota dictionary", () => {
      const client = new EcoFlowHttpClient(
        new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("as-test")),
        "https://api.ecoflow.com"
      );

      const quotaData = {
        "bms_emsStatus.maxChargeSoc": 80,
        "bms_emsStatus.minDsgSoc": 12,
        "mppt.inWatts": 320,
      };

      const maxSoc = (client as any).extractMaxChargeSocFromQuota(quotaData);
      const minSoc = (client as any).extractMinDsgSocFromQuota(quotaData);

      expect(maxSoc).toBe(80);
      expect(minSoc).toBe(12);
    });

    it("should extract from nested structures in quota", () => {
      const client = new EcoFlowHttpClient(
        new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("as-test")),
        "https://api.ecoflow.com"
      );

      const quotaData = {
        ems: {
          maxChargeSoc: 75,
          minDsgSoc: 8,
        },
      };

      const maxSoc = (client as any).extractMaxChargeSocFromQuota(quotaData);
      const minSoc = (client as any).extractMinDsgSocFromQuota(quotaData);

      expect(maxSoc).toBe(75);
      expect(minSoc).toBe(8);
    });
  });

  describe("OrchestratorSyncUseCase Limits Integration", () => {
    it("should clamp turnOnThreshold to deviceMaxChargeSoc (80%) when configured threshold is 90%", async () => {
      const record = buildMockRecord("rec-limits-1", {
        turnOnThreshold: 90, // Configurado em 90%, mas app EcoFlow está limitado em 80%
        turnOffThreshold: 20,
        isAutomationActive: true,
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(1),
        updateStormAlertStatus: vi.fn().mockResolvedValue(undefined),
      };

      const useCase = new OrchestratorSyncUseCase(mockRepo as any);

      // Bateria atingiu 80% (teto do app EcoFlow), AC desligado
      const result = await useCase.executeSyncForUser("user-limits-1", {
        batteryPercentage: 80,
        solarWatts: 200,
        outputWatts: 0,
        isAcOutputEnabled: false,
        deviceMaxChargeSoc: 80,
        deviceMinDsgSoc: 10,
      });

      expect(result.hasExecutedSuccessfully).toBe(true);
      expect(result.triggeredAction).toBe("ENABLE_ECOFLOW_AC");
      expect(mockSetAcOutputState).toHaveBeenCalled();
    });

    it("should clamp autoStorm reserve threshold to deviceMaxChargeSoc", async () => {
      mockEvaluateWeatherRisk.mockResolvedValue({
        isStormRisk: true,
        weatherCode: 95,
        weatherDescription: "Tempestade com trovoadas",
        windSpeedMaxKmh: 70,
        precipitationSumMm: 50,
      });

      const record = buildMockRecord("rec-storm-clamp", {
        turnOnThreshold: 85,
        turnOffThreshold: 30,
        isAutomationActive: true,
        isAutoStormActive: true,
        autoStormPrechargeAc: true,
        autoStormReserveThreshold: 90, // Quer 90%, mas o app EcoFlow limita em 80%
        isSmartChargingActive: true,
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(1),
        updateStormAlertStatus: vi.fn().mockResolvedValue(undefined),
      };

      const useCase = new OrchestratorSyncUseCase(mockRepo as any);

      // Bateria em 80% (já atingiu o limite do hardware de 80%)
      const result = await useCase.executeSyncForUser("user-storm-clamp", {
        batteryPercentage: 80,
        solarWatts: 0,
        outputWatts: 150,
        isAcOutputEnabled: true,
        deviceMaxChargeSoc: 80,
        deviceMinDsgSoc: 10,
      });

      expect(result.hasExecutedSuccessfully).toBe(true);
      // Não deve tentar pré-carregar acima do teto físico do dispositivo (80%)
      expect(mockSetAcChargingSpeed).not.toHaveBeenCalled();
    });

    it("should not call setAcChargingSpeed when isSmartChargingActive is false", async () => {
      const record = buildMockRecord("rec-no-smart-chg", {
        turnOnThreshold: 80,
        turnOffThreshold: 20,
        isAutomationActive: true,
        isSmartChargingActive: false, // Smart charging desativado
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(1),
        updateStormAlertStatus: vi.fn().mockResolvedValue(undefined),
      };

      const useCase = new OrchestratorSyncUseCase(mockRepo as any);

      const result = await useCase.executeSyncForUser("user-no-smart-chg", {
        batteryPercentage: 50,
        solarWatts: 100,
        outputWatts: 150,
        isAcOutputEnabled: true,
        deviceMaxChargeSoc: 80,
        deviceMinDsgSoc: 10,
      });

      expect(result.hasExecutedSuccessfully).toBe(true);
      expect(mockSetAcChargingSpeed).not.toHaveBeenCalled();
    });
  });
});
