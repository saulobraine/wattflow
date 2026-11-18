import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationTokenService,
  DEFAULT_SESSION_VALIDITY_DAYS,
} from "../../../domain/services/AuthenticationTokenService";
import { UserSessionToken } from "../../../domain/values/UserSessionToken";
import {
  clearSessionCookie,
  enforceCsrfProtection,
  extractSessionWithMetaFromRequest,
  extractUserFromRequest,
  getAuthenticationTokenService,
  PERSISTENT_SESSION_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  SHORT_SESSION_MAX_AGE_SECONDS,
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

    it("defaults session validity to 30 days (DEFAULT_SESSION_VALIDITY_DAYS=30) and returns identity + expiresAt via inspectSessionToken", () => {
      expect(DEFAULT_SESSION_VALIDITY_DAYS).toBe(30);

      vi.useFakeTimers();
      const baseTimeMs = new Date("2026-11-18T00:00:00Z").getTime();
      vi.setSystemTime(baseTimeMs);

      const service = new AuthenticationTokenService(VALID_SECRET_32);
      const token = service.createSessionToken("user-30d", "pwa@wattflow.local");
      const inspected = service.inspectSessionToken(token);

      expect(inspected).not.toBeNull();
      expect(inspected?.expiresAt).toBe(baseTimeMs + 30 * 24 * 60 * 60 * 1000);

      let capturedId = "";
      let capturedEmail = "";
      let capturedVersion = -1;
      inspected?.identity.provideIdentity((id, email, version) => {
        capturedId = id;
        capturedEmail = email;
        capturedVersion = version;
      });
      expect(capturedId).toBe("user-30d");
      expect(capturedEmail).toBe("pwa@wattflow.local");
      expect(capturedVersion).toBe(0);

      expect(service.inspectSessionToken(token, 0)).not.toBeNull();
      expect(service.inspectSessionToken(token, 1)).toBeNull();

      const challenge = service.createTwoFactorChallengeToken("user-30d", "pwa@wattflow.local");
      expect(service.inspectSessionToken(new UserSessionToken(challenge))).toBeNull();
    });

    it("enforces Object Calisthenics rules in AuthenticationTokenService.ts (no else, 1 instance var, max 1 dot per line)", () => {
      const sourcePath = path.resolve(
        process.cwd(),
        "src/domain/services/AuthenticationTokenService.ts"
      );
      const source = readFileSync(sourcePath, "utf8");

      const strippedCommentsAndStrings = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/(["'`])(?:\\.|(?!\1)[^\\\r\n])*\1/g, '""');

      expect(strippedCommentsAndStrings).not.toMatch(/\belse\b/);

      const privateFields = strippedCommentsAndStrings.match(
        /^\s*private\s+(readonly\s+)?\w+\s*:/gm
      );
      expect(privateFields).toHaveLength(1);

      const codeLines = strippedCommentsAndStrings
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("import "));

      for (const line of codeLines) {
        expect(line).not.toMatch(/\b\w+\.\w+\.\w+/);
      }
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

      // extractSessionWithMetaFromRequest returns identity, expiresAt, and tokenVersion
      mockFindUnique.mockResolvedValueOnce({
        id: "usr-42",
        email: "admin@wattflow.local",
        tokenVersion: 2,
      });
      const meta = await extractSessionWithMetaFromRequest(req, mockDb);
      expect(meta).not.toBeNull();
      expect(meta?.tokenVersion).toBe(2);
      expect(typeof meta?.expiresAt).toBe("number");
    });

    it("sets and clears session cookies with HttpOnly, SameSite=Lax, Max-Age, explicit Expires, and Secure in production", () => {
      process.env.AUTH_SECRET = VALID_SECRET_32;
      vi.stubEnv("NODE_ENV", "production");
      vi.useFakeTimers();
      const baseTimeMs = new Date("2026-11-18T12:00:00Z").getTime();
      vi.setSystemTime(baseTimeMs);

      const service = getAuthenticationTokenService();
      const token = service.createSessionToken("usr-1", "a@b.com");
      const res = createMockResponse();

      expect(PERSISTENT_SESSION_MAX_AGE_SECONDS).toBe(2592000);
      expect(SHORT_SESSION_MAX_AGE_SECONDS).toBe(86400);

      setSessionCookie(res, token);
      const expected30dExpires = new Date(baseTimeMs + 2592000 * 1000).toUTCString();
      expect(res.headers["Set-Cookie"]).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(res.headers["Set-Cookie"]).toContain("HttpOnly");
      expect(res.headers["Set-Cookie"]).toContain("SameSite=Lax");
      expect(res.headers["Set-Cookie"]).toContain("Max-Age=2592000");
      expect(res.headers["Set-Cookie"]).toContain(`Expires=${expected30dExpires}`);
      expect(res.headers["Set-Cookie"]).toContain("Secure");

      setSessionCookie(res, token, SHORT_SESSION_MAX_AGE_SECONDS);
      const expected1dExpires = new Date(baseTimeMs + 86400 * 1000).toUTCString();
      expect(res.headers["Set-Cookie"]).toContain("SameSite=Lax");
      expect(res.headers["Set-Cookie"]).toContain("Max-Age=86400");
      expect(res.headers["Set-Cookie"]).toContain(`Expires=${expected1dExpires}`);

      clearSessionCookie(res);
      expect(res.headers["Set-Cookie"]).toContain(`${SESSION_COOKIE_NAME}=;`);
      expect(res.headers["Set-Cookie"]).toContain("SameSite=Lax");
      expect(res.headers["Set-Cookie"]).toContain("Max-Age=0");
      expect(res.headers["Set-Cookie"]).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
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
