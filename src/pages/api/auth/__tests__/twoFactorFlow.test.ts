import { randomBytes, scryptSync } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFindUnique, mockUserUpdate, mockQrToDataUrl } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockQrToDataUrl: vi.fn(),
}));

vi.mock("../../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      update: mockUserUpdate,
    },
  },
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: mockQrToDataUrl,
  },
}));

import handleLogin from "../login";
import handleLoginTwoFactor from "../login-2fa";
import handleTwoFactor from "../2fa";
import { AuthenticationTokenService } from "../../../../domain/services/AuthenticationTokenService";
import { SESSION_COOKIE_NAME } from "../../../../infrastructure/auth/sessionHelper";
import { encryptSecret } from "../../../../infrastructure/security/encryptionHelper";
import { generateBase32Secret, generateTotpCode } from "../../../../infrastructure/auth/totpHelper";
import { resetRateLimiterState } from "../../../../infrastructure/security/rateLimiter";

const VALID_AUTH_SECRET = "auth-secret-token-with-32-chars!";
const VALID_ENCRYPTION_KEY = "4f8a2c1e9d7b6a3f0e5c8d1a2b4c6e8f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d";

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

describe("2FA authentication flow (/api/auth/login + /api/auth/login-2fa + /api/auth/2fa)", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiterState();
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;
    process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;
    mockQrToDataUrl.mockResolvedValue("data:image/png;base64,MOCKQR");
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
  });

  it("login with 2FA enabled returns requiresTwoFactor=true and challengeToken without setting session cookie", async () => {
    const password = "StrongPassword123!";
    mockUserFindUnique.mockResolvedValue({
      id: "usr-2fa-1",
      email: "user@wattflow.local",
      fullName: "WattFlow User",
      passwordHash: hashPasswordForTest(password),
      twoFactorEnabled: true,
    });

    const req = {
      method: "POST",
      body: { email: "user@wattflow.local", password },
    } as unknown as NextApiRequest;
    const res = createMockApiResponse();

    await handleLogin(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.headers["Set-Cookie"]).toBeUndefined();
    expect(res.body).toMatchObject({
      success: true,
      requiresTwoFactor: true,
      challengeToken: expect.any(String),
    });
  });

  it("login-2fa issues session cookie with valid challengeToken + valid TOTP and rejects invalid/expired code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));

    const totpSecret = generateBase32Secret(20);
    const encryptedTotpSecret = encryptSecret(totpSecret);
    const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET);
    const challengeToken = tokenService.createTwoFactorChallengeToken("usr-2fa-1", "user@wattflow.local");

    mockUserFindUnique.mockResolvedValue({
      id: "usr-2fa-1",
      email: "user@wattflow.local",
      fullName: "WattFlow User",
      twoFactorEnabled: true,
      twoFactorSecret: encryptedTotpSecret,
    });

    // Invalid / expired TOTP code (2 steps behind)
    const expiredCode = generateTotpCode(totpSecret, -2);
    const reqInvalidCode = {
      method: "POST",
      body: { challengeToken, code: expiredCode },
    } as unknown as NextApiRequest;
    const resInvalidCode = createMockApiResponse();

    await handleLoginTwoFactor(reqInvalidCode, resInvalidCode);
    expect(resInvalidCode.statusCode).toBe(401);
    expect(resInvalidCode.headers["Set-Cookie"]).toBeUndefined();

    // Valid TOTP code
    const validCode = generateTotpCode(totpSecret, 0);
    const reqValid = {
      method: "POST",
      body: { challengeToken, code: validCode },
    } as unknown as NextApiRequest;
    const resValid = createMockApiResponse();

    await handleLoginTwoFactor(reqValid, resValid);
    expect(resValid.statusCode).toBe(200);
    expect(resValid.headers["Cache-Control"]).toBe("no-store");
    expect(String(resValid.headers["Set-Cookie"])).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(resValid.body).toMatchObject({
      success: true,
      user: {
        id: "usr-2fa-1",
        email: "user@wattflow.local",
      },
    });
  });

  it("login-2fa rejects expired or tampered challengeToken", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));

    const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET);
    const challengeToken = tokenService.createTwoFactorChallengeToken("usr-2fa-1", "user@wattflow.local", 1);

    // Advance 2 minutes past 1-minute challenge TTL
    vi.setSystemTime(new Date("2026-11-18T00:02:00Z"));

    const reqExpired = {
      method: "POST",
      body: { challengeToken, code: "123456" },
    } as unknown as NextApiRequest;
    const resExpired = createMockApiResponse();

    await handleLoginTwoFactor(reqExpired, resExpired);
    expect(resExpired.statusCode).toBe(401);
    expect(resExpired.headers["Set-Cookie"]).toBeUndefined();
  });

  it("login-2fa sanitizes HTTP 500 internal errors when decryption fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET);
    const challengeToken = tokenService.createTwoFactorChallengeToken("usr-2fa-1", "user@wattflow.local");

    mockUserFindUnique.mockResolvedValueOnce({
      id: "usr-2fa-1",
      email: "user@wattflow.local",
      fullName: "WattFlow User",
      twoFactorEnabled: true,
      twoFactorSecret: "enc:v1:corrupted-iv:corrupted-tag:corrupted-cipher",
    });

    const res = createMockApiResponse();
    await handleLoginTwoFactor(
      {
        method: "POST",
        body: { challengeToken, code: "123456" },
      } as unknown as NextApiRequest,
      res
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: "Erro interno ao validar autenticação em duas etapas.",
    });
    expect(JSON.stringify(res.body)).not.toContain("enc:v1:");
    expect(JSON.stringify(res.body)).not.toContain("corrupted");
  });

  describe("/api/auth/2fa VERIFY_AND_ENABLE hardening", () => {
    function buildAuthenticatedHeaders(userId = "usr-1", email = "user@wattflow.local") {
      const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET);
      const sessionToken = tokenService.createSessionToken(userId, email);
      let rawToken = "";
      sessionToken.transferToken((t) => {
        rawToken = t;
      });
      return {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
      };
    }

    it("rejects secret in body, requires valid currentPassword, and blocks overwrite when 2FA is already active", async () => {
      const currentPassword = "CurrentPassword123!";
      const passwordHash = hashPasswordForTest(currentPassword);
      const pendingSecret = generateBase32Secret(20);
      const encryptedPending = encryptSecret(pendingSecret);

      // 1) Blocks overwrite when 2FA already active (409)
      mockUserFindUnique.mockResolvedValue({
        id: "usr-1",
        email: "user@wattflow.local",
        passwordHash,
        twoFactorEnabled: true,
        pendingTwoFactorSecret: null,
        tokenVersion: 0,
      });
      const resAlreadyActive = createMockApiResponse();
      await handleTwoFactor(
        {
          method: "POST",
          headers: buildAuthenticatedHeaders(),
          body: { action: "VERIFY_AND_ENABLE", token: "123456", currentPassword },
        } as unknown as NextApiRequest,
        resAlreadyActive
      );
      expect(resAlreadyActive.statusCode).toBe(409);

      // 2) Rejects client-supplied secret in body (400)
      mockUserFindUnique.mockResolvedValue({
        id: "usr-1",
        email: "user@wattflow.local",
        passwordHash,
        twoFactorEnabled: false,
        pendingTwoFactorSecret: encryptedPending,
        tokenVersion: 0,
      });
      const resBodySecret = createMockApiResponse();
      await handleTwoFactor(
        {
          method: "POST",
          headers: buildAuthenticatedHeaders(),
          body: {
            action: "VERIFY_AND_ENABLE",
            secret: "CLIENTPROVIDEDSECRET",
            token: "123456",
            currentPassword,
          },
        } as unknown as NextApiRequest,
        resBodySecret
      );
      expect(resBodySecret.statusCode).toBe(400);
      expect(resBodySecret.body.message).toContain("'secret' não é aceito");

      // 3) Requires currentPassword (400 if missing, 401 if wrong)
      const resMissingPassword = createMockApiResponse();
      await handleTwoFactor(
        {
          method: "POST",
          headers: buildAuthenticatedHeaders(),
          body: { action: "VERIFY_AND_ENABLE", token: "123456" },
        } as unknown as NextApiRequest,
        resMissingPassword
      );
      expect(resMissingPassword.statusCode).toBe(400);

      const resWrongPassword = createMockApiResponse();
      await handleTwoFactor(
        {
          method: "POST",
          headers: buildAuthenticatedHeaders(),
          body: {
            action: "VERIFY_AND_ENABLE",
            token: "123456",
            currentPassword: "WrongPassword999!",
          },
        } as unknown as NextApiRequest,
        resWrongPassword
      );
      expect(resWrongPassword.statusCode).toBe(401);

      // 4) Succeeds with encrypted pendingTwoFactorSecret, valid currentPassword, and valid TOTP
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));
      const validTotp = generateTotpCode(pendingSecret, 0);

      mockUserUpdate.mockResolvedValueOnce({ id: "usr-1", tokenVersion: 1 });

      const resSuccess = createMockApiResponse();
      await handleTwoFactor(
        {
          method: "POST",
          headers: buildAuthenticatedHeaders(),
          body: {
            action: "VERIFY_AND_ENABLE",
            token: validTotp,
            currentPassword,
          },
        } as unknown as NextApiRequest,
        resSuccess
      );

      expect(resSuccess.statusCode).toBe(200);
      expect(resSuccess.body).toMatchObject({
        success: true,
        data: { twoFactorEnabled: true },
      });
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: "usr-1" },
        data: {
          twoFactorEnabled: true,
          twoFactorSecret: expect.stringMatching(/^enc:v1:/),
          pendingTwoFactorSecret: null,
          lastTotpCounter: expect.any(Number),
          tokenVersion: { increment: 1 },
        },
      });
    });
  });
});
