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
import { LiveTelemetryService, resetLiveTelemetryStateForTests } from "../LiveTelemetryService";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
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
  const serial = new DeviceSerialNumber("SN-DROPOUT-TEST");
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

describe("MQTT Zero-SOC Dropout & False ATS Switching Prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLiveTelemetryStateForTests();
    EcoFlowMqttStreamService.getInstance().stopStream();
    mockSetAcOutputState.mockResolvedValue("SUCCESS");
  });

  afterEach(() => {
    EcoFlowMqttStreamService.getInstance().stopStream();
  });

  describe("EcoFlowMqttStreamService - Cold Snapshot & Anti-Dropout Filter", () => {
    it("preserves batteryPercentage as null on cold start when partial packet has no SOC", async () => {
      const fakeClient = createFakeMqttClient();
      mockMqttConnect.mockReturnValue(fakeClient);
      mockFetchMqttCertification.mockResolvedValue({
        protocol: "mqtts",
        brokerHost: "mqtt.ecoflow.com",
        brokerPort: 8883,
        certificateAccount: "acct-cold",
        certificatePassword: "pass-cold",
      });

      const mockCreate = vi.fn().mockResolvedValue({});
      const mockDatabaseClient = {
        syncExecutionLog: { create: mockCreate },
        userConfiguration: {
          findUnique: vi.fn().mockResolvedValue({ id: "cfg-cold", userId: "user-cold", isAutomationActive: true }),
        },
      } as unknown as PrismaClient;

      const service = EcoFlowMqttStreamService.getInstance();
      await service.startStream({
        userId: "user-cold",
        credentials: new EcoFlowCredentials(new AccessKey("ak-c"), new AccessSecret("as-c")),
        serialNumber: new DeviceSerialNumber("SN-COLD"),
        baseApiUrl: "https://api.ecoflow.com",
        databaseClient: mockDatabaseClient,
        userConfigurationId: "cfg-cold",
      });

      // Partial packet containing only MPPT solar input and no SOC info
      fakeClient.emitEvent(
        "message",
        "/open/acct-cold/SN-COLD/quota",
        Buffer.from(
          JSON.stringify({
            moduleType: 5,
            typeCode: "mpptStatus",
            params: {
              inWatts: 320,
              outWatts: 300,
            },
          })
        )
      );

      await new Promise((r) => setTimeout(r, 50));

      const telemetry = service.getLatestTelemetry("user-cold");
      expect(telemetry).not.toBeNull();
      // Crucial: Must be null, NOT 0!
      expect(telemetry?.batteryPercentage).toBeNull();
      expect(telemetry?.solarInputWatts).toBe(320);

      // Must NOT evaluate automation (no AC switching attempted)
      expect(mockSetAcOutputState).not.toHaveBeenCalled();

      // Must NOT persist invalid null telemetry to database
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("rejects transient 0% SOC glitch when previous valid battery was > 15%", async () => {
      const fakeClient = createFakeMqttClient();
      mockMqttConnect.mockReturnValue(fakeClient);
      mockFetchMqttCertification.mockResolvedValue({
        protocol: "mqtts",
        brokerHost: "mqtt.ecoflow.com",
        brokerPort: 8883,
        certificateAccount: "acct-glitch",
        certificatePassword: "pass-glitch",
      });

      const mockCreate = vi.fn().mockResolvedValue({});
      const mockDatabaseClient = {
        syncExecutionLog: { create: mockCreate },
        userConfiguration: {
          findUnique: vi.fn().mockResolvedValue({ id: "cfg-glitch", userId: "user-glitch", isAutomationActive: true }),
        },
      } as unknown as PrismaClient;

      const service = EcoFlowMqttStreamService.getInstance();
      await service.startStream({
        userId: "user-glitch",
        credentials: new EcoFlowCredentials(new AccessKey("ak-g"), new AccessSecret("as-g")),
        serialNumber: new DeviceSerialNumber("SN-GLITCH"),
        baseApiUrl: "https://api.ecoflow.com",
        databaseClient: mockDatabaseClient,
        userConfigurationId: "cfg-glitch",
      });

      // 1. First packet arrives with valid 82% battery
      fakeClient.emitEvent(
        "message",
        "/open/acct-glitch/SN-GLITCH/quota",
        Buffer.from(
          JSON.stringify({
            params: {
              "bmsMaster.soc": 82,
              "mppt.inWatts": 450,
              "inv.cfgAcEnabled": 1,
            },
          })
        )
      );

      await new Promise((r) => setTimeout(r, 50));
      expect(service.getLatestTelemetry("user-glitch")?.batteryPercentage).toBe(82);

      // 2. Transient glitch packet arrives with soc = 0
      fakeClient.emitEvent(
        "message",
        "/open/acct-glitch/SN-GLITCH/quota",
        Buffer.from(
          JSON.stringify({
            params: {
              "bmsMaster.soc": 0,
              "mppt.inWatts": 450,
            },
          })
        )
      );

      await new Promise((r) => setTimeout(r, 50));

      const latest = service.getLatestTelemetry("user-glitch");
      // The anti-dropout filter must have rejected the 0% and preserved 82%
      expect(latest?.batteryPercentage).toBe(82);

      // Must not turn off AC due to 0% dropout
      expect(mockSetAcOutputState).not.toHaveBeenCalledWith(expect.anything(), false);
    });

    it("allows genuine low battery (0%) when previous battery was already <= 15%", async () => {
      const fakeClient = createFakeMqttClient();
      mockMqttConnect.mockReturnValue(fakeClient);
      mockFetchMqttCertification.mockResolvedValue({
        protocol: "mqtts",
        brokerHost: "mqtt.ecoflow.com",
        brokerPort: 8883,
        certificateAccount: "acct-low",
        certificatePassword: "pass-low",
      });

      const mockDatabaseClient = {
        syncExecutionLog: { create: vi.fn().mockResolvedValue({}) },
        userConfiguration: {
          findUnique: vi.fn().mockResolvedValue({ id: "cfg-low", userId: "user-low", isAutomationActive: true }),
        },
      } as unknown as PrismaClient;

      const service = EcoFlowMqttStreamService.getInstance();
      await service.startStream({
        userId: "user-low",
        credentials: new EcoFlowCredentials(new AccessKey("ak-l"), new AccessSecret("as-l")),
        serialNumber: new DeviceSerialNumber("SN-LOW"),
        baseApiUrl: "https://api.ecoflow.com",
        databaseClient: mockDatabaseClient,
        userConfigurationId: "cfg-low",
      });

      // Battery at 12%
      fakeClient.emitEvent(
        "message",
        "/open/acct-low/SN-LOW/quota",
        Buffer.from(JSON.stringify({ params: { "bmsMaster.soc": 12 } }))
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(service.getLatestTelemetry("user-low")?.batteryPercentage).toBe(12);

      // Now drops to 0% (genuine depletion from low state <= 15%)
      fakeClient.emitEvent(
        "message",
        "/open/acct-low/SN-LOW/quota",
        Buffer.from(JSON.stringify({ params: { "bmsMaster.soc": 0 } }))
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(service.getLatestTelemetry("user-low")?.batteryPercentage).toBe(0);
    });
  });

  describe("OrchestratorSyncUseCase - Dropout Protection", () => {
    it("protects against false cutoff when providedTelemetry has SOC <= 0 but configurationRecord has lastBatteryPercentage > 15", async () => {
      const record = buildMockConfigRecord("rec-ats-protect", {
        lastBatteryPercentage: 78,
      });

      const repo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        incrementAtsCycle: vi.fn().mockResolvedValue(10),
      };

      const useCase = new OrchestratorSyncUseCase(repo as any);

      // Provided telemetry has batteryPercentage: 0 (dropout)
      const result = await useCase.executeSyncForUser("user-protect", {
        batteryPercentage: 0,
        solarWatts: 200,
        outputWatts: 150,
        isAcOutputEnabled: true,
      });

      // The use case should have recovered the 78% from lastBatteryPercentage
      expect(result.batteryPercentage).toBe(78);
      // It should NOT have turned off the AC
      expect(mockSetAcOutputState).not.toHaveBeenCalledWith(expect.anything(), false);
    });
  });

  describe("LiveTelemetryService - Null Battery Guard", () => {
    it("returns null and does not execute sync when memory telemetry batteryPercentage is null", async () => {
      const fakeClient = createFakeMqttClient();
      mockMqttConnect.mockReturnValue(fakeClient);
      mockFetchMqttCertification.mockResolvedValue({
        protocol: "mqtts",
        brokerHost: "mqtt.ecoflow.com",
        brokerPort: 8883,
        certificateAccount: "acct-live-null",
        certificatePassword: "pass-live-null",
      });

      const mockDb = {
        userConfiguration: {
          findUnique: vi.fn().mockResolvedValue({
            id: "cfg-live",
            userId: "user-live",
            ecoflowAccessKey: "ak",
            ecoflowAccessSecret: "as",
            ecoflowSerialNumber: "sn",
          }),
        },
      } as unknown as PrismaClient;

      const streamService = EcoFlowMqttStreamService.getInstance();
      await streamService.startStream({
        userId: "user-live",
        credentials: new EcoFlowCredentials(new AccessKey("ak"), new AccessSecret("as")),
        serialNumber: new DeviceSerialNumber("SN-LIVE"),
        baseApiUrl: "https://api.ecoflow.com",
        databaseClient: mockDb,
        userConfigurationId: "cfg-live",
      });

      // Push a packet without battery
      fakeClient.emitEvent(
        "message",
        "/open/acct-live-null/SN-LIVE/quota",
        Buffer.from(JSON.stringify({ params: { "mppt.inWatts": 500 } }))
      );

      const liveService = new LiveTelemetryService(mockDb);
      const syncResult = await liveService.syncIfStale("user-live", 100);

      // Should safely return null without triggering sync
      expect(syncResult).toBeNull();
    });
  });
});
