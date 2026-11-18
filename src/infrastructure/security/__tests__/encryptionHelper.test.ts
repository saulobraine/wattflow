import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  decryptSecretIfPresent,
  encryptSecret,
  encryptSecretIfPresent,
  getEncryptionKey,
  isUnchangedOrMaskedSecret,
  maskSecretIrreversible,
} from "../encryptionHelper";

const VALID_HEX_KEY_A = "4f8a2c1e9d7b6a3f0e5c8d1a2b4c6e8f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d";
const VALID_HEX_KEY_B = "9c3e7a1b5d8f2e4c6a0b9d1e3f5a7c8b2d4e6f8a1c3e5b7d9f0a2c4e6b8d0f2a";

describe("encryptionHelper (SEC-01 / SEC-03)", () => {
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_HEX_KEY_A;
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  describe("getEncryptionKey (fail-closed)", () => {
    it("throws when ENCRYPTION_KEY is missing, empty, non-hex, or wrong length", () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => getEncryptionKey()).toThrow(/ENCRYPTION_KEY obrigatória ausente/);

      const invalidKeys = [
        "",
        "   ",
        "a".repeat(63),
        "a".repeat(65),
        "z".repeat(64),
        " ".repeat(64),
        "00".repeat(32),
        "ab".repeat(32),
        "0123456789abcdef".repeat(4),
        "fedcba9876543210".repeat(4),
      ];

      for (const candidate of invalidKeys) {
        process.env.ENCRYPTION_KEY = candidate;
        expect(() => getEncryptionKey()).toThrow(/ENCRYPTION_KEY inválida/);
      }
    });

    it("rejects trivial, repetitive, or example ENCRYPTION_KEY values", () => {
      const trivialKeys = [
        "00".repeat(32),
        "ff".repeat(32),
        "a1b2c3d4".repeat(8),
        "0123456789abcdef".repeat(4),
        "fedcba9876543210".repeat(4),
        "abcdef0123456789".repeat(4),
      ];

      for (const candidate of trivialKeys) {
        process.env.ENCRYPTION_KEY = candidate;
        expect(() => getEncryptionKey()).toThrow(/chave trivial, repetitiva ou de exemplo/);
      }
    });

    it("returns a 32-byte Buffer for a valid 64-char hex ENCRYPTION_KEY", () => {
      const key = getEncryptionKey();
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.byteLength).toBe(32);
    });
  });

  describe("encryptSecret & decryptSecret (AES-256-GCM)", () => {
    it("encrypts with enc:v1: envelope and decrypts back to exact plaintext", () => {
      const plaintext = "ecoflow-super-secret-token-!@#$%^&*()_+-utf8-çãõ";
      const encrypted = encryptSecret(plaintext);

      expect(encrypted.startsWith("enc:v1:")).toBe(true);
      expect(encrypted.split(":")).toHaveLength(5);
      expect(encrypted).not.toContain(plaintext);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("uses unique random IVs per encryption", () => {
      const first = encryptSecret("same-secret");
      const second = encryptSecret("same-secret");
      expect(first).not.toBe(second);
    });

    it("fails closed when decrypting tampered ciphertext, tampered authTag, wrong key, or non-enc:v1: payload", () => {
      const encrypted = encryptSecret("sensitive-api-secret");
      const parts = encrypted.split(":");
      // parts = ["enc", "v1", iv, tag, cipher]

      // Tamper ciphertext
      const cipherBuf = Buffer.from(parts[4], "base64url");
      cipherBuf[0] ^= 0xff;
      const tamperedCipher = `enc:v1:${parts[2]}:${parts[3]}:${cipherBuf.toString("base64url")}`;
      expect(() => decryptSecret(tamperedCipher)).toThrow();

      // Tamper authTag
      const tagBuf = Buffer.from(parts[3], "base64url");
      tagBuf[0] ^= 0xff;
      const tamperedTag = `enc:v1:${parts[2]}:${tagBuf.toString("base64url")}:${parts[4]}`;
      expect(() => decryptSecret(tamperedTag)).toThrow();

      // Wrong key
      process.env.ENCRYPTION_KEY = VALID_HEX_KEY_B;
      expect(() => decryptSecret(encrypted)).toThrow();

      // Plaintext / missing enc:v1: prefix
      process.env.ENCRYPTION_KEY = VALID_HEX_KEY_A;
      expect(() => decryptSecret("plaintext-secret")).toThrow(/Formato de segredo cifrado inválido/);
      expect(() => decryptSecret("enc:v2:abc:def:ghi")).toThrow(/Formato de segredo cifrado inválido/);
      expect(() => decryptSecret("enc:v1:only-two-parts")).toThrow(/Estrutura de payload cifrado inválida/);
    });
  });

  describe("encryptSecretIfPresent & decryptSecretIfPresent", () => {
    it("returns empty string for null/undefined/empty values while still enforcing ENCRYPTION_KEY", () => {
      expect(encryptSecretIfPresent(null)).toBe("");
      expect(encryptSecretIfPresent(undefined)).toBe("");
      expect(encryptSecretIfPresent("   ")).toBe("");
      expect(decryptSecretIfPresent(null)).toBe("");
      expect(decryptSecretIfPresent(undefined)).toBe("");
      expect(decryptSecretIfPresent("")).toBe("");

      delete process.env.ENCRYPTION_KEY;
      expect(() => encryptSecretIfPresent("")).toThrow(/ENCRYPTION_KEY obrigatória/);
      expect(() => decryptSecretIfPresent("")).toThrow(/ENCRYPTION_KEY obrigatória/);
    });

    it("rejects non-empty stored values without enc:v1: prefix", () => {
      expect(() => decryptSecretIfPresent("legacy-plaintext-secret")).toThrow(
        /Formato de segredo cifrado inválido/
      );
    });

    it("round-trips non-empty secrets", () => {
      const cipher = encryptSecretIfPresent("  my-secret-value  ");
      expect(cipher.startsWith("enc:v1:")).toBe(true);
      expect(decryptSecretIfPresent(cipher)).toBe("my-secret-value");
    });
  });

  describe("maskSecretIrreversible & isUnchangedOrMaskedSecret", () => {
    it("masks secrets irreversibly without exposing length for short secrets", () => {
      expect(maskSecretIrreversible(null)).toBe("");
      expect(maskSecretIrreversible("")).toBe("");
      expect(maskSecretIrreversible("short")).toBe("••••••••");
      expect(maskSecretIrreversible("1234567")).toBe("••••••••");
      expect(maskSecretIrreversible("12345678")).toBe("••••••••5678");
      expect(maskSecretIrreversible("very-long-api-secret-9999")).toBe("••••••••9999");
    });

    it("detects empty or masked UI inputs", () => {
      expect(isUnchangedOrMaskedSecret(undefined)).toBe(true);
      expect(isUnchangedOrMaskedSecret("")).toBe(true);
      expect(isUnchangedOrMaskedSecret("   ")).toBe(true);
      expect(isUnchangedOrMaskedSecret("••••••••")).toBe(true);
      expect(isUnchangedOrMaskedSecret("••••••••5678")).toBe(true);
      expect(isUnchangedOrMaskedSecret("new-real-secret")).toBe(false);
    });

    it("works with a freshly generated random 32-byte hex key", () => {
      process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
      const encrypted = encryptSecret("random-key-test");
      expect(decryptSecret(encrypted)).toBe("random-key-test");
    });
  });
});
