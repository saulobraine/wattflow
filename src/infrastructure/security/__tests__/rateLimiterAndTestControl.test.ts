import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkCooldown,
  checkRateLimit,
  extractClientIp,
  resetRateLimiterState,
  sendRateLimitExceeded,
} from "../rateLimiter";

const { mockUserFindUnique, mockConfigFindUnique, mockExecuteTestTelemetry, mockExecuteTestAc } =
  vi.hoisted(() => ({
    mockUserFindUnique: vi.fn(),
    mockConfigFindUnique: vi.fn(),
    mockExecuteTestTelemetry: vi.fn(),
    mockExecuteTestAc: vi.fn(),
  }));

vi.mock("../../database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
    },
    userConfiguration: {
      findUnique: mockConfigFindUnique,
    },
  },
}));

vi.mock("../../../application/EcoFlowTestUseCase", () => ({
  EcoFlowTestUseCase: vi.fn(function () {
    return {
      executeTestTelemetry: mockExecuteTestTelemetry,
      executeTestAc: mockExecuteTestAc,
    };
  }),
}));

import handleTestControl from "../../../pages/api/test-control";
import { AuthenticationTokenService } from "../../../domain/services/AuthenticationTokenService";
import { SESSION_COOKIE_NAME } from "../../auth/sessionHelper";

const VALID_AUTH_SECRET = "auth-secret-token-with-32-chars!";

function createMockApiResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
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
  return res as unknown as NextApiResponse & {
    statusCode: number;
    body: Record<string, unknown>;
    headers: Record<string, unknown>;
  };
}

describe("rateLimiter & /api/test-control cooldown (SEC-05)", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalTrustProxy = process.env.TRUST_PROXY;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiterState();
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;
    delete process.env.TRUST_PROXY;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
    if (originalTrustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = originalTrustProxy;
    }
  });

  describe("rateLimiter unit behavior", () => {
    it("enforces fixed-window rate limits and resets after windowMs", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));

      expect(checkRateLimit("k1", 2, 10_000)).toMatchObject({ allowed: true, remaining: 1 });
      expect(checkRateLimit("k1", 2, 10_000)).toMatchObject({ allowed: true, remaining: 0 });
      const blocked = checkRateLimit("k1", 2, 10_000);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBe(10);

      vi.advanceTimersByTime(10_000);
      expect(checkRateLimit("k1", 2, 10_000)).toMatchObject({ allowed: true, remaining: 1 });
    });

    it("enforces cooldown window and unlocks after cooldownMs", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));

      expect(checkCooldown("cd:1", 10_000).allowed).toBe(true);
      const blocked = checkCooldown("cd:1", 10_000);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBe(10);

      vi.advanceTimersByTime(10_000);
      expect(checkCooldown("cd:1", 10_000).allowed).toBe(true);
    });

    it("extractClientIp ignores spoofed headers from untrusted remoteAddress unless loopback or TRUST_PROXY=true", () => {
      const untrustedReq = {
        socket: { remoteAddress: "203.0.113.50" },
        headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" },
      } as unknown as NextApiRequest;
      expect(extractClientIp(untrustedReq)).toBe("203.0.113.50");

      const loopbackReq = {
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "x-forwarded-for": "198.51.100.22, 127.0.0.1" },
      } as unknown as NextApiRequest;
      expect(extractClientIp(loopbackReq)).toBe("198.51.100.22");

      const dockerBridgeReq172 = {
        socket: { remoteAddress: "172.18.0.2" },
        headers: { "x-forwarded-for": "198.51.100.33, 172.18.0.2" },
      } as unknown as NextApiRequest;
      expect(extractClientIp(dockerBridgeReq172)).toBe("198.51.100.33");

      const dockerBridgeReq10 = {
        socket: { remoteAddress: "10.0.1.5" },
        headers: { "x-real-ip": "198.51.100.44" },
      } as unknown as NextApiRequest;
      expect(extractClientIp(dockerBridgeReq10)).toBe("198.51.100.44");

      process.env.TRUST_PROXY = "true";
      expect(extractClientIp(untrustedReq)).toBe("5.6.7.8");
    });

    it("sendRateLimitExceeded sends HTTP 429 with Retry-After header", () => {
      const res = createMockApiResponse();
      sendRateLimitExceeded(res, 42, "Too many requests");
      expect(res.statusCode).toBe(429);
      expect(res.headers["Retry-After"]).toBe("42");
      expect(res.body).toEqual({ success: false, message: "Too many requests" });
    });

    it("evicts oldest entries (FIFO) when reaching MAX_STORE_ENTRIES (10,000)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));

      for (let i = 0; i < 10_000; i++) {
        checkRateLimit(`fifo:${i}`, 1, 60_000);
        checkCooldown(`cd-fifo:${i}`, 60_000);
      }

      // Adding 10,001st entry triggers FIFO eviction of fifo:0 and cd-fifo:0
      checkRateLimit("fifo:10000", 1, 60_000);
      checkCooldown("cd-fifo:10000", 60_000);

      // fifo:0 and cd-fifo:0 were evicted, so they are allowed again
      expect(checkRateLimit("fifo:0", 1, 60_000).allowed).toBe(true);
      expect(checkCooldown("cd-fifo:0", 60_000).allowed).toBe(true);

      // fifo:9999 and cd-fifo:9999 are still retained and blocked
      expect(checkRateLimit("fifo:9999", 1, 60_000).allowed).toBe(false);
      expect(checkCooldown("cd-fifo:9999", 60_000).allowed).toBe(false);
    });
  });

  describe("/api/test-control rate limit & 10s AC switch cooldown", () => {
    function buildAuthReq(
      body: Record<string, unknown>,
      ip = "198.51.100.10",
      userId = "usr-ctrl-1"
    ) {
      const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET);
      const token = tokenService.createSessionToken(userId, "ctrl@wattflow.local", 7, 0);
      let raw = "";
      token.transferToken((t) => {
        raw = t;
      });
      return {
        method: "POST",
        socket: { remoteAddress: "127.0.0.1" },
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
          "x-real-ip": ip,
          cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(raw)}`,
        },
        body,
      } as unknown as NextApiRequest;
    }

    it("enforces 10s cooldown on ECOFLOW_ON / ECOFLOW_OFF with HTTP 429 + Retry-After", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));

      mockUserFindUnique.mockResolvedValue({
        id: "usr-ctrl-1",
        email: "ctrl@wattflow.local",
        tokenVersion: 0,
      });
      mockConfigFindUnique.mockResolvedValue(null);
      mockExecuteTestAc.mockResolvedValue({
        isSuccess: true,
        summaryMessage: "AC toggled",
      });

      const payload = {
        actionTarget: "ECOFLOW_ON",
        ecoflowAccessKey: "ak-valid-1234",
        ecoflowAccessSecret: "as-valid-1234",
        ecoflowSerialNumber: "R601ZAB99999",
      };

      const res1 = createMockApiResponse();
      await handleTestControl(buildAuthReq(payload), res1);
      expect(res1.statusCode).toBe(200);

      // Immediate second toggle -> 429 + Retry-After
      const res2 = createMockApiResponse();
      await handleTestControl(buildAuthReq({ ...payload, actionTarget: "ECOFLOW_OFF" }), res2);
      expect(res2.statusCode).toBe(429);
      expect(Number(res2.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
      expect(Number(res2.headers["Retry-After"])).toBeLessThanOrEqual(10);
      expect(mockExecuteTestAc).toHaveBeenCalledTimes(1);

      // After 10s cooldown -> allowed again
      vi.advanceTimersByTime(10_000);
      const res3 = createMockApiResponse();
      await handleTestControl(buildAuthReq({ ...payload, actionTarget: "ECOFLOW_OFF" }), res3);
      expect(res3.statusCode).toBe(200);
      expect(mockExecuteTestAc).toHaveBeenCalledTimes(2);
    });

    it("normalizes serial number to uppercase for AC cooldown key (case/whitespace insensitive)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));

      mockUserFindUnique.mockResolvedValue({
        id: "usr-ctrl-1",
        email: "ctrl@wattflow.local",
        tokenVersion: 0,
      });
      mockConfigFindUnique.mockResolvedValue(null);
      mockExecuteTestAc.mockResolvedValue({
        isSuccess: true,
        summaryMessage: "AC toggled",
      });

      const res1 = createMockApiResponse();
      await handleTestControl(
        buildAuthReq({
          actionTarget: "ECOFLOW_ON",
          ecoflowAccessKey: "ak-valid-1234",
          ecoflowAccessSecret: "as-valid-1234",
          ecoflowSerialNumber: "r601zab99999",
        }),
        res1
      );
      expect(res1.statusCode).toBe(200);

      const res2 = createMockApiResponse();
      await handleTestControl(
        buildAuthReq({
          actionTarget: "ECOFLOW_OFF",
          ecoflowAccessKey: "ak-valid-1234",
          ecoflowAccessSecret: "as-valid-1234",
          ecoflowSerialNumber: "  R601ZAB99999  ",
        }),
        res2
      );
      expect(res2.statusCode).toBe(429);
      expect(Number(res2.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    });

    it("returns HTTP 429 + Retry-After when IP rate limit (30/min) is exceeded", async () => {
      mockUserFindUnique.mockImplementation(async (args: { where: { id: string } }) => ({
        id: args.where.id,
        email: "ctrl@wattflow.local",
        tokenVersion: 0,
      }));
      mockConfigFindUnique.mockResolvedValue(null);
      mockExecuteTestTelemetry.mockResolvedValue({
        isSuccess: true,
        summaryMessage: "Telemetry OK",
      });

      const telemetryPayload = {
        actionTarget: "ECOFLOW_TELEMETRY",
        ecoflowAccessKey: "ak-valid-1234",
        ecoflowAccessSecret: "as-valid-1234",
        ecoflowSerialNumber: "R601ZAB99999",
      };

      for (let i = 0; i < 30; i++) {
        const res = createMockApiResponse();
        await handleTestControl(buildAuthReq(telemetryPayload, "203.0.113.77", `usr-ip-${i}`), res);
        expect(res.statusCode).toBe(200);
      }

      const resBlocked = createMockApiResponse();
      await handleTestControl(buildAuthReq(telemetryPayload, "203.0.113.77", "usr-ip-31"), resBlocked);
      expect(resBlocked.statusCode).toBe(429);
      expect(Number(resBlocked.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    });
  });
});
