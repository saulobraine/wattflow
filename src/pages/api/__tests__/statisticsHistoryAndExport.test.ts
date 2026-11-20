import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

const { mockFindUniqueConfig, mockFindManyLogs } = vi.hoisted(() => ({
  mockFindUniqueConfig: vi.fn(),
  mockFindManyLogs: vi.fn(),
}));

vi.mock("../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    userConfiguration: {
      findUnique: mockFindUniqueConfig,
    },
    syncExecutionLog: {
      findMany: mockFindManyLogs,
    },
  },
}));

vi.mock("../../../infrastructure/auth/sessionHelper", () => ({
  extractUserFromRequest: vi.fn().mockResolvedValue({
    provideIdentity: (fn: (id: string) => void) => fn("user-history-test"),
  }),
}));

import handleStatisticsHistory from "../statistics/history";
import handleStatisticsExport from "../statistics/export";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";

function createMockReqRes(query: Record<string, string | string[]> = {}, method = "GET") {
  const req = {
    method,
    headers: {},
    query,
  } as unknown as NextApiRequest;

  const mockRes = {
    statusCode: 200,
    headers: {} as Record<string, string | string[]>,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(key: string, value: string | string[]) {
      this.headers[key.toLowerCase()] = value;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  return { req, res: mockRes as unknown as NextApiResponse };
}

describe("Endpoints REST de Estatísticas Avançadas (history.ts & export.ts)", () => {
  const baseConfig = {
    id: "config-history-1",
    userId: "user-history-test",
    energyCostPerKwh: 0.95,
    currencySymbol: "R$",
    isDynamicTariffActive: false,
  };

  const sampleLogs = [
    {
      executedAt: new Date(),
      solarInputWatts: 900,
      outputWatts: 450,
      batteryPercentage: 80,
      actionTriggered: "AC_ENABLED",
      executionDetails: "OK",
      batteryTempCelsius: 32.5,
      batterySoh: 98,
      batteryCycles: 45,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUniqueConfig.mockResolvedValue(baseConfig);
    mockFindManyLogs.mockResolvedValue(sampleLogs);
    vi.mocked(extractUserFromRequest).mockResolvedValue({
      provideIdentity: (fn: (id: string) => void) => fn("user-history-test"),
    } as unknown as Awaited<ReturnType<typeof extractUserFromRequest>>);
  });

  describe("GET /api/statistics/history", () => {
    it("rejeita métodos HTTP diferentes de GET com status 405", async () => {
      const { req, res } = createMockReqRes({}, "POST");
      await handleStatisticsHistory(req, res);

      expect((res as unknown as { statusCode: number }).statusCode).toBe(405);
      expect((res as unknown as { body: { message: string } }).body.message).toContain(
        "Método HTTP não permitido."
      );
    });

    it("rejeita requisições não autenticadas com 401", async () => {
      vi.mocked(extractUserFromRequest).mockResolvedValueOnce(null);

      const { req, res } = createMockReqRes({ range: "24h" });
      await handleStatisticsHistory(req, res);

      expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    });

    it("rejeita range inválido com 400 Bad Request", async () => {
      const { req, res } = createMockReqRes({ range: "invalid-range" });
      await handleStatisticsHistory(req, res);

      expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
      expect((res as unknown as { body: { message: string } }).body.message).toContain(
        "Range inválido"
      );
    });

    it("retorna 200 com payload estruturado StatisticsHistoryResponse para range 24h", async () => {
      const { req, res } = createMockReqRes({ range: "24h" });
      await handleStatisticsHistory(req, res);

      const responseObj = res as unknown as {
        statusCode: number;
        body: {
          range: string;
          summary: Record<string, number>;
          points: Array<unknown>;
        };
      };

      expect(responseObj.statusCode).toBe(200);
      expect(responseObj.body.range).toBe("24h");
      expect(responseObj.body.points).toHaveLength(96);
      expect(responseObj.body.summary).toBeDefined();
      expect(responseObj.body.summary.peakSolarWatts).toBe(900);
    });

    it("retorna 200 com bloco comparison para range today-vs-yesterday", async () => {
      const { req, res } = createMockReqRes({ range: "today-vs-yesterday" });
      await handleStatisticsHistory(req, res);

      const responseObj = res as unknown as {
        statusCode: number;
        body: {
          range: string;
          comparison?: {
            todayPoints: Array<unknown>;
            yesterdayPoints: Array<unknown>;
            divergencePercentage: number;
          };
        };
      };

      expect(responseObj.statusCode).toBe(200);
      expect(responseObj.body.range).toBe("today-vs-yesterday");
      expect(responseObj.body.comparison).toBeDefined();
      expect(responseObj.body.comparison?.yesterdayPoints).toHaveLength(96);
    });
  });

  describe("GET /api/statistics/export", () => {
    it("rejeita métodos HTTP diferentes de GET com 405", async () => {
      const { req, res } = createMockReqRes({}, "POST");
      await handleStatisticsExport(req, res);

      expect((res as unknown as { statusCode: number }).statusCode).toBe(405);
    });

    it("rejeita requisições não autenticadas com 401", async () => {
      vi.mocked(extractUserFromRequest).mockResolvedValueOnce(null);

      const { req, res } = createMockReqRes({ range: "24h", format: "csv" });
      await handleStatisticsExport(req, res);

      expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    });

    it("rejeita formato não suportado com 400", async () => {
      const { req, res } = createMockReqRes({ range: "24h", format: "xlsx" });
      await handleStatisticsExport(req, res);

      expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    });

    it("retorna 200 com headers de attachment CSV e BOM UTF-8", async () => {
      const { req, res } = createMockReqRes({ range: "24h", format: "csv" });
      await handleStatisticsExport(req, res);

      const responseObj = res as unknown as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(responseObj.statusCode).toBe(200);
      expect(responseObj.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(responseObj.headers["content-disposition"]).toMatch(
        /attachment; filename="wattflow-telemetria-24h-\d{4}-\d{2}-\d{2}\.csv"/
      );
      expect(typeof responseObj.body).toBe("string");
      expect(responseObj.body.startsWith("\uFEFF")).toBe(true);
      expect(responseObj.body).toContain("Data_Hora,Bateria_SOC_Percent,Geracao_Solar_Watts");
    });
  });
});
