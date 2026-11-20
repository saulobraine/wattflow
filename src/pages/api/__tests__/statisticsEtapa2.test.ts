import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

const {
  mockFindUniqueConfig,
  mockFindManyLogs,
  mockFindFirstLog,
  mockGetLatestTelemetry,
} = vi.hoisted(() => ({
  mockFindUniqueConfig: vi.fn(),
  mockFindManyLogs: vi.fn(),
  mockFindFirstLog: vi.fn(),
  mockGetLatestTelemetry: vi.fn(),
}));

vi.mock("../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    userConfiguration: {
      findUnique: mockFindUniqueConfig,
    },
    syncExecutionLog: {
      findMany: mockFindManyLogs,
      findFirst: mockFindFirstLog,
    },
  },
}));

vi.mock("../../../infrastructure/auth/sessionHelper", () => ({
  extractUserFromRequest: vi.fn().mockResolvedValue({
    provideIdentity: (fn: (id: string) => void) => fn("user-etapa2"),
  }),
}));

vi.mock("../../../infrastructure/services/LiveTelemetryService", () => ({
  LiveTelemetryService: vi.fn(function () {
    return {
      syncIfStale: vi.fn().mockResolvedValue(null),
    };
  }),
}));

vi.mock("../../../infrastructure/services/EcoFlowMqttStreamService", () => ({
  EcoFlowMqttStreamService: {
    getInstance: vi.fn(() => ({
      getLatestTelemetry: mockGetLatestTelemetry,
      isStreamConnected: vi.fn().mockReturnValue(true),
    })),
  },
}));

import handleStatistics from "../statistics";

function createMockReqRes() {
  const req = {
    method: "GET",
    headers: {},
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

describe("GET /api/statistics - Etapa 2 (solarForecast & bmsAnalytics)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna blocos solarForecast e bmsAnalytics com conformidade total à especificação", async () => {
    const mockConfig = {
      id: "config-etapa2",
      userId: "user-etapa2",
      latitude: -23.5505,
      longitude: -46.6333,
      isAdaptiveHysteresisActive: true,
      minAdaptiveThreshold: 20,
      maxAdaptiveThreshold: 50,
      lastSolarIrradianceMj: 21.4,
      lastSolarForecastCheckAt: new Date("2026-11-20T10:00:00Z"),
      thermalWarningThreshold: 45.0,
      thermalShutdownThreshold: 50.0,
      lastBatteryTempCelsius: 32.5,
      lastBatterySoh: 99,
      lastBatteryCycles: 84,
      maxRecordedBatteryTemp: 38.2,
      energyCostPerKwh: 0.92,
      currencySymbol: "R$",
      batteryCapacityWh: 2048,
      syncExecutionLogs: [
        {
          id: "log-1",
          batteryPercentage: 85,
          solarInputWatts: 450,
          outputWatts: 120,
          actionTriggered: "MONITORAMENTO",
          executionDetails: "Telemetria consolidada",
          executedAt: new Date(),
          batteryTempCelsius: 32.5,
          batterySoh: 99,
          batteryCycles: 84,
        },
      ],
    };

    mockFindUniqueConfig.mockResolvedValue(mockConfig);
    mockFindManyLogs.mockResolvedValue([]);
    mockFindFirstLog.mockResolvedValue(null);

    mockGetLatestTelemetry.mockReturnValue({
      batteryPercentage: 85,
      solarInputWatts: 450,
      outputWatts: 120,
      isAcOutputEnabled: true,
      updatedAt: new Date(),
      batteryTempCelsius: 32.5,
      batterySoh: 99,
      batteryCycles: 84,
      batteryVolts: 51.4,
      batteryAmps: 12.3,
    });

    const { req, res } = createMockReqRes();
    await handleStatistics(req, res);

    expect(res.statusCode).toBe(200);
    const body = (res as unknown as { body: { success: boolean; data: Record<string, unknown> } }).body;
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();

    // Verificação de solarForecast
    const solarForecast = body.data.solarForecast as Record<string, unknown>;
    expect(solarForecast).toBeDefined();
    expect(solarForecast.isAdaptiveActive).toBe(true);
    expect(typeof solarForecast.effectiveTurnOffThreshold).toBe("number");
    expect(solarForecast.forecastSummary).toBeDefined();

    // Verificação de bmsAnalytics
    const bmsAnalytics = body.data.bmsAnalytics as Record<string, unknown>;
    expect(bmsAnalytics).toBeDefined();
    expect(bmsAnalytics.temperatureCelsius).toBe(32.5);
    expect(bmsAnalytics.maxRecordedTemp).toBe(38.2);
    expect(bmsAnalytics.sohPercentage).toBe(99);
    expect(bmsAnalytics.bmsCycles).toBe(84);
    expect(bmsAnalytics.thermalStatus).toBe("NORMAL"); // 32.5°C < 38°C
    expect(bmsAnalytics.thermalWarningThreshold).toBe(45.0);
    expect(bmsAnalytics.thermalShutdownThreshold).toBe(50.0);
    expect(bmsAnalytics.voltageVolts).toBe(51.4);
    expect(bmsAnalytics.amperageAmps).toBe(12.3);
    expect(Array.isArray(bmsAnalytics.recentThermalTrend)).toBe(true);

    // Verificação de recentLogs contendo campos BMS
    const recentLogs = body.data.recentLogs as Array<Record<string, unknown>>;
    expect(recentLogs.length).toBeGreaterThan(0);
    expect(recentLogs[0].batteryTempCelsius).toBe(32.5);
    expect(recentLogs[0].batterySoh).toBe(99);
    expect(recentLogs[0].batteryCycles).toBe(84);
  });

  it("classifica o thermalStatus como WARM, HOT e CRITICAL conforme a temperatura", async () => {
    // 1. WARM (>= 38°C)
    mockGetLatestTelemetry.mockReturnValue({
      batteryTempCelsius: 40.0,
    });
    mockFindUniqueConfig.mockResolvedValue({
      id: "c1",
      thermalWarningThreshold: 45.0,
      thermalShutdownThreshold: 50.0,
      syncExecutionLogs: [],
    });

    const { req: req1, res: res1 } = createMockReqRes();
    await handleStatistics(req1, res1);
    const body1 = (res1 as unknown as { body: { data: { bmsAnalytics: { thermalStatus: string } } } }).body;
    expect(body1.data.bmsAnalytics.thermalStatus).toBe("WARM");

    // 2. HOT (>= 45°C)
    mockGetLatestTelemetry.mockReturnValue({
      batteryTempCelsius: 47.0,
    });
    const { req: req2, res: res2 } = createMockReqRes();
    await handleStatistics(req2, res2);
    const body2 = (res2 as unknown as { body: { data: { bmsAnalytics: { thermalStatus: string } } } }).body;
    expect(body2.data.bmsAnalytics.thermalStatus).toBe("HOT");

    // 3. CRITICAL (>= 50°C)
    mockGetLatestTelemetry.mockReturnValue({
      batteryTempCelsius: 51.5,
    });
    const { req: req3, res: res3 } = createMockReqRes();
    await handleStatistics(req3, res3);
    const body3 = (res3 as unknown as { body: { data: { bmsAnalytics: { thermalStatus: string } } } }).body;
    expect(body3.data.bmsAnalytics.thermalStatus).toBe("CRITICAL");
  });
});
