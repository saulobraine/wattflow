import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";

const {
  mockFindManyUserConfig,
  mockFindUniqueUserConfig,
  mockUpsertUserConfig,
  mockUpdateUserConfig,
} = vi.hoisted(() => ({
  mockFindManyUserConfig: vi.fn(),
  mockFindUniqueUserConfig: vi.fn(),
  mockUpsertUserConfig: vi.fn(),
  mockUpdateUserConfig: vi.fn(),
}));

vi.mock("../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-tenant-1",
        email: "tenant1@wattflow.local",
        tokenVersion: 0,
      }),
    },
    userConfiguration: {
      findMany: mockFindManyUserConfig,
      findUnique: mockFindUniqueUserConfig,
      upsert: mockUpsertUserConfig,
      update: mockUpdateUserConfig,
    },
    syncExecutionLog: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

import handleDailyReportCron, { isAuthorizedCronRequest } from "../../../pages/api/cron/daily-report";
import handleStormMode from "../../../pages/api/storm-mode";
import { NotificationDispatcher } from "../../notifications/NotificationDispatcher";
import { AuthenticationTokenService } from "../../../domain/services/AuthenticationTokenService";
import { SESSION_COOKIE_NAME } from "../../auth/sessionHelper";

const VALID_AUTH_SECRET = "auth-secret-token-with-32-chars!";
const VALID_CRON_SECRET = "cron-secret-with-high-entropy-32!";

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

function buildSessionCookieHeader(userId = "user-tenant-1"): string {
  const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET);
  const sessionToken = tokenService.createSessionToken(userId, "tenant1@wattflow.local");
  let rawToken = "";
  sessionToken.transferToken((t) => {
    rawToken = t;
  });
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`;
}

describe("Security Regression Suite - CRON Hardening & Timing-Safe Verification", () => {
  it("timing-safe cron validator rejects missing, empty or mismatched secrets fail-closed", () => {
    expect(isAuthorizedCronRequest(undefined, undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer valid-token", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer valid-token", "")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer valid-token", "   ")).toBe(false);
    expect(isAuthorizedCronRequest(undefined, "secret-123")).toBe(false);
    expect(isAuthorizedCronRequest("Basic invalid", "secret-123")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer short", "secret-123-with-longer-size")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer wrong-token-same-length!", "right-token-same-length!")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer correct-secret-token", "correct-secret-token")).toBe(true);
  });

  it("fails closed with 401 when neither valid CRON_SECRET nor authenticated session is present", async () => {
    const originalCronSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;

    const req = {
      method: "GET",
      headers: {
        authorization: "Bearer unauthorized-token",
      },
      query: {},
    } as unknown as NextApiRequest;

    const res = createMockApiResponse();
    await handleDailyReportCron(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);

    if (originalCronSecret) {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it("strictly enforces multi-tenant isolation when triggered by session user", async () => {
    const originalAuthSecret = process.env.AUTH_SECRET;
    const originalCronSecret = process.env.CRON_SECRET;
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;
    process.env.CRON_SECRET = VALID_CRON_SECRET;

    mockFindManyUserConfig.mockResolvedValueOnce([
      {
        id: "cfg-1",
        userId: "user-tenant-1",
        isDailyReportActive: true,
        isNotificationActive: true,
        dailyReportTime: "21:00",
        lastDailyReportSentAt: null,
        energyCostPerKwh: 0.92,
        currencySymbol: "R$",
        batteryCapacityWh: 2048,
        isStormModeActive: false,
        atsLifespanCycles: 10000,
        atsCurrentCycles: 10,
        whatsappPhoneNumber: "5511999998888",
        whatsappApiKey: "enc:test",
        telegramBotToken: "",
        telegramChatId: "",
        user: { email: "tenant1@wattflow.local", fullName: "Tenant One" },
      },
    ]);

    const req = {
      method: "POST",
      headers: {
        cookie: buildSessionCookieHeader("user-tenant-1"),
      },
      query: { force: "true" },
      body: { force: true },
    } as unknown as NextApiRequest;

    const res = createMockApiResponse();
    await handleDailyReportCron(req, res);

    expect(res.statusCode).toBe(200);
    // Verifica que o findMany filtrou obrigatoriamente pelo userId do tenant da sessão
    expect(mockFindManyUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-tenant-1",
        }),
      })
    );

    // Higienização de resposta: detalhes não devem vazar userIds para cliente de sessão comum
    const details = res.body.details as Array<{ userId?: string }>;
    expect(details[0]?.userId).toBeUndefined();

    if (originalAuthSecret) process.env.AUTH_SECRET = originalAuthSecret;
    if (originalCronSecret) process.env.CRON_SECRET = originalCronSecret;
  });
});

describe("Security Regression Suite - Storm Mode Race Condition & Idempotency", () => {
  it("does not trigger physical switch or increment cycles when storm mode is already in desired state", async () => {
    const originalAuthSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;

    // Cenário: o banco já está com isStormModeActive: true
    mockFindUniqueUserConfig.mockResolvedValueOnce({
      id: "cfg-storm-1",
      userId: "user-tenant-1",
      isStormModeActive: true,
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
    });

    mockUpsertUserConfig.mockResolvedValueOnce({
      id: "cfg-storm-1",
      userId: "user-tenant-1",
      isStormModeActive: true,
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
    });

    const req = {
      method: "POST",
      headers: {
        cookie: buildSessionCookieHeader("user-tenant-1"),
        host: "wattflow.local",
        origin: "https://wattflow.local",
        "sec-fetch-site": "same-origin",
      },
      body: {
        isStormModeActive: true,
      },
    } as unknown as NextApiRequest;

    const res = createMockApiResponse();
    await handleStormMode(req, res);

    expect(res.statusCode).toBe(200);
    // Garante que não houve comutação redundante nem race condition
    expect((res.body.data as { acSwitchedToGrid?: boolean })?.acSwitchedToGrid).toBe(false);

    if (originalAuthSecret) process.env.AUTH_SECRET = originalAuthSecret;
  });

  it("rejects invalid storm mode input types", async () => {
    const originalAuthSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;

    const req = {
      method: "POST",
      headers: {
        cookie: buildSessionCookieHeader("user-tenant-1"),
        host: "wattflow.local",
        origin: "https://wattflow.local",
        "sec-fetch-site": "same-origin",
      },
      body: {
        isStormModeActive: "invalid_string_not_boolean",
      },
    } as unknown as NextApiRequest;

    const res = createMockApiResponse();
    await handleStormMode(req, res);

    expect(res.statusCode).toBe(400);

    if (originalAuthSecret) process.env.AUTH_SECRET = originalAuthSecret;
  });
});

describe("Security Regression Suite - NotificationDispatcher CallMeBot Hardening", () => {
  it("rejects invalid or dangerous phone numbers and apiKeys before making HTTP calls", async () => {
    const dispatcher = new NotificationDispatcher();

    // Telefone muito curto (< 10 dígitos)
    const resultShortPhone = await dispatcher.dispatchNotification(
      { title: "Test", message: "Short Phone" },
      { whatsappPhoneNumber: "12345", whatsappApiKey: "validkey123" }
    );
    expect(resultShortPhone.whatsappSuccess).toBe(false);
    expect(resultShortPhone.whatsappError).toContain("Número de WhatsApp inválido");

    // Telefone com caracteres inválidos
    const resultInvalidPhone = await dispatcher.dispatchNotification(
      { title: "Test", message: "Bad Phone" },
      { whatsappPhoneNumber: "abcde", whatsappApiKey: "validkey123" }
    );
    expect(resultInvalidPhone.whatsappSuccess).toBe(false);
    expect(resultInvalidPhone.whatsappError).toContain("Número de WhatsApp inválido");

    // API Key com caracteres perigosos (espaços, pontuações especiais, scripts)
    const resultDangerousKey = await dispatcher.dispatchNotification(
      { title: "Test", message: "Bad API Key" },
      { whatsappPhoneNumber: "5511999998888", whatsappApiKey: "bad key with spaces!" }
    );
    expect(resultDangerousKey.whatsappSuccess).toBe(false);
    expect(resultDangerousKey.whatsappError).toContain("API Key do CallMeBot contém caracteres inválidos");

    const resultScriptKey = await dispatcher.dispatchNotification(
      { title: "Test", message: "XSS Key" },
      { whatsappPhoneNumber: "5511999998888", whatsappApiKey: "<script>alert(1)</script>" }
    );
    expect(resultScriptKey.whatsappSuccess).toBe(false);
    expect(resultScriptKey.whatsappError).toContain("API Key do CallMeBot contém caracteres inválidos");
  });
});
