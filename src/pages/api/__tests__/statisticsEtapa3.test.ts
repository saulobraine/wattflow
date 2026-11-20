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
    provideIdentity: (fn: (id: string) => void) => fn("user-etapa3"),
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
import { TariffScheduleService } from "../../../domain/services/TariffScheduleService";

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

describe("GET /api/statistics - Etapa 3 (Tarifas Dinâmicas & Economia Ponderada)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna bloco financialSavings com decomposição tarifária quando isDynamicTariffActive é verdadeiro", async () => {
    vi.spyOn(TariffScheduleService.prototype, "getBrasiliaTime").mockReturnValue({
      dayOfWeek: 5, // Sexta-feira
      hours: 18,
      minutes: 0,
      timeInMinutes: 18 * 60,
      timeString: "18:00",
    });

    const mockConfig = {
      id: "config-etapa3",
      userId: "user-etapa3",
      isDynamicTariffActive: true,
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
      energyCostPerKwh: 0.92,
      currencySymbol: "R$",
      batteryCapacityWh: 2048,
      syncExecutionLogs: [],
    };

    mockFindUniqueConfig.mockResolvedValue(mockConfig);
    mockFindManyLogs.mockResolvedValue([]);
    mockFindFirstLog.mockResolvedValue(null);

    mockGetLatestTelemetry.mockReturnValue({
      batteryPercentage: 75,
      solarInputWatts: 600,
      outputWatts: 250,
      isAcOutputEnabled: true,
      updatedAt: new Date(),
    });

    const { req, res } = createMockReqRes();
    await handleStatistics(req, res);

    expect(res.statusCode).toBe(200);
    const body = (res as unknown as { body: { success: boolean; data: Record<string, unknown> } }).body;
    expect(body.success).toBe(true);

    const savings = body.data.financialSavings as Record<string, unknown>;
    expect(savings).toBeDefined();
    expect(savings.isDynamicTariffActive).toBe(true);
    expect(savings.currentTariffPeriod).toBe("PEAK");
    expect(savings.currentTariffRate).toBe(1.85);
    expect(typeof savings.peakSavingsToday).toBe("number");
    expect(typeof savings.offPeakSavingsToday).toBe("number");
  });

  it("retorna valores convencionais planos quando isDynamicTariffActive é falso", async () => {
    const mockConfig = {
      id: "config-etapa3-flat",
      userId: "user-etapa3",
      isDynamicTariffActive: false,
      energyCostPerKwh: 0.95,
      currencySymbol: "R$",
      batteryCapacityWh: 2048,
      syncExecutionLogs: [],
    };

    mockFindUniqueConfig.mockResolvedValue(mockConfig);
    mockFindManyLogs.mockResolvedValue([]);
    mockFindFirstLog.mockResolvedValue(null);

    mockGetLatestTelemetry.mockReturnValue({
      batteryPercentage: 80,
      solarInputWatts: 400,
      outputWatts: 200,
      isAcOutputEnabled: true,
      updatedAt: new Date(),
    });

    const { req, res } = createMockReqRes();
    await handleStatistics(req, res);

    expect(res.statusCode).toBe(200);
    const body = (res as unknown as { body: { success: boolean; data: Record<string, unknown> } }).body;
    expect(body.success).toBe(true);

    const savings = body.data.financialSavings as Record<string, unknown>;
    expect(savings.isDynamicTariffActive).toBe(false);
    expect(savings.currentTariffPeriod).toBe("OFF_PEAK");
    expect(savings.currentTariffRate).toBe(0.95);
    expect(savings.peakSavingsToday).toBe(0);
  });
});
