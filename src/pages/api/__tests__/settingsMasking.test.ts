import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpsert, mockStopStream } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockStopStream: vi.fn(),
}));

vi.mock("../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "usr-settings-1",
        email: "settings@wattflow.local",
        tokenVersion: 0,
      }),
    },
    userConfiguration: {
      findUnique: mockFindUnique,
      update: vi.fn(),
      upsert: mockUpsert,
    },
  },
}));

vi.mock("../../../infrastructure/services/EcoFlowMqttStreamService", () => ({
  EcoFlowMqttStreamService: {
    getInstance: vi.fn(() => ({
      stopStream: mockStopStream,
    })),
  },
}));

import handleSettings from "../settings";
import { AuthenticationTokenService } from "../../../domain/services/AuthenticationTokenService";
import { SESSION_COOKIE_NAME } from "../../../infrastructure/auth/sessionHelper";
import { encryptSecret } from "../../../infrastructure/security/encryptionHelper";

const VALID_AUTH_SECRET = "auth-secret-token-with-32-chars!";
const VALID_ENCRYPTION_KEY = "4f8a2c1e9d7b6a3f0e5c8d1a2b4c6e8f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d";

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

function buildAuthCookieHeader(userId = "usr-settings-1"): string {
  const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET);
  const sessionToken = tokenService.createSessionToken(userId, "settings@wattflow.local");
  let rawToken = "";
  sessionToken.transferToken((t) => {
    rawToken = t;
  });
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`;
}

describe("GET /api/settings masking & Cache-Control (SEC-01 / SEC-03)", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;
    process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;
  });

  afterEach(() => {
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

  it("sets Cache-Control: no-store and masks all secrets without leaking plaintext or ciphertext", async () => {
    const plainEcoflowSecret = "ECOFLOW_PLAIN_SECRET_ABCD";
    const plainTuyaSecret = "TUYA_PLAIN_SECRET_WXYZ";
    const plainTelegramToken = "123456:TELEGRAM_BOT_TOKEN_9876";
    const plainWhatsappKey = "WHATSAPP_CALLMEBOT_KEY_4321";

    mockFindUnique.mockResolvedValue({
      userId: "usr-settings-1",
      ecoflowEndpointRegion: "https://api.ecoflow.com",
      ecoflowAccessKey: "ecoflow-ak-public",
      ecoflowAccessSecret: encryptSecret(plainEcoflowSecret),
      ecoflowSerialNumber: "R601ZAB12345",
      tuyaAccessId: "tuya-id-public",
      tuyaAccessSecret: encryptSecret(plainTuyaSecret),
      tuyaDeviceId: "tuya-dev-1",
      tuyaEndpointRegion: "https://openapi.tuyaus.com",
      telegramBotToken: encryptSecret(plainTelegramToken),
      telegramChatId: "99887766",
      whatsappPhoneNumber: "+5511999999999",
      whatsappApiKey: encryptSecret(plainWhatsappKey),
      isNotificationActive: true,
    });

    const req = {
      method: "GET",
      headers: { cookie: buildAuthCookieHeader("usr-settings-1") },
    } as unknown as NextApiRequest;
    const res = createMockApiResponse();

    await handleSettings(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(plainEcoflowSecret);
    expect(serialized).not.toContain(plainTuyaSecret);
    expect(serialized).not.toContain(plainTelegramToken);
    expect(serialized).not.toContain(plainWhatsappKey);
    expect(serialized).not.toContain("enc:v1:");

    expect(res.body).toMatchObject({
      success: true,
      data: {
        ecoflowAccessKey: "ecoflow-ak-public",
        hasEcoflowAccessSecret: true,
        ecoflowAccessSecretMasked: "••••••••ABCD",
        hasTuyaAccessSecret: true,
        tuyaAccessSecretMasked: "••••••••WXYZ",
        hasTelegramBotToken: true,
        telegramBotTokenMasked: "••••••••9876",
        hasWhatsappApiKey: true,
        whatsappApiKeyMasked: "••••••••4321",
      },
    });
  });

  it("fails closed with 500 when ENCRYPTION_KEY is missing during GET /api/settings", async () => {
    delete process.env.ENCRYPTION_KEY;
    mockFindUnique.mockResolvedValue({
      userId: "usr-settings-1",
      ecoflowEndpointRegion: "https://api.ecoflow.com",
      ecoflowAccessKey: "ak",
      ecoflowAccessSecret: "",
      ecoflowSerialNumber: "SN1",
    });

    const req = {
      method: "GET",
      headers: { cookie: buildAuthCookieHeader("usr-settings-1") },
    } as unknown as NextApiRequest;
    const res = createMockApiResponse();

    await handleSettings(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.body).toMatchObject({
      success: false,
      message: expect.stringContaining("ENCRYPTION_KEY"),
    });
  });

  it("POST /api/settings calls stopStream(userId) after persisting updated credentials", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockUpsert.mockResolvedValueOnce({ userId: "usr-settings-1" });

    const req = {
      method: "POST",
      headers: {
        cookie: buildAuthCookieHeader("usr-settings-1"),
        host: "wattflow.local",
        origin: "https://wattflow.local",
        "sec-fetch-site": "same-origin",
      },
      body: {
        ecoflowEndpointRegion: "https://api.ecoflow.com",
        ecoflowAccessKey: "new-ak-1234",
        ecoflowAccessSecret: "new-as-1234",
        ecoflowSerialNumber: "R601ZAB12345",
      },
    } as unknown as NextApiRequest;
    const res = createMockApiResponse();

    await handleSettings(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockStopStream).toHaveBeenCalledWith("usr-settings-1");
  });

  it("sanitizes HTTP 500 internal DB errors in GET and POST /api/settings without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFindUnique.mockRejectedValueOnce(new Error("ECONNREFUSED postgres://secret-host:5432"));

    const getRes = createMockApiResponse();
    await handleSettings(
      {
        method: "GET",
        headers: { cookie: buildAuthCookieHeader("usr-settings-1") },
      } as unknown as NextApiRequest,
      getRes
    );
    expect(getRes.statusCode).toBe(500);
    expect(JSON.stringify(getRes.body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(getRes.body)).not.toContain("postgres://");

    mockFindUnique.mockResolvedValueOnce(null);
    mockUpsert.mockRejectedValueOnce(new Error("ECONNREFUSED postgres://secret-host:5432"));
    const postRes = createMockApiResponse();
    await handleSettings(
      {
        method: "POST",
        headers: {
          cookie: buildAuthCookieHeader("usr-settings-1"),
          host: "wattflow.local",
          origin: "https://wattflow.local",
          "sec-fetch-site": "same-origin",
        },
        body: {
          ecoflowEndpointRegion: "https://api.ecoflow.com",
          ecoflowAccessKey: "new-ak-1234",
          ecoflowAccessSecret: "new-as-1234",
          ecoflowSerialNumber: "R601ZAB12345",
        },
      } as unknown as NextApiRequest,
      postRes
    );
    expect(postRes.statusCode).toBe(500);
    expect(postRes.body).toEqual({
      success: false,
      message: "Erro interno ao salvar configurações.",
    });
    expect(JSON.stringify(postRes.body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(postRes.body)).not.toContain("postgres://");
  });
});
