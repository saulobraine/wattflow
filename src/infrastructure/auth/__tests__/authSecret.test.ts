import { createHmac } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationTokenService } from "../../../domain/services/AuthenticationTokenService";
import { UserSessionToken } from "../../../domain/values/UserSessionToken";
import {
  clearSessionCookie,
  enforceCsrfProtection,
  extractUserFromRequest,
  getAuthenticationTokenService,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  validateCsrfOrigin,
} from "../sessionHelper";

const VALID_SECRET_32 = "a".repeat(32);
const VALID_SECRET_64 = "b".repeat(64);

function createMockResponse() {
  const headers: Record<string, string | string[]> = {};
  return {
    headers,
    setHeader: vi.fn((name: string, value: string | string[]) => {
      headers[name] = value;
    }),
  } as unknown as NextApiResponse & { headers: Record<string, string | string[]> };
}

describe("AuthenticationTokenService & sessionHelper (AUTH_SECRET >= 32 chars)", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
    vi.useRealTimers();
  });

  describe("AuthenticationTokenService", () => {
    it("rejects secrets shorter than 32 characters or whitespace-only", () => {
      expect(() => new AuthenticationTokenService("")).toThrow(/mínimo 32 caracteres/);
      expect(() => new AuthenticationTokenService("a".repeat(31))).toThrow(/mínimo 32 caracteres/);
      expect(() => new AuthenticationTokenService(" ".repeat(32))).toThrow(/mínimo 32 caracteres/);
    });

    it("accepts secrets with 32 or more characters and verifies valid tokens", () => {
      const service = new AuthenticationTokenService(VALID_SECRET_32);
      const token = service.createSessionToken("user-123", "User@Example.COM");
      const identity = service.verifySessionToken(token);

      expect(identity).not.toBeNull();
      let capturedId = "";
      let capturedEmail = "";
      identity?.provideIdentity((id, email) => {
        capturedId = id;
        capturedEmail = email;
      });
      expect(capturedId).toBe("user-123");
      expect(capturedEmail).toBe("user@example.com");
    });

    it("rejects tampered, wrong-secret, malformed, and expired tokens", () => {
      const serviceA = new AuthenticationTokenService(VALID_SECRET_32);
      const serviceB = new AuthenticationTokenService(VALID_SECRET_64);
      const token = serviceA.createSessionToken("user-1", "test@wattflow.local");

      let rawToken = "";
      token.transferToken((raw) => {
        rawToken = raw;
      });

      expect(serviceB.verifySessionToken(token)).toBeNull();
      expect(serviceA.verifySessionToken(new UserSessionToken("invalid-no-dot"))).toBeNull();
      expect(serviceA.verifySessionToken(new UserSessionToken("a.b.c"))).toBeNull();

      const [payloadPart, signaturePart] = rawToken.split(".");
      const tamperedSig =
        (signaturePart[0] === "A" ? "B" : "A") + signaturePart.slice(1);
      expect(
        serviceA.verifySessionToken(new UserSessionToken(`${payloadPart}.${tamperedSig}`))
      ).toBeNull();

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const shortLived = serviceA.createSessionToken("user-1", "test@wattflow.local", 1);
      vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
      expect(serviceA.verifySessionToken(shortLived)).toBeNull();
    });
  });

  describe("sessionHelper", () => {
    it("throws when AUTH_SECRET is missing, empty, or shorter than 32 trimmed chars", () => {
      delete process.env.AUTH_SECRET;
      expect(() => getAuthenticationTokenService()).toThrow(/AUTH_SECRET obrigatória/);

      process.env.AUTH_SECRET = "";
      expect(() => getAuthenticationTokenService()).toThrow(/AUTH_SECRET obrigatória/);

      process.env.AUTH_SECRET = "   ".repeat(15);
      expect(() => getAuthenticationTokenService()).toThrow(/AUTH_SECRET obrigatória/);

      process.env.AUTH_SECRET = "x".repeat(31);
      expect(() => getAuthenticationTokenService()).toThrow(/AUTH_SECRET obrigatória/);

      process.env.AUTH_SECRET = "  " + "x".repeat(30);
      expect(() => getAuthenticationTokenService()).toThrow(/AUTH_SECRET obrigatória/);
    });

    it("returns service when AUTH_SECRET has at least 32 characters", () => {
      process.env.AUTH_SECRET = VALID_SECRET_32;
      const service = getAuthenticationTokenService();
      expect(service).toBeInstanceOf(AuthenticationTokenService);
    });

    it("extractUserFromRequest returns null without session cookie and fails closed if AUTH_SECRET is invalid when cookie is present", async () => {
      delete process.env.AUTH_SECRET;
      const mockDb = {
        user: {
          findUnique: vi.fn(),
        },
      } as unknown as Parameters<typeof extractUserFromRequest>[1];

      const reqWithoutCookie = { headers: {} } as NextApiRequest;
      await expect(extractUserFromRequest(reqWithoutCookie, mockDb)).resolves.toBeNull();

      const reqWithCookie = {
        headers: { cookie: `${SESSION_COOKIE_NAME}=some.token` },
      } as NextApiRequest;
      await expect(extractUserFromRequest(reqWithCookie, mockDb)).rejects.toThrow(
        /AUTH_SECRET obrigatória/
      );
    });

    it("extractUserFromRequest extracts authenticated user from valid cookie and validates tokenVersion", async () => {
      process.env.AUTH_SECRET = VALID_SECRET_64;
      const service = getAuthenticationTokenService();
      const token = service.createSessionToken("usr-42", "admin@wattflow.local", 7, 2);
      let rawToken = "";
      token.transferToken((t) => {
        rawToken = t;
      });

      const mockFindUnique = vi.fn().mockResolvedValueOnce({
        id: "usr-42",
        email: "admin@wattflow.local",
        tokenVersion: 2,
      });
      const mockDb = {
        user: { findUnique: mockFindUnique },
      } as unknown as Parameters<typeof extractUserFromRequest>[1];

      const req = {
        headers: {
          cookie: `other=1; ${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
        },
      } as NextApiRequest;

      const user = await extractUserFromRequest(req, mockDb);
      expect(user).not.toBeNull();
      let extractedId = "";
      user?.provideIdentity((id) => {
        extractedId = id;
      });
      expect(extractedId).toBe("usr-42");

      // Revoked when DB tokenVersion increments
      mockFindUnique.mockResolvedValueOnce({
        id: "usr-42",
        email: "admin@wattflow.local",
        tokenVersion: 3,
      });
      await expect(extractUserFromRequest(req, mockDb)).resolves.toBeNull();
    });

    it("sets and clears session cookies with HttpOnly, SameSite=Strict, and Secure in production", () => {
      process.env.AUTH_SECRET = VALID_SECRET_32;
      vi.stubEnv("NODE_ENV", "production");

      const service = getAuthenticationTokenService();
      const token = service.createSessionToken("usr-1", "a@b.com");
      const res = createMockResponse();

      setSessionCookie(res, token);
      expect(res.headers["Set-Cookie"]).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(res.headers["Set-Cookie"]).toContain("HttpOnly");
      expect(res.headers["Set-Cookie"]).toContain("SameSite=Strict");
      expect(res.headers["Set-Cookie"]).toContain("Secure");

      clearSessionCookie(res);
      expect(res.headers["Set-Cookie"]).toContain(`${SESSION_COOKIE_NAME}=;`);
      expect(res.headers["Set-Cookie"]).toContain("SameSite=Strict");
      expect(res.headers["Set-Cookie"]).toContain("Max-Age=0");
      expect(res.headers["Set-Cookie"]).toContain("Secure");
    });

    it("returns null safely on malformed percent-encoding in cookie or invalid JSON in token payload (SEC-11)", async () => {
      process.env.AUTH_SECRET = VALID_SECRET_32;

      const badPercentReq = {
        headers: { cookie: `${SESSION_COOKIE_NAME}=%E0%A4%A` },
      } as unknown as NextApiRequest;
      await expect(extractUserFromRequest(badPercentReq)).resolves.toBeNull();

      const invalidJsonB64 = Buffer.from("{not-valid-json", "utf8").toString("base64url");
      const validSig = createHmac("sha256", VALID_SECRET_32)
        .update(invalidJsonB64, "utf8")
        .digest("base64url");
      const service = new AuthenticationTokenService(VALID_SECRET_32);
      expect(service.verifySessionToken(new UserSessionToken(`${invalidJsonB64}.${validSig}`))).toBeNull();
    });

    it("validateCsrfOrigin & enforceCsrfProtection block cross-site/missing-origin POSTs with 403 and allow same-origin (SEC-10)", () => {
      expect(validateCsrfOrigin({ method: "GET", headers: {} } as unknown as NextApiRequest)).toBe(true);

      expect(
        validateCsrfOrigin({
          method: "POST",
          headers: { host: "app.wattflow.local", origin: "https://app.wattflow.local", "sec-fetch-site": "same-origin" },
        } as unknown as NextApiRequest)
      ).toBe(true);

      expect(
        validateCsrfOrigin({
          method: "POST",
          headers: { host: "app.wattflow.local", referer: "https://app.wattflow.local/settings" },
        } as unknown as NextApiRequest)
      ).toBe(true);

      const crossSiteRes = {
        statusCode: 200,
        body: undefined as unknown,
        status: vi.fn(function (this: { statusCode: number }, code: number) {
          this.statusCode = code;
          return this;
        }),
        json: vi.fn(function (this: { body: unknown }, payload: unknown) {
          this.body = payload;
          return this;
        }),
      } as unknown as NextApiResponse & { statusCode: number; body: unknown };

      const allowed = enforceCsrfProtection(
        {
          method: "POST",
          headers: {
            host: "app.wattflow.local",
            origin: "https://evil.example.com",
            "sec-fetch-site": "cross-site",
          },
        } as unknown as NextApiRequest,
        crossSiteRes
      );

      expect(allowed).toBe(false);
      expect(crossSiteRes.statusCode).toBe(403);
    });
  });
});
