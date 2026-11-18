import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "../encryptionHelper";
import {
  decryptAndMigrateConfigurationSecrets,
  decryptAndMigrateUserTotpSecret,
  resolveStoredSecretWithMigration,
} from "../secretMigrationHelper";

const VALID_HEX_KEY = "4f8e2a19c7b305d61a9e4c82b7f03d65e8a19c4b2d7f06e3a5c8194b7d2e0f61";

describe("secretMigrationHelper (lazy migration & fail-closed)", () => {
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_HEX_KEY;
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  describe("resolveStoredSecretWithMigration", () => {
    it("returns empty plaintext and null migration for null, undefined, or empty string", () => {
      expect(resolveStoredSecretWithMigration(null)).toEqual({
        plaintext: "",
        migratedCiphertext: null,
      });
      expect(resolveStoredSecretWithMigration(undefined)).toEqual({
        plaintext: "",
        migratedCiphertext: null,
      });
      expect(resolveStoredSecretWithMigration("")).toEqual({
        plaintext: "",
        migratedCiphertext: null,
      });
    });

    it("migrates legacy plaintext values to enc:v1: ciphertext", () => {
      const resolution = resolveStoredSecretWithMigration("  legacy-ecoflow-secret  ");

      expect(resolution.plaintext).toBe("legacy-ecoflow-secret");
      expect(resolution.migratedCiphertext).not.toBeNull();
      expect(resolution.migratedCiphertext?.startsWith("enc:v1:")).toBe(true);
      expect(decryptSecret(resolution.migratedCiphertext as string)).toBe(
        "legacy-ecoflow-secret"
      );
    });

    it("returns decrypted plaintext with null migration when already enc:v1:", () => {
      const cipher = encryptSecret("already-encrypted-secret");
      const resolution = resolveStoredSecretWithMigration(cipher);

      expect(resolution).toEqual({
        plaintext: "already-encrypted-secret",
        migratedCiphertext: null,
      });
    });

    it("fails closed on tampered, malformed, or unsupported enc: payloads", () => {
      const validCipher = encryptSecret("sensitive");
      const parts = validCipher.split(":");
      const cipherBuf = Buffer.from(parts[4], "base64url");
      cipherBuf[0] ^= 0xff;
      const tamperedCipher = `enc:v1:${parts[2]}:${parts[3]}:${cipherBuf.toString("base64url")}`;

      expect(() => resolveStoredSecretWithMigration(tamperedCipher)).toThrow();
      expect(() => resolveStoredSecretWithMigration("enc:v1:invalid")).toThrow(
        /Estrutura de payload cifrado inválida/
      );
      expect(() => resolveStoredSecretWithMigration("enc:v2:abc:def:ghi")).toThrow(
        /Formato de segredo cifrado inválido/
      );
    });

    it("fails closed when ENCRYPTION_KEY is missing", () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => resolveStoredSecretWithMigration("legacy-value")).toThrow(
        /ENCRYPTION_KEY obrigatória/
      );
    });
  });

  describe("decryptAndMigrateConfigurationSecrets", () => {
    it("persists lazy migration only for legacy fields and leaves enc:v1: fields untouched", async () => {
      const mockUpdate = vi.fn().mockResolvedValue({});
      const mockPrisma = {
        userConfiguration: {
          update: mockUpdate,
        },
      } as unknown as PrismaClient;

      const encryptedTuya = encryptSecret("tuya-already-encrypted");

      const result = await decryptAndMigrateConfigurationSecrets(mockPrisma, {
        id: "cfg-1",
        ecoflowAccessSecret: "legacy-ecoflow-secret",
        tuyaAccessSecret: encryptedTuya,
        telegramBotToken: "legacy-telegram-token",
        whatsappApiKey: "",
      });

      expect(result).toEqual({
        ecoflowAccessSecret: "legacy-ecoflow-secret",
        tuyaAccessSecret: "tuya-already-encrypted",
        telegramBotToken: "legacy-telegram-token",
        whatsappApiKey: "",
      });

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const updateArg = mockUpdate.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: "cfg-1" });
      expect(Object.keys(updateArg.data).sort()).toEqual([
        "ecoflowAccessSecret",
        "telegramBotToken",
      ]);
      expect(decryptSecret(updateArg.data.ecoflowAccessSecret)).toBe("legacy-ecoflow-secret");
      expect(decryptSecret(updateArg.data.telegramBotToken)).toBe("legacy-telegram-token");
    });

    it("does not call update when all secrets are already encrypted or empty", async () => {
      const mockUpdate = vi.fn();
      const mockPrisma = {
        userConfiguration: {
          update: mockUpdate,
        },
      } as unknown as PrismaClient;

      const result = await decryptAndMigrateConfigurationSecrets(mockPrisma, {
        id: "cfg-2",
        ecoflowAccessSecret: encryptSecret("ecoflow-ok"),
        tuyaAccessSecret: null,
        telegramBotToken: "",
        whatsappApiKey: encryptSecret("wa-ok"),
      });

      expect(result).toEqual({
        ecoflowAccessSecret: "ecoflow-ok",
        tuyaAccessSecret: "",
        telegramBotToken: "",
        whatsappApiKey: "wa-ok",
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("fails closed without updating DB if any enc: payload is tampered", async () => {
      const mockUpdate = vi.fn();
      const mockPrisma = {
        userConfiguration: {
          update: mockUpdate,
        },
      } as unknown as PrismaClient;

      await expect(
        decryptAndMigrateConfigurationSecrets(mockPrisma, {
          id: "cfg-corrupt",
          ecoflowAccessSecret: "legacy-ok",
          tuyaAccessSecret: "enc:v1:corrupted-payload",
        })
      ).rejects.toThrow();

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("decryptAndMigrateUserTotpSecret", () => {
    it("lazy-migrates legacy TOTP secret and fails closed on tampered enc: payload", async () => {
      const mockUpdate = vi.fn().mockResolvedValue({});
      const mockPrisma = {
        user: {
          update: mockUpdate,
        },
      } as unknown as PrismaClient;

      const plain = await decryptAndMigrateUserTotpSecret(
        mockPrisma,
        "usr-1",
        "twoFactorSecret",
        "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
      );

      expect(plain).toBe("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "usr-1" },
        data: {
          twoFactorSecret: expect.stringMatching(/^enc:v1:/),
        },
      });

      await expect(
        decryptAndMigrateUserTotpSecret(
          mockPrisma,
          "usr-1",
          "twoFactorSecret",
          "enc:v1:tampered"
        )
      ).rejects.toThrow();
    });
  });
});
