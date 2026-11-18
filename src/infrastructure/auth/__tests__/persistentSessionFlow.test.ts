import { randomBytes, scryptSync } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFindUnique, mockUserUpdateMany, mockUserUpdate, mockTransaction } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockUserUpdateMany: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("../../database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      updateMany: mockUserUpdateMany,
      update: mockUserUpdate,
    },
    $transaction: mockTransaction,
  },
}));

import handleMe from "../../../pages/api/auth/me";
import handleLogin from "../../../pages/api/auth/login";
import handleLoginTwoFactor from "../../../pages/api/auth/login-2fa";
import handleRegister from "../../../pages/api/auth/register";
import { AuthenticationTokenService } from "../../../domain/services/AuthenticationTokenService";
import { UserSessionToken } from "../../../domain/values/UserSessionToken";
import {
  PERSISTENT_SESSION_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  SHORT_SESSION_MAX_AGE_SECONDS,
} from "../sessionHelper";
import { encryptSecret } from "../../security/encryptionHelper";
import { generateBase32Secret, generateTotpCode } from "../totpHelper";
import { resetRateLimiterState } from "../../security/rateLimiter";

const VALID_AUTH_SECRET = "auth-secret-token-with-32-chars!";
const VALID_ENCRYPTION_KEY = "4f8a2c1e9d7b6a3f0e5c8d1a2b4c6e8f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d";
const DAY_MS = 24 * 60 * 60 * 1000;

function hashPasswordForTest(rawPassword: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(rawPassword, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

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

function extractSessionTokenFromSetCookie(setCookieHeader: unknown): string {
  const rawHeader = Array.isArray(setCookieHeader)
    ? String(setCookieHeader[0] ?? "")
    : String(setCookieHeader ?? "");
  const firstSegment = rawHeader.split(";")[0] ?? "";
  const prefix = `${SESSION_COOKIE_NAME}=`;
  expect(firstSegment.startsWith(prefix)).toBe(true);
  return decodeURIComponent(firstSegment.slice(prefix.length));
}

describe("Persistent PWA session flow (Etapa 1)", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;
  const originalAllowPublicReg = process.env.ALLOW_PUBLIC_REGISTRATION;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiterState();
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;
    process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;
    delete process.env.ALLOW_PUBLIC_REGISTRATION;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }
    if (originalAllowPublicReg === undefined) {
      delete process.env.ALLOW_PUBLIC_REGISTRATION;
    } else {
      process.env.ALLOW_PUBLIC_REGISTRATION = originalAllowPublicReg;
    }
  });

  describe("GET /api/auth/me sliding refresh", () => {
    it("reissues a 30d Set-Cookie when remaining session lifetime is < 29 days and > 24h", async () => {
      vi.useFakeTimers();
      const t0 = new Date("2026-11-01T00:00:00Z").getTime();
      vi.setSystemTime(t0);

      const service = new AuthenticationTokenService(VALID_AUTH_SECRET);
      const token = service.createSessionToken("usr-me-1", "me@wattflow.local", 30, 2);
      let rawToken = "";
      token.transferToken((t) => {
        rawToken = t;
      });

      // Advance 2 days -> 28 days remaining (< 29d and > 24h)
      const tNow = t0 + 2 * DAY_MS;
      vi.setSystemTime(tNow);

      mockUserFindUnique
        .mockResolvedValueOnce({
          id: "usr-me-1",
          email: "me@wattflow.local",
          tokenVersion: 2,
        })
        .mockResolvedValueOnce({
          id: "usr-me-1",
          email: "me@wattflow.local",
          fullName: "PWA User",
        });

      const req = {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}` },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleMe(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        isAuthenticated: true,
        user: { id: "usr-me-1", email: "me@wattflow.local", fullName: "PWA User" },
      });

      const setCookie = String(res.headers["Set-Cookie"] ?? "");
      expect(setCookie).toContain(`SameSite=Lax`);
      expect(setCookie).toContain(`Max-Age=${PERSISTENT_SESSION_MAX_AGE_SECONDS}`);
      expect(setCookie).toContain(
        `Expires=${new Date(tNow + PERSISTENT_SESSION_MAX_AGE_SECONDS * 1000).toUTCString()}`
      );

      const refreshedRaw = extractSessionTokenFromSetCookie(setCookie);
      const inspected = service.inspectSessionToken(new UserSessionToken(refreshedRaw), 2);
      expect(inspected?.expiresAt).toBe(tNow + 30 * DAY_MS);
    });

    it("does NOT reissue Set-Cookie when remaining lifetime is > 29 days", async () => {
      vi.useFakeTimers();
      const t0 = new Date("2026-11-01T00:00:00Z").getTime();
      vi.setSystemTime(t0);

      const service = new AuthenticationTokenService(VALID_AUTH_SECRET);
      const token = service.createSessionToken("usr-me-2", "me2@wattflow.local", 30, 0);
      let rawToken = "";
      token.transferToken((t) => {
        rawToken = t;
      });

      // Advance 12 hours -> 29.5 days remaining (> 29d)
      vi.setSystemTime(t0 + 12 * 60 * 60 * 1000);

      mockUserFindUnique
        .mockResolvedValueOnce({
          id: "usr-me-2",
          email: "me2@wattflow.local",
          tokenVersion: 0,
        })
        .mockResolvedValueOnce({
          id: "usr-me-2",
          email: "me2@wattflow.local",
          fullName: "Fresh User",
        });

      const req = {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}` },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleMe(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.isAuthenticated).toBe(true);
      expect(res.headers["Set-Cookie"]).toBeUndefined();
    });

    it("does NOT reissue Set-Cookie for a short session (<= 24h remaining)", async () => {
      vi.useFakeTimers();
      const t0 = new Date("2026-11-01T00:00:00Z").getTime();
      vi.setSystemTime(t0);

      const service = new AuthenticationTokenService(VALID_AUTH_SECRET);
      const shortToken = service.createSessionToken("usr-me-3", "short@wattflow.local", 1, 0);
      let rawToken = "";
      shortToken.transferToken((t) => {
        rawToken = t;
      });

      // Advance 2 hours -> 22h remaining (<= 24h)
      vi.setSystemTime(t0 + 2 * 60 * 60 * 1000);

      mockUserFindUnique
        .mockResolvedValueOnce({
          id: "usr-me-3",
          email: "short@wattflow.local",
          tokenVersion: 0,
        })
        .mockResolvedValueOnce({
          id: "usr-me-3",
          email: "short@wattflow.local",
          fullName: "Short Session User",
        });

      const req = {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}` },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleMe(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.isAuthenticated).toBe(true);
      expect(res.headers["Set-Cookie"]).toBeUndefined();
    });

    it("blocks session when tokenVersion diverges from database", async () => {
      const service = new AuthenticationTokenService(VALID_AUTH_SECRET);
      const token = service.createSessionToken("usr-me-4", "revoked@wattflow.local", 30, 0);
      let rawToken = "";
      token.transferToken((t) => {
        rawToken = t;
      });

      mockUserFindUnique.mockResolvedValueOnce({
        id: "usr-me-4",
        email: "revoked@wattflow.local",
        tokenVersion: 1,
      });

      const req = {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}` },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleMe(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ isAuthenticated: false });
      expect(res.headers["Set-Cookie"]).toBeUndefined();
    });
  });

  describe("POST /api/auth/login rememberMe persistence", () => {
    it("issues 30d cookie when rememberMe is omitted or true, and 1d cookie when rememberMe=false", async () => {
      vi.useFakeTimers();
      const nowMs = new Date("2026-11-18T10:00:00Z").getTime();
      vi.setSystemTime(nowMs);

      const password = "StrongPassword123!";
      const passwordHash = hashPasswordForTest(password);
      const service = new AuthenticationTokenService(VALID_AUTH_SECRET);

      const dbUser = {
        id: "usr-login-1",
        email: "login@wattflow.local",
        fullName: "Login User",
        passwordHash,
        twoFactorEnabled: false,
        tokenVersion: 1,
      };

      // 1) rememberMe omitted (default true -> 30d)
      mockUserFindUnique.mockResolvedValueOnce(dbUser);
      const resDefault = createMockApiResponse();
      await handleLogin(
        {
          method: "POST",
          headers: { "x-real-ip": "198.51.100.1" },
          body: { email: "login@wattflow.local", password },
        } as unknown as NextApiRequest,
        resDefault
      );
      expect(resDefault.statusCode).toBe(200);
      const defaultCookie = String(resDefault.headers["Set-Cookie"] ?? "");
      expect(defaultCookie).toContain(`SameSite=Lax`);
      expect(defaultCookie).toContain(`Max-Age=${PERSISTENT_SESSION_MAX_AGE_SECONDS}`);
      expect(defaultCookie).toContain(
        `Expires=${new Date(nowMs + PERSISTENT_SESSION_MAX_AGE_SECONDS * 1000).toUTCString()}`
      );
      const defaultToken = extractSessionTokenFromSetCookie(defaultCookie);
      expect(service.inspectSessionToken(new UserSessionToken(defaultToken), 1)?.expiresAt).toBe(
        nowMs + 30 * DAY_MS
      );

      // 2) rememberMe: true -> 30d
      mockUserFindUnique.mockResolvedValueOnce(dbUser);
      const resTrue = createMockApiResponse();
      await handleLogin(
        {
          method: "POST",
          headers: { "x-real-ip": "198.51.100.2" },
          body: { email: "login@wattflow.local", password, rememberMe: true },
        } as unknown as NextApiRequest,
        resTrue
      );
      expect(resTrue.statusCode).toBe(200);
      const trueCookie = String(resTrue.headers["Set-Cookie"] ?? "");
      expect(trueCookie).toContain(`Max-Age=${PERSISTENT_SESSION_MAX_AGE_SECONDS}`);
      const trueToken = extractSessionTokenFromSetCookie(trueCookie);
      expect(service.inspectSessionToken(new UserSessionToken(trueToken), 1)?.expiresAt).toBe(
        nowMs + 30 * DAY_MS
      );

      // 3) rememberMe: false -> 1d
      mockUserFindUnique.mockResolvedValueOnce(dbUser);
      const resFalse = createMockApiResponse();
      await handleLogin(
        {
          method: "POST",
          headers: { "x-real-ip": "198.51.100.3" },
          body: { email: "login@wattflow.local", password, rememberMe: false },
        } as unknown as NextApiRequest,
        resFalse
      );
      expect(resFalse.statusCode).toBe(200);
      const falseCookie = String(resFalse.headers["Set-Cookie"] ?? "");
      expect(falseCookie).toContain(`SameSite=Lax`);
      expect(falseCookie).toContain(`Max-Age=${SHORT_SESSION_MAX_AGE_SECONDS}`);
      expect(falseCookie).toContain(
        `Expires=${new Date(nowMs + SHORT_SESSION_MAX_AGE_SECONDS * 1000).toUTCString()}`
      );
      const falseToken = extractSessionTokenFromSetCookie(falseCookie);
      expect(service.inspectSessionToken(new UserSessionToken(falseToken), 1)?.expiresAt).toBe(
        nowMs + 1 * DAY_MS
      );
    });
  });

  describe("POST /api/auth/login-2fa rememberMe persistence", () => {
    it("issues 30d cookie when rememberMe is omitted/true and 1d cookie when rememberMe=false", async () => {
      vi.useFakeTimers();
      const nowMs = new Date("2026-11-18T10:00:00Z").getTime();
      vi.setSystemTime(nowMs);

      const totpSecret = generateBase32Secret(20);
      const encryptedTotpSecret = encryptSecret(totpSecret);
      const service = new AuthenticationTokenService(VALID_AUTH_SECRET);
      const challengeToken = service.createTwoFactorChallengeToken(
        "usr-2fa-rem",
        "2fa@wattflow.local",
        5 * 60 * 1000,
        3
      );

      const dbUser = {
        id: "usr-2fa-rem",
        email: "2fa@wattflow.local",
        fullName: "2FA PWA User",
        twoFactorEnabled: true,
        twoFactorSecret: encryptedTotpSecret,
        tokenVersion: 3,
        lastTotpCounter: null as number | null,
      };

      const validCode = generateTotpCode(totpSecret, 0);

      // 1) rememberMe omitted -> 30d
      mockUserFindUnique.mockResolvedValueOnce(dbUser);
      mockUserUpdateMany.mockResolvedValueOnce({ count: 1 });
      const resDefault = createMockApiResponse();
      await handleLoginTwoFactor(
        {
          method: "POST",
          headers: { "x-real-ip": "198.51.100.10" },
          body: { challengeToken, code: validCode },
        } as unknown as NextApiRequest,
        resDefault
      );
      expect(resDefault.statusCode).toBe(200);
      const defaultCookie = String(resDefault.headers["Set-Cookie"] ?? "");
      expect(defaultCookie).toContain(`Max-Age=${PERSISTENT_SESSION_MAX_AGE_SECONDS}`);
      const defaultToken = extractSessionTokenFromSetCookie(defaultCookie);
      expect(service.inspectSessionToken(new UserSessionToken(defaultToken), 3)?.expiresAt).toBe(
        nowMs + 30 * DAY_MS
      );

      // 2) rememberMe: true -> 30d
      mockUserFindUnique.mockResolvedValueOnce(dbUser);
      mockUserUpdateMany.mockResolvedValueOnce({ count: 1 });
      const resTrue = createMockApiResponse();
      await handleLoginTwoFactor(
        {
          method: "POST",
          headers: { "x-real-ip": "198.51.100.11" },
          body: { challengeToken, code: validCode, rememberMe: true },
        } as unknown as NextApiRequest,
        resTrue
      );
      expect(resTrue.statusCode).toBe(200);
      expect(String(resTrue.headers["Set-Cookie"] ?? "")).toContain(
        `Max-Age=${PERSISTENT_SESSION_MAX_AGE_SECONDS}`
      );

      // 3) rememberMe: false -> 1d
      mockUserFindUnique.mockResolvedValueOnce(dbUser);
      mockUserUpdateMany.mockResolvedValueOnce({ count: 1 });
      const resFalse = createMockApiResponse();
      await handleLoginTwoFactor(
        {
          method: "POST",
          headers: { "x-real-ip": "198.51.100.12" },
          body: { challengeToken, code: validCode, rememberMe: false },
        } as unknown as NextApiRequest,
        resFalse
      );
      expect(resFalse.statusCode).toBe(200);
      const falseCookie = String(resFalse.headers["Set-Cookie"] ?? "");
      expect(falseCookie).toContain(`SameSite=Lax`);
      expect(falseCookie).toContain(`Max-Age=${SHORT_SESSION_MAX_AGE_SECONDS}`);
      const falseToken = extractSessionTokenFromSetCookie(falseCookie);
      expect(service.inspectSessionToken(new UserSessionToken(falseToken), 3)?.expiresAt).toBe(
        nowMs + 1 * DAY_MS
      );
    });
  });

  describe("POST /api/auth/register persistent cookie", () => {
    it("issues 30d persistent cookie with SameSite=Lax and explicit Expires", async () => {
      vi.useFakeTimers();
      const nowMs = new Date("2026-11-18T10:00:00Z").getTime();
      vi.setSystemTime(nowMs);

      process.env.ALLOW_PUBLIC_REGISTRATION = "true";
      mockUserFindUnique.mockResolvedValueOnce(null);
      mockTransaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          user: {
            create: vi.fn().mockResolvedValue({
              id: "usr-reg-30d",
              email: "reg30d@wattflow.local",
              fullName: "Reg PWA",
              tokenVersion: 0,
            }),
          },
          userConfiguration: {
            create: vi.fn().mockResolvedValue({}),
          },
        };
        return cb(tx);
      });

      const res = createMockApiResponse();
      await handleRegister(
        {
          method: "POST",
          headers: {},
          body: {
            email: "reg30d@wattflow.local",
            password: "ValidPassword123!",
            fullName: "Reg PWA",
          },
        } as unknown as NextApiRequest,
        res
      );

      expect(res.statusCode).toBe(201);
      const setCookie = String(res.headers["Set-Cookie"] ?? "");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain(`Max-Age=${PERSISTENT_SESSION_MAX_AGE_SECONDS}`);
      expect(setCookie).toContain(
        `Expires=${new Date(nowMs + PERSISTENT_SESSION_MAX_AGE_SECONDS * 1000).toUTCString()}`
      );
    });
  });
});
