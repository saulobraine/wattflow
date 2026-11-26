import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { EventEmitter } from "events";
import liveTelemetryFixture from "../../../../e2e/fixtures/live-telemetry.json";

const { mockExtractUser } = vi.hoisted(() => ({
  mockExtractUser: vi.fn(),
}));

vi.mock("../../../infrastructure/auth/sessionHelper", () => ({
  extractUserFromRequest: mockExtractUser,
}));

vi.mock("../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    userConfiguration: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import handleTelemetryStream from "../telemetry/stream";
import {
  EcoFlowMqttStreamService,
  type LiveTelemetrySnapshot,
} from "../../../infrastructure/services/EcoFlowMqttStreamService";

class MockResponse extends EventEmitter {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public chunks: string[] = [];
  public isFlushed = false;

  public status(code: number) {
    this.statusCode = code;
    return this;
  }

  public setHeader(key: string, value: string) {
    this.headers[key.toLowerCase()] = value;
    return this;
  }

  public flushHeaders() {
    this.isFlushed = true;
  }

  public write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }

  public json(payload: unknown) {
    this.chunks.push(JSON.stringify(payload));
    return this;
  }

  public end() {
    return this;
  }
}

function createMockSseReqRes(method = "GET") {
  const reqEmitter = new EventEmitter();
  const mockRes = new MockResponse();

  const req = Object.assign(reqEmitter, {
    method,
    headers: {},
  }) as unknown as NextApiRequest;

  return {
    req,
    res: mockRes as unknown as NextApiResponse & MockResponse,
    reqEmitter,
    resEmitter: mockRes,
  };
}

describe("Endpoint SSE (GET /api/telemetry/stream)", () => {
  let streamService: EcoFlowMqttStreamService;

  beforeEach(() => {
    vi.clearAllMocks();
    streamService = EcoFlowMqttStreamService.getInstance();
    streamService.stopStream();

    mockExtractUser.mockResolvedValue({
      provideIdentity: (fn: (id: string) => void) => fn("user-sse-test"),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejeita métodos HTTP diferentes de GET com 405", async () => {
    const { req, res } = createMockSseReqRes("POST");
    await handleTelemetryStream(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers["allow"]).toBe("GET");
    expect(res.chunks[0]).toContain("Método HTTP não permitido");
  });

  it("rejeita requisição não autenticada com 401", async () => {
    mockExtractUser.mockResolvedValueOnce(null);

    const { req, res } = createMockSseReqRes("GET");
    await handleTelemetryStream(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.chunks[0]).toContain("Usuário não autenticado");
  });

  it("estabelece canal SSE com cabeçalhos mandatórios e entrega snapshot inicial", async () => {
    const { req, res } = createMockSseReqRes("GET");
    await handleTelemetryStream(req, res);

    // Validação estrita de cabeçalhos
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(res.headers["connection"]).toBe("keep-alive");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    expect(res.isFlushed).toBe(true);

    // Snapshot inicial enviado imediatamente
    expect(res.chunks.length).toBeGreaterThanOrEqual(1);
    expect(res.chunks[0]).toMatch(/^event: telemetry\ndata: (.*)\n\n$/);
  });

  it("transmite snapshots em tempo real via broadcast do EcoFlowMqttStreamService", async () => {
    const { req, res } = createMockSseReqRes("GET");
    await handleTelemetryStream(req, res);

    expect(streamService.getActiveListenersCount("user-sse-test")).toBe(1);

    const liveSnapshot: LiveTelemetrySnapshot = {
      ...liveTelemetryFixture,
      updatedAt: new Date(),
    };

    streamService.broadcastTelemetry("user-sse-test", liveSnapshot);

    const lastChunk = res.chunks[res.chunks.length - 1];
    expect(lastChunk).toContain("event: telemetry");
    expect(lastChunk).toContain('"batteryPercentage":95');
    expect(lastChunk).toContain('"solarInputWatts":1400');
  });

  it("dispara keep-alive a cada 15 segundos", async () => {
    vi.useFakeTimers();

    const { req, res } = createMockSseReqRes("GET");
    await handleTelemetryStream(req, res);

    expect(res.chunks).toHaveLength(1); // snapshot inicial

    // Avança 15s
    vi.advanceTimersByTime(15000);
    expect(res.chunks).toContain(": keep-alive\n\n");

    // Avança mais 15s
    vi.advanceTimersByTime(15000);
    const keepAlives = res.chunks.filter((c) => c === ": keep-alive\n\n");
    expect(keepAlives).toHaveLength(2);
  });

  it("previne vazamento de memória cancelando intervalo e removendo listener ao fechar requisição", async () => {
    vi.useFakeTimers();

    const { req, res, reqEmitter } = createMockSseReqRes("GET");
    await handleTelemetryStream(req, res);

    expect(streamService.getActiveListenersCount("user-sse-test")).toBe(1);

    // Simula cliente desconectando (fechamento de aba/conexão)
    reqEmitter.emit("close");

    // Listener deve ter sido desregistrado
    expect(streamService.getActiveListenersCount("user-sse-test")).toBe(0);

    // Nenhum novo keep-alive deve ser emitido após o fechamento
    const chunkCountBefore = res.chunks.length;
    vi.advanceTimersByTime(30000);
    expect(res.chunks.length).toBe(chunkCountBefore);
  });
});
