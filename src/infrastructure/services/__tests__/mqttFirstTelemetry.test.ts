import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMqttConnect,
  mockFetchMqttCertification,
  mockExecuteSyncForUser,
  mockRecordExecutionLog,
  mockFindLatestExecutionLog,
} = vi.hoisted(() => ({
  mockMqttConnect: vi.fn(),
  mockFetchMqttCertification: vi.fn(),
  mockExecuteSyncForUser: vi.fn(),
  mockRecordExecutionLog: vi.fn(),
  mockFindLatestExecutionLog: vi.fn(),
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
      fetchDeviceTelemetry: vi.fn().mockResolvedValue({
        batteryLevel: { transferBatteryPercentage: (cb: (n: number) => void) => cb(85) },
        solarWatts: { transferNumericWatts: (cb: (n: number) => void) => cb(120) },
        outputWatts: 50,
        isAcOutputEnabled: true,
      }),
      setAcOutputState: vi.fn().mockResolvedValue("SUCCESS"),
    };
  }),
}));

vi.mock("../../repositories/ConfigurationRepository", () => ({
  ConfigurationRepository: vi.fn(function () {
    return {
      recordExecutionLog: mockRecordExecutionLog,
      findLatestExecutionLog: mockFindLatestExecutionLog,
    };
  }),
}));

import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { DeviceSerialNumber } from "../../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { EcoFlowMqttStreamService } from "../EcoFlowMqttStreamService";
import { LiveTelemetryService, resetLiveTelemetryStateForTests } from "../LiveTelemetryService";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
import { ConfigurationRepository } from "../../repositories/ConfigurationRepository";
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

describe("MQTT-First Telemetry & Throttled Database Writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLiveTelemetryStateForTests();
    OrchestratorSyncUseCase.resetLoggedStatesForTests();
    EcoFlowMqttStreamService.getInstance().stopStream();
  });

  afterEach(() => {
    vi.useRealTimers();
    EcoFlowMqttStreamService.getInstance().stopStream();
  });

  describe("EcoFlowMqttStreamService persistTelemetryThrottled", () => {
    it("throttles static telemetry writes to 5 minutes but persists immediately on AC state transition", async () => {
      const fakeClient = createFakeMqttClient();
      mockMqttConnect.mockReturnValue(fakeClient);
      mockFetchMqttCertification.mockResolvedValue({
        protocol: "mqtts",
        url: "mqtt.ecoflow.com",
        port: 8883,
        certificateAccount: "acct-test",
        certificatePassword: "pass-test",
      });

      const mockSyncExecutionLogCreate = vi.fn().mockResolvedValue({});
      const mockDatabaseClient = {
        syncExecutionLog: {
          create: mockSyncExecutionLogCreate,
        },
      } as unknown as PrismaClient;

      const service = EcoFlowMqttStreamService.getInstance();
      await service.startStream({
        userId: "user-throttle",
        credentials: new EcoFlowCredentials(new AccessKey("ak-1234"), new AccessSecret("as-1234")),
        serialNumber: new DeviceSerialNumber("SN123456"),
        baseApiUrl: "https://api.ecoflow.com",
        databaseClient: mockDatabaseClient,
        userConfigurationId: "cfg-123",
      });

      // 1. Initial telemetry message (should persist initial snapshot)
      fakeClient.emitEvent(
        "message",
        "/open/acct-test/SN123456/quota",
        Buffer.from(JSON.stringify({
          params: {
            "bmsMaster.soc": 80,
            "mppt.inWatts": 100,
            "pd.wattsOutSum": 50,
            "inv.cfgAcEnabled": 1,
          },
        }))
      );

      expect(mockSyncExecutionLogCreate).toHaveBeenCalledTimes(1);
      expect(mockSyncExecutionLogCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            batteryPercentage: 80,
            actionTriggered: "MQTT_STREAM",
          }),
        })
      );

      // 2. Second message 10s later with same AC state (should be throttled, 0 new writes)
      fakeClient.emitEvent(
        "message",
        "/open/acct-test/SN123456/quota",
        Buffer.from(JSON.stringify({
          params: {
            "bmsMaster.soc": 80,
            "mppt.inWatts": 105,
            "pd.wattsOutSum": 52,
            "inv.cfgAcEnabled": 1,
          },
        }))
      );

      expect(mockSyncExecutionLogCreate).toHaveBeenCalledTimes(1);

      // 3. Third message: AC state changes from enabled (1) to disabled (0)
      fakeClient.emitEvent(
        "message",
        "/open/acct-test/SN123456/quota",
        Buffer.from(JSON.stringify({
          params: {
            "bmsMaster.soc": 25,
            "mppt.inWatts": 0,
            "pd.wattsOutSum": 0,
            "inv.cfgAcEnabled": 0,
          },
        }))
      );

      // Must persist immediately due to AC state transition!
      expect(mockSyncExecutionLogCreate).toHaveBeenCalledTimes(2);
      expect(mockSyncExecutionLogCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            batteryPercentage: 25,
            actionTriggered: "DISABLE_ECOFLOW_AC",
          }),
        })
      );
    });
  });

  describe("LiveTelemetryService MQTT-First short-circuit", () => {
    it("returns null immediately (0 HTTP calls) when MQTT stream is connected", async () => {
      const fakeClient = createFakeMqttClient();
      mockMqttConnect.mockReturnValue(fakeClient);
      mockFetchMqttCertification.mockResolvedValue({
        protocol: "mqtts",
        url: "mqtt.ecoflow.com",
        port: 8883,
        certificateAccount: "acct-live",
        certificatePassword: "pass-live",
      });

      const service = EcoFlowMqttStreamService.getInstance();
      await service.startStream({
        userId: "user-connected",
        credentials: new EcoFlowCredentials(new AccessKey("ak-1234"), new AccessSecret("as-1234")),
        serialNumber: new DeviceSerialNumber("SN999999"),
        baseApiUrl: "https://api.ecoflow.com",
      });

      expect(service.isStreamConnected("user-connected")).toBe(true);

      const liveService = new LiveTelemetryService({} as PrismaClient);
      const result = await liveService.syncIfStale("user-connected", 2000);

      expect(result).toBeNull();
      // Zero HTTP REST calls to executeSyncForUser!
      expect(mockExecuteSyncForUser).not.toHaveBeenCalled();
    });
  });

  describe("OrchestratorSyncUseCase throttled execution logging", () => {
    function buildMockConfigurationRecord(recordId: string, isAutomationActive = false) {
      const ecoflowKey = new AccessKey("ak-test-key");
      const ecoflowSecret = new AccessSecret("as-test-secret");
      const credentials = new EcoFlowCredentials(ecoflowKey, ecoflowSecret);
      const bundle = new CredentialsBundle(credentials);

      const serial = new DeviceSerialNumber("SN123456");
      const devices = new DevicePair(serial);
      const thresholds = new AutomationThresholdPair(new PercentageValue(80), new PercentageValue(30));
      const profile = new AutomationProfile(devices, thresholds);

      const configuration = new OrchestratorConfiguration(bundle, profile);

      return {
        databaseRecordId: recordId,
        ecoflowEndpointRegion: "https://api.ecoflow.com",
        isAutomationActive,
        notificationConfig: {
          telegramBotToken: "",
          telegramChatId: "",
          whatsappPhoneNumber: "",
          whatsappApiKey: "",
          isNotificationActive: false,
        },
        configuration,
      };
    }

    it("skips duplicate logs during MONITORAMENTO when battery SOC does not vary by >= 1%", async () => {
      const record = buildMockConfigurationRecord("rec-1", false);
      const repo = new ConfigurationRepository({} as PrismaClient);

      // Stub findActiveConfigurationByUserId to return our record
      (repo as unknown as { findActiveConfigurationByUserId: unknown }).findActiveConfigurationByUserId =
        vi.fn().mockResolvedValue(record);

      const useCase = new OrchestratorSyncUseCase(repo);

      // 1. First sync records initial state
      const res1 = await useCase.executeSyncForUser("user-1");
      expect(res1.hasExecutedSuccessfully).toBe(true);
      expect(mockRecordExecutionLog).toHaveBeenCalledTimes(1);
      expect(mockRecordExecutionLog).toHaveBeenLastCalledWith(
        "rec-1",
        85,
        "MONITORAMENTO",
        expect.any(String),
        120,
        50
      );

      // 2. Second sync with identical battery (85%) skips logging!
      const res2 = await useCase.executeSyncForUser("user-1");
      expect(res2.hasExecutedSuccessfully).toBe(true);
      expect(mockRecordExecutionLog).toHaveBeenCalledTimes(1); // Still 1!
    });
  });
});
