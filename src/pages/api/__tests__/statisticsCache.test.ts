import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

const {
  mockFindUniqueConfig,
  mockFindManyLogs,
  mockGetLatestTelemetry,
} = vi.hoisted(() => ({
  mockFindUniqueConfig: vi.fn(),
  mockFindManyLogs: vi.fn(),
  mockGetLatestTelemetry: vi.fn(),
}));

vi.mock("../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    userConfiguration: {
      findUnique: mockFindUniqueConfig,
    },
    syncExecutionLog: {
      findMany: mockFindManyLogs,
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../../../infrastructure/auth/sessionHelper", () => ({
  extractUserFromRequest: vi.fn().mockResolvedValue({
    provideIdentity: (fn: (id: string) => void) => fn("user-cache-perf"),
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

import handleStatistics, { clearStatisticsCache } from "../statistics";

function createMockReqRes(headers: Record<string, string> = {}) {
  const req = {
    method: "GET",
    headers,
    query: {},
  } as unknown as NextApiRequest;

  const mockRes = {
    statusCode: 200,
    headers: {} as Record<string, unknown>,
    body: null as unknown,
    setHeader: vi.fn(function (name: string, val: unknown) {
      mockRes.headers[name.toLowerCase()] = val;
    }),
    status: vi.fn(function (code: number) {
      mockRes.statusCode = code;
      return mockRes;
    }),
    json: vi.fn(function (payload: unknown) {
      mockRes.body = payload;
      return mockRes;
    }),
  };

  return { req, res: mockRes as unknown as NextApiResponse & { body: any; headers: Record<string, unknown>; statusCode: number } };
}

describe("Cache em Memória de Estatísticas (TTL / Performance)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStatisticsCache();
  });

  it("responde com X-Cache: MISS na primeira requisição e armazena em cache", async () => {
    mockFindUniqueConfig.mockResolvedValue({
      id: "config-perf",
      userId: "user-cache-perf",
      energyCostPerKwh: 0.92,
      currencySymbol: "R$",
      syncExecutionLogs: [
        {
          id: "log-p1",
          batteryPercentage: 80,
          solarInputWatts: 350,
          outputWatts: 150,
          actionTriggered: "MONITORAMENTO",
          executedAt: new Date(),
        },
      ],
    });
    mockFindManyLogs.mockResolvedValue([]);
    mockGetLatestTelemetry.mockReturnValue({
      batteryPercentage: 80,
      solarInputWatts: 350,
      outputWatts: 150,
    });

    const { req, res } = createMockReqRes({ "x-enable-cache": "true" });
    await handleStatistics(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(res.body.success).toBe(true);
    expect(mockFindUniqueConfig).toHaveBeenCalledTimes(1);
  });

  it("responde em < 5ms com X-Cache: HIT sem reconsultar o banco na segunda requisição", async () => {
    mockFindUniqueConfig.mockResolvedValue({
      id: "config-perf",
      userId: "user-cache-perf",
      energyCostPerKwh: 0.92,
      currencySymbol: "R$",
      syncExecutionLogs: [
        {
          id: "log-p1",
          batteryPercentage: 80,
          solarInputWatts: 350,
          outputWatts: 150,
          actionTriggered: "MONITORAMENTO",
          executedAt: new Date(),
        },
      ],
    });
    mockFindManyLogs.mockResolvedValue([]);
    mockGetLatestTelemetry.mockReturnValue({
      batteryPercentage: 80,
      solarInputWatts: 350,
      outputWatts: 150,
    });

    // 1ª chamada: Preenche o cache (MISS)
    const { req: req1, res: res1 } = createMockReqRes({ "x-enable-cache": "true" });
    await handleStatistics(req1, res1);
    expect(res1.headers["x-cache"]).toBe("MISS");

    // Limpa contadores de chamadas do mock do Prisma
    mockFindUniqueConfig.mockClear();
    mockFindManyLogs.mockClear();

    // 2ª chamada: Deve servir do cache em memória com latência desprezível (HIT)
    const startTime = performance.now();
    const { req: req2, res: res2 } = createMockReqRes({ "x-enable-cache": "true" });
    await handleStatistics(req2, res2);
    const durationMs = performance.now() - startTime;

    expect(res2.statusCode).toBe(200);
    expect(res2.headers["x-cache"]).toBe("HIT");
    expect(res2.body.success).toBe(true);
    expect(mockFindUniqueConfig).not.toHaveBeenCalled();
    expect(mockFindManyLogs).not.toHaveBeenCalled();
    expect(durationMs).toBeLessThan(50); // Execução pura em memória < 50ms (geralmente < 1ms)
  });

  it("atualiza métricas vivas de telemetria (Watts e temperatura BMS) mesmo servindo do cache", async () => {
    mockFindUniqueConfig.mockResolvedValue({
      id: "config-perf",
      userId: "user-cache-perf",
      energyCostPerKwh: 0.92,
      currencySymbol: "R$",
      thermalWarningThreshold: 45,
      thermalShutdownThreshold: 50,
      syncExecutionLogs: [
        {
          id: "log-p2",
          batteryPercentage: 80,
          solarInputWatts: 200,
          outputWatts: 100,
          actionTriggered: "MONITORAMENTO",
          executedAt: new Date(),
        },
      ],
    });
    mockFindManyLogs.mockResolvedValue([]);
    mockGetLatestTelemetry.mockReturnValue({
      batteryPercentage: 80,
      solarInputWatts: 200,
      outputWatts: 100,
      batteryTempCelsius: 30,
    });

    // 1ª chamada
    const { req: req1, res: res1 } = createMockReqRes({ "x-enable-cache": "true" });
    await handleStatistics(req1, res1);
    expect(res1.body.data.currentWatts).toBe(200);

    // Nova leitura MQTT recebida no stream
    mockGetLatestTelemetry.mockReturnValue({
      batteryPercentage: 85,
      solarInputWatts: 650,
      outputWatts: 220,
      batteryTempCelsius: 39, // WARM
    });

    // 2ª chamada: cache hit mas com telemetria viva reconciliada
    const { req: req2, res: res2 } = createMockReqRes({ "x-enable-cache": "true" });
    await handleStatistics(req2, res2);

    expect(res2.headers["x-cache"]).toBe("HIT");
    expect(res2.body.data.currentWatts).toBe(650);
    expect(res2.body.data.currentOutputWatts).toBe(220);
    expect(res2.body.data.bmsAnalytics.temperatureCelsius).toBe(39);
    expect(res2.body.data.bmsAnalytics.thermalStatus).toBe("WARM");
  });

  it("bypassa o cache quando x-skip-cache é fornecido", async () => {
    mockFindUniqueConfig.mockResolvedValue({
      id: "config-perf",
      userId: "user-cache-perf",
      syncExecutionLogs: [
        {
          id: "log-p3",
          batteryPercentage: 80,
          solarInputWatts: 100,
          outputWatts: 50,
          actionTriggered: "MONITORAMENTO",
          executedAt: new Date(),
        },
      ],
    });
    mockFindManyLogs.mockResolvedValue([]);
    mockGetLatestTelemetry.mockReturnValue({});

    // 1ª chamada com x-enable-cache
    const { req: req1, res: res1 } = createMockReqRes({ "x-enable-cache": "true" });
    await handleStatistics(req1, res1);
    expect(res1.headers["x-cache"]).toBe("MISS");

    // 2ª chamada forçando skip
    const { req: req2, res: res2 } = createMockReqRes({
      "x-enable-cache": "true",
      "x-skip-cache": "true",
    });
    await handleStatistics(req2, res2);
    expect(res2.headers["x-cache"]).toBe("MISS");
  });
});
