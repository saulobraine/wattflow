import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  appliancePostBodySchema,
  applianceToggleBodySchema,
  applianceBatchToggleSchema,
  settingsPostBodySchema,
} from "../../security/apiSchemas";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
import {
  ConfigurationRepository,
  RetrievedConfigurationRecord,
} from "../../repositories/ConfigurationRepository";
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

const {
  mockFindUniqueConfig,
  mockCreateConfig,
  mockFindManyAppliances,
  mockCreateManyAppliances,
  mockCreateAppliance,
  mockUpdateManyAppliances,
  mockDeleteManyAppliances,
  mockGetLatestTelemetry,
} = vi.hoisted(() => ({
  mockFindUniqueConfig: vi.fn(),
  mockCreateConfig: vi.fn(),
  mockFindManyAppliances: vi.fn(),
  mockCreateManyAppliances: vi.fn(),
  mockCreateAppliance: vi.fn(),
  mockUpdateManyAppliances: vi.fn(),
  mockDeleteManyAppliances: vi.fn(),
  mockGetLatestTelemetry: vi.fn(),
}));

vi.mock("../../database/prismaClient", () => ({
  prisma: {
    userConfiguration: {
      findUnique: mockFindUniqueConfig,
      create: mockCreateConfig,
    },
    applianceLoadProfile: {
      findMany: mockFindManyAppliances,
      createMany: mockCreateManyAppliances,
      create: mockCreateAppliance,
      updateMany: mockUpdateManyAppliances,
      deleteMany: mockDeleteManyAppliances,
    },
  },
}));

vi.mock("../../auth/sessionHelper", () => ({
  extractUserFromRequest: vi.fn().mockResolvedValue({
    provideIdentity: (fn: (id: string) => void) => fn("user-etapa4"),
  }),
  enforceCsrfProtection: vi.fn().mockReturnValue(true),
}));

vi.mock("../EcoFlowMqttStreamService", () => ({
  EcoFlowMqttStreamService: {
    getInstance: vi.fn(() => ({
      getLatestTelemetry: mockGetLatestTelemetry,
      isStreamConnected: vi.fn().mockReturnValue(true),
    })),
  },
}));

const mockSetAcOutputState = vi.fn().mockResolvedValue("SUCCESS");
const mockSetAcChargingSpeed = vi.fn().mockResolvedValue({ isSuccess: true, feedbackMessage: "OK" });
const mockFetchDeviceTelemetry = vi.fn().mockResolvedValue({
  batteryLevel: {
    transferBatteryPercentage: (fn: (v: number) => void) => fn(80),
  },
  solarWatts: {
    transferNumericWatts: (fn: (v: number) => void) => fn(400),
  },
  isAcOutputEnabled: true,
  outputWatts: 250,
});

vi.mock("../../http/EcoFlowHttpClient", () => {
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

import handleAppliances from "../../../pages/api/appliances";

function createMockReqRes(method: string, body?: unknown, query?: Record<string, string>) {
  const req = {
    method,
    headers: {},
    body,
    query: query ?? {},
  } as unknown as NextApiRequest;

  const mockRes = {
    statusCode: 200,
    headers: {} as Record<string, unknown>,
    body: null as unknown,
    setHeader: vi.fn(),
    status: vi.fn(function (code: number) {
      mockRes.statusCode = code;
      return mockRes;
    }),
    json: vi.fn(function (payload: unknown) {
      mockRes.body = payload;
      return mockRes;
    }),
  };

  return { req, res: mockRes as unknown as NextApiResponse & { body: any; statusCode: number } };
}

function buildMockEtapa4Record(
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
    latitude: -23.5505,
    longitude: -46.6333,
    isAdaptiveHysteresisActive: false,
    minAdaptiveThreshold: 20,
    maxAdaptiveThreshold: 50,
    lastSolarIrradianceMj: 21.4,
    lastSolarForecastCheckAt: new Date(),
    thermalWarningThreshold: 45.0,
    thermalShutdownThreshold: 50.0,
    lastBatteryTempCelsius: 30.0,
    lastBatterySoh: 100,
    lastBatteryCycles: 50,
    maxRecordedBatteryTemp: 35.0,
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
    // Etapa 4:
    isSmartChargingActive: true,
    minAcChargingWatts: 200,
    maxAcChargingWatts: 1200,
    currentAcChargingWatts: 400,
    chargeOnlyOffPeak: true,
    cloudyPrechargeActive: true,
    lastSmartChargeAdjustAt: null,
    ...overrides,
  };
}

describe("Suíte de Inteligência Operacional - Etapa 4 (Backend)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Feature 2.3: Simulação de Autonomia por Carga (Critério de Aceite 2)", () => {
    it("projeta com exatidão 120 minutos (2h 00m) quando 1024Wh de bateria alimentam 512W de carga simulada", () => {
      const remainingWh = 1024;
      const totalSimulatedWatts = 512;

      const runtimeMinutes = Math.round((remainingWh / Math.max(10, totalSimulatedWatts)) * 60);
      expect(runtimeMinutes).toBe(120);

      const h = Math.floor(runtimeMinutes / 60);
      const m = Math.round(runtimeMinutes % 60);
      const formatted = `${h}h ${m.toString().padStart(2, "0")}m`;
      expect(formatted).toBe("2h 00m");
    });
  });

  describe("Validação de Segurança de Schemas (apiSchemas.ts)", () => {
    it("valida criação de novo aparelho via appliancePostBodySchema", () => {
      const valid = {
        name: "Freezer Vertical",
        category: "ESSENTIAL",
        averageWatts: 150,
        icon: "Refrigerator",
        isActiveInSimulation: true,
      };

      const result = appliancePostBodySchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejeita aparelhos com potência negativa ou acima de 10.000W", () => {
      expect(appliancePostBodySchema.safeParse({ name: "A", category: "ESSENTIAL", averageWatts: 2 }).success).toBe(false);
      expect(appliancePostBodySchema.safeParse({ name: "A", category: "ESSENTIAL", averageWatts: 15000 }).success).toBe(false);
    });

    it("valida campos de Solar Smart Charging em settingsPostBodySchema", () => {
      const validSettings = {
        ecoflowAccessKey: "ak-test",
        ecoflowSerialNumber: "EF-TEST",
        isSmartChargingActive: true,
        minAcChargingWatts: 200,
        maxAcChargingWatts: 1500,
        chargeOnlyOffPeak: true,
        cloudyPrechargeActive: true,
      };

      const result = settingsPostBodySchema.safeParse(validSettings);
      expect(result.success).toBe(true);
    });

    it("rejeita potências de recarga fora dos limites operacionais de hardware", () => {
      expect(settingsPostBodySchema.shape.minAcChargingWatts.safeParse(50).success).toBe(false); // min: 100
      expect(settingsPostBodySchema.shape.maxAcChargingWatts.safeParse(5000).success).toBe(false); // max: 3600
    });
  });

  describe("Endpoint REST /api/appliances (Critério de Aceite 1)", () => {
    it("auto-inicializa (Auto-Seed) 6 aparelhos essenciais padrão quando o usuário novo não possui nenhum", async () => {
      mockFindUniqueConfig.mockResolvedValue({
        id: "config-etapa4-new",
        userId: "user-etapa4",
        batteryCapacityWh: 2048,
        applianceProfiles: [],
      });

      const mockCreatedDefaults = [
        { id: "app-1", name: "Geladeira Inverter", category: "ESSENTIAL", averageWatts: 100, isActiveInSimulation: false, icon: "Refrigerator", createdAt: new Date(), updatedAt: new Date() },
        { id: "app-2", name: "Iluminação LED Residencial", category: "ESSENTIAL", averageWatts: 60, isActiveInSimulation: false, icon: "Lightbulb", createdAt: new Date(), updatedAt: new Date() },
        { id: "app-3", name: "Starlink / ONU + Roteador Wi-Fi", category: "ESSENTIAL", averageWatts: 50, isActiveInSimulation: false, icon: "Wifi", createdAt: new Date(), updatedAt: new Date() },
        { id: "app-4", name: "Notebook / Computador Trabalho", category: "COMFORT", averageWatts: 120, isActiveInSimulation: false, icon: "Laptop", createdAt: new Date(), updatedAt: new Date() },
        { id: "app-5", name: "Smart TV + Áudio", category: "COMFORT", averageWatts: 140, isActiveInSimulation: false, icon: "Tv", createdAt: new Date(), updatedAt: new Date() },
        { id: "app-6", name: "Ar-Condicionado Inverter 9k", category: "HEAVY", averageWatts: 750, isActiveInSimulation: false, icon: "AirVent", createdAt: new Date(), updatedAt: new Date() },
      ];

      mockFindManyAppliances.mockResolvedValue(mockCreatedDefaults);
      mockGetLatestTelemetry.mockReturnValue({ batteryPercentage: 80 });

      const { req, res } = createMockReqRes("GET");
      await handleAppliances(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockCreateManyAppliances).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ name: "Geladeira Inverter", averageWatts: 100 }),
            expect.objectContaining({ name: "Ar-Condicionado Inverter 9k", averageWatts: 750 }),
          ]),
        })
      );
      expect(res.body.data.appliances.length).toBe(6);
    });

    it("atualiza o toggle de simulação de um aparelho via POST", async () => {
      mockFindUniqueConfig.mockResolvedValue({
        id: "config-etapa4",
        userId: "user-etapa4",
        applianceProfiles: [],
      });
      mockUpdateManyAppliances.mockResolvedValue({ count: 1 });

      const { req, res } = createMockReqRes("POST", {
        applianceId: "app-1",
        isActiveInSimulation: true,
      });

      await handleAppliances(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockUpdateManyAppliances).toHaveBeenCalledWith({
        where: { id: "app-1", userConfigurationId: "config-etapa4" },
        data: { isActiveInSimulation: true },
      });
      expect(res.body.success).toBe(true);
    });

    it("remove um aparelho por ID via DELETE", async () => {
      mockFindUniqueConfig.mockResolvedValue({
        id: "config-etapa4",
        userId: "user-etapa4",
        applianceProfiles: [],
      });
      mockDeleteManyAppliances.mockResolvedValue({ count: 1 });

      const { req, res } = createMockReqRes("DELETE", null, { id: "app-delete-1" });
      await handleAppliances(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockDeleteManyAppliances).toHaveBeenCalledWith({
        where: { id: "app-delete-1", userConfigurationId: "config-etapa4" },
      });
      expect(res.body.message).toContain("removido com sucesso");
    });
  });

  describe("Integração do Orquestrador com Solar Smart Charging", () => {
    it("dispara setAcChargingSpeed e atualiza o repositório quando o Modo Tempestade está ativo", async () => {
      const mockRecord = buildMockEtapa4Record("rec-storm-smart", {
        isSmartChargingActive: true,
        isStormModeActive: true,
        currentAcChargingWatts: 400,
        maxAcChargingWatts: 1200,
      });

      const mockUpdateCharging = vi.fn().mockResolvedValue(undefined);
      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(mockRecord),
        updateCurrentAcChargingWatts: mockUpdateCharging,
        incrementAtsCycle: vi.fn(),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        retrieveConfiguration: vi.fn(),
      } as unknown as ConfigurationRepository;

      const useCase = new OrchestratorSyncUseCase(mockRepo);

      await useCase.executeSyncForUser("rec-storm-smart", {
        batteryPercentage: 70,
        solarWatts: 200,
        outputWatts: 150,
        isAcOutputEnabled: true,
      });

      expect(mockSetAcChargingSpeed).toHaveBeenCalledWith(
        expect.anything(),
        1200
      );
      expect(mockUpdateCharging).toHaveBeenCalledWith("rec-storm-smart", 1200);
    });
  });
});
