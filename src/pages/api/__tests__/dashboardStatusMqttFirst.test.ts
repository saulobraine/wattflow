import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsStreamConnected,
  mockGetLatestTelemetry,
  mockSyncIfStale,
  mockFindUniqueUser,
  mockFindUniqueConfig,
} = vi.hoisted(() => ({
  mockIsStreamConnected: vi.fn(),
  mockGetLatestTelemetry: vi.fn(),
  mockSyncIfStale: vi.fn(),
  mockFindUniqueUser: vi.fn(),
  mockFindUniqueConfig: vi.fn(),
}));

vi.mock("../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: mockFindUniqueUser,
    },
    userConfiguration: {
      findUnique: mockFindUniqueConfig,
    },
  },
}));

vi.mock("../../../infrastructure/services/EcoFlowMqttStreamService", () => ({
  EcoFlowMqttStreamService: {
    getInstance: vi.fn(() => ({
      isStreamConnected: mockIsStreamConnected,
      getLatestTelemetry: mockGetLatestTelemetry,
    })),
  },
}));

vi.mock("../../../infrastructure/services/LiveTelemetryService", () => ({
  LiveTelemetryService: vi.fn(function () {
    return {
      syncIfStale: mockSyncIfStale,
    };
  }),
}));

import handleDashboardStatus from "../dashboard-status";

function createMockReqRes(options: {
  method?: string;
  cookieHeader?: string;
} = {}) {
  const req = {
    method: options.method ?? "GET",
    headers: {
      cookie: options.cookieHeader,
    },
  } as unknown as NextApiRequest;

  const res = {
    statusCode: 200,
    headers: {} as Record<string, unknown>,
    body: null as unknown,
    status: vi.fn(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: typeof res, payload: unknown) {
      this.body = payload;
      return this;
    }),
    setHeader: vi.fn(function (this: typeof res, key: string, val: unknown) {
      this.headers[key] = val;
      return this;
    }),
  };

  return {
    req,
    res: res as unknown as NextApiResponse & {
      statusCode: number;
      body: Record<string, unknown>;
      headers: Record<string, unknown>;
    },
  };
}

describe("Dashboard Status MQTT-First (API)", () => {
  const VALID_AUTH_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;
  });

  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it("serves sub-second live telemetry directly from RAM without calling syncIfStale when MQTT is connected", async () => {
    mockFindUniqueUser.mockResolvedValue({
      id: "user-dash-1",
      email: "user@test.local",
      tokenVersion: 0,
    });

    mockFindUniqueConfig.mockResolvedValue({
      id: "cfg-dash-1",
      userId: "user-dash-1",
      ecoflowAccessKey: "ak",
      ecoflowAccessSecret: "as",
      ecoflowSerialNumber: "sn",
      isAutomationActive: true,
      turnOnThreshold: 85,
      turnOffThreshold: 25,
      syncExecutionLogs: [
        {
          id: "old-log-1",
          batteryPercentage: 50,
          solarInputWatts: 80,
          actionTriggered: "OLD_ACTION",
          executionDetails: "old",
          executedAt: new Date(Date.now() - 3600000),
        },
      ],
    });

    mockIsStreamConnected.mockReturnValue(true);
    mockGetLatestTelemetry.mockReturnValue({
      batteryPercentage: 92,
      solarInputWatts: 340,
      outputWatts: 150,
      isAcOutputEnabled: true,
      updatedAt: new Date(),
    });

    // Create session cookie for user-dash-1
    const { getAuthenticationTokenService } = await import("../../../infrastructure/auth/sessionHelper");
    const tokenObj = getAuthenticationTokenService().createSessionToken("user-dash-1", "user@test.local", 30, 0);
    let tokenStr = "";
    tokenObj.transferToken((t) => { tokenStr = t; });
    const validCookie = `wattflow_session=${tokenStr}`;

    const { req, res } = createMockReqRes({ cookieHeader: validCookie });
    await handleDashboardStatus(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockSyncIfStale).not.toHaveBeenCalled(); // ZERO HTTP calls!

    const body = res.body as { data: Record<string, unknown> };
    expect(body.data.lastBatteryPercentage).toBe(92);
    expect(body.data.lastSolarWatts).toBe(340);
    expect(body.data.lastAction).toBe("ENABLE_ECOFLOW_AC");
  });

  it("falls back to syncIfStale when MQTT stream is not connected", async () => {
    mockFindUniqueUser.mockResolvedValue({
      id: "user-dash-2",
      email: "user2@test.local",
      tokenVersion: 0,
    });

    mockFindUniqueConfig.mockResolvedValue({
      id: "cfg-dash-2",
      userId: "user-dash-2",
      ecoflowAccessKey: "ak",
      ecoflowAccessSecret: "as",
      ecoflowSerialNumber: "sn",
      isAutomationActive: true,
      turnOnThreshold: 90,
      turnOffThreshold: 30,
      syncExecutionLogs: [],
    });

    mockIsStreamConnected.mockReturnValue(false);

    const { getAuthenticationTokenService } = await import("../../../infrastructure/auth/sessionHelper");
    const tokenObj = getAuthenticationTokenService().createSessionToken("user-dash-2", "user2@test.local", 30, 0);
    let tokenStr = "";
    tokenObj.transferToken((t) => { tokenStr = t; });
    const validCookie = `wattflow_session=${tokenStr}`;

    const { req, res } = createMockReqRes({ cookieHeader: validCookie });
    await handleDashboardStatus(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockSyncIfStale).toHaveBeenCalledWith("user-dash-2", 90000);
  });
});
