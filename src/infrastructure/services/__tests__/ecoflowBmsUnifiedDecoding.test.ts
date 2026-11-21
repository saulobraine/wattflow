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
  const serial = new DeviceSerialNumber("SN-BMS-TEST");
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
    lastBatteryTempCelsius: null,
    lastBatterySoh: null,
    lastBatteryCycles: null,
    isThermalProtectionActive: true,
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

describe("Unified EcoFlow BMS & Battery Health Decoding (River 2 vs Delta)", () => {
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

  describe("EcoFlowMqttStreamService - River 2 Series BMS Decoding (bms_bmsStatus.*)", () => {
    let service: EcoFlowMqttStreamService;

    beforeEach(() => {
      service = EcoFlowMqttStreamService.getInstance();
    });

    it("should extract flat dotted River 2 BMS telemetry (bms_bmsStatus.*)", () => {
      const river2Flat = {
        "bms_bmsStatus.temp": 29,
        "bms_bmsStatus.soh": 98,
        "bms_bmsStatus.cycles": 45,
        "bms_bmsStatus.vol": 25600, // 25.6V in mV
        "bms_bmsStatus.amp": 4800,  // 4.8A in mA
      };

      const temp = service.extractBatteryTemp(river2Flat);
      const soh = service.extractBatterySoh(river2Flat);
      const cycles = service.extractBatteryCycles(river2Flat);
      const volts = service.extractBatteryVolts(river2Flat);
      const amps = service.extractBatteryAmps(river2Flat);

      expect(temp).toBe(29);
      expect(soh).toBe(98);
      expect(cycles).toBe(45);
      expect(volts).toBe(25.6);
      expect(amps).toBe(4.8);
    });

    it("should extract nested River 2 BMS telemetry object ({ bms_bmsStatus: { ... } })", () => {
      const river2Nested = {
        bms_bmsStatus: {
          temp: 275, // Raw 275 -> 27.5°C
          soh: 100,
          cycles: 12,
          vol: 26400, // 26.4V
          amp: -3200, // -3.2A
        },
      };

      const temp = service.extractBatteryTemp(river2Nested);
      const soh = service.extractBatterySoh(river2Nested);
      const cycles = service.extractBatteryCycles(river2Nested);
      const volts = service.extractBatteryVolts(river2Nested);
      const amps = service.extractBatteryAmps(river2Nested);

      expect(temp).toBe(27.5);
      expect(soh).toBe(100);
      expect(cycles).toBe(12);
      expect(volts).toBe(26.4);
      expect(amps).toBe(-3.2);
    });

    it("should handle River 2 cellTemp and maxCellTemp variants", () => {
      const river2CellTemp = {
        "bms_bmsStatus.maxCellTemp": 31,
      };

      const temp = service.extractBatteryTemp(river2CellTemp);
      expect(temp).toBe(31);
    });
  });

  describe("EcoFlowMqttStreamService - Delta Series BMS Decoding (bmsMaster.*)", () => {
    let service: EcoFlowMqttStreamService;

    beforeEach(() => {
      service = EcoFlowMqttStreamService.getInstance();
    });

    it("should extract flat dotted Delta BMS telemetry (bmsMaster.*)", () => {
      const deltaFlat = {
        "bmsMaster.temp": 32,
        "bmsMaster.soh": 94,
        "bmsMaster.cycles": 115,
        "bmsMaster.vol": 51200, // 51.2V in mV
        "bmsMaster.amp": 12500, // 12.5A in mA
      };

      const temp = service.extractBatteryTemp(deltaFlat);
      const soh = service.extractBatterySoh(deltaFlat);
      const cycles = service.extractBatteryCycles(deltaFlat);
      const volts = service.extractBatteryVolts(deltaFlat);
      const amps = service.extractBatteryAmps(deltaFlat);

      expect(temp).toBe(32);
      expect(soh).toBe(94);
      expect(cycles).toBe(115);
      expect(volts).toBe(51.2);
      expect(amps).toBe(12.5);
    });

    it("should extract nested Delta BMS telemetry object ({ bmsMaster: { ... } })", () => {
      const deltaNested = {
        bmsMaster: {
          temp: 340, // 34.0°C
          soh: 91,
          cycles: 230,
          vol: 50800,
          amp: -8500,
        },
      };

      const temp = service.extractBatteryTemp(deltaNested);
      const soh = service.extractBatterySoh(deltaNested);
      const cycles = service.extractBatteryCycles(deltaNested);
      const volts = service.extractBatteryVolts(deltaNested);
      const amps = service.extractBatteryAmps(deltaNested);

      expect(temp).toBe(34.0);
      expect(soh).toBe(91);
      expect(cycles).toBe(230);
      expect(volts).toBe(50.8);
      expect(amps).toBe(-8.5);
    });
  });

  describe("EcoFlowMqttStreamService - Decoupled BMS Persistence in persistTelemetryThrottled", () => {
    it("should persist SOH and cycles to userConfiguration even when temperature is null", async () => {
      const service = EcoFlowMqttStreamService.getInstance();
      const mockDatabaseClient = {
        syncExecutionLog: {
          create: vi.fn().mockReturnValue({
            catch: vi.fn(),
          }),
        },
        userConfiguration: {
          update: vi.fn().mockReturnValue({
            catch: vi.fn(),
          }),
        },
      };

      const userState = {
        userId: "user-decoupled-bms",
        lastPersistTimeMs: 0,
        lastPersistedAcState: null,
        lastEvaluatedSoc: 80,
        latestTelemetry: {
          batteryPercentage: 80,
          solarInputWatts: 200,
          outputWatts: 150,
          isAcOutputEnabled: true,
          batteryTempCelsius: null, // Temperature is null
          batterySoh: 97,           // SOH is present
          batteryCycles: 55,        // Cycles is present
          batteryVolts: 26.1,
          batteryAmps: 5.0,
          timestamp: Date.now(),
        },
      };

      (service as any).persistTelemetryThrottled(userState as any, mockDatabaseClient as any, "cfg-1");

      expect(mockDatabaseClient.userConfiguration.update).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
        data: {
          lastBatterySoh: 97,
          lastBatteryCycles: 55,
        },
      });
    });
  });

  describe("EcoFlowHttpClient - BMS Quota Extraction & Telemetry Assembly", () => {
    let client: EcoFlowHttpClient;

    beforeEach(() => {
      client = new EcoFlowHttpClient(
        new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("as-test")),
        "https://api.ecoflow.com"
      );
    });

    it("should extract River 2 BMS fields from quota dictionary", () => {
      const river2Quota = {
        "bms_bmsStatus.temp": 28,
        "bms_bmsStatus.soh": 99,
        "bms_bmsStatus.cycles": 30,
        "bms_bmsStatus.vol": 25800,
        "bms_bmsStatus.amp": 3500,
      };

      const temp = client.extractBatteryTempFromQuota(river2Quota);
      const soh = client.extractBatterySohFromQuota(river2Quota);
      const cycles = client.extractBatteryCyclesFromQuota(river2Quota);
      const volts = client.extractBatteryVoltsFromQuota(river2Quota);
      const amps = client.extractBatteryAmpsFromQuota(river2Quota);

      expect(temp).toBe(28);
      expect(soh).toBe(99);
      expect(cycles).toBe(30);
      expect(volts).toBe(25.8);
      expect(amps).toBe(3.5);
    });

    it("should extract Delta BMS fields from quota dictionary", () => {
      const deltaQuota = {
        "bmsMaster.temp": 33,
        "bmsMaster.soh": 92,
        "bmsMaster.cycles": 180,
        "bmsMaster.vol": 52000,
        "bmsMaster.amp": 9000,
      };

      const temp = client.extractBatteryTempFromQuota(deltaQuota);
      const soh = client.extractBatterySohFromQuota(deltaQuota);
      const cycles = client.extractBatteryCyclesFromQuota(deltaQuota);
      const volts = client.extractBatteryVoltsFromQuota(deltaQuota);
      const amps = client.extractBatteryAmpsFromQuota(deltaQuota);

      expect(temp).toBe(33);
      expect(soh).toBe(92);
      expect(cycles).toBe(180);
      expect(volts).toBe(52);
      expect(amps).toBe(9);
    });

    it("should assemble full EcoFlowTelemetryResult including BMS metrics", () => {
      const fullQuota = {
        "bms_bmsStatus.soc": 85,
        "mppt.inWatts": 320,
        "inv.outWatts": 180,
        "inv.cfgAcEnabled": 1,
        "bms_bmsStatus.temp": 28,
        "bms_bmsStatus.soh": 98,
        "bms_bmsStatus.cycles": 40,
        "bms_bmsStatus.vol": 25600,
        "bms_bmsStatus.amp": 4500,
      };

      const assembled = (client as any).assembleTelemetryResult(fullQuota);

      let assembledBattery = 0;
      assembled.batteryLevel.transferBatteryPercentage((p: number) => {
        assembledBattery = p;
      });

      let assembledSolar = 0;
      assembled.solarWatts.transferNumericWatts((w: number) => {
        assembledSolar = w;
      });

      expect(assembledBattery).toBe(85);
      expect(assembledSolar).toBe(320);
      expect(assembled.outputWatts).toBe(180);
      expect(assembled.isAcOutputEnabled).toBe(true);
      expect(assembled.batteryTempCelsius).toBe(28);
      expect(assembled.batterySoh).toBe(98);
      expect(assembled.batteryCycles).toBe(40);
      expect(assembled.batteryVoltageVolts).toBe(25.6);
      expect(assembled.batteryAmperageAmps).toBe(4.5);
    });
  });

  describe("OrchestratorSyncUseCase - HTTP Fallback BMS Propagation", () => {
    it("should propagate BMS telemetry returned by fetchDeviceTelemetry to repository and logs", async () => {
      const { BatteryLevel } = await import("../../../domain/values/BatteryLevel");
      const { SolarGenerationWatts } = await import("../../../domain/values/SolarGenerationWatts");

      mockFetchDeviceTelemetry.mockResolvedValue({
        batteryLevel: new BatteryLevel(78),
        solarWatts: new SolarGenerationWatts(180),
        outputWatts: 140,
        isAcOutputEnabled: true,
        deviceMaxChargeSoc: 85,
        deviceMinDsgSoc: 10,
        batteryTempCelsius: 29.5,
        batterySoh: 96,
        batteryCycles: 60,
        batteryVoltageVolts: 26.0,
        batteryAmperageAmps: 4.2,
      });

      const record = buildMockRecord("rec-http-bms", {
        turnOnThreshold: 80,
        turnOffThreshold: 20,
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(1),
        updateStormAlertStatus: vi.fn().mockResolvedValue(undefined),
        updateBmsTelemetry: vi.fn().mockResolvedValue(undefined),
      };

      const useCase = new OrchestratorSyncUseCase(mockRepo as any);

      // Chamada sem providedTelemetry (forçando fallback HTTP / cron)
      const result = await useCase.executeSyncForUser("user-http-bms");

      expect(result.hasExecutedSuccessfully).toBe(true);
      expect(mockFetchDeviceTelemetry).toHaveBeenCalled();

      // Confirma que recordExecutionLog recebeu os dados BMS propagados
      expect(mockRepo.recordExecutionLog).toHaveBeenCalledWith(
        "rec-http-bms",
        78,
        expect.any(String),
        expect.any(String),
        180,
        140,
        29.5,
        96,
        60
      );

      // Confirma que updateBmsTelemetry foi acionado para atualizar a configuração
      expect(mockRepo.updateBmsTelemetry).toHaveBeenCalledWith(
        "rec-http-bms",
        {
          tempCelsius: 29.5,
          soh: 96,
          cycles: 60,
        }
      );
    });
  });
});
