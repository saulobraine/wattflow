import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMqttConnect,
  mockFetchMqttCertification,
  mockFetchDeviceTelemetry,
  mockSetAcOutputState,
  mockFindActiveConfigurationByUserId,
  mockRecordExecutionLog,
} = vi.hoisted(() => ({
  mockMqttConnect: vi.fn(),
  mockFetchMqttCertification: vi.fn(),
  mockFetchDeviceTelemetry: vi.fn(),
  mockSetAcOutputState: vi.fn(),
  mockFindActiveConfigurationByUserId: vi.fn(),
  mockRecordExecutionLog: vi.fn(),
}));

vi.mock("mqtt", () => ({
  default: {
    connect: mockMqttConnect,
  },
}));

vi.mock("../../http/EcoFlowHttpClient", () => ({
  EcoFlowHttpClient: vi.fn(function () {
    return {
      fetchMqttCertification: mockFetchMqttCertification,
      fetchDeviceTelemetry: mockFetchDeviceTelemetry,
      setAcOutputState: mockSetAcOutputState,
    };
  }),
}));

vi.mock("../../repositories/ConfigurationRepository", () => ({
  ConfigurationRepository: vi.fn(function () {
    return {
      recordExecutionLog: mockRecordExecutionLog,
      findActiveConfigurationByUserId: mockFindActiveConfigurationByUserId,
      incrementAtsCycle: vi.fn().mockResolvedValue(1),
    };
  }),
}));

import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { DeviceSerialNumber } from "../../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { EcoFlowMqttStreamService } from "../EcoFlowMqttStreamService";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
import {
  registerManualAcOverride,
  isManualAcOverrideActive,
  resetManualAcOverrideState,
} from "../../security/rateLimiter";
import { AutomationThresholdPair } from "../../../domain/models/AutomationThresholdPair";
import { PercentageValue } from "../../../domain/values/PercentageValue";
import { AutomationProfile } from "../../../domain/models/AutomationProfile";
import { DevicePair } from "../../../domain/models/DevicePair";
import { CredentialsBundle } from "../../../domain/models/CredentialsBundle";
import { OrchestratorConfiguration } from "../../../domain/models/OrchestratorConfiguration";

function createFakeMqttClient() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    connected: true,
    reconnecting: false,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb);
    }),
    removeAllListeners: vi.fn(),
    subscribe: vi.fn(),
    end: vi.fn(),
    emitEvent(event: string, ...args: unknown[]) {
      handlers.get(event)?.(...args);
    },
  };
}

function buildMockConfigRecord(recordId: string, overrides: Record<string, unknown> = {}) {
  const credentials = new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("as-test"));
  const bundle = new CredentialsBundle(credentials);
  const serial = new DeviceSerialNumber("SN-CONCUR-TEST");
  const devices = new DevicePair(serial);
  const thresholds = new AutomationThresholdPair(new PercentageValue(80), new PercentageValue(30));
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
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

describe("Automation Concurrency, Mutex & Manual Override Hierarchy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetManualAcOverrideState();
    OrchestratorSyncUseCase.resetLoggedStatesForTests();
    OrchestratorSyncUseCase.resetActiveUserSyncsForTests();
    EcoFlowMqttStreamService.getInstance().stopStream();
    mockSetAcOutputState.mockResolvedValue("SUCCESS");
  });

  afterEach(() => {
    EcoFlowMqttStreamService.getInstance().stopStream();
    resetManualAcOverrideState();
  });

  describe("OrchestratorSyncUseCase Mutex per User", () => {
    it("deduplicates concurrent executeSyncForUser calls for the same user, running only once", async () => {
      let resolveConfig: (val: unknown) => void;
      const delayedConfigPromise = new Promise((resolve) => {
        resolveConfig = resolve;
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockImplementation(async () => {
          await delayedConfigPromise;
          return buildMockConfigRecord("rec-concur-1", {
            lastBatteryPercentage: 75,
          });
        }),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(1),
      };

      const useCase = new OrchestratorSyncUseCase(mockRepo as any);

      // Dispara 2 chamadas simultâneas (ex.: MQTT Stream + Live Cron)
      const promise1 = useCase.executeSyncForUser("user-concur", {
        batteryPercentage: 75,
        solarWatts: 200,
        outputWatts: 100,
        isAcOutputEnabled: true,
      });

      const promise2 = useCase.executeSyncForUser("user-concur", {
        batteryPercentage: 75,
        solarWatts: 200,
        outputWatts: 100,
        isAcOutputEnabled: true,
      });

      // Libera a busca no repositório
      resolveConfig!(undefined);

      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect(res1.hasExecutedSuccessfully).toBe(true);
      expect(res2.hasExecutedSuccessfully).toBe(true);

      // Repositório deve ter sido chamado exatamente UMA vez para o mesmo usuário
      expect(mockRepo.findActiveConfigurationByUserId).toHaveBeenCalledTimes(1);

      // Chamada posterior (após finalização) executa normalmente e limpa o mutex
      const res3 = await useCase.executeSyncForUser("user-concur", {
        batteryPercentage: 76,
        solarWatts: 210,
        outputWatts: 100,
        isAcOutputEnabled: true,
      });
      expect(res3.hasExecutedSuccessfully).toBe(true);
      expect(mockRepo.findActiveConfigurationByUserId).toHaveBeenCalledTimes(2);
    });

    it("allows different users to sync concurrently without blocking each other", async () => {
      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockImplementation(async (userId: string) => {
          return buildMockConfigRecord(`rec-${userId}`);
        }),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(1),
      };

      const useCase = new OrchestratorSyncUseCase(mockRepo as any);

      const [resUserA, resUserB] = await Promise.all([
        useCase.executeSyncForUser("user-A", {
          batteryPercentage: 80,
          solarWatts: 300,
          outputWatts: 100,
          isAcOutputEnabled: false,
        }),
        useCase.executeSyncForUser("user-B", {
          batteryPercentage: 50,
          solarWatts: 100,
          outputWatts: 50,
          isAcOutputEnabled: true,
        }),
      ]);

      expect(resUserA.hasExecutedSuccessfully).toBe(true);
      expect(resUserB.hasExecutedSuccessfully).toBe(true);
      expect(mockRepo.findActiveConfigurationByUserId).toHaveBeenCalledWith("user-A");
      expect(mockRepo.findActiveConfigurationByUserId).toHaveBeenCalledWith("user-B");
    });
  });

  describe("Manual AC Override Cooldown & Hierarchy", () => {
    it("registers manual override and enforces cooldown window", () => {
      expect(isManualAcOverrideActive("user-override-1")).toBe(false);

      registerManualAcOverride("user-override-1", 500); // 500ms
      expect(isManualAcOverrideActive("user-override-1")).toBe(true);
    });

    it("EcoFlowMqttStreamService aborts automation evaluation when manual override is active", async () => {
      const fakeClient = createFakeMqttClient();
      mockMqttConnect.mockReturnValue(fakeClient);
      mockFetchMqttCertification.mockResolvedValue({
        protocol: "mqtts",
        brokerHost: "mqtt.ecoflow.com",
        brokerPort: 8883,
        certificateAccount: "acct-override",
        certificatePassword: "pass-override",
      });

      const mockDb = {
        syncExecutionLog: { create: vi.fn().mockResolvedValue({}) },
        userConfiguration: {
          findUnique: vi.fn().mockResolvedValue({
            id: "cfg-override",
            userId: "user-override",
            isAutomationActive: true,
          }),
        },
      } as unknown as PrismaClient;

      const service = EcoFlowMqttStreamService.getInstance();
      await service.startStream({
        userId: "user-override",
        credentials: new EcoFlowCredentials(new AccessKey("ak-o"), new AccessSecret("as-o")),
        serialNumber: new DeviceSerialNumber("SN-OVERRIDE"),
        baseApiUrl: "https://api.ecoflow.com",
        databaseClient: mockDb,
        userConfigurationId: "cfg-override",
      });

      // Ativa override manual para o usuário
      registerManualAcOverride("user-override", 10_000);

      // Envia telemetria normal com bateria 92% e AC desligado (normalmente ligaria AC)
      fakeClient.emitEvent(
        "message",
        "/open/acct-override/SN-OVERRIDE/quota",
        Buffer.from(
          JSON.stringify({
            params: {
              "bmsMaster.soc": 92,
              "mppt.inWatts": 400,
              "inv.cfgAcEnabled": 0,
            },
          })
        )
      );

      await new Promise((r) => setTimeout(r, 50));

      // Deve ter abortado a comutação e NÃO acionado o ligamento da AC
      expect(mockSetAcOutputState).not.toHaveBeenCalled();
    });

    it("bypasses manual override when battery reaches critical threshold (<= 10%)", async () => {
      const fakeClient = createFakeMqttClient();
      mockMqttConnect.mockReturnValue(fakeClient);
      mockFetchMqttCertification.mockResolvedValue({
        protocol: "mqtts",
        brokerHost: "mqtt.ecoflow.com",
        brokerPort: 8883,
        certificateAccount: "acct-crit-override",
        certificatePassword: "pass-crit-override",
      });

      const record = buildMockConfigRecord("rec-crit-override", {
        lastBatteryPercentage: 15,
      });
      mockFindActiveConfigurationByUserId.mockResolvedValue(record);

      const mockDb = {
        syncExecutionLog: { create: vi.fn().mockResolvedValue({}) },
        userConfiguration: {
          findUnique: vi.fn().mockResolvedValue({
            id: "cfg-crit-override",
            userId: "user-crit-override",
            isAutomationActive: true,
          }),
        },
      } as unknown as PrismaClient;

      const service = EcoFlowMqttStreamService.getInstance();
      await service.startStream({
        userId: "user-crit-override",
        credentials: new EcoFlowCredentials(new AccessKey("ak-co"), new AccessSecret("as-co")),
        serialNumber: new DeviceSerialNumber("SN-CRIT-OVERRIDE"),
        baseApiUrl: "https://api.ecoflow.com",
        databaseClient: mockDb,
        userConfigurationId: "cfg-crit-override",
      });

      registerManualAcOverride("user-crit-override", 10_000);

      // Bateria crítica em 8% com AC ligado -> deve ignorar o override e comutar para rede
      fakeClient.emitEvent(
        "message",
        "/open/acct-crit-override/SN-CRIT-OVERRIDE/quota",
        Buffer.from(
          JSON.stringify({
            params: {
              "bmsMaster.soc": 8,
              "inv.cfgAcEnabled": 1,
            },
          })
        )
      );

      await new Promise((r) => setTimeout(r, 60));

      // Segurança crítica: executou a comutação para desligar AC
      expect(mockSetAcOutputState).toHaveBeenCalledWith(expect.anything(), false);
    });
  });
});
