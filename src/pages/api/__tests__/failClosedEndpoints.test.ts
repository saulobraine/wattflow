import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIsStreamConnected,
  mockStartWithActiveConfiguration,
  mockGetLatestTelemetry,
  mockExecuteSyncAll,
  mockExecuteSyncForUser,
} = vi.hoisted(() => ({
  mockIsStreamConnected: vi.fn(),
  mockStartWithActiveConfiguration: vi.fn(),
  mockGetLatestTelemetry: vi.fn(),
  mockExecuteSyncAll: vi.fn(),
  mockExecuteSyncForUser: vi.fn(),
}));

vi.mock("../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-99",
        email: "owner@wattflow.local",
        tokenVersion: 0,
      }),
    },
  },
}));

vi.mock("../../../infrastructure/services/EcoFlowMqttStreamService", () => ({
  EcoFlowMqttStreamService: {
    getInstance: vi.fn(() => ({
      isStreamConnected: mockIsStreamConnected,
      startWithActiveConfiguration: mockStartWithActiveConfiguration,
      getLatestTelemetry: mockGetLatestTelemetry,
    })),
  },
}));

vi.mock("../../../infrastructure/repositories/ConfigurationRepository", () => ({
  ConfigurationRepository: vi.fn(function () {
    return {};
  }),
}));

vi.mock("../../../application/OrchestratorSyncUseCase", () => ({
  OrchestratorSyncUseCase: vi.fn(function () {
    return {
      executeSyncAll: mockExecuteSyncAll,
      executeSyncForUser: mockExecuteSyncForUser,
    };
  }),
}));

import handleMqttStream from "../mqtt-stream";
import handleSync from "../sync";
import { AuthenticationTokenService } from "../../../domain/services/AuthenticationTokenService";
import { SESSION_COOKIE_NAME } from "../../../infrastructure/auth/sessionHelper";

const VALID_CRON_SECRET_32 = "cron-secret-token-with-32-chars!";
const VALID_AUTH_SECRET_32 = "auth-secret-token-with-32-chars!";

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

describe("Fail-closed API endpoints (SEC-04)", () => {
  const originalCronSecret = process.env.CRON_SECRET_TOKEN;
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalDisableLocalCron = process.env.DISABLE_LOCAL_CRON;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET_TOKEN;
    delete process.env.AUTH_SECRET;
    delete process.env.DISABLE_LOCAL_CRON;
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET_TOKEN;
    } else {
      process.env.CRON_SECRET_TOKEN = originalCronSecret;
    }
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
    if (originalDisableLocalCron === undefined) {
      delete process.env.DISABLE_LOCAL_CRON;
    } else {
      process.env.DISABLE_LOCAL_CRON = originalDisableLocalCron;
    }
  });

  describe("/api/mqtt-stream", () => {
    it("fails closed with 500 when CRON_SECRET_TOKEN is missing, whitespace, or < 32 chars", async () => {
      const invalidSecrets = [
        undefined,
        "",
        " ".repeat(32),
        "short-token",
        "c".repeat(31),
        "  " + "c".repeat(30),
      ];

      for (const secretValue of invalidSecrets) {
        if (secretValue === undefined) {
          delete process.env.CRON_SECRET_TOKEN;
        } else {
          process.env.CRON_SECRET_TOKEN = secretValue;
        }

        const req = {
          query: { token: secretValue ?? "anything" },
          headers: { "x-cron-token": secretValue ?? "anything" },
        } as unknown as NextApiRequest;
        const res = createMockApiResponse();

        await handleMqttStream(req, res);

        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({
          success: false,
          message:
            "Variável de ambiente CRON_SECRET_TOKEN obrigatória não configurada ou com menos de 32 caracteres.",
        });
        expect(mockStartWithActiveConfiguration).not.toHaveBeenCalled();
      }
    });

    it("rejects with 401 when CRON_SECRET_TOKEN is configured (>= 32 chars) but request token is missing or invalid", async () => {
      process.env.CRON_SECRET_TOKEN = VALID_CRON_SECRET_32;

      const reqMissing = { query: {}, headers: {} } as unknown as NextApiRequest;
      const resMissing = createMockApiResponse();
      await handleMqttStream(reqMissing, resMissing);
      expect(resMissing.statusCode).toBe(401);

      const reqWrong = {
        query: { token: "wrong-token" },
        headers: {},
      } as unknown as NextApiRequest;
      const resWrong = createMockApiResponse();
      await handleMqttStream(reqWrong, resWrong);
      expect(resWrong.statusCode).toBe(401);
    });

    it("allows access with 200 when valid CRON_SECRET_TOKEN (>= 32 chars) is provided", async () => {
      process.env.CRON_SECRET_TOKEN = VALID_CRON_SECRET_32;
      mockIsStreamConnected.mockReturnValue(false);
      mockGetLatestTelemetry.mockReturnValue({ batteryPercentage: 85 });

      const req = {
        query: {},
        headers: { "x-cron-token": VALID_CRON_SECRET_32 },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleMqttStream(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockStartWithActiveConfiguration).toHaveBeenCalledTimes(1);
      expect(res.body).toMatchObject({
        success: true,
        latestTelemetry: { batteryPercentage: 85 },
      });
    });

    it("enforces 500/401 auth checks before skipping when DISABLE_LOCAL_CRON=true", async () => {
      process.env.DISABLE_LOCAL_CRON = "true";

      // 500 when CRON_SECRET_TOKEN is absent
      const resNoSecret = createMockApiResponse();
      await handleMqttStream(
        { query: {}, headers: { "x-cron-token": VALID_CRON_SECRET_32 } } as unknown as NextApiRequest,
        resNoSecret
      );
      expect(resNoSecret.statusCode).toBe(500);
      expect(mockStartWithActiveConfiguration).not.toHaveBeenCalled();

      // 401 when CRON_SECRET_TOKEN is set but header is invalid/missing
      process.env.CRON_SECRET_TOKEN = VALID_CRON_SECRET_32;
      const resUnauthorized = createMockApiResponse();
      await handleMqttStream(
        { query: {}, headers: { "x-cron-token": "wrong-token" } } as unknown as NextApiRequest,
        resUnauthorized
      );
      expect(resUnauthorized.statusCode).toBe(401);
      expect(mockStartWithActiveConfiguration).not.toHaveBeenCalled();

      // 200 skipped:true when authorized via Cron header
      const resSkipped = createMockApiResponse();
      await handleMqttStream(
        { query: {}, headers: { "x-cron-token": VALID_CRON_SECRET_32 } } as unknown as NextApiRequest,
        resSkipped
      );
      expect(resSkipped.statusCode).toBe(200);
      expect(resSkipped.body).toMatchObject({
        success: true,
        skipped: true,
        isConnected: false,
        latestTelemetry: null,
      });
      expect(mockStartWithActiveConfiguration).not.toHaveBeenCalled();
    });
  });

  describe("/api/sync", () => {
    it("rejects unsupported HTTP methods with 405", async () => {
      const req = { method: "DELETE", headers: {}, query: {} } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleSync(req, res);

      expect(res.statusCode).toBe(405);
      expect(res.headers.Allow).toEqual(["GET", "POST"]);
    });

    it("fails closed with 500 when CRON_SECRET_TOKEN is missing, whitespace, or < 32 chars and no user session exists", async () => {
      const invalidSecrets = [
        undefined,
        "",
        " ".repeat(32),
        "short-cron-secret",
        "c".repeat(31),
        "  " + "c".repeat(30),
      ];

      for (const secretValue of invalidSecrets) {
        if (secretValue === undefined) {
          delete process.env.CRON_SECRET_TOKEN;
        } else {
          process.env.CRON_SECRET_TOKEN = secretValue;
        }

        const req = {
          method: "POST",
          headers: { authorization: `Bearer ${secretValue ?? "anything"}` },
          query: { token: secretValue ?? "anything" },
        } as unknown as NextApiRequest;
        const res = createMockApiResponse();

        await handleSync(req, res);

        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({
          success: false,
          message:
            "Variável de ambiente CRON_SECRET_TOKEN obrigatória não configurada ou com menos de 32 caracteres.",
        });
        expect(mockExecuteSyncAll).not.toHaveBeenCalled();
      }
    });

    it("returns controlled JSON 500 when AUTH_SECRET fails in extractUserFromRequest", async () => {
      process.env.CRON_SECRET_TOKEN = VALID_CRON_SECRET_32;
      process.env.AUTH_SECRET = "too-short";

      const req = {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=tampered.token`,
        },
        query: {},
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleSync(req, res);

      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({
        success: false,
        message: expect.stringContaining("AUTH_SECRET obrigatória"),
      });
      expect(mockExecuteSyncAll).not.toHaveBeenCalled();
      expect(mockExecuteSyncForUser).not.toHaveBeenCalled();
    });

    it("rejects with 401 when CRON_SECRET_TOKEN is configured but neither valid cron token nor user session is provided", async () => {
      process.env.CRON_SECRET_TOKEN = VALID_CRON_SECRET_32;

      const req = {
        method: "GET",
        headers: { authorization: "Bearer wrong-secret" },
        query: {},
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleSync(req, res);

      expect(res.statusCode).toBe(401);
      expect(mockExecuteSyncAll).not.toHaveBeenCalled();
    });

    it("executes executeSyncAll with 200 when valid Bearer cron token is provided, even with an invalid session cookie present", async () => {
      process.env.CRON_SECRET_TOKEN = VALID_CRON_SECRET_32;
      // AUTH_SECRET intentionally omitted/invalid to verify Cron short-circuits before extractUserFromRequest
      delete process.env.AUTH_SECRET;
      mockExecuteSyncAll.mockResolvedValue([{ hasExecutedSuccessfully: true }]);

      const req = {
        method: "POST",
        headers: {
          authorization: `Bearer ${VALID_CRON_SECRET_32}`,
          cookie: `${SESSION_COOKIE_NAME}=invalid-or-expired.cookie`,
        },
        query: {},
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleSync(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockExecuteSyncAll).toHaveBeenCalledTimes(1);
      expect(mockExecuteSyncForUser).not.toHaveBeenCalled();
    });

    it("executes executeSyncForUser with 200 when valid user session cookie is provided", async () => {
      process.env.AUTH_SECRET = VALID_AUTH_SECRET_32;
      const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET_32);
      const sessionToken = tokenService.createSessionToken("user-99", "owner@wattflow.local");
      let rawToken = "";
      sessionToken.transferToken((t) => {
        rawToken = t;
      });

      mockExecuteSyncForUser.mockResolvedValue({
        hasExecutedSuccessfully: true,
        batteryPercentage: 90,
        solarWatts: 400,
        outputWatts: 120,
        triggeredAction: "NONE",
        detailMessage: "OK",
      });

      const req = {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
          cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
        },
        query: {},
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleSync(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockExecuteSyncForUser).toHaveBeenCalledWith("user-99");
      expect(mockExecuteSyncAll).not.toHaveBeenCalled();
    });

    it("blocks GET /api/sync with 405 when authenticated by session cookie (SEC-10)", async () => {
      process.env.AUTH_SECRET = VALID_AUTH_SECRET_32;
      const req = {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=some.session.token` },
        query: {},
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleSync(req, res);

      expect(res.statusCode).toBe(405);
      expect(res.headers.Allow).toEqual(["POST"]);
    });

    it("rejects ?token= in query string for /api/mqtt-stream and /api/sync (SEC-12)", async () => {
      process.env.CRON_SECRET_TOKEN = VALID_CRON_SECRET_32;

      const mqttRes = createMockApiResponse();
      await handleMqttStream(
        {
          method: "GET",
          query: { token: VALID_CRON_SECRET_32 },
          headers: {},
        } as unknown as NextApiRequest,
        mqttRes
      );
      expect(mqttRes.statusCode).toBe(401);

      const syncRes = createMockApiResponse();
      await handleSync(
        {
          method: "GET",
          query: { token: VALID_CRON_SECRET_32 },
          headers: {},
        } as unknown as NextApiRequest,
        syncRes
      );
      expect(syncRes.statusCode).toBe(401);
    });

    it("sanitizes unexpected 500 internal errors in /api/sync without leaking DB/stack details (SEC-14)", async () => {
      process.env.CRON_SECRET_TOKEN = VALID_CRON_SECRET_32;
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockExecuteSyncAll.mockRejectedValueOnce(new Error("ECONNREFUSED postgres://secret-host:5432"));

      const syncRes = createMockApiResponse();
      await handleSync(
        {
          method: "POST",
          query: {},
          headers: { authorization: `Bearer ${VALID_CRON_SECRET_32}` },
        } as unknown as NextApiRequest,
        syncRes
      );

      expect(syncRes.statusCode).toBe(500);
      expect(syncRes.body).toEqual({
        success: false,
        message: "Erro interno ao processar a sincronização de energia.",
      });
      expect(JSON.stringify(syncRes.body)).not.toContain("ECONNREFUSED");
      expect(JSON.stringify(syncRes.body)).not.toContain("postgres://");
    });

    it("guards DISABLE_LOCAL_CRON=true: skips only authenticated cron (200 skipped:true), keeps 401/405/500 and session sync active", async () => {
      process.env.DISABLE_LOCAL_CRON = "true";

      // 405 on unsupported method
      const resMethod = createMockApiResponse();
      await handleSync(
        { method: "DELETE", headers: {}, query: {} } as unknown as NextApiRequest,
        resMethod
      );
      expect(resMethod.statusCode).toBe(405);

      // 500 when CRON_SECRET_TOKEN is absent
      const resNoSecret = createMockApiResponse();
      await handleSync(
        {
          method: "POST",
          headers: { authorization: `Bearer ${VALID_CRON_SECRET_32}` },
          query: {},
        } as unknown as NextApiRequest,
        resNoSecret
      );
      expect(resNoSecret.statusCode).toBe(500);

      // 401 when unauthorized
      process.env.CRON_SECRET_TOKEN = VALID_CRON_SECRET_32;
      const resUnauth = createMockApiResponse();
      await handleSync(
        { method: "POST", headers: { authorization: "Bearer wrong" }, query: {} } as unknown as NextApiRequest,
        resUnauth
      );
      expect(resUnauth.statusCode).toBe(401);

      // 200 skipped:true when authenticated via Cron header
      const resCronSkip = createMockApiResponse();
      await handleSync(
        {
          method: "POST",
          headers: { authorization: `Bearer ${VALID_CRON_SECRET_32}` },
          query: {},
        } as unknown as NextApiRequest,
        resCronSkip
      );
      expect(resCronSkip.statusCode).toBe(200);
      expect(resCronSkip.body).toMatchObject({
        success: true,
        skipped: true,
        data: [],
      });
      expect(mockExecuteSyncAll).not.toHaveBeenCalled();

      // Authenticated user session still executes manual sync even with DISABLE_LOCAL_CRON=true
      process.env.AUTH_SECRET = VALID_AUTH_SECRET_32;
      const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET_32);
      const sessionToken = tokenService.createSessionToken("user-99", "owner@wattflow.local");
      let rawToken = "";
      sessionToken.transferToken((t) => {
        rawToken = t;
      });
      mockExecuteSyncForUser.mockResolvedValueOnce({
        hasExecutedSuccessfully: true,
        batteryPercentage: 88,
        solarWatts: 300,
        outputWatts: 100,
        triggeredAction: "NONE",
        detailMessage: "Manual sync OK",
      });

      const resUserSync = createMockApiResponse();
      await handleSync(
        {
          method: "POST",
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
            host: "app.wattflow.local",
            origin: "https://app.wattflow.local",
            "sec-fetch-site": "same-origin",
          },
          query: {},
        } as unknown as NextApiRequest,
        resUserSync
      );
      expect(resUserSync.statusCode).toBe(200);
      expect(resUserSync.body.skipped).toBeUndefined();
      expect(mockExecuteSyncForUser).toHaveBeenCalledWith("user-99");
    });
  });
});
