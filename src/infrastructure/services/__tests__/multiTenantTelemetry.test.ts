import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockMqttConnect, mockFetchMqttCertification, mockExecuteSyncForUser } = vi.hoisted(() => ({
  mockMqttConnect: vi.fn(),
  mockFetchMqttCertification: vi.fn(),
  mockExecuteSyncForUser: vi.fn(),
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
    };
  }),
}));

vi.mock("../../repositories/ConfigurationRepository", () => ({
  ConfigurationRepository: vi.fn(function () {
    return {};
  }),
}));

vi.mock("../../../application/OrchestratorSyncUseCase", () => ({
  OrchestratorSyncUseCase: vi.fn(function () {
    return {
      executeSyncForUser: mockExecuteSyncForUser,
    };
  }),
}));

import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { DeviceSerialNumber } from "../../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { EcoFlowMqttStreamService } from "../EcoFlowMqttStreamService";
import { LiveTelemetryService, resetLiveTelemetryStateForTests } from "../LiveTelemetryService";

function createFakeMqttClient(overrides: { connected?: boolean; reconnecting?: boolean } = {}) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    connected: overrides.connected ?? true,
    reconnecting: overrides.reconnecting ?? false,
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

describe("Multi-tenant telemetry & MQTT stream isolation (SEC-08)", () => {
  const originalDisableLocalCron = process.env.DISABLE_LOCAL_CRON;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_LOCAL_CRON;
    resetLiveTelemetryStateForTests();
    EcoFlowMqttStreamService.getInstance().stopStream();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalDisableLocalCron === undefined) {
      delete process.env.DISABLE_LOCAL_CRON;
    } else {
      process.env.DISABLE_LOCAL_CRON = originalDisableLocalCron;
    }
    EcoFlowMqttStreamService.getInstance().stopStream();
  });

  describe("EcoFlowMqttStreamService", () => {
    it("isolates MQTT clients, telemetry snapshots, and stopStream by userId and enforces rejectUnauthorized: true", async () => {
      const clientA = createFakeMqttClient();
      const clientB = createFakeMqttClient();

      mockMqttConnect.mockReturnValueOnce(clientA).mockReturnValueOnce(clientB);

      mockFetchMqttCertification
        .mockResolvedValueOnce({
          protocol: "mqtts",
          url: "mqtt.ecoflow.com",
          port: 8883,
          certificateAccount: "acct-A",
          certificatePassword: "pass-A",
        })
        .mockResolvedValueOnce({
          protocol: "mqtts",
          url: "mqtt-e.ecoflow.com",
          port: 8883,
          certificateAccount: "acct-B",
          certificatePassword: "pass-B",
        });

      const service = EcoFlowMqttStreamService.getInstance();

      await service.startStream({
        userId: "user-A",
        credentials: new EcoFlowCredentials(new AccessKey("ak-A-1234"), new AccessSecret("as-A-1234")),
        serialNumber: new DeviceSerialNumber("SNA00001"),
        baseApiUrl: "https://api.ecoflow.com",
      });

      await service.startStream({
        userId: "user-B",
        credentials: new EcoFlowCredentials(new AccessKey("ak-B-1234"), new AccessSecret("as-B-1234")),
        serialNumber: new DeviceSerialNumber("SNB00002"),
        baseApiUrl: "https://api-e.ecoflow.com",
      });

      // Verify TLS rejectUnauthorized: true on both connections
      expect(mockMqttConnect).toHaveBeenNthCalledWith(
        1,
        "mqtts://mqtt.ecoflow.com:8883",
        expect.objectContaining({ rejectUnauthorized: true, username: "acct-A" })
      );
      expect(mockMqttConnect).toHaveBeenNthCalledWith(
        2,
        "mqtts://mqtt-e.ecoflow.com:8883",
        expect.objectContaining({ rejectUnauthorized: true, username: "acct-B" })
      );

      // Simulate telemetry message on user-A only
      clientA.emitEvent(
        "message",
        "/open/acct-A/SNA00001/quota",
        Buffer.from(JSON.stringify({ params: { "bmsMaster.soc": 88, "mppt.inWatts": 320 } }))
      );

      expect(service.getLatestTelemetry("user-A")?.batteryPercentage).toBe(88);
      expect(service.getLatestTelemetry("user-B")).toBeNull();
      expect(service.isStreamConnected("user-A")).toBe(true);
      expect(service.isStreamConnected("user-B")).toBe(true);

      // Stopping user-A must not affect user-B
      service.stopStream("user-A");
      expect(clientA.end).toHaveBeenCalledWith(true);
      expect(clientB.end).not.toHaveBeenCalled();
      expect(service.isStreamConnected("user-A")).toBe(false);
      expect(service.isStreamConnected("user-B")).toBe(true);
    });

    it("throws when userId is missing in startStream", async () => {
      const service = EcoFlowMqttStreamService.getInstance();
      await expect(
        service.startStream({
          userId: "   ",
          credentials: new EcoFlowCredentials(new AccessKey("ak-1234"), new AccessSecret("as-1234")),
          serialNumber: new DeviceSerialNumber("SN00001"),
          baseApiUrl: "https://api.ecoflow.com",
        })
      ).rejects.toThrow(/userId é obrigatório/);
    });

    it("does not duplicate client when reconnecting=true and disposes old disconnected client", async () => {
      const reconnectingClient = createFakeMqttClient({ connected: false, reconnecting: true });
      mockMqttConnect.mockReturnValueOnce(reconnectingClient);
      mockFetchMqttCertification.mockResolvedValue({
        protocol: "mqtts",
        url: "mqtt.ecoflow.com",
        port: 8883,
        certificateAccount: "acct-R",
        certificatePassword: "pass-R",
      });

      const service = EcoFlowMqttStreamService.getInstance();
      const config = {
        userId: "user-reconn",
        credentials: new EcoFlowCredentials(new AccessKey("ak-R-1234"), new AccessSecret("as-R-1234")),
        serialNumber: new DeviceSerialNumber("SNR00001"),
        baseApiUrl: "https://api.ecoflow.com",
      };

      await service.startStream(config);
      expect(mockMqttConnect).toHaveBeenCalledTimes(1);

      // Second call while reconnecting=true must be a no-op
      await service.startStream(config);
      expect(mockMqttConnect).toHaveBeenCalledTimes(1);

      // When client is neither connected nor reconnecting (and close cleared isConnecting), startStream recycles it via disposeUserClient
      reconnectingClient.reconnecting = false;
      reconnectingClient.emitEvent("close");
      const freshClient = createFakeMqttClient({ connected: true, reconnecting: false });
      mockMqttConnect.mockReturnValueOnce(freshClient);

      await service.startStream(config);
      expect(mockMqttConnect).toHaveBeenCalledTimes(2);
      expect(reconnectingClient.removeAllListeners).toHaveBeenCalledTimes(1);
      expect(reconnectingClient.end).toHaveBeenCalledWith(true);
    });

    it("correctly parses modular MQTT telemetry for solar input, dual PV inputs, inverter and AC states", async () => {
      const client = createFakeMqttClient();
      mockMqttConnect.mockReturnValueOnce(client);
      mockFetchMqttCertification.mockResolvedValueOnce({
        protocol: "mqtts",
        url: "mqtt.ecoflow.com",
        port: 8883,
        certificateAccount: "acct-solar",
        certificatePassword: "pass-solar",
      });

      const service = EcoFlowMqttStreamService.getInstance();
      await service.startStream({
        userId: "user-solar",
        credentials: new EcoFlowCredentials(new AccessKey("ak-solar"), new AccessSecret("as-solar")),
        serialNumber: new DeviceSerialNumber("SN-SOLAR-01"),
        baseApiUrl: "https://api.ecoflow.com",
      });

      // 1. MPPT modular packet with direct inWatts
      client.emitEvent(
        "message",
        "/open/acct-solar/SN-SOLAR-01/quota",
        Buffer.from(
          JSON.stringify({
            moduleType: 5,
            typeCode: "mpptStatus",
            params: { inWatts: 350, outWatts: 340 },
          })
        )
      );

      let snapshot = service.getLatestTelemetry("user-solar");
      expect(snapshot?.solarInputWatts).toBe(350);
      // outWatts in MPPT must NOT be interpreted as inverter outputWatts
      expect(snapshot?.outputWatts).toBe(0);

      // 2. MPPT dual-input packet (inWatts + pv2InWatts)
      client.emitEvent(
        "message",
        "/open/acct-solar/SN-SOLAR-01/quota",
        Buffer.from(
          JSON.stringify({
            moduleType: 5,
            typeCode: "mpptStatus",
            params: { inWatts: 200, pv2InWatts: 150 },
          })
        )
      );

      snapshot = service.getLatestTelemetry("user-solar");
      expect(snapshot?.solarInputWatts).toBe(350);

      // 3. Nested object format { mppt: { inWatts: 180, pv2InWatts: 20 } }
      client.emitEvent(
        "message",
        "/open/acct-solar/SN-SOLAR-01/quota",
        Buffer.from(
          JSON.stringify({
            params: { mppt: { inWatts: 180, pv2InWatts: 20 } },
          })
        )
      );

      snapshot = service.getLatestTelemetry("user-solar");
      expect(snapshot?.solarInputWatts).toBe(200);

      // 4. Inverter modular packet with cfgAcEnabled: 1 and outWatts: 450
      client.emitEvent(
        "message",
        "/open/acct-solar/SN-SOLAR-01/quota",
        Buffer.from(
          JSON.stringify({
            moduleType: 3,
            typeCode: "invStatus",
            params: { cfgAcEnabled: 1, outWatts: 450 },
          })
        )
      );

      snapshot = service.getLatestTelemetry("user-solar");
      expect(snapshot?.isAcOutputEnabled).toBe(true);
      expect(snapshot?.outputWatts).toBe(450);
      // Solar input preserved from previous snapshot
      expect(snapshot?.solarInputWatts).toBe(200);
    });
  });

  describe("LiveTelemetryService", () => {
    it("awaits inFlightSync before checking maxAgeMs for concurrent callers of the same user", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));

      const mockPrisma = {
        userConfiguration: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient;

      let resolveSync!: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolveSync = resolve;
      });
      mockExecuteSyncForUser.mockReturnValueOnce(pendingPromise);

      const liveService = new LiveTelemetryService(mockPrisma);

      const caller1 = liveService.syncIfStale("user-concurrent", 2000);
      // Let startForUser microtask settle so inFlightSync is assigned
      await Promise.resolve();
      const caller2 = liveService.syncIfStale("user-concurrent", 2000);

      resolveSync({
        hasExecutedSuccessfully: true,
        batteryPercentage: 91,
        solarWatts: 250,
        outputWatts: 60,
        triggeredAction: "NONE",
        detailMessage: "concurrent-ok",
      });

      const [res1, res2] = await Promise.all([caller1, caller2]);
      expect(res1?.detailMessage).toBe("concurrent-ok");
      expect(res2?.detailMessage).toBe("concurrent-ok");
      expect(mockExecuteSyncForUser).toHaveBeenCalledTimes(1);
    });
    it("isolates sync throttling per userId so user-A cooldown does not block user-B", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));

      const mockPrisma = {
        userConfiguration: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient;

      mockExecuteSyncForUser.mockImplementation(async (uid: string) => ({
        hasExecutedSuccessfully: true,
        batteryPercentage: uid === "user-A" ? 75 : 42,
        solarWatts: 100,
        outputWatts: 50,
        triggeredAction: "NONE",
        detailMessage: `ok:${uid}`,
      }));

      const liveService = new LiveTelemetryService(mockPrisma);

      // First sync for user-A runs
      const resA1 = await liveService.syncIfStale("user-A", 2000);
      expect(resA1?.detailMessage).toBe("ok:user-A");

      // Immediate second sync for user-A is throttled (null)
      const resA2 = await liveService.syncIfStale("user-A", 2000);
      expect(resA2).toBeNull();

      // Immediate sync for user-B is NOT throttled by user-A
      const resB1 = await liveService.syncIfStale("user-B", 2000);
      expect(resB1?.detailMessage).toBe("ok:user-B");

      expect(mockExecuteSyncForUser).toHaveBeenCalledTimes(2);
    });

    it("returns null immediately without starting MQTT or syncing when DISABLE_LOCAL_CRON=true", async () => {
      process.env.DISABLE_LOCAL_CRON = "true";

      const mockPrisma = {
        userConfiguration: {
          findUnique: vi.fn(),
        },
      } as unknown as PrismaClient;

      const liveService = new LiveTelemetryService(mockPrisma);
      const result = await liveService.syncIfStale("user-A", 2000);

      expect(result).toBeNull();
      expect(mockExecuteSyncForUser).not.toHaveBeenCalled();
      expect(mockMqttConnect).not.toHaveBeenCalled();
      expect(mockPrisma.userConfiguration.findUnique).not.toHaveBeenCalled();
    });
  });
});
