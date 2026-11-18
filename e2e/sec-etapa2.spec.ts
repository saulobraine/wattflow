import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(input: string): Buffer {
  const cleaned = input.trim().replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new Error(`Invalid Base32 char: ${cleaned[i]}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateTotpCode(base32Secret: string, timestampMs = Date.now()): string {
  const key = decodeBase32(base32Secret);
  const counter = Math.floor(timestampMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binaryCode % 1_000_000).padStart(6, "0");
}

test.describe("Etapa 2 - SEC-01 (2FA TOTP) & SEC-03 (BYOK Masking)", () => {
  test("fluxo completo 2FA: SETUP -> VERIFY_AND_ENABLE em /profile, logout e login via /api/auth/login-2fa", async ({
    page,
  }) => {
    const email = `e2e-2fa-${Date.now()}@wattflow.local`;
    const password = "StrongE2ePassword!123";

    const registerRes = await page.request.post("/api/auth/register", {
      data: {
        email,
        password,
        fullName: "E2E 2FA Tester",
      },
    });
    expect(registerRes.status()).toBe(201);

    await page.goto("/profile");
    await expect(
      page.getByRole("button", { name: /Configurar Autenticação em 2 Etapas/i })
    ).toBeVisible();

    const setupResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/auth/2fa") && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: /Configurar Autenticação em 2 Etapas/i }).click();
    const setupRes = await setupResponsePromise;
    expect(setupRes.status()).toBe(200);
    const setupJson = await setupRes.json();
    expect(setupJson.success).toBe(true);
    const totpSecret: string = setupJson.data.secret;
    expect(totpSecret).toBeTruthy();

    const enableCode = generateTotpCode(totpSecret);
    await page.locator("#totp-code-input").fill(enableCode);
    await page.locator("#totp-current-password-input").fill(password);

    const verifyResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/auth/2fa") && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: /Ativar 2FA/i }).click();
    const verifyRes = await verifyResponsePromise;
    expect(verifyRes.status()).toBe(200);
    const verifyJson = await verifyRes.json();
    expect(verifyJson.success).toBe(true);
    expect(verifyJson.data.twoFactorEnabled).toBe(true);

    await expect(page.getByText(/Sua conta está protegida por 2FA/i)).toBeVisible();

    // Logout e garantir que nao ha cookie de sessao antes do 2FA
    const logoutRes = await page.request.post("/api/auth/logout");
    expect(logoutRes.status()).toBe(200);

    await page.goto("/login");
    await page.locator("#login-email-input").fill(email);
    await page.locator("#login-password-input").fill(password);

    const loginResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/auth/login") && !res.url().includes("login-2fa")
    );
    await page.getByRole("button", { name: /Entrar/i }).click();
    const loginRes = await loginResponsePromise;
    expect(loginRes.status()).toBe(200);
    const loginJson = await loginRes.json();
    expect(loginJson.success).toBe(true);
    expect(loginJson.requiresTwoFactor).toBe(true);
    expect(loginJson.challengeToken).toBeTruthy();

    const cookiesBefore2fa = await page.context().cookies();
    const sessionBefore2fa = cookiesBefore2fa.find((c) => c.name === "wattflow_session");
    expect(sessionBefore2fa).toBeUndefined();

    await expect(page.locator("#login-totp-input")).toBeVisible();

    const loginCode = generateTotpCode(totpSecret);
    await page.locator("#login-totp-input").fill(loginCode);

    const login2faResponsePromise = page.waitForResponse((res) =>
      res.url().includes("/api/auth/login-2fa")
    );
    await page.locator('button[type="submit"]').click();
    const login2faRes = await login2faResponsePromise;
    expect(login2faRes.status()).toBe(200);
    const login2faJson = await login2faRes.json();
    expect(login2faJson.success).toBe(true);

    await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
    const cookiesAfter2fa = await page.context().cookies();
    const sessionAfter2fa = cookiesAfter2fa.find((c) => c.name === "wattflow_session");
    expect(sessionAfter2fa).toBeDefined();
  });

  test("protecao BYOK em /settings: GET /api/settings retorna apenas flag has* + mascara e UI nao expoe segredo", async ({
    page,
  }) => {
    const email = `e2e-byok-${Date.now()}@wattflow.local`;
    const password = "StrongE2ePassword!123";
    const plainSecret = "sk_e2e_super_secret_byok_987654321";

    const registerRes = await page.request.post("/api/auth/register", {
      data: {
        email,
        password,
        fullName: "E2E BYOK Tester",
      },
    });
    expect(registerRes.status()).toBe(201);

    await page.goto("/settings");
    await page.locator("#ecoflow-access-key-input").fill("ak_e2e_public_key_123");
    await page.locator("#ecoflow-secret-key-input").fill(plainSecret);
    await page.locator("#ecoflow-sn-input").fill("SN-E2E-123456");

    const savePromise = page.waitForResponse(
      (res) => res.url().includes("/api/settings") && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: /Salvar Configurações/i }).click();
    const saveRes = await savePromise;
    expect(saveRes.status()).toBe(200);
    const saveJson = await saveRes.json();
    expect(saveJson.success).toBe(true);

    const reloadSettingsPromise = page.waitForResponse(
      (res) => res.url().includes("/api/settings") && res.request().method() === "GET"
    );
    await page.reload();
    const reloadSettingsRes = await reloadSettingsPromise;
    expect(reloadSettingsRes.status()).toBe(200);

    const apiSettingsRes = await page.request.get("/api/settings");
    expect(apiSettingsRes.status()).toBe(200);
    const rawBody = await apiSettingsRes.text();
    expect(rawBody).not.toContain(plainSecret);

    const getSettingsJson = JSON.parse(rawBody);
    expect(getSettingsJson.success).toBe(true);
    expect(getSettingsJson.data.hasEcoflowAccessSecret).toBe(true);
    expect(getSettingsJson.data.ecoflowAccessSecretMasked).toBeTruthy();
    expect(getSettingsJson.data.ecoflowAccessSecretMasked).not.toContain(plainSecret);
    expect(getSettingsJson.data.ecoflowAccessSecret).toBeUndefined();

    await expect(page.getByText(/Configurada \(/i)).toBeVisible();
    await expect(page.locator("#ecoflow-secret-key-input")).toHaveValue("");
    const htmlContent = await page.content();
    expect(htmlContent).not.toContain(plainSecret);
  });
});
