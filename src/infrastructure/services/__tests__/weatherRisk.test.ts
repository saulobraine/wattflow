import { settingsPostBodySchema } from "../../security/apiSchemas";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenMeteoSolarForecastService,
  getWeatherDescriptionByCode,
} from "../OpenMeteoSolarForecastService";
import {
  OrchestratorSyncUseCase,
  ProvidedTelemetry,
} from "../../../application/OrchestratorSyncUseCase";
import {
  ConfigurationRepository,
  RetrievedConfigurationRecord,
} from "../../repositories/ConfigurationRepository";
import { EcoFlowHttpClient } from "../../http/EcoFlowHttpClient";
import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { CredentialsBundle } from "../../../domain/models/CredentialsBundle";
import { DeviceSerialNumber } from "../../../domain/values/DeviceSerialNumber";
import { DevicePair } from "../../../domain/models/DevicePair";
import { AutomationThresholdPair } from "../../../domain/models/AutomationThresholdPair";
import { PercentageValue } from "../../../domain/values/PercentageValue";
import { AutomationProfile } from "../../../domain/models/AutomationProfile";
import { OrchestratorConfiguration } from "../../../domain/models/OrchestratorConfiguration";

function buildMockConfigurationRecord(
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
    isDynamicTariffActive: false,
    peakTariffPerKwh: 1.85,
    intermediateTariffPerKwh: 1.15,
    offPeakTariffPerKwh: 0.65,
    peakStartTime: "18:00",
    peakEndTime: "21:00",
    intermediateStartTime1: "17:00",
    intermediateEndTime1: "18:00",
    intermediateStartTime2: "21:00",
    intermediateEndTime2: "22:00",
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
    isAutoStormActive: true,
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

describe("Feature 4.5: Automações Meteorológicas & Auto-Storm (Backend)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    OrchestratorSyncUseCase.resetLoggedStatesForTests();
    OpenMeteoSolarForecastService.getInstance().clearCacheForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("OpenMeteoSolarForecastService - Avaliação de Risco WMO e Previsão", () => {
    it("mapeia descrições corretas dos códigos meteorológicos WMO", () => {
      expect(getWeatherDescriptionByCode(0)).toBe("Céu limpo");
      expect(getWeatherDescriptionByCode(65)).toBe("Chuva forte contínua");
      expect(getWeatherDescriptionByCode(82)).toBe("Pancadas de chuva violentas");
      expect(getWeatherDescriptionByCode(95)).toBe("Trovoada leve ou moderada");
      expect(getWeatherDescriptionByCode(96)).toBe("Trovoada com granizo leve");
      expect(getWeatherDescriptionByCode(99)).toBe("Trovoada severa com granizo pesado");
      expect(getWeatherDescriptionByCode(999)).toBe("Condições meteorológicas variáveis");
    });

    it("classifica WMO 96/99 ou ventos > 65km/h como SEVERE e isStormRisk: true", async () => {
      const mockApiResponse = {
        daily: {
          time: ["2026-11-20", "2026-11-21"],
          weather_code: [99, 1],
          precipitation_sum: [35.0, 0.0],
          precipitation_probability_max: [95, 10],
          wind_speed_10m_max: [72.5, 15.0],
          temperature_2m_max: [28.0, 24.0],
          temperature_2m_min: [19.0, 16.0],
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      const service = OpenMeteoSolarForecastService.getInstance();
      const assessment = await service.evaluateWeatherRisk(-23.55, -46.63, 20.0);

      expect(assessment.isStormRisk).toBe(true);
      expect(assessment.severity).toBe("SEVERE");
      expect(assessment.weatherCode).toBe(99);
      expect(assessment.weatherDescription).toContain("granizo pesado");
      expect(assessment.windSpeedMaxKmh).toBe(72.5);
      expect(assessment.precipitationSumMm).toBe(35.0);
    });

    it("classifica WMO 95 ou chuva >= rainThresholdMm como MODERATE e isStormRisk: true", async () => {
      const mockApiResponse = {
        daily: {
          time: ["2026-11-20", "2026-11-21"],
          weather_code: [95, 2],
          precipitation_sum: [18.5, 2.0],
          precipitation_probability_max: [80, 20],
          wind_speed_10m_max: [45.0, 18.0],
          temperature_2m_max: [26.0, 25.0],
          temperature_2m_min: [18.0, 17.0],
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      const service = OpenMeteoSolarForecastService.getInstance();
      const assessment = await service.evaluateWeatherRisk(-23.55, -46.63, 20.0);

      expect(assessment.isStormRisk).toBe(true);
      expect(assessment.severity).toBe("MODERATE");
      expect(assessment.weatherCode).toBe(95);
      expect(assessment.weatherDescription).toContain("Trovoada leve ou moderada");
    });

    it("classifica chuva acumulada >= rainThresholdMm mesmo com código comum como MODERATE", async () => {
      const mockApiResponse = {
        daily: {
          time: ["2026-11-20", "2026-11-21"],
          weather_code: [61, 63],
          precipitation_sum: [28.0, 5.0],
          precipitation_probability_max: [85, 30],
          wind_speed_10m_max: [30.0, 15.0],
          temperature_2m_max: [22.0, 23.0],
          temperature_2m_min: [16.0, 15.0],
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      const service = OpenMeteoSolarForecastService.getInstance();
      const assessment = await service.evaluateWeatherRisk(-23.55, -46.63, 20.0);

      expect(assessment.isStormRisk).toBe(true);
      expect(assessment.severity).toBe("MODERATE");
      expect(assessment.precipitationSumMm).toBe(28.0);
    });

    it("classifica condições normais como NORMAL e isStormRisk: false", async () => {
      const mockApiResponse = {
        daily: {
          time: ["2026-11-20", "2026-11-21"],
          weather_code: [1, 0],
          precipitation_sum: [0.0, 0.0],
          precipitation_probability_max: [5, 0],
          wind_speed_10m_max: [18.0, 12.0],
          temperature_2m_max: [27.0, 28.0],
          temperature_2m_min: [17.0, 18.0],
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      const service = OpenMeteoSolarForecastService.getInstance();
      const assessment = await service.evaluateWeatherRisk(-23.55, -46.63, 20.0);

      expect(assessment.isStormRisk).toBe(false);
      expect(assessment.severity).toBe("NORMAL");
    });

    it("utiliza cache em memória de 1 hora para evitar requisições redundantes", async () => {
      const mockApiResponse = {
        daily: {
          time: ["2026-11-20"],
          weather_code: [0],
          precipitation_sum: [0.0],
          precipitation_probability_max: [0],
          wind_speed_10m_max: [10.0],
          temperature_2m_max: [26.0],
          temperature_2m_min: [18.0],
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      const service = OpenMeteoSolarForecastService.getInstance();
      const first = await service.getWeatherForecast(-23.55, -46.63);
      expect(first.isCached).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const second = await service.getWeatherForecast(-23.55, -46.63);
      expect(second.isCached).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("aplica fail-safe gracioso com NORMAL e isStormRisk: false se a API falhar", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network timeout or connection refused"));

      const service = OpenMeteoSolarForecastService.getInstance();
      const assessment = await service.evaluateWeatherRisk(-23.55, -46.63, 20.0);

      expect(assessment.isStormRisk).toBe(false);
      expect(assessment.severity).toBe("NORMAL");
      expect(assessment.weatherDescription).toContain("indisponível");
    });
  });

  describe("OrchestratorSyncUseCase - Comportamento e Defesa Auto-Storm", () => {
    it("aciona Modo de Defesa Auto-Storm, desliga AC (ATS na rede) e pré-recarrega se bateria < reserva", async () => {
      const spySetAcOutput = vi
        .spyOn(EcoFlowHttpClient.prototype, "setAcOutputState")
        .mockResolvedValue("SUCCESS");
      const spySetAcSpeed = vi
        .spyOn(EcoFlowHttpClient.prototype, "setAcChargingSpeed")
        .mockResolvedValue({ isSuccess: true, feedbackMessage: "SPEED_UPDATED" });

      const config = buildMockConfigurationRecord("config-auto-storm-1", {
        isAutoStormActive: true,
        autoStormReserveThreshold: 85,
        autoStormPrechargeAc: true,
        maxAcChargingWatts: 1200,
        isStormAlertActive: false,
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(config),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(121),
        updateStormAlertStatus: vi.fn().mockResolvedValue(undefined),
        updateCurrentAcChargingWatts: vi.fn().mockResolvedValue(undefined),
        findLatestExecutionLog: vi.fn().mockResolvedValue(null),
      } as unknown as ConfigurationRepository;

      // Mock Open-Meteo API retornando tempestade severa
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          daily: {
            time: ["2026-11-20"],
            weather_code: [96],
            precipitation_sum: [40.0],
            precipitation_probability_max: [90],
            wind_speed_10m_max: [68.0],
            temperature_2m_max: [25.0],
            temperature_2m_min: [18.0],
          },
        }),
      } as Response);

      const telemetry: ProvidedTelemetry = {
        batteryPercentage: 60,
        solarWatts: 200,
        outputWatts: 350,
        isAcOutputEnabled: true,
      };

      const orchestrator = new OrchestratorSyncUseCase(mockRepo);
      const result = await orchestrator.executeSyncForUser("user-1", telemetry);

      expect(result.hasExecutedSuccessfully).toBe(true);
      expect(result.triggeredAction).toBe("AUTO_STORM_DEFENSE");
      expect(result.detailMessage).toContain("Modo Auto-Storm Ativo");

      // 1. Saída AC desligada (ATS comuta para rede)
      expect(spySetAcOutput).toHaveBeenCalledWith(expect.anything(), false);
      // 2. Ciclos ATS incrementados
      expect(mockRepo.incrementAtsCycle).toHaveBeenCalledWith("config-auto-storm-1");
      // 3. Status gravado com código WMO 96
      expect(mockRepo.updateStormAlertStatus).toHaveBeenCalledWith("config-auto-storm-1", {
        isStormAlertActive: true,
        lastStormAlertCode: 96,
        lastStormAlertDescription: expect.stringContaining("granizo"),
        lastStormAlertTriggeredAt: expect.any(Date),
      });
      // 4. Pré-recarga rápida em 1200W (bateria 60% < reserva 85%)
      expect(spySetAcSpeed).toHaveBeenCalledWith(expect.anything(), 1200);
      expect(mockRepo.updateCurrentAcChargingWatts).toHaveBeenCalledWith("config-auto-storm-1", 1200);
    });

    it("não aciona pré-recarga se bateria já estiver acima do limiar de reserva", async () => {
      const spySetAcOutput = vi
        .spyOn(EcoFlowHttpClient.prototype, "setAcOutputState")
        .mockResolvedValue("SUCCESS");
      const spySetAcSpeed = vi
        .spyOn(EcoFlowHttpClient.prototype, "setAcChargingSpeed")
        .mockResolvedValue({ isSuccess: true, feedbackMessage: "SPEED_UPDATED" });

      const config = buildMockConfigurationRecord("config-auto-storm-2", {
        isAutoStormActive: true,
        autoStormReserveThreshold: 85,
        autoStormPrechargeAc: true,
        isStormAlertActive: false,
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(config),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(121),
        updateStormAlertStatus: vi.fn().mockResolvedValue(undefined),
        findLatestExecutionLog: vi.fn().mockResolvedValue(null),
      } as unknown as ConfigurationRepository;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          daily: {
            time: ["2026-11-20"],
            weather_code: [95],
            precipitation_sum: [25.0],
            precipitation_probability_max: [80],
            wind_speed_10m_max: [40.0],
            temperature_2m_max: [24.0],
            temperature_2m_min: [17.0],
          },
        }),
      } as Response);

      const telemetry: ProvidedTelemetry = {
        batteryPercentage: 90, // 90% >= 85%
        solarWatts: 100,
        outputWatts: 300,
        isAcOutputEnabled: true,
      };

      const orchestrator = new OrchestratorSyncUseCase(mockRepo);
      const result = await orchestrator.executeSyncForUser("user-2", telemetry);

      expect(result.triggeredAction).toBe("AUTO_STORM_DEFENSE");
      expect(spySetAcOutput).toHaveBeenCalledWith(expect.anything(), false);
      expect(spySetAcSpeed).not.toHaveBeenCalled();
    });

    it("desarma Auto-Storm e notifica encerramento quando as condições normalizam", async () => {
      const config = buildMockConfigurationRecord("config-auto-storm-3", {
        isAutoStormActive: true,
        isStormAlertActive: true, // Estava ativo na execução anterior
        lastStormAlertTriggeredAt: new Date(Date.now() - 3600000),
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(config),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        updateStormAlertStatus: vi.fn().mockResolvedValue(undefined),
        findLatestExecutionLog: vi.fn().mockResolvedValue(null),
      } as unknown as ConfigurationRepository;

      // Tempo bom: WMO 0, sem chuva nem vento
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          daily: {
            time: ["2026-11-20"],
            weather_code: [0],
            precipitation_sum: [0.0],
            precipitation_probability_max: [0],
            wind_speed_10m_max: [12.0],
            temperature_2m_max: [27.0],
            temperature_2m_min: [18.0],
          },
        }),
      } as Response);

      const telemetry: ProvidedTelemetry = {
        batteryPercentage: 50,
        solarWatts: 300,
        outputWatts: 0,
        isAcOutputEnabled: false,
      };

      const orchestrator = new OrchestratorSyncUseCase(mockRepo);
      await orchestrator.executeSyncForUser("user-3", telemetry);

      // Verificação: status no banco atualizado para inativo com lastStormAlertEndedAt
      expect(mockRepo.updateStormAlertStatus).toHaveBeenCalledWith("config-auto-storm-3", {
        isStormAlertActive: false,
        lastStormAlertEndedAt: expect.any(Date),
      });
    });
  });

  describe("Validação Zod de Auto-Storm em settingsPostBodySchema", () => {
    it("aceita parâmetros válidos de Auto-Storm", () => {
      const valid = {
        ecoflowAccessKey: "ak-test",
        ecoflowSerialNumber: "EF-TEST",
        isAutoStormActive: true,
        autoStormReserveThreshold: 80,
        autoStormRainThresholdMm: 25.5,
        autoStormPrechargeAc: true,
      };

      const result = settingsPostBodySchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejeita autoStormReserveThreshold fora do intervalo [50, 100]", () => {
      expect(settingsPostBodySchema.shape.autoStormReserveThreshold.safeParse(40).success).toBe(false);
      expect(settingsPostBodySchema.shape.autoStormReserveThreshold.safeParse(105).success).toBe(false);
      expect(settingsPostBodySchema.shape.autoStormReserveThreshold.safeParse(75.5).success).toBe(false); // deve ser int
      expect(settingsPostBodySchema.shape.autoStormReserveThreshold.safeParse(85).success).toBe(true);
    });

    it("rejeita autoStormRainThresholdMm fora do intervalo [5, 150]", () => {
      expect(settingsPostBodySchema.shape.autoStormRainThresholdMm.safeParse(2).success).toBe(false);
      expect(settingsPostBodySchema.shape.autoStormRainThresholdMm.safeParse(200).success).toBe(false);
      expect(settingsPostBodySchema.shape.autoStormRainThresholdMm.safeParse(20.0).success).toBe(true);
    });
  });
});
