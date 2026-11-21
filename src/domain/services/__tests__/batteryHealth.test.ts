import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BatteryHealthService,
  RawBatteryTelemetryParams,
  BatteryHealthConfig,
} from "../BatteryHealthService";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
import {
  ConfigurationRepository,
  RetrievedConfigurationRecord,
} from "../../../infrastructure/repositories/ConfigurationRepository";
import { PrismaClient } from "@prisma/client";
import { settingsPostBodySchema } from "../../../infrastructure/security/apiSchemas";
import handleBatteryHealth from "../../../pages/api/battery/health";
import type { NextApiRequest, NextApiResponse } from "next";
import { CredentialsBundle } from "../../models/CredentialsBundle";
import { EcoFlowCredentials } from "../../models/EcoFlowCredentials";
import { AccessKey } from "../../values/AccessKey";
import { AccessSecret } from "../../values/AccessSecret";
import { DeviceSerialNumber } from "../../values/DeviceSerialNumber";
import { DevicePair } from "../../models/DevicePair";
import { PercentageValue } from "../../values/PercentageValue";
import { AutomationThresholdPair } from "../../models/AutomationThresholdPair";
import { AutomationProfile } from "../../models/AutomationProfile";
import { OrchestratorConfiguration } from "../../models/OrchestratorConfiguration";

const mockSetAcOutputState = vi.fn().mockResolvedValue("SUCCESS");
const mockSetAcChargingSpeed = vi.fn().mockResolvedValue(true);
const mockFetchDeviceTelemetry = vi.fn().mockResolvedValue({
  batteryLevel: {
    transferBatteryPercentage: (fn: (v: number) => void) => fn(80),
  },
  solarWatts: {
    transferNumericWatts: (fn: (v: number) => void) => fn(150),
  },
  isAcOutputEnabled: true,
  outputWatts: 200,
});

vi.mock("../../../infrastructure/http/EcoFlowHttpClient", () => {
  return {
    EcoFlowHttpClient: vi.fn().mockImplementation(function () {
      return {
        setAcOutputState: mockSetAcOutputState,
        setAcChargingSpeed: mockSetAcChargingSpeed,
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

const mockSendTelegramMessage = vi.fn().mockResolvedValue(true);
const mockSendWhatsAppCallMeBot = vi.fn().mockResolvedValue(true);

vi.mock("../../../infrastructure/notifications/NotificationDispatcher", () => {
  return {
    NotificationDispatcher: vi.fn().mockImplementation(function () {
      return {
        dispatchNotification: vi.fn().mockResolvedValue(undefined),
        dispatchMessage: vi.fn().mockResolvedValue(undefined),
        sendTelegramMessage: mockSendTelegramMessage,
        sendWhatsAppCallMeBot: mockSendWhatsAppCallMeBot,
      };
    }),
  };
});

function buildMockConfigRecord(
  databaseRecordId: string,
  overrides: Partial<RetrievedConfigurationRecord> = {}
): RetrievedConfigurationRecord {
  const credentialsBundle = new CredentialsBundle(
    new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("as-test"))
  );
  const devicePair = new DevicePair(new DeviceSerialNumber("EF-DELTA2-BMS-TEST"));
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
    atsCurrentCycles: 150,
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
    isAdaptiveHysteresisActive: false,
    minAdaptiveThreshold: 20,
    maxAdaptiveThreshold: 50,
    lastSolarIrradianceMj: 20.0,
    lastSolarForecastCheckAt: new Date(),
    thermalWarningThreshold: 42.0,
    thermalShutdownThreshold: 48.0,
    lastBatteryTempCelsius: 32.0,
    lastBatterySoh: 99,
    lastBatteryCycles: 100,
    maxRecordedBatteryTemp: 38.0,
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
    isTimeOfUseActive: false,
    timeOfUseWeekdaysOnly: true,
    intermediateStartTime: "16:30",
    intermediateEndTime: "21:30",
    peakDischargeReserveLimit: 20,
    blockAcChargingDuringPeak: true,
    // BMS & Thermal fields:
    isThermalProtectionActive: true,
    thermalThrottleTempThreshold: 42,
    thermalCutoffTempThreshold: 48,
    thermalRecoveryTempThreshold: 44,
    thermalThrottleSpeedWatts: 200,
    isThermalThrottleActive: false,
    isThermalCutoffActive: false,
    lastThermalEventAt: null,
    lastThermalActionMessage: null,
    ...overrides,
  };
}

describe("BatteryHealthService & BMS Thermal Protection", () => {
  let service: BatteryHealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = BatteryHealthService.getInstance();
    service.clearTrendForTests();
  });

  describe("Cálculo de Estimativa de Vida Útil LiFePO4 (calculateLifespanEstimate)", () => {
    it("projeta 100% de saúde e 8.2 anos com 0 ciclos e sem SOH reportado", () => {
      const estimate = service.calculateLifespanEstimate(0, null, 3000, 1.0);
      expect(estimate.healthPercentage).toBe(100);
      expect(estimate.remainingCycles).toBe(3000);
      expect(estimate.estimatedYears).toBe(8.2);
    });

    it("calcula degradação linear teórica de 20% para 3000 ciclos quando SOH é nulo", () => {
      // 1500 ciclos = 50% de uso -> degradação teórica de 10% -> SOH calculado 90%
      const estimate = service.calculateLifespanEstimate(1500, null, 3000, 1.0);
      expect(estimate.healthPercentage).toBe(90);
      expect(estimate.remainingCycles).toBe(1500);
      expect(estimate.estimatedYears).toBe(4.1);
    });

    it("utiliza o SOH real reportado pelo BMS do hardware se disponível", () => {
      const estimate = service.calculateLifespanEstimate(1500, 94, 3000, 1.0);
      expect(estimate.healthPercentage).toBe(94);
      expect(estimate.remainingCycles).toBe(1500);
      expect(estimate.estimatedYears).toBe(4.1);
    });

    it("retorna 0 ciclos restantes e 0 anos quando ciclos atingem ou excedem o limite nominal", () => {
      const estimate = service.calculateLifespanEstimate(3200, 78, 3000, 1.0);
      expect(estimate.healthPercentage).toBe(78);
      expect(estimate.remainingCycles).toBe(0);
      expect(estimate.estimatedYears).toBe(0);
    });
  });

  describe("Avaliação de Risco Térmico e Histerese (evaluateThermalRisk)", () => {
    it("classifica como OPTIMAL para temperaturas normais (< 38°C)", () => {
      const result = service.evaluateThermalRisk(32.5, {
        isThermalProtectionActive: true,
        thermalWarningThreshold: 42.0,
        thermalShutdownThreshold: 48.0,
        thermalRecoveryTempThreshold: 44.0,
      });

      expect(result.riskLevel).toBe("OPTIMAL");
      expect(result.shouldCutoff).toBe(false);
      expect(result.shouldThrottle).toBe(false);
      expect(result.shouldRecover).toBe(false);
    });

    it("classifica como WARM para temperaturas moderadas (38°C a 41.9°C)", () => {
      const result = service.evaluateThermalRisk(39.0, {
        isThermalProtectionActive: true,
        thermalWarningThreshold: 42.0,
        thermalShutdownThreshold: 48.0,
        thermalRecoveryTempThreshold: 44.0,
      });

      expect(result.riskLevel).toBe("WARM");
      expect(result.shouldCutoff).toBe(false);
      expect(result.shouldThrottle).toBe(false);
      expect(result.shouldRecover).toBe(false);
    });

    it("classifica como THROTTLED e ativa shouldThrottle quando temp >= 42°C e < 48°C", () => {
      const result = service.evaluateThermalRisk(43.5, {
        isThermalProtectionActive: true,
        thermalWarningThreshold: 42.0,
        thermalShutdownThreshold: 48.0,
        thermalRecoveryTempThreshold: 44.0,
      });

      expect(result.riskLevel).toBe("THROTTLED");
      expect(result.shouldThrottle).toBe(true);
      expect(result.shouldCutoff).toBe(false);
      expect(result.shouldRecover).toBe(false);
    });

    it("classifica como CRITICAL_CUTOFF e ativa shouldCutoff quando temp >= 48°C", () => {
      const result = service.evaluateThermalRisk(49.2, {
        isThermalProtectionActive: true,
        thermalWarningThreshold: 42.0,
        thermalShutdownThreshold: 48.0,
        thermalRecoveryTempThreshold: 44.0,
      });

      expect(result.riskLevel).toBe("CRITICAL_CUTOFF");
      expect(result.shouldCutoff).toBe(true);
      expect(result.shouldThrottle).toBe(false);
      expect(result.shouldRecover).toBe(false);
    });

    it("mantém CRITICAL_CUTOFF por histerese quando temp cai para 46°C mas ainda está acima de 44°C", () => {
      const result = service.evaluateThermalRisk(46.0, {
        isThermalProtectionActive: true,
        thermalWarningThreshold: 42.0,
        thermalShutdownThreshold: 48.0,
        thermalRecoveryTempThreshold: 44.0,
        isThermalCutoffActive: true,
      });

      expect(result.riskLevel).toBe("CRITICAL_CUTOFF");
      expect(result.shouldCutoff).toBe(true);
      expect(result.shouldRecover).toBe(false);
    });

    it("desarma CRITICAL_CUTOFF e ativa shouldRecover quando temp cai para <= 44°C", () => {
      const result = service.evaluateThermalRisk(43.0, {
        isThermalProtectionActive: true,
        thermalWarningThreshold: 42.0,
        thermalShutdownThreshold: 48.0,
        thermalRecoveryTempThreshold: 44.0,
        isThermalCutoffActive: true,
      });

      expect(result.riskLevel).toBe("THROTTLED");
      expect(result.shouldCutoff).toBe(false);
      expect(result.shouldThrottle).toBe(true);
      expect(result.shouldRecover).toBe(true);
    });

    it("não aplica cortes nem throttling quando isThermalProtectionActive é false", () => {
      const result = service.evaluateThermalRisk(55.0, {
        isThermalProtectionActive: false,
        thermalWarningThreshold: 42.0,
        thermalShutdownThreshold: 48.0,
        thermalRecoveryTempThreshold: 44.0,
      });

      expect(result.riskLevel).toBe("OPTIMAL");
      expect(result.shouldCutoff).toBe(false);
      expect(result.shouldThrottle).toBe(false);
      expect(result.shouldRecover).toBe(false);
    });
  });

  describe("Métricas Completas e Histórico de Tendência (evaluateBatteryHealth)", () => {
    it("agrega métricas de telemetria bruta e constrói o payload BatteryHealthMetrics", () => {
      const rawParams: RawBatteryTelemetryParams = {
        temp: 35.0,
        cycles: 120,
        soh: 99,
        volts: 51.2,
        amps: 8.5,
      };

      const config: BatteryHealthConfig = {
        isThermalProtectionActive: true,
        thermalThrottleTempThreshold: 42,
        thermalCutoffTempThreshold: 48,
        thermalRecoveryTempThreshold: 44,
        thermalThrottleSpeedWatts: 200,
        maxRecordedBatteryTemp: 38.0,
      };

      const metrics = service.evaluateBatteryHealth(rawParams, config, "cfg-123");

      expect(metrics.currentTempCelsius).toBe(35.0);
      expect(metrics.maxRecordedTempCelsius).toBe(38.0);
      expect(metrics.thermalRiskLevel).toBe("OPTIMAL");
      expect(metrics.isThermalCutoffActive).toBe(false);
      expect(metrics.isThermalThrottleActive).toBe(false);
      expect(metrics.bmsCycleCount).toBe(120);
      expect(metrics.bmsSohPercentage).toBe(99);
      expect(metrics.voltageVolts).toBe(51.2);
      expect(metrics.amperageAmps).toBe(8.5);
      expect(metrics.powerWatts).toBe(435.2);
      expect(metrics.recentThermalTrend.length).toBe(1);
      expect(metrics.recentThermalTrend[0].temperatureCelsius).toBe(35.0);
    });

    it("limita o ring buffer de tendência a 24 pontos de medição", () => {
      const config: BatteryHealthConfig = {
        isThermalProtectionActive: true,
      };

      for (let i = 1; i <= 30; i++) {
        service.evaluateBatteryHealth({ temp: 30 + i * 0.5 }, config, "cfg-ring");
      }

      const metrics = service.evaluateBatteryHealth({ temp: 43.0 }, config, "cfg-ring");
      expect(metrics.recentThermalTrend.length).toBe(24);
    });
  });
});

describe("OrchestratorSyncUseCase - Ações de Proteção Térmica do BMS", () => {
  let mockPrisma: PrismaClient;
  let repo: ConfigurationRepository;
  let useCase: OrchestratorSyncUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      userConfiguration: {
        update: vi.fn().mockResolvedValue({}),
      },
      syncExecutionLog: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    repo = new ConfigurationRepository(mockPrisma);
    useCase = new OrchestratorSyncUseCase(repo);
  });

  it("aciona desarme de emergência, desliga AC da EcoFlow e zera recarga quando temp >= 48°C", async () => {
    const record = buildMockConfigRecord("rec-crit", {
      thermalCutoffTempThreshold: 48,
      thermalThrottleTempThreshold: 42,
    });

    (repo as unknown as Record<string, unknown>).findActiveConfigurationByUserId =
      vi.fn().mockResolvedValue(record);
    (repo as unknown as Record<string, unknown>).recordExecutionLog = vi.fn().mockResolvedValue(undefined);
    (repo as unknown as Record<string, unknown>).incrementAtsCycle = vi.fn().mockResolvedValue(151);
    (repo as unknown as Record<string, unknown>).updateThermalState = vi.fn().mockResolvedValue(undefined);

    const res = await useCase.executeSyncForUser("user-crit", {
      batteryPercentage: 80,
      solarWatts: 200,
      outputWatts: 150,
      isAcOutputEnabled: true,
      batteryTempCelsius: 49.5,
      batterySoh: 98,
      batteryCycles: 150,
    });

    expect(res.hasExecutedSuccessfully).toBe(true);
    expect(res.triggeredAction).toBe("THERMAL_PROTECTION_DISARM");
    expect(mockSetAcOutputState).toHaveBeenCalledWith(expect.anything(), false);
    expect(mockSetAcChargingSpeed).toHaveBeenCalledWith(expect.anything(), 0);
    expect((repo as unknown as Record<string, unknown>).updateThermalState).toHaveBeenCalledWith(
      "rec-crit",
      expect.objectContaining({
        isThermalCutoffActive: true,
        isThermalThrottleActive: false,
      })
    );
  });

  it("restringe potência de recarga AC para thermalThrottleSpeedWatts quando temp >= 42°C", async () => {
    const record = buildMockConfigRecord("rec-throttle", {
      thermalCutoffTempThreshold: 48,
      thermalThrottleTempThreshold: 42,
      thermalThrottleSpeedWatts: 200,
      isSmartChargingActive: true,
      currentAcChargingWatts: 800,
      latitude: null,
      longitude: null,
    });

    (repo as unknown as Record<string, unknown>).findActiveConfigurationByUserId =
      vi.fn().mockResolvedValue(record);
    (repo as unknown as Record<string, unknown>).recordExecutionLog = vi.fn().mockResolvedValue(undefined);
    (repo as unknown as Record<string, unknown>).incrementAtsCycle = vi.fn().mockResolvedValue(150);
    (repo as unknown as Record<string, unknown>).updateThermalState = vi.fn().mockResolvedValue(undefined);

    const res = await useCase.executeSyncForUser("user-throttle", {
      batteryPercentage: 50,
      solarWatts: 50,
      outputWatts: 100,
      isAcOutputEnabled: false,
      batteryTempCelsius: 43.5,
      batterySoh: 98,
      batteryCycles: 150,
    });

    expect(res.hasExecutedSuccessfully).toBe(true);
    expect(mockSetAcChargingSpeed).toHaveBeenCalledWith(expect.anything(), 200);
    expect((repo as unknown as Record<string, unknown>).updateThermalState).toHaveBeenCalledWith(
      "rec-throttle",
      expect.objectContaining({
        isThermalThrottleActive: true,
      })
    );
  });

  it("desarma estado de corte térmico e envia notificação de recuperação quando temp cai para <= 44°C", async () => {
    const record = buildMockConfigRecord("rec-recovery", {
      thermalCutoffTempThreshold: 48,
      thermalRecoveryTempThreshold: 44,
      isThermalCutoffActive: true,
    });

    (repo as unknown as Record<string, unknown>).findActiveConfigurationByUserId =
      vi.fn().mockResolvedValue(record);
    (repo as unknown as Record<string, unknown>).recordExecutionLog = vi.fn().mockResolvedValue(undefined);
    (repo as unknown as Record<string, unknown>).incrementAtsCycle = vi.fn().mockResolvedValue(150);
    (repo as unknown as Record<string, unknown>).updateThermalState = vi.fn().mockResolvedValue(undefined);

    const res = await useCase.executeSyncForUser("user-recovery", {
      batteryPercentage: 70,
      solarWatts: 300,
      outputWatts: 100,
      isAcOutputEnabled: false,
      batteryTempCelsius: 42.0, // <= 44°C -> recupera
      batterySoh: 98,
      batteryCycles: 150,
    });

    expect(res.hasExecutedSuccessfully).toBe(true);
    expect((repo as unknown as Record<string, unknown>).updateThermalState).toHaveBeenCalledWith(
      "rec-recovery",
      expect.objectContaining({
        isThermalCutoffActive: false,
      })
    );
  });
});

describe("GET /api/battery/health API Endpoint", () => {
  it("rejeita requisições com métodos HTTP diferentes de GET retornando 405 e Allow: GET", async () => {
    const req = {
      method: "POST",
    } as unknown as NextApiRequest;

    const resJson = vi.fn();
    const resHeader = vi.fn();
    const resStatus = vi.fn().mockReturnValue({ json: resJson });

    const res = {
      setHeader: resHeader,
      status: resStatus,
    } as unknown as NextApiResponse;

    await handleBatteryHealth(req, res);

    expect(resHeader).toHaveBeenCalledWith("Allow", ["GET"]);
    expect(resStatus).toHaveBeenCalledWith(405);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Método HTTP não permitido.",
      })
    );
  });

  it("rejeita requisições não autenticadas retornando 401", async () => {
    const req = {
      method: "GET",
      headers: {},
    } as unknown as NextApiRequest;

    const resJson = vi.fn();
    const resHeader = vi.fn();
    const resStatus = vi.fn().mockReturnValue({ json: resJson });

    const res = {
      setHeader: resHeader,
      status: resStatus,
    } as unknown as NextApiResponse;

    await handleBatteryHealth(req, res);

    expect(resStatus).toHaveBeenCalledWith(401);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
      })
    );
  });
});

describe("Validação Zod de Configurações Térmicas (settingsPostBodySchema)", () => {
  it("aceita parâmetros térmicos válidos dentro das faixas operacionais", () => {
    const payload = {
      isThermalProtectionActive: true,
      thermalThrottleTempThreshold: 42,
      thermalCutoffTempThreshold: 48,
      thermalRecoveryTempThreshold: 44,
      thermalThrottleSpeedWatts: 200,
    };

    const parsed = settingsPostBodySchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("rejeita thermalThrottleTempThreshold fora dos limites [30, 50]", () => {
    const invalidLow = settingsPostBodySchema.safeParse({ thermalThrottleTempThreshold: 25 });
    expect(invalidLow.success).toBe(false);

    const invalidHigh = settingsPostBodySchema.safeParse({ thermalThrottleTempThreshold: 55 });
    expect(invalidHigh.success).toBe(false);
  });

  it("rejeita thermalCutoffTempThreshold fora dos limites [40, 60]", () => {
    const invalidLow = settingsPostBodySchema.safeParse({ thermalCutoffTempThreshold: 35 });
    expect(invalidLow.success).toBe(false);

    const invalidHigh = settingsPostBodySchema.safeParse({ thermalCutoffTempThreshold: 65 });
    expect(invalidHigh.success).toBe(false);
  });

  it("rejeita thermalThrottleSpeedWatts fora dos limites [100, 1000]", () => {
    const invalidLow = settingsPostBodySchema.safeParse({ thermalThrottleSpeedWatts: 50 });
    expect(invalidLow.success).toBe(false);

    const invalidHigh = settingsPostBodySchema.safeParse({ thermalThrottleSpeedWatts: 1500 });
    expect(invalidHigh.success).toBe(false);
  });
});
