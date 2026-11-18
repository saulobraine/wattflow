import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationRepository } from "../ConfigurationRepository";
import { encryptSecret } from "../../security/encryptionHelper";

const VALID_HEX_KEY = "9c3b7e14a8d250f6e1b49c73d8a205f4c6e91b3a7d5f2084b6c19e3d7a5f0821";

describe("ConfigurationRepository.findAllActiveConfigurations", () => {
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_HEX_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  it("isolates per-record decryption/mapping failures and returns all valid configurations", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockFindMany = vi.fn().mockResolvedValue([
      {
        id: "cfg-valid-1",
        userId: "usr-1",
        ecoflowEndpointRegion: "https://api.ecoflow.com",
        ecoflowAccessKey: "ecoflow-ak-1",
        ecoflowAccessSecret: encryptSecret("ecoflow-secret-1"),
        ecoflowSerialNumber: "R601ZAB10001",
        tuyaAccessId: "",
        tuyaAccessSecret: "",
        tuyaDeviceId: "",
        tuyaEndpointRegion: "https://openapi.tuyaus.com",
        telegramBotToken: encryptSecret("tg-token-1"),
        telegramChatId: "111",
        whatsappPhoneNumber: "",
        whatsappApiKey: "",
        isNotificationActive: true,
        isAutomationActive: true,
        turnOnThreshold: 80,
        turnOffThreshold: 20,
      },
      {
        id: "cfg-corrupt-2",
        userId: "usr-2",
        ecoflowEndpointRegion: "https://api.ecoflow.com",
        ecoflowAccessKey: "ecoflow-ak-2",
        ecoflowAccessSecret: "enc:v1:tampered:payload",
        ecoflowSerialNumber: "R601ZAB10002",
        tuyaAccessId: "",
        tuyaAccessSecret: "",
        tuyaDeviceId: "",
        tuyaEndpointRegion: "https://openapi.tuyaus.com",
        telegramBotToken: "",
        telegramChatId: "",
        whatsappPhoneNumber: "",
        whatsappApiKey: "",
        isNotificationActive: true,
        isAutomationActive: true,
        turnOnThreshold: 80,
        turnOffThreshold: 20,
      },
      {
        id: "cfg-valid-legacy-3",
        userId: "usr-3",
        ecoflowEndpointRegion: "https://api-e.ecoflow.com",
        ecoflowAccessKey: "ecoflow-ak-3",
        ecoflowAccessSecret: "legacy-plaintext-secret-3",
        ecoflowSerialNumber: "R601ZAB10003",
        tuyaAccessId: "",
        tuyaAccessSecret: "",
        tuyaDeviceId: "",
        tuyaEndpointRegion: "https://openapi.tuyaus.com",
        telegramBotToken: "",
        telegramChatId: "",
        whatsappPhoneNumber: "",
        whatsappApiKey: "",
        isNotificationActive: false,
        isAutomationActive: true,
        turnOnThreshold: 85,
        turnOffThreshold: 25,
      },
    ]);
    const mockUpdate = vi.fn().mockResolvedValue({});

    const mockPrisma = {
      userConfiguration: {
        findMany: mockFindMany,
        update: mockUpdate,
      },
    } as unknown as PrismaClient;

    const repo = new ConfigurationRepository(mockPrisma);
    const results = await repo.findAllActiveConfigurations();

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.databaseRecordId)).toEqual([
      "cfg-valid-1",
      "cfg-valid-legacy-3",
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("cfg-corrupt-2");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: "cfg-valid-legacy-3" });
  });

  it("fails closed immediately when ENCRYPTION_KEY is missing", async () => {
    delete process.env.ENCRYPTION_KEY;
    const mockFindMany = vi.fn();
    const mockPrisma = {
      userConfiguration: {
        findMany: mockFindMany,
      },
    } as unknown as PrismaClient;

    const repo = new ConfigurationRepository(mockPrisma);
    await expect(repo.findAllActiveConfigurations()).rejects.toThrow(
      /ENCRYPTION_KEY obrigatória/
    );
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
