import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  automationsPostBodySchema,
  loginBodySchema,
  registerBodySchema,
  settingsPostBodySchema,
  twoFactorBodySchema,
} from "../apiSchemas";
import {
  constantTimeSecretEquals,
  extractCronTokenFromHeaders,
  verifyCronRequestAuthorization,
} from "../cronAuthHelper";
import { escapeHtml, NotificationDispatcher } from "../../notifications/NotificationDispatcher";
import { EcoFlowHttpClient } from "../../http/EcoFlowHttpClient";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { resetRateLimiterState } from "../rateLimiter";

const { mockUserFindUnique } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
}));

vi.mock("../../database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
    },
  },
}));

import handleLogin from "../../../pages/api/auth/login";

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

describe("Etapa 4 Hardening (SEC-11, SEC-12, SEC-13, SEC-14)", () => {
  const originalFetch = globalThis.fetch;
  const originalAuthSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiterState();
    process.env.AUTH_SECRET = "auth-secret-token-with-32-chars!";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
    vi.restoreAllMocks();
  });

  describe("SEC-11: apiSchemas.ts (Zod + maxLength)", () => {
    it("enforces maxLength and types on login, register, twoFactor, and settings schemas", () => {
      expect(loginBodySchema.safeParse({ email: "a@b.com", password: "secret" }).success).toBe(true);
      expect(loginBodySchema.safeParse({ email: "a".repeat(255), password: "secret" }).success).toBe(false);
      expect(loginBodySchema.safeParse({ email: "a@b.com", password: "p".repeat(129) }).success).toBe(false);

      expect(registerBodySchema.safeParse({ email: "a@b.com", password: "short" }).success).toBe(false);
      expect(
        registerBodySchema.safeParse({
          email: "a@b.com",
          password: "ValidPassword123!",
          fullName: "x".repeat(121),
        }).success
      ).toBe(false);

      expect(twoFactorBodySchema.safeParse({ action: "INVALID" }).success).toBe(false);
      expect(twoFactorBodySchema.safeParse({ action: "SETUP" }).success).toBe(true);

      expect(
        settingsPostBodySchema.safeParse({
          ecoflowAccessKey: "ak",
          ecoflowSerialNumber: "SN123",
        }).success
      ).toBe(true);
      expect(
        settingsPostBodySchema.safeParse({
          ecoflowAccessKey: "a".repeat(129),
          ecoflowSerialNumber: "SN123",
        }).success
      ).toBe(false);
    });

    it("automationsPostBodySchema rejects null, '', false, and [] in thresholds without coercing to 0", () => {
      expect(
        automationsPostBodySchema.safeParse({
          turnOnThreshold: 80,
          turnOffThreshold: 20,
          isAutomationActive: true,
        }).success
      ).toBe(true);

      expect(
        automationsPostBodySchema.safeParse({
          turnOnThreshold: "80",
          turnOffThreshold: " 20 ",
          isAutomationActive: false,
        }).success
      ).toBe(true);

      const nonCoercibleValues: unknown[] = [null, "", "   ", false, true, [], {}, -1, 101, 80.5];
      for (const bad of nonCoercibleValues) {
        expect(
          automationsPostBodySchema.safeParse({
            turnOnThreshold: bad,
            turnOffThreshold: 20,
            isAutomationActive: true,
          }).success
        ).toBe(false);

        expect(
          automationsPostBodySchema.safeParse({
            turnOnThreshold: 80,
            turnOffThreshold: bad,
            isAutomationActive: true,
          }).success
        ).toBe(false);
      }
    });
  });

  describe("SEC-11 & SEC-13: NotificationDispatcher escapeHtml & AbortSignal.timeout(8000)", () => {
    it("escapes HTML special characters in escapeHtml() and Telegram payload", async () => {
      expect(escapeHtml(`<script>alert("xss" & 'test')</script>`)).toBe(
        "&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;test&#39;)&lt;/script&gt;"
      );

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const dispatcher = new NotificationDispatcher();
      await dispatcher.dispatchTelegramOnly(
        {
          title: `<b>Alert & "Hack"</b>`,
          message: `<a href="evil">Click 'here'</a>`,
          batteryPercentage: 80,
          solarWatts: 250,
          actionState: "ALERT",
        },
        "123456:BOT_TOKEN",
        "998877"
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, fetchInit] = fetchSpy.mock.calls[0];
      expect(fetchInit.signal).toBeInstanceOf(AbortSignal);
      const sentBody = JSON.parse(fetchInit.body as string) as { text: string };
      expect(sentBody.text).toContain("&lt;b&gt;Alert &amp; &quot;Hack&quot;&lt;/b&gt;");
      expect(sentBody.text).toContain("&lt;a href=&quot;evil&quot;&gt;Click &#39;here&#39;&lt;/a&gt;");
    });
  });

  describe("SEC-12: cronAuthHelper.ts (SHA-256 + timingSafeEqual, headers-only)", () => {
    it("ignores ?token= query string and validates Bearer / x-cron-token headers in constant time", () => {
      const secret = "cron-secret-token-with-32-chars!";
      expect(constantTimeSecretEquals(secret, secret)).toBe(true);
      expect(constantTimeSecretEquals("short", secret)).toBe(false);

      const queryOnlyReq = {
        query: { token: secret },
        headers: {},
      } as unknown as NextApiRequest;
      expect(extractCronTokenFromHeaders(queryOnlyReq)).toBeNull();
      expect(verifyCronRequestAuthorization(queryOnlyReq, secret)).toEqual({
        hasValidSecretConfigured: true,
        isAuthorized: false,
      });

      const bearerReq = {
        query: {},
        headers: { authorization: `Bearer ${secret}` },
      } as unknown as NextApiRequest;
      expect(verifyCronRequestAuthorization(bearerReq, secret)).toEqual({
        hasValidSecretConfigured: true,
        isAuthorized: true,
      });

      const headerReq = {
        query: {},
        headers: { "x-cron-token": secret },
      } as unknown as NextApiRequest;
      expect(verifyCronRequestAuthorization(headerReq, secret)).toEqual({
        hasValidSecretConfigured: true,
        isAuthorized: true,
      });
    });
  });

  describe("SEC-13 & SEC-14: EcoFlowHttpClient AbortSignal & Login dummy scrypt + sanitized 500", () => {
    it("passes AbortSignal to external fetch() in EcoFlowHttpClient", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: "0",
          data: {
            protocol: "mqtts",
            url: "mqtt.ecoflow.com",
            port: 8883,
            certificateAccount: "acct",
            certificatePassword: "pass",
          },
        }),
      });
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const client = new EcoFlowHttpClient(
        new EcoFlowCredentials(new AccessKey("ak-1234"), new AccessSecret("as-1234")),
        "https://api.ecoflow.com"
      );
      await client.fetchMqttCertification();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it("login runs dummy scrypt when !user and returns generic 401", async () => {
      mockUserFindUnique.mockResolvedValueOnce(null);
      const resNotFound = createMockApiResponse();
      await handleLogin(
        {
          method: "POST",
          headers: {},
          body: { email: "missing@wattflow.local", password: "SomePassword123!" },
        } as unknown as NextApiRequest,
        resNotFound
      );
      expect(resNotFound.statusCode).toBe(401);
      expect(resNotFound.body).toEqual({
        success: false,
        message: "Credenciais de acesso incorretas.",
      });
    });
  });
});
