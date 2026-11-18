import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOtpAuthUrl,
  decodeBase32,
  generateBase32Secret,
  generateTotpCode,
  verifyTotpCode,
} from "../totpHelper";

describe("totpHelper (SEC-01 / SEC-03)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("generateBase32Secret", () => {
    it("rejects byteLength smaller than 16 or non-integer", () => {
      expect(() => generateBase32Secret(15)).toThrow(/mínimo 16 bytes/);
      expect(() => generateBase32Secret(0)).toThrow(/mínimo 16 bytes/);
      expect(() => generateBase32Secret(16.5)).toThrow(/mínimo 16 bytes/);
    });

    it("generates a valid Base32 secret with at least 16 decoded bytes", () => {
      const secret = generateBase32Secret(20);
      expect(secret).toMatch(/^[A-Z2-7]+$/);
      expect(decodeBase32(secret).byteLength).toBe(20);
    });
  });

  describe("decodeBase32", () => {
    it("rejects invalid Base32 characters, empty strings, and non-strings", () => {
      expect(() => decodeBase32(123 as unknown as string)).toThrow(/formato string Base32/);
      expect(() => decodeBase32("")).toThrow(/ausente ou excede/);
      expect(() => decodeBase32("   ")).toThrow(/ausente ou excede/);
      expect(() => decodeBase32("A".repeat(257))).toThrow(/ausente ou excede/);
      expect(() => decodeBase32("JBSWY3DPEBLW64TMMQ0189!")).toThrow(/caracteres Base32 inválidos/);
    });

    it("rejects valid Base32 strings that decode to fewer than 16 bytes", () => {
      // 24 Base32 chars = 120 bits = 15 bytes (< 16 bytes)
      const fifteenByteSecret = "A".repeat(24);
      expect(() => decodeBase32(fifteenByteSecret)).toThrow(/mínimo de 16 bytes decodificados/);

      // 26 Base32 chars = 130 bits = 16 bytes (>= 16 bytes)
      const sixteenByteSecret = "A".repeat(26);
      expect(decodeBase32(sixteenByteSecret).byteLength).toBe(16);
    });
  });

  describe("generateTotpCode & verifyTotpCode", () => {
    it("generates 6-digit TOTP codes and verifies within ±1 step window", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));

      const secret = generateBase32Secret(20);
      const currentCode = generateTotpCode(secret, 0);
      const previousCode = generateTotpCode(secret, -1);
      const nextCode = generateTotpCode(secret, 1);
      const expiredCode = generateTotpCode(secret, -2);
      const futureCode = generateTotpCode(secret, 2);

      expect(currentCode).toMatch(/^\d{6}$/);
      expect(verifyTotpCode(secret, currentCode)).toBe(true);
      expect(verifyTotpCode(secret, previousCode)).toBe(true);
      expect(verifyTotpCode(secret, nextCode)).toBe(true);

      expect(verifyTotpCode(secret, expiredCode)).toBe(false);
      expect(verifyTotpCode(secret, futureCode)).toBe(false);
      expect(verifyTotpCode(secret, "12345")).toBe(false);
      expect(verifyTotpCode(secret, "abcdef")).toBe(false);
    });

    it("fails closed when verifying against an invalid or weak secret", () => {
      expect(() => verifyTotpCode("INVALID!SECRET", "123456")).toThrow(/caracteres Base32 inválidos/);
      expect(() => verifyTotpCode("A".repeat(24), "123456")).toThrow(/mínimo de 16 bytes/);
    });
  });

  describe("buildOtpAuthUrl", () => {
    it("builds a valid otpauth URL and rejects weak secrets", () => {
      const secret = generateBase32Secret(20);
      const url = buildOtpAuthUrl("user@wattflow.local", secret);
      expect(url).toBe(
        `otpauth://totp/WattFlow:user%40wattflow.local?secret=${secret}&issuer=WattFlow&algorithm=SHA1&digits=6&period=30`
      );
      expect(() => buildOtpAuthUrl("user@wattflow.local", "A".repeat(24))).toThrow(
        /mínimo de 16 bytes/
      );
    });
  });
});
