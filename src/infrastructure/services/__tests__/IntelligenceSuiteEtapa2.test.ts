import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenMeteoSolarForecastService,
  SolarExpectationLevel,
} from "../OpenMeteoSolarForecastService";
import { EcoFlowMqttStreamService } from "../EcoFlowMqttStreamService";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
import {
  ConfigurationRepository,
  RetrievedConfigurationRecord,
} from "../../repositories/ConfigurationRepository";
import { PrismaClient } from "@prisma/client";
import { settingsPostBodySchema } from "../../security/apiSchemas";
import { DeviceSerialNumber } from "../../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { CredentialsBundle } from "../../../domain/models/CredentialsBundle";
import { DevicePair } from "../../../domain/models/DevicePair";
import { PercentageValue } from "../../../domain/values/PercentageValue";
import { AutomationThresholdPair } from "../../../domain/models/AutomationThresholdPair";
import { AutomationProfile } from "../../../domain/models/AutomationProfile";
import { OrchestratorConfiguration } from "../../../domain/models/OrchestratorConfiguration";

const mockSetAcOutputState = vi.fn().mockResolvedValue("SUCCESS");
const mockFetchDeviceTelemetry = vi.fn().mockResolvedValue({
  batteryLevel: {
    transferBatteryPercentage: (fn: (v: number) => void) => fn(40),
  },
  solarWatts: {
    transferNumericWatts: (fn: (v: number) => void) => fn(100),
  },
  isAcOutputEnabled: true,
  outputWatts: 150,
});

vi.mock("../../http/EcoFlowHttpClient", () => {
  return {
    EcoFlowHttpClient: vi.fn().mockImplementation(function () {
      return {
        setAcOutputState: mockSetAcOutputState,
        fetchDeviceTelemetry: mockFetchDeviceTelemetry,
        fetchMqttCertification: vi.fn().mockResolvedValue({
          protocol: "mqtts",
          brokerHost: "mqtt.ecoflow.com",
          brokerPort: 8883,
          certificateAccount: "test-cert",
        }),
      };
    }),
  };
});

function buildMockEtapa2Record(
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
    notificationConfig: {
      telegramBotToken: "mock-token",
      telegramChatId: "123456",
      whatsappPhoneNumber: "5511999999999",
      whatsappApiKey: "test-key",
      isNotificationActive: true,
    },
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
    latitude: -23.5505,
    longitude: -46.6333,
    isAdaptiveHysteresisActive: true,
    minAdaptiveThreshold: 20,
    maxAdaptiveThreshold: 50,
    lastSolarIrradianceMj: 21.4,
    lastSolarForecastCheckAt: new Date(),
    thermalWarningThreshold: 45.0,
    thermalShutdownThreshold: 50.0,
    lastBatteryTempCelsius: 32.0,
    lastBatterySoh: 99,
    lastBatteryCycles: 84,
    maxRecordedBatteryTemp: 38.0,
    // Etapa 3:
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
    ...overrides,
  };
}

describe("Suíte de Inteligência Operacional - Etapa 2 (Backend)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    OrchestratorSyncUseCase.resetLoggedStatesForTests();
    OpenMeteoSolarForecastService.getInstance().clearCacheForTests();
  });

  describe("Feature 3.1: OpenMeteoSolarForecastService & Histerese Adaptativa", () => {
    it("classifica corretamente os níveis de radiação solar em MJ/m²", () => {
      const service = OpenMeteoSolarForecastService.getInstance();

      expect(service.calculateExpectationLevel(22.5)).toBe("SOLAR_EXCELLENT");
      expect(service.calculateExpectationLevel(18.1)).toBe("SOLAR_EXCELLENT");
      expect(service.calculateExpectationLevel(18.0)).toBe("SOLAR_GOOD");
      expect(service.calculateExpectationLevel(15.0)).toBe("SOLAR_GOOD");
      expect(service.calculateExpectationLevel(12.0)).toBe("SOLAR_GOOD");
      expect(service.calculateExpectationLevel(11.9)).toBe("SOLAR_MODERATE");
      expect(service.calculateExpectationLevel(8.0)).toBe("SOLAR_MODERATE");
      expect(service.calculateExpectationLevel(7.9)).toBe("SOLAR_POOR");
      expect(service.calculateExpectationLevel(2.0)).toBe("SOLAR_POOR");
    });

    it("calcula o limiar adaptativo de corte dinâmico conforme a expectativa solar", () => {
      const service = OpenMeteoSolarForecastService.getInstance();
      const min = 20;
      const max = 50;

      expect(service.calculateAdaptiveThreshold("SOLAR_EXCELLENT", min, max)).toBe(20);
      expect(service.calculateAdaptiveThreshold("SOLAR_GOOD", min, max)).toBe(30);
      expect(service.calculateAdaptiveThreshold("SOLAR_MODERATE", min, max)).toBe(40);
      expect(service.calculateAdaptiveThreshold("SOLAR_POOR", min, max)).toBe(50);
    });

    it("gera o sumário explicativo contextualizado com percentuais e valores", () => {
      const service = OpenMeteoSolarForecastService.getInstance();

      const summary1 = service.buildForecastSummary("SOLAR_EXCELLENT", 21.4, 20);
      expect(summary1).toContain("Sol pleno");
      expect(summary1).toContain("21.4 MJ/m²");
      expect(summary1).toContain("20%");

      const summary2 = service.buildForecastSummary("SOLAR_POOR", 5.2, 50);
      expect(summary2).toContain("nublado");
      expect(summary2).toContain("5.2 MJ/m²");
      expect(summary2).toContain("50%");
    });

    it("faz requisição à API Open-Meteo, analisa a resposta e armazena em cache por 2 horas", async () => {
      const service = OpenMeteoSolarForecastService.getInstance();

      const mockResponse = {
        daily: {
          time: ["2026-11-20"],
          shortwave_radiation_sum: [21.45],
          sunshine_duration: [36000],
          weathercode: [0],
        },
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const forecast1 = await service.getForecast(-23.55, -46.63, 20, 50);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(forecast1.irradianceMj).toBe(21.45);
      expect(forecast1.expectationLevel).toBe("SOLAR_EXCELLENT");
      expect(forecast1.effectiveTurnOffThreshold).toBe(20);
      expect(forecast1.isCached).toBe(false);

      // Segunda chamada imediata com mesmas coordenadas deve bater no cache em memória
      const forecast2 = await service.getForecast(-23.55, -46.63, 20, 50);
      expect(fetchSpy).toHaveBeenCalledTimes(1); // Continua 1!
      expect(forecast2.isCached).toBe(true);
      expect(forecast2.irradianceMj).toBe(21.45);

      fetchSpy.mockRestore();
    });

    it("aplica fallback gracioso seguro quando a API Open-Meteo falha ou está sem internet", async () => {
      const service = OpenMeteoSolarForecastService.getInstance();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network timeout"));

      const forecast = await service.getForecast(-23.55, -46.63, 20, 50);

      expect(forecast).toBeDefined();
      expect(forecast.expectationLevel).toBe("SOLAR_MODERATE");
      expect(forecast.effectiveTurnOffThreshold).toBe(35); // Ponto intermediário (20 + 30 * 0.5)
      expect(forecast.forecastSummary).toContain("indisponível temporariamente");

      fetchSpy.mockRestore();
    });
  });

  describe("Feature 4.1: EcoFlowMqttStreamService - Decodificação de Telemetria BMS", () => {
    it("decodifica temperatura bmsMaster.temp em deci-graus (320 -> 32.0°C) e em graus diretos", () => {
      const streamService = EcoFlowMqttStreamService.getInstance();

      // Caso 1: décimos de grau
      const temp1 = streamService.extractBatteryTemp({
        "bmsMaster.temp": 320,
      });
      expect(temp1).toBe(32.0);

      // Caso 2: objeto aninhado em deci-graus
      const temp2 = streamService.extractBatteryTemp({
        bmsMaster: { temp: 455 },
      });
      expect(temp2).toBe(45.5);

      // Caso 3: graus diretos
      const temp3 = streamService.extractBatteryTemp({
        "bmsMaster.temp": 36.5,
      });
      expect(temp3).toBe(36.5);
    });

    it("decodifica State of Health (SOH) e ciclos da bateria", () => {
      const streamService = EcoFlowMqttStreamService.getInstance();

      const soh = streamService.extractBatterySoh({
        "bmsMaster.soh": 99,
      });
      expect(soh).toBe(99);

      const cycles = streamService.extractBatteryCycles({
        "bmsMaster.cycles": 142,
      });
      expect(cycles).toBe(142);
    });

    it("decodifica tensão em Volts e corrente em Amperes (mV/mA para V/A)", () => {
      const streamService = EcoFlowMqttStreamService.getInstance();

      const volts = streamService.extractBatteryVolts({
        "bmsMaster.vol": 51400,
      });
      expect(volts).toBe(51.4);

      const amps = streamService.extractBatteryAmps({
        "bmsMaster.amp": 12500,
      });
      expect(amps).toBe(12.5);
    });
  });

  describe("Feature 4.1 & 3.1: Orquestrador - Proteção Térmica e Histerese Adaptativa", () => {
    it("aciona desarme de emergência THERMAL_PROTECTION_DISARM quando a bateria atinge thermalShutdownThreshold", async () => {
      const record = buildMockEtapa2Record("rec-thermal", {
        thermalWarningThreshold: 45.0,
        thermalShutdownThreshold: 50.0,
      });

      const mockRecordExecutionLog = vi.fn().mockResolvedValue(undefined);
      const mockIncrementAtsCycle = vi.fn().mockResolvedValue(121);
      const mockPrisma = {
        syncExecutionLog: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient;
      const repo = new ConfigurationRepository(mockPrisma);

      (repo as unknown as Record<string, unknown>).findActiveConfigurationByUserId =
        vi.fn().mockResolvedValue(record);
      (repo as unknown as Record<string, unknown>).recordExecutionLog = mockRecordExecutionLog;
      (repo as unknown as Record<string, unknown>).incrementAtsCycle = mockIncrementAtsCycle;
      (repo as unknown as Record<string, unknown>).findLatestExecutionLog = vi.fn().mockResolvedValue(null);

      const useCase = new OrchestratorSyncUseCase(repo);

      // Bateria com 80% (normalmente manteria ligado), mas temperatura em 52°C (crítica >= 50°C)
      const res = await useCase.executeSyncForUser("user-thermal", {
        batteryPercentage: 80,
        solarWatts: 200,
        outputWatts: 150,
        isAcOutputEnabled: true,
        batteryTempCelsius: 52.0,
        batterySoh: 98,
        batteryCycles: 85,
      });

      expect(res.hasExecutedSuccessfully).toBe(true);
      expect(res.triggeredAction).toBe("THERMAL_PROTECTION_DISARM");
      expect(res.detailMessage).toContain("Proteção térmica acionada");
      expect(res.detailMessage).toContain("52.0°C");

      // Deve ter comandado desligamento físico da saída AC
      expect(mockSetAcOutputState).toHaveBeenCalledWith(expect.any(DeviceSerialNumber), false);
      expect(mockIncrementAtsCycle).toHaveBeenCalledWith("rec-thermal");
      expect(mockRecordExecutionLog).toHaveBeenCalledWith(
        "rec-thermal",
        80,
        "THERMAL_PROTECTION_DISARM",
        expect.stringContaining("Proteção térmica"),
        200,
        150,
        52.0,
        98,
        85
      );
    });

    it("aciona corte adaptativo quando a histerese adaptativa estiver ativa e dia for ensolarado", async () => {
      const record = buildMockEtapa2Record("rec-adaptive", {
        isAdaptiveHysteresisActive: true,
        minAdaptiveThreshold: 20,
        maxAdaptiveThreshold: 50,
        latitude: -23.55,
        longitude: -46.63,
      });

      // Mock Open-Meteo retornando SOLAR_EXCELLENT (21 MJ/m² -> corte efetivo em 20%)
      const forecastService = OpenMeteoSolarForecastService.getInstance();
      vi.spyOn(forecastService, "getForecast").mockResolvedValueOnce({
        irradianceMj: 21.0,
        sunshineDurationSeconds: 36000,
        weatherCode: 0,
        expectationLevel: "SOLAR_EXCELLENT",
        effectiveTurnOffThreshold: 20,
        forecastDate: "2026-11-20",
        isCached: false,
        fetchedAt: new Date(),
        forecastSummary: "Sol pleno",
      });

      const mockRecordExecutionLog = vi.fn().mockResolvedValue(undefined);
      const mockPrisma = {
        syncExecutionLog: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient;
      const repo = new ConfigurationRepository(mockPrisma);

      (repo as unknown as Record<string, unknown>).findActiveConfigurationByUserId =
        vi.fn().mockResolvedValue(record);
      (repo as unknown as Record<string, unknown>).recordExecutionLog = mockRecordExecutionLog;
      (repo as unknown as Record<string, unknown>).updateSolarForecast = vi.fn().mockResolvedValue(undefined);
      (repo as unknown as Record<string, unknown>).findLatestExecutionLog = vi.fn().mockResolvedValue(null);

      const useCase = new OrchestratorSyncUseCase(repo);

      // Bateria em 25%: com a histerese padrão (corte em 30%), desligaria a AC.
      // Porém, com corte adaptativo em 20%, 25% está na faixa intermediária e deve manter a AC ligada!
      const res = await useCase.executeSyncForUser("user-adaptive", {
        batteryPercentage: 25,
        solarWatts: 0,
        outputWatts: 100,
        isAcOutputEnabled: true,
        batteryTempCelsius: 32.0,
      });

      expect(res.hasExecutedSuccessfully).toBe(true);
      expect(res.triggeredAction).toBe("HOLD_CURRENT_STATE");
      expect(res.detailMessage).toContain("faixa intermediária (histerese)");
      expect(mockSetAcOutputState).not.toHaveBeenCalled();
    });
  });

  describe("Validação Zod de Schemas (apiSchemas.ts)", () => {
    it("valida com sucesso parâmetros da Etapa 2 em settingsPostBodySchema", () => {
      const validPayload = {
        ecoflowAccessKey: "test-ak",
        ecoflowSerialNumber: "test-sn",
        latitude: -23.5505,
        longitude: -46.6333,
        isAdaptiveHysteresisActive: true,
        minAdaptiveThreshold: 20,
        maxAdaptiveThreshold: 50,
        thermalWarningThreshold: 45.0,
        thermalShutdownThreshold: 50.0,
      };

      const result = settingsPostBodySchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.latitude).toBe(-23.5505);
        expect(result.data.isAdaptiveHysteresisActive).toBe(true);
        expect(result.data.minAdaptiveThreshold).toBe(20);
        expect(result.data.thermalShutdownThreshold).toBe(50.0);
      }
    });

    it("rejeita coordenadas e limiares térmicos fora dos intervalos permitidos", () => {
      // Latitude > 90
      const invalidLat = settingsPostBodySchema.safeParse({
        ecoflowAccessKey: "test-ak",
        ecoflowSerialNumber: "test-sn",
        latitude: 95.0,
      });
      expect(invalidLat.success).toBe(false);

      // Limiar térmico de corte < 40°C
      const invalidShutdown = settingsPostBodySchema.safeParse({
        ecoflowAccessKey: "test-ak",
        ecoflowSerialNumber: "test-sn",
        thermalShutdownThreshold: 35.0,
      });
      expect(invalidShutdown.success).toBe(false);

      // Limiar mínimo adaptativo < 10%
      const invalidMinAdaptive = settingsPostBodySchema.safeParse({
        ecoflowAccessKey: "test-ak",
        ecoflowSerialNumber: "test-sn",
        minAdaptiveThreshold: 5,
      });
      expect(invalidMinAdaptive.success).toBe(false);
    });
  });
});
