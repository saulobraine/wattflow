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

test.describe("Etapa 4 - SEC-10 a SEC-14 (Headers, CSRF, Metodos/Query Token & Anti-Replay TOTP)", () => {
  test("security headers HTTP presentes em /login", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.status()).toBe(200);

    const headers = res.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  });

  test("protecao CSRF: Origin cross-site retorna 403 em POST/PATCH autenticados", async ({
    page,
  }) => {
    const email = `e2e-csrf-${Date.now()}@wattflow.local`;
    const password = "StrongE2ePassword!123";

    const registerRes = await page.request.post("/api/auth/register", {
      data: {
        email,
        password,
        fullName: "E2E CSRF Tester",
      },
    });
    expect(registerRes.status()).toBe(201);

    const csrfSettingsRes = await page.request.post("/api/settings", {
      headers: {
        origin: "https://evil.example.com",
      },
      data: {
        ecoflowAccessKey: "dummy-ak",
        ecoflowAccessSecret: "dummy-sk",
        ecoflowSerialNumber: "dummy-sn",
      },
    });
    expect(csrfSettingsRes.status()).toBe(403);
    const csrfSettingsJson = await csrfSettingsRes.json();
    expect(csrfSettingsJson.success).toBe(false);

    const csrfProfileRes = await page.request.patch("/api/auth/profile", {
      headers: {
        origin: "https://evil.example.com",
      },
      data: {
        fullName: "Hijacked Name",
      },
    });
    expect(csrfProfileRes.status()).toBe(403);
    const csrfProfileJson = await csrfProfileRes.json();
    expect(csrfProfileJson.success).toBe(false);
  });

  test("GET bloqueado (405) em /api/auth/logout e /api/sync com sessao; ?token= na query string rejeitado (401)", async ({
    page,
    request,
  }) => {
    const email = `e2e-methods-${Date.now()}@wattflow.local`;
    const password = "StrongE2ePassword!123";

    const registerRes = await page.request.post("/api/auth/register", {
      data: {
        email,
        password,
        fullName: "E2E Method Guard Tester",
      },
    });
    expect(registerRes.status()).toBe(201);

    const logoutGetRes = await page.request.get("/api/auth/logout");
    expect(logoutGetRes.status()).toBe(405);

    const syncGetSessionRes = await page.request.get("/api/sync");
    expect(syncGetSessionRes.status()).toBe(405);

    const cronToken =
      process.env.CRON_SECRET_TOKEN &&
      process.env.CRON_SECRET_TOKEN.trim().length >= 32
        ? process.env.CRON_SECRET_TOKEN
        : "e2e-cron-secret-token-with-at-least-32-chars";

    const syncQueryTokenRes = await request.get(
      `/api/sync?token=${encodeURIComponent(cronToken)}`
    );
    expect(syncQueryTokenRes.status()).toBe(401);

    const mqttQueryTokenRes = await request.get(
      `/api/mqtt-stream?token=${encodeURIComponent(cronToken)}`
    );
    expect(mqttQueryTokenRes.status()).toBe(401);
  });

  test("anti-replay TOTP no /api/auth/login-2fa: segundo uso do mesmo codigo retorna 401", async ({
    page,
    baseURL,
  }) => {
    const email = `e2e-replay-${Date.now()}@wattflow.local`;
    const password = "StrongE2ePassword!123";
    const sameOriginHeaders = { origin: baseURL || "http://127.0.0.1:3005" };

    const registerRes = await page.request.post("/api/auth/register", {
      data: {
        email,
        password,
        fullName: "E2E TOTP Replay Tester",
      },
    });
    expect(registerRes.status()).toBe(201);

    const setupRes = await page.request.post("/api/auth/2fa", {
      headers: sameOriginHeaders,
      data: { action: "SETUP" },
    });
    expect(setupRes.status()).toBe(200);
    const setupJson = await setupRes.json();
    const secret: string = setupJson.data.secret;

    const enableCode = generateTotpCode(secret, Date.now() - 30_000);
    const verifyRes = await page.request.post("/api/auth/2fa", {
      headers: sameOriginHeaders,
      data: {
        action: "VERIFY_AND_ENABLE",
        token: enableCode,
        currentPassword: password,
      },
    });
    expect(verifyRes.status()).toBe(200);

    const logoutRes = await page.request.post("/api/auth/logout", {
      headers: sameOriginHeaders,
    });
    expect(logoutRes.status()).toBe(200);

    const loginRes = await page.request.post("/api/auth/login", {
      data: { email, password },
    });
    expect(loginRes.status()).toBe(200);
    const loginJson = await loginRes.json();
    expect(loginJson.requiresTwoFactor).toBe(true);
    const challengeToken: string = loginJson.challengeToken;

    const firstCode = generateTotpCode(secret);
    const firstUseRes = await page.request.post("/api/auth/login-2fa", {
      data: {
        challengeToken,
        token: firstCode,
      },
    });
    expect(firstUseRes.status()).toBe(200);

    const replayRes = await page.request.post("/api/auth/login-2fa", {
      data: {
        challengeToken,
        token: firstCode,
      },
    });
    expect(replayRes.status()).toBe(401);
    const replayJson = await replayRes.json();
    expect(replayJson.success).toBe(false);
  });
});
