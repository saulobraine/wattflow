import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFindUnique, mockUserUpdate } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
}));

vi.mock("../../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      update: mockUserUpdate,
    },
  },
}));

import handleLogout from "../logout";
import handleChangePassword from "../change-password";
import handleProfile from "../profile";
import { AuthenticationTokenService } from "../../../../domain/services/AuthenticationTokenService";
import {
  extractUserFromRequest,
  SESSION_COOKIE_NAME,
} from "../../../../infrastructure/auth/sessionHelper";
import { resetRateLimiterState } from "../../../../infrastructure/security/rateLimiter";

const VALID_AUTH_SECRET = "auth-secret-token-with-32-chars!";

async function hashPasswordAsync(raw: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(raw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (e, k) => {
      if (e) reject(e);
      else resolve(k);
    });
  });
  return `${salt}:${derived.toString("hex")}`;
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

function buildSessionCookie(userId: string, email: string, tokenVersion = 0): string {
  const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET);
  const token = tokenService.createSessionToken(userId, email, 7, tokenVersion);
  let raw = "";
  token.transferToken((t) => {
    raw = t;
  });
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(raw)}`;
}

describe("Session revocation via tokenVersion & profile email verification (SEC-09)", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiterState();
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;
  });

  afterEach(() => {
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
  });

  it("extractUserFromRequest rejects tokens whose tokenVersion does not match DB tokenVersion", async () => {
    const cookieV0 = buildSessionCookie("usr-1", "u@wattflow.local", 0);

    mockUserFindUnique.mockResolvedValueOnce({
      id: "usr-1",
      email: "u@wattflow.local",
      tokenVersion: 0,
    });
    const validIdentity = await extractUserFromRequest({
      headers: { cookie: cookieV0 },
    } as unknown as NextApiRequest);
    expect(validIdentity).not.toBeNull();

    // After tokenVersion is bumped in DB to 1, old v0 cookie must be rejected
    mockUserFindUnique.mockResolvedValueOnce({
      id: "usr-1",
      email: "u@wattflow.local",
      tokenVersion: 1,
    });
    const revokedIdentity = await extractUserFromRequest({
      headers: { cookie: cookieV0 },
    } as unknown as NextApiRequest);
    expect(revokedIdentity).toBeNull();
  });

  it("POST /api/auth/logout increments tokenVersion and clears session cookie", async () => {
    const cookieV0 = buildSessionCookie("usr-logout", "logout@wattflow.local", 0);
    mockUserFindUnique.mockResolvedValueOnce({
      id: "usr-logout",
      email: "logout@wattflow.local",
      tokenVersion: 0,
    });
    mockUserUpdate.mockResolvedValueOnce({ id: "usr-logout", tokenVersion: 1 });

    const req = {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        cookie: cookieV0,
      },
    } as unknown as NextApiRequest;
    const res = createMockApiResponse();

    await handleLogout(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "usr-logout" },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(String(res.headers["Set-Cookie"])).toContain("Max-Age=0");
  });

  it("GET /api/auth/logout is blocked with 405 and cross-site POST is blocked with 403 (SEC-10)", async () => {
    const resGet = createMockApiResponse();
    await handleLogout(
      { method: "GET", headers: {} } as unknown as NextApiRequest,
      resGet
    );
    expect(resGet.statusCode).toBe(405);
    expect(resGet.headers.Allow).toEqual(["POST"]);

    const resCsrf = createMockApiResponse();
    await handleLogout(
      {
        method: "POST",
        headers: {
          host: "app.wattflow.local",
          origin: "https://evil.example.com",
          "sec-fetch-site": "cross-site",
        },
      } as unknown as NextApiRequest,
      resCsrf
    );
    expect(resCsrf.statusCode).toBe(403);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("POST /api/auth/change-password increments tokenVersion and rotates session cookie", async () => {
    const oldPassword = "OldPassword123!";
    const oldHash = await hashPasswordAsync(oldPassword);
    const cookieV0 = buildSessionCookie("usr-cp", "cp@wattflow.local", 0);

    // 1st findUnique: extractUserFromRequest; 2nd findUnique: handleChangePassword
    mockUserFindUnique
      .mockResolvedValueOnce({ id: "usr-cp", email: "cp@wattflow.local", tokenVersion: 0 })
      .mockResolvedValueOnce({
        id: "usr-cp",
        email: "cp@wattflow.local",
        passwordHash: oldHash,
        tokenVersion: 0,
      });

    mockUserUpdate.mockResolvedValueOnce({ id: "usr-cp", tokenVersion: 1 });

    const req = {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        cookie: cookieV0,
      },
      body: {
        currentPassword: oldPassword,
        newPassword: "NewStrongPassword123!",
      },
    } as unknown as NextApiRequest;
    const res = createMockApiResponse();

    await handleChangePassword(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "usr-cp" },
      data: {
        passwordHash: expect.any(String),
        tokenVersion: { increment: 1 },
      },
    });
    expect(String(res.headers["Set-Cookie"])).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(String(res.headers["Set-Cookie"])).not.toContain("Max-Age=0");
  });

  it("PATCH /api/auth/profile requires currentPassword to change email, increments tokenVersion, and rotates cookie", async () => {
    const currentPassword = "ProfilePassword123!";
    const passwordHash = await hashPasswordAsync(currentPassword);
    const cookieV0 = buildSessionCookie("usr-prof", "old@wattflow.local", 0);

    // 1) Missing currentPassword -> 400
    mockUserFindUnique
      .mockResolvedValueOnce({ id: "usr-prof", email: "old@wattflow.local", tokenVersion: 0 })
      .mockResolvedValueOnce({
        id: "usr-prof",
        email: "old@wattflow.local",
        passwordHash,
        tokenVersion: 0,
      });

    const resMissingPwd = createMockApiResponse();
    await handleProfile(
      {
        method: "PATCH",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
          cookie: cookieV0,
        },
        body: { email: "new@wattflow.local" },
      } as unknown as NextApiRequest,
      resMissingPwd
    );
    expect(resMissingPwd.statusCode).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();

    // 2) Wrong currentPassword -> 401
    mockUserFindUnique
      .mockResolvedValueOnce({ id: "usr-prof", email: "old@wattflow.local", tokenVersion: 0 })
      .mockResolvedValueOnce({
        id: "usr-prof",
        email: "old@wattflow.local",
        passwordHash,
        tokenVersion: 0,
      });

    const resWrongPwd = createMockApiResponse();
    await handleProfile(
      {
        method: "PATCH",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
          cookie: cookieV0,
        },
        body: { email: "new@wattflow.local", currentPassword: "WrongPassword123!" },
      } as unknown as NextApiRequest,
      resWrongPwd
    );
    expect(resWrongPwd.statusCode).toBe(401);
    expect(mockUserUpdate).not.toHaveBeenCalled();

    // 3) Valid currentPassword -> 200, tokenVersion incremented, new cookie issued
    mockUserFindUnique
      .mockResolvedValueOnce({ id: "usr-prof", email: "old@wattflow.local", tokenVersion: 0 })
      .mockResolvedValueOnce({
        id: "usr-prof",
        email: "old@wattflow.local",
        passwordHash,
        tokenVersion: 0,
      })
      .mockResolvedValueOnce(null); // email uniqueness check

    mockUserUpdate.mockResolvedValueOnce({
      id: "usr-prof",
      email: "new@wattflow.local",
      fullName: "Updated Name",
      twoFactorEnabled: false,
      tokenVersion: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      passkeys: [],
    });

    const resValid = createMockApiResponse();
    await handleProfile(
      {
        method: "PATCH",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
          cookie: cookieV0,
        },
        body: {
          email: "new@wattflow.local",
          fullName: "Updated Name",
          currentPassword,
        },
      } as unknown as NextApiRequest,
      resValid
    );

    expect(resValid.statusCode).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "usr-prof" },
        data: expect.objectContaining({
          email: "new@wattflow.local",
          tokenVersion: { increment: 1 },
        }),
      })
    );
    expect(String(resValid.headers["Set-Cookie"])).toContain(`${SESSION_COOKIE_NAME}=`);
  });
});
