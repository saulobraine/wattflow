import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

// Mock de web-push para testes determinísticos
const mockSendNotification = vi.fn();
const mockSetVapidDetails = vi.fn();
const mockGenerateVAPIDKeys = vi.fn(() => ({
  publicKey: "BPUB_TEST_KEY_1234567890abcdefghijklmnopqrstuvwxyz",
  privateKey: "PRIV_TEST_KEY_abcdef123456",
}));

vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
    setVapidDetails: (...args: unknown[]) => mockSetVapidDetails(...args),
    generateVAPIDKeys: () => mockGenerateVAPIDKeys(),
  },
}));

// Mock do prismaClient
vi.mock("../../database/prismaClient", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "usr-push-test",
        email: "push@wattflow.local",
        tokenVersion: 0,
      }),
    },
    webPushSubscription: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { WebPushService } from "../WebPushService";
import { NotificationDispatcher, NotificationPayload } from "../NotificationDispatcher";
import handleGetPublicKey from "../../../pages/api/push/public-key";
import handlePushSubscribe from "../../../pages/api/push/subscribe";
import handlePushTest from "../../../pages/api/push/test";
import { AuthenticationTokenService } from "../../../domain/services/AuthenticationTokenService";
import { SESSION_COOKIE_NAME } from "../../auth/sessionHelper";

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

function buildAuthCookieHeader(userId = "usr-push-test"): string {
  const tokenService = new AuthenticationTokenService(VALID_AUTH_SECRET);
  const sessionToken = tokenService.createSessionToken(userId, "push@wattflow.local");
  let rawToken = "";
  sessionToken.transferToken((token) => {
    rawToken = token;
  });
  return `${SESSION_COOKIE_NAME}=${rawToken}; wattflow_csrf=mock-csrf-token`;
}

describe("Web Push & Notificações de Comutação ATS", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = VALID_AUTH_SECRET;
    mockSendNotification.mockResolvedValue({ statusCode: 201 });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("WebPushService", () => {
    it("gera ou recupera chaves VAPID válidas e retorna chave pública", () => {
      const service = WebPushService.getInstance();
      const publicKey = service.getPublicKey();

      expect(publicKey).toBeDefined();
      expect(typeof publicKey).toBe("string");
      expect(publicKey.length).toBeGreaterThan(10);
    });

    it("salva, recupera e remove subscrições do registro em memória", async () => {
      const service = WebPushService.getInstance();
      const testSubscription = {
        endpoint: "https://fcm.googleapis.com/fcm/send/test-sub-1",
        keys: {
          p256dh: "p256dh-key-test",
          auth: "auth-key-test",
        },
        userId: "usr-push-test",
      };

      await service.saveSubscription(testSubscription, "usr-push-test");
      const list = await service.getSubscriptions("usr-push-test");
      const found = list.find((s) => s.endpoint === testSubscription.endpoint);

      expect(found).toBeDefined();
      expect(found?.keys.p256dh).toBe("p256dh-key-test");

      await service.removeSubscription(testSubscription.endpoint);
      const listAfter = await service.getSubscriptions("usr-push-test");
      const foundAfter = listAfter.find((s) => s.endpoint === testSubscription.endpoint);
      expect(foundAfter).toBeUndefined();
    });

    it("limpa automaticamente inscrições expiradas (410 Gone / 404 Not Found)", async () => {
      const service = WebPushService.getInstance();
      const deadSubscription = {
        endpoint: "https://fcm.googleapis.com/fcm/send/dead-sub-410",
        keys: {
          p256dh: "p256dh-dead",
          auth: "auth-dead",
        },
        userId: "usr-push-test",
      };

      await service.saveSubscription(deadSubscription, "usr-push-test");

      // Simula erro 410 Gone do provedor de Push
      mockSendNotification.mockRejectedValueOnce({
        statusCode: 410,
        message: "Push subscription has expired or unsubscribed.",
      });

      const result = await service.sendNotification(deadSubscription, {
        title: "Teste Dead",
        message: "Notificação",
      });

      expect(result.isSuccess).toBe(false);
      expect(result.statusCode).toBe(410);

      // Deve ter sido removida
      const list = await service.getSubscriptions("usr-push-test");
      const found = list.find((s) => s.endpoint === deadSubscription.endpoint);
      expect(found).toBeUndefined();
    });
  });

  describe("NotificationDispatcher com Web Push Integrado", () => {
    it("despacha notificação Web Push automaticamente na comutação para BATERIA (actionState: SOLAR_BATTERY)", async () => {
      const dispatcher = new NotificationDispatcher();
      const service = WebPushService.getInstance();

      const testSub = {
        endpoint: "https://fcm.googleapis.com/fcm/send/ats-solar-battery",
        keys: { p256dh: "key-solar", auth: "auth-solar" },
        userId: "usr-push-test",
      };
      await service.saveSubscription(testSub, "usr-push-test");

      const payload: NotificationPayload = {
        title: "ATS: Comutação para Bateria Solar",
        message: "Bateria EcoFlow atingiu 90%. Alimentação transferida para Bateria.",
        batteryPercentage: 90,
        solarWatts: 620,
        actionState: "SOLAR_BATTERY",
      };

      const result = await dispatcher.dispatchNotification(payload, {
        isNotificationActive: true,
        isWebPushActive: true,
        userId: "usr-push-test",
      });

      expect(result.webPushSuccess).toBe(true);
      expect(result.summaryMessage).toContain("Web Push: enviado");
      expect(mockSendNotification).toHaveBeenCalled();
    });

    it("despacha notificação Web Push automaticamente na comutação para REDE (actionState: GRID)", async () => {
      const dispatcher = new NotificationDispatcher();
      const service = WebPushService.getInstance();

      const testSub = {
        endpoint: "https://fcm.googleapis.com/fcm/send/ats-grid",
        keys: { p256dh: "key-grid", auth: "auth-grid" },
        userId: "usr-push-test",
      };
      await service.saveSubscription(testSub, "usr-push-test");

      const payload: NotificationPayload = {
        title: "ATS: Comutação para Rede Elétrica",
        message: "Bateria EcoFlow atingiu limite mínimo de 30%. Alimentação transferida para Concessionária.",
        batteryPercentage: 30,
        solarWatts: 50,
        actionState: "GRID",
      };

      const result = await dispatcher.dispatchNotification(payload, {
        isNotificationActive: true,
        isWebPushActive: true,
        userId: "usr-push-test",
      });

      expect(result.webPushSuccess).toBe(true);
      expect(result.summaryMessage).toContain("Web Push: enviado");
    });

    it("respeita isWebPushActive: false e não despacha push", async () => {
      const dispatcher = new NotificationDispatcher();
      mockSendNotification.mockClear();

      const payload: NotificationPayload = {
        title: "ATS: Comutação",
        message: "Mudança de estado",
        actionState: "SOLAR_BATTERY",
      };

      const result = await dispatcher.dispatchNotification(payload, {
        isNotificationActive: true,
        isWebPushActive: false, // Desativado
      });

      expect(result.webPushSuccess).toBe(false);
      expect(mockSendNotification).not.toHaveBeenCalled();
    });
  });

  describe("Endpoints de API Push", () => {
    it("GET /api/push/public-key retorna chave pública VAPID com código 200", async () => {
      const req = { method: "GET", headers: {} } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleGetPublicKey(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.publicKey).toBeDefined();
    });

    it("GET /api/push/public-key rejeita métodos não-GET com 405", async () => {
      const req = { method: "POST", headers: {} } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handleGetPublicKey(req, res);

      expect(res.statusCode).toBe(405);
      expect(res.body.success).toBe(false);
    });

    it("POST /api/push/subscribe valida e registra nova inscrição Web Push", async () => {
      const req = {
        method: "POST",
        headers: { cookie: buildAuthCookieHeader() },
        body: {
          subscription: {
            endpoint: "https://fcm.googleapis.com/fcm/send/browser-client-endpoint-1",
            keys: {
              p256dh: "client-p256dh-key",
              auth: "client-auth-key",
            },
          },
        },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handlePushSubscribe(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("sucesso");
    });

    it("POST /api/push/subscribe rejeita payload inválido com 400", async () => {
      const req = {
        method: "POST",
        headers: {},
        body: { invalidField: true },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handlePushSubscribe(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("POST /api/push/test requer autenticação e retorna 401 para requisições anônimas", async () => {
      const req = {
        method: "POST",
        headers: {},
        body: {},
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handlePushTest(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("POST /api/push/test envia notificação de teste para usuário autenticado com CSRF", async () => {
      const req = {
        method: "POST",
        headers: {
          cookie: buildAuthCookieHeader(),
          "x-csrf-token": "mock-csrf-token",
          host: "wattflow.local",
          origin: "https://wattflow.local",
          "sec-fetch-site": "same-origin",
        },
        body: {
          title: "Teste",
          message: "Mensagem de teste",
          subscription: {
            endpoint: "https://fcm.googleapis.com/fcm/send/direct-test",
            keys: {
              p256dh: "key",
              auth: "auth",
            },
          },
        },
      } as unknown as NextApiRequest;
      const res = createMockApiResponse();

      await handlePushTest(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalSent).toBe(1);
    });
  });
});
