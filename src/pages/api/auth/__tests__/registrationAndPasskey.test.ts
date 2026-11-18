import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUserFindUnique,
  mockTransaction,
  mockPasskeyDeleteMany,
  mockPasskeyFindMany,
} = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockTransaction: vi.fn(),
  mockPasskeyDeleteMany: vi.fn(),
  mockPasskeyFindMany: vi.fn(),
}));

vi.mock("../../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
    },
    userPasskey: {
      deleteMany: mockPasskeyDeleteMany,
      findMany: mockPasskeyFindMany,
    },
    $transaction: mockTransaction,
  },
}));

import handleRegister from "../register";
import handlePasskey from "../passkey";
import { AuthenticationTokenService } from "../../../../domain/services/AuthenticationTokenService";
import { SESSION_COOKIE_NAME } from "../../../../infrastructure/auth/sessionHelper";
import { resetRateLimiterState } from "../../../../infrastructure/security/rateLimiter";

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

describe("Registration gate & Passkey 501 (SEC-07)", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalAllowPublicReg = process.env.ALLOW_PUBLIC_REGISTRATION;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiterState();
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;
    delete process.env.ALLOW_PUBLIC_REGISTRATION;
  });

  afterEach(() => {
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
    if (originalAllowPublicReg === undefined) {
      delete process.env.ALLOW_PUBLIC_REGISTRATION;
    } else {
      process.env.ALLOW_PUBLIC_REGISTRATION = originalAllowPublicReg;
    }
  });

  describe("POST /api/auth/register", () => {
    it("returns 403 when ALLOW_PUBLIC_REGISTRATION is missing or 'false'", async () => {
      for (const flagValue of [undefined, "false", "0", ""]) {
        if (flagValue === undefined) {
          delete process.env.ALLOW_PUBLIC_REGISTRATION;
        } else {
          process.env.ALLOW_PUBLIC_REGISTRATION = flagValue;
        }

        const req = {
          method: "POST",
          body: {
            email: "newuser@wattflow.local",
            password: "ValidPassword123!",
            fullName: "New User",
          },
        } as unknown as NextApiRequest;
        const res = createMockApiResponse();

        await handleRegister(req, res);

        expect(res.statusCode).toBe(403);
        expect(res.body.success).toBe(false);
        expect(mockTransaction).not.toHaveBeenCalled();
      }
    });

    it("returns 201 and sets session cookie when ALLOW_PUBLIC_REGISTRATION === 'true'", async () => {
      process.env.ALLOW_PUBLIC_REGISTRATION = "true";
      mockUserFindUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          user: {
            create: vi.fn().mockResolvedValue({
              id: "usr-new-1",
              email: "newuser@wattflow.local",
              fullName: "New User",
              tokenVersion: 0,
            }),
          },
          userConfiguration: {
            create: vi.fn().mockResolvedValue({}),
          },
        };
        return cb(tx);
      });

      const req = {
        method: "POST",
        headers: {},
        body: {
          email: "newuser@wattflow.local",
          password: "ValidPassword123!",
          fullName: "New User",
        },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleRegister(req, res);

      expect(res.statusCode).toBe(201);
      expect(String(res.headers["Set-Cookie"])).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(res.body).toMatchObject({
        success: true,
        user: {
          id: "usr-new-1",
          email: "newuser@wattflow.local",
        },
      });
    });

    it("rejects passwords shorter than 12 characters with 400 when registration is enabled", async () => {
      process.env.ALLOW_PUBLIC_REGISTRATION = "true";

      const req = {
        method: "POST",
        headers: {},
        body: {
          email: "newuser@wattflow.local",
          password: "short11char",
        },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleRegister(req, res);
      expect(res.statusCode).toBe(400);
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  describe("/api/auth/passkey", () => {
    function buildAuthHeaders() {
      const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET);
      const token = tokenService.createSessionToken("usr-pk-1", "pk@wattflow.local", 7, 0);
      let raw = "";
      token.transferToken((t) => {
        raw = t;
      });
      return { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(raw)}` };
    }

    it("returns 501 Not Implemented for CHALLENGE and REGISTER actions", async () => {
      mockUserFindUnique.mockResolvedValue({
        id: "usr-pk-1",
        email: "pk@wattflow.local",
        tokenVersion: 0,
        passkeys: [],
      });

      for (const action of ["CHALLENGE", "REGISTER"]) {
        const req = {
          method: "POST",
          headers: buildAuthHeaders(),
          body: { action, name: "My Key" },
        } as unknown as NextApiRequest;
        const res = createMockApiResponse();

        await handlePasskey(req, res);

        expect(res.statusCode).toBe(501);
        expect(res.headers["Cache-Control"]).toBe("no-store");
        expect(res.body.success).toBe(false);
      }
    });

    it("allows DELETE of existing passkey with 200", async () => {
      mockUserFindUnique.mockResolvedValue({
        id: "usr-pk-1",
        email: "pk@wattflow.local",
        tokenVersion: 0,
        passkeys: [],
      });
      mockPasskeyDeleteMany.mockResolvedValue({ count: 1 });
      mockPasskeyFindMany.mockResolvedValue([]);

      const req = {
        method: "POST",
        headers: buildAuthHeaders(),
        body: { action: "DELETE", passkeyId: "pk-123" },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handlePasskey(req, res);
      expect(res.statusCode).toBe(200);
      expect(mockPasskeyDeleteMany).toHaveBeenCalledWith({
        where: { id: "pk-123", userId: "usr-pk-1" },
      });
    });
  });
});
