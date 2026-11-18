import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationTokenService } from "../../../domain/services/AuthenticationTokenService";
import { UserSessionToken } from "../../../domain/values/UserSessionToken";
import {
  clearSessionCookie,
  extractUserFromRequest,
  getAuthenticationTokenService,
  SESSION_COOKIE_NAME,
  setSessionCookie,
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

    it("extractUserFromRequest returns null without session cookie and fails closed if AUTH_SECRET is invalid when cookie is present", () => {
      delete process.env.AUTH_SECRET;
      const reqWithoutCookie = { headers: {} } as NextApiRequest;
      expect(extractUserFromRequest(reqWithoutCookie)).toBeNull();

      const reqWithCookie = {
        headers: { cookie: `${SESSION_COOKIE_NAME}=some.token` },
      } as NextApiRequest;
      expect(() => extractUserFromRequest(reqWithCookie)).toThrow(/AUTH_SECRET obrigatória/);
    });

    it("extractUserFromRequest extracts authenticated user from valid cookie", () => {
      process.env.AUTH_SECRET = VALID_SECRET_64;
      const service = getAuthenticationTokenService();
      const token = service.createSessionToken("usr-42", "admin@wattflow.local");
      let rawToken = "";
      token.transferToken((t) => {
        rawToken = t;
      });

      const req = {
        headers: {
          cookie: `other=1; ${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
        },
      } as NextApiRequest;

      const user = extractUserFromRequest(req);
      expect(user).not.toBeNull();
      let extractedId = "";
      user?.provideIdentity((id) => {
        extractedId = id;
      });
      expect(extractedId).toBe("usr-42");
    });

    it("sets and clears session cookies with HttpOnly, SameSite=Lax, and Secure in production", () => {
      process.env.AUTH_SECRET = VALID_SECRET_32;
      vi.stubEnv("NODE_ENV", "production");

      const service = getAuthenticationTokenService();
      const token = service.createSessionToken("usr-1", "a@b.com");
      const res = createMockResponse();

      setSessionCookie(res, token);
      expect(res.headers["Set-Cookie"]).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(res.headers["Set-Cookie"]).toContain("HttpOnly");
      expect(res.headers["Set-Cookie"]).toContain("SameSite=Lax");
      expect(res.headers["Set-Cookie"]).toContain("Secure");

      clearSessionCookie(res);
      expect(res.headers["Set-Cookie"]).toContain(`${SESSION_COOKIE_NAME}=;`);
      expect(res.headers["Set-Cookie"]).toContain("Max-Age=0");
      expect(res.headers["Set-Cookie"]).toContain("Secure");
    });
  });
});
