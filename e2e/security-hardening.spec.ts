import { test, expect } from "@playwright/test";

test.describe("Etapa 1 - Security Hardening & Auth Gate", () => {
  test("carrega a tela /login com formulario de autenticacao", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveTitle(/WattFlow/i);
    await expect(page.getByRole("heading", { name: /WattFlow/i })).toBeVisible();
    await expect(page.locator("#login-email-input")).toBeVisible();
    await expect(page.locator("#login-password-input")).toBeVisible();
    await expect(page.getByRole("button", { name: /entrar/i })).toBeVisible();
  });

  test("protege rota autenticada / redirecionando usuario nao autenticado para /login", async ({
    page,
  }) => {
    await page.goto("/");

    await page.waitForURL("**/login", { timeout: 15000 });
    await expect(page.locator("#login-email-input")).toBeVisible();
  });

  test("endpoints fail-closed: /api/mqtt-stream e /api/sync bloqueiam acesso sem token/sessao", async ({
    request,
  }) => {
    const mqttRes = await request.get("/api/mqtt-stream");
    expect([401, 500]).toContain(mqttRes.status());
    const mqttBody = await mqttRes.json();
    expect(mqttBody.success).toBe(false);

    const mqttInvalidRes = await request.get("/api/mqtt-stream?token=invalid-token-e2e");
    expect([401, 500]).toContain(mqttInvalidRes.status());

    const syncGetRes = await request.get("/api/sync");
    expect(syncGetRes.status()).toBe(401);
    const syncBody = await syncGetRes.json();
    expect(syncBody.success).toBe(false);

    const syncPostRes = await request.post("/api/sync");
    expect(syncPostRes.status()).toBe(401);
  });

  test("bloqueio SSRF em /api/settings rejeita ecoflowEndpointRegion fora da allowlist", async ({
    request,
    baseURL,
  }) => {
    const unauthSettingsRes = await request.post("/api/settings", {
      data: {
        ecoflowEndpointRegion: "http://169.254.169.254/latest/meta-data",
        ecoflowAccessKey: "dummy-ak",
        ecoflowAccessSecret: "dummy-sk",
        ecoflowSerialNumber: "dummy-sn",
      },
    });
    expect(unauthSettingsRes.status()).toBe(401);

    const uniqueEmail = `e2e-ssrf-${Date.now()}@wattflow.local`;
    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: uniqueEmail,
        password: "StrongE2ePassword!123",
        fullName: "E2E Security Tester",
      },
    });
    expect(registerRes.status()).toBe(201);

    const invalidRegions = [
      "http://169.254.169.254/latest/meta-data",
      "http://127.0.0.1:3000",
      "https://evil.example.com",
    ];

    for (const invalidRegion of invalidRegions) {
      const ssrfRes = await request.post("/api/settings", {
        headers: { origin: baseURL || "http://127.0.0.1:3005" },
        data: {
          ecoflowEndpointRegion: invalidRegion,
          ecoflowAccessKey: "dummy-ak",
          ecoflowAccessSecret: "dummy-sk",
          ecoflowSerialNumber: "dummy-sn",
        },
      });
      expect(ssrfRes.status()).toBe(400);
      const ssrfBody = await ssrfRes.json();
      expect(ssrfBody.success).toBe(false);
    }
  });
});
