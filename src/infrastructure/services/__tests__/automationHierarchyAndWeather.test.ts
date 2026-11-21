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

vi.mock("../../http/EcoFlowHttpClient", () => ({
  EcoFlowHttpClient: vi.fn(function () {
    return {
      fetchDeviceTelemetry: mockFetchDeviceTelemetry,
      setAcOutputState: mockSetAcOutputState,
      setAcChargingSpeed: mockSetAcChargingSpeed,
    };
  }),
}));

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

vi.mock("../../../domain/services/TariffScheduleService", () => {
  const instance = {
    evaluateTariffPeriod: mockEvaluateTariffPeriod,
  };
  return {
    TariffScheduleService: {
      getInstance: () => instance,
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

function buildMockRecord(recordId: string, overrides: Record<string, unknown> = {}) {
  const credentials = new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("as-test"));
  const bundle = new CredentialsBundle(credentials);
  const serial = new DeviceSerialNumber("SN-HIERARCHY-TEST");
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

describe("Deterministic Automation Hierarchy & Weather-based Energy Level Config", () => {
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("1. Disjuntor geral inativo bloqueia Auto-Storm de comutar ATS ou disparar pré-recarga", async () => {
    // Configuração com risco meteorológico detectado, mas automação desativada pelo disjuntor geral
    mockEvaluateWeatherRisk.mockResolvedValue({
      isStormRisk: true,
      weatherCode: 95,
      weatherDescription: "Tempestade com trovoadas",
      windSpeedMaxKmh: 65,
      precipitationSumMm: 45,
    });

    const record = buildMockRecord("rec-breaker-off", {
      isAutomationActive: false, // Disjuntor Geral DESLIGADO
      isAutoStormActive: true,
      autoStormPrechargeAc: true,
      autoStormReserveThreshold: 85,
    });

    const mockRepo = {
      findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
      recordExecutionLog: vi.fn().mockResolvedValue(undefined),
      incrementAtsCycle: vi.fn().mockResolvedValue(1),
      updateStormAlertStatus: vi.fn().mockResolvedValue(undefined),
    };

    const useCase = new OrchestratorSyncUseCase(mockRepo as any);

    // Bateria a 60% e AC Ligado
    const result = await useCase.executeSyncForUser("user-breaker-off", {
      batteryPercentage: 60,
      solarWatts: 150,
      outputWatts: 200,
      isAcOutputEnabled: true,
    });

    expect(result.hasExecutedSuccessfully).toBe(true);
    expect(result.triggeredAction).toBe("MONITORAMENTO");
    expect(result.detailMessage).toContain("Automação pausada");

    // CRUCIAL: O Auto-Storm NÃO deve ter comutado a ATS (desligado a AC)
    expect(mockSetAcOutputState).not.toHaveBeenCalled();
    // CRUCIAL: O Auto-Storm NÃO deve ter disparado pré-recarga
    expect(mockSetAcChargingSpeed).not.toHaveBeenCalled();
  });

  it("2. Horário de Ponta tem prevalência financeira sobre Auto-Storm", async () => {
    // Risco de tempestade detectado
    mockEvaluateWeatherRisk.mockResolvedValue({
      isStormRisk: true,
      weatherCode: 95,
      weatherDescription: "Tempestade severa",
      windSpeedMaxKmh: 70,
      precipitationSumMm: 50,
    });

    // Horário de Ponta (Pico) ativo
    mockEvaluateTariffPeriod.mockReturnValue({
      isTimeOfUseActive: true,
      currentPeriod: "PEAK",
      currentRate: 1.85,
      currencySymbol: "R$",
    });

    const record = buildMockRecord("rec-peak-prevalence", {
      isAutomationActive: true,
      isTimeOfUseActive: true,
      isAutoStormActive: true,
      autoStormReserveThreshold: 85,
      peakReserveThreshold: 20,
      peakDischargeReserveLimit: 20,
      blockAcChargingDuringPeak: true,
    });

    const mockRepo = {
      findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
      recordExecutionLog: vi.fn().mockResolvedValue(undefined),
      incrementAtsCycle: vi.fn().mockResolvedValue(1),
      updateStormAlertStatus: vi.fn().mockResolvedValue(undefined),
    };

    const useCase = new OrchestratorSyncUseCase(mockRepo as any);

    // Bateria a 70% (acima da reserva de ponta de 20%, mas abaixo do reserve do storm de 85%)
    // Em Auto-Storm puro, 70% < 85% forçaria corte para concessionária.
    // Mas no Horário de Ponta, a economia financeira prevalece e mantém a saída AC ligada!
    const result = await useCase.executeSyncForUser("user-peak-prevalence", {
      batteryPercentage: 70,
      solarWatts: 0,
      outputWatts: 350,
      isAcOutputEnabled: true,
    });

    expect(result.hasExecutedSuccessfully).toBe(true);
    expect(result.triggeredAction).toBe("HOLD_CURRENT_STATE");
    expect(result.detailMessage).toContain("Horário de Ponta Ativo: Bateria em 70%");

    // Garante que NÃO desligou a AC para jogar a casa na tarifa cara da concessionária
    expect(mockSetAcOutputState).not.toHaveBeenCalledWith(expect.anything(), false);
  });

  it("3. isAdaptiveHysteresisActive = false mantém limiares 100% estáticos com zero consulta climática", async () => {
    const record = buildMockRecord("rec-static", {
      isAutomationActive: true,
      isAdaptiveHysteresisActive: false, // 100% ESTÁTICO
      turnOnThreshold: 85,
      turnOffThreshold: 35,
    });

    const mockRepo = {
      findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
      recordExecutionLog: vi.fn().mockResolvedValue(undefined),
      incrementAtsCycle: vi.fn().mockResolvedValue(1),
    };

    const useCase = new OrchestratorSyncUseCase(mockRepo as any);

    // Bateria em 33% (abaixo do limiar estático de 35%) com AC ligado -> deve desligar AC
    const result = await useCase.executeSyncForUser("user-static", {
      batteryPercentage: 33,
      solarWatts: 50,
      outputWatts: 150,
      isAcOutputEnabled: true,
    });

    expect(result.hasExecutedSuccessfully).toBe(true);
    expect(result.triggeredAction).toBe("DISABLE_ECOFLOW_AC");
    expect(mockSetAcOutputState).toHaveBeenCalledWith(expect.anything(), false);

    // Garante que o serviço de previsão solar NUNCA foi chamado para alterar a histerese
    expect(mockGetForecast).not.toHaveBeenCalled();
  });

  it("4. isAdaptiveHysteresisActive = true aplica o corte adaptativo baseado na previsão solar", async () => {
    // Dia ensolarado: previsão adaptativa calcula que o corte pode descer com segurança para 25%
    mockGetForecast.mockResolvedValue({
      irradianceMj: 28.5,
      effectiveTurnOffThreshold: 25,
      expectationLevel: "EXCELLENT",
    });

    const record = buildMockRecord("rec-adaptive", {
      isAutomationActive: true,
      isAdaptiveHysteresisActive: true, // ADAPTATIVO ATIVO
      turnOnThreshold: 85,
      turnOffThreshold: 35, // Padrão fixo seria 35%
      minAdaptiveThreshold: 20,
      maxAdaptiveThreshold: 50,
    });

    const mockRepo = {
      findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
      recordExecutionLog: vi.fn().mockResolvedValue(undefined),
      incrementAtsCycle: vi.fn().mockResolvedValue(1),
      updateSolarForecast: vi.fn().mockResolvedValue(undefined),
    };

    const useCase = new OrchestratorSyncUseCase(mockRepo as any);

    // Bateria a 30% com AC ligado.
    // Em modo estático (35%), isso desligaria a AC e comutaria para a rede.
    // Em modo adaptativo ensolarado (25%), 30% > 25% (histerese), mantendo a AC LIGADA!
    const result = await useCase.executeSyncForUser("user-adaptive", {
      batteryPercentage: 30,
      solarWatts: 300,
      outputWatts: 150,
      isAcOutputEnabled: true,
    });

    expect(result.hasExecutedSuccessfully).toBe(true);
    expect(mockGetForecast).toHaveBeenCalled();
    // Saída AC mantida ligada aproveitando o sol do dia seguinte
    expect(mockSetAcOutputState).not.toHaveBeenCalledWith(expect.anything(), false);
  });
});
