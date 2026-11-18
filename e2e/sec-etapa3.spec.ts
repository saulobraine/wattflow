import { test, expect, request as playwrightRequest } from "@playwright/test";

test.describe("Etapa 3 - SEC-05 a SEC-09 (Passkeys, Senha 12+, Revogacao tokenVersion & Rate Limit)", () => {
  test("politica de senha: /api/auth/register rejeita senha com menos de 12 caracteres (400)", async ({
    request,
  }) => {
    const res = await request.post("/api/auth/register", {
      data: {
        email: `e2e-short-${Date.now()}@wattflow.local`,
        password: "ShortPass1!",
        fullName: "Short Password Tester",
      },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test("passkeys desabilitadas: /api/auth/passkey retorna 501 para CHALLENGE e REGISTER", async ({
    page,
    baseURL,
  }) => {
    const targetOrigin = baseURL || "http://127.0.0.1:3005";
    const email = `e2e-passkey-${Date.now()}@wattflow.local`;
    const password = "StrongE2ePassword!123";

    const registerRes = await page.request.post("/api/auth/register", {
      data: {
        email,
        password,
        fullName: "E2E Passkey Tester",
      },
    });
    expect(registerRes.status()).toBe(201);

    const challengeRes = await page.request.post("/api/auth/passkey", {
      headers: { origin: targetOrigin },
      data: { action: "CHALLENGE" },
    });
    expect(challengeRes.status()).toBe(501);
    const challengeJson = await challengeRes.json();
    expect(challengeJson.success).toBe(false);

    const registerPasskeyRes = await page.request.post("/api/auth/passkey", {
      headers: { origin: targetOrigin },
      data: { action: "REGISTER", name: "Test Passkey" },
    });
    expect(registerPasskeyRes.status()).toBe(501);
    const registerPasskeyJson = await registerPasskeyRes.json();
    expect(registerPasskeyJson.success).toBe(false);
  });

  test("perfil exige currentPassword ao alterar email (400) e troca de senha / logout revoga sessao anterior via tokenVersion (401)", async ({
    page,
    baseURL,
  }) => {
    const email = `e2e-revocation-${Date.now()}@wattflow.local`;
    const initialPassword = "StrongE2ePassword!123";
    const updatedPassword = "NewStrongE2ePassword!456";

    const registerRes = await page.request.post("/api/auth/register", {
      data: {
        email,
        password: initialPassword,
        fullName: "E2E Revocation Tester",
      },
    });
    expect(registerRes.status()).toBe(201);

    const cookiesAfterRegister = await page.context().cookies();
    const initialSessionCookie = cookiesAfterRegister.find(
      (c) => c.name === "wattflow_session"
    );
    expect(initialSessionCookie).toBeDefined();

    // Alterar email sem currentPassword deve retornar 400
    const targetOrigin = baseURL || "http://127.0.0.1:3005";
    const emailChangeNoPassRes = await page.request.patch("/api/auth/profile", {
      headers: { origin: targetOrigin },
      data: {
        email: `changed-${email}`,
      },
    });
    expect(emailChangeNoPassRes.status()).toBe(400);
    const emailChangeNoPassJson = await emailChangeNoPassRes.json();
    expect(emailChangeNoPassJson.success).toBe(false);

    // Troca de senha incrementa tokenVersion e invalida o cookie antigo
    const changePassRes = await page.request.post("/api/auth/change-password", {
      headers: { origin: targetOrigin },
      data: {
        currentPassword: initialPassword,
        newPassword: updatedPassword,
      },
    });
    expect(changePassRes.status()).toBe(200);

    const staleContextAfterPassChange = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: {
        cookie: `wattflow_session=${initialSessionCookie!.value}`,
      },
    });
    const staleProfileRes = await staleContextAfterPassChange.get("/api/auth/profile");
    expect(staleProfileRes.status()).toBe(401);
    await staleContextAfterPassChange.dispose();

    // Logout tambem incrementa tokenVersion e invalida o cookie anterior
    const cookiesBeforeLogout = await page.context().cookies();
    const activeSessionCookie = cookiesBeforeLogout.find(
      (c) => c.name === "wattflow_session"
    );
    expect(activeSessionCookie).toBeDefined();

    const logoutRes = await page.request.post("/api/auth/logout", {
      headers: { origin: targetOrigin },
    });
    expect(logoutRes.status()).toBe(200);

    const staleContextAfterLogout = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: {
        cookie: `wattflow_session=${activeSessionCookie!.value}`,
      },
    });
    const postLogoutProfileRes = await staleContextAfterLogout.get("/api/auth/profile");
    expect(postLogoutProfileRes.status()).toBe(401);
    await staleContextAfterLogout.dispose();
  });

  test("rate limit em /api/auth/login retorna 429 com header Retry-After", async ({
    request,
  }) => {
    const email = `e2e-ratelimit-${Date.now()}@wattflow.local`;
    const wrongPassword = "WrongPassword!12345";

    let lastStatus = 0;
    let retryAfterHeader: string | undefined;

    for (let attempt = 1; attempt <= 7; attempt++) {
      const res = await request.post("/api/auth/login", {
        data: {
          email,
          password: wrongPassword,
        },
      });
      lastStatus = res.status();
      if (lastStatus === 429) {
        retryAfterHeader = res.headers()["retry-after"];
        const body = await res.json();
        expect(body.success).toBe(false);
        break;
      }
      expect(lastStatus).toBe(401);
    }

    expect(lastStatus).toBe(429);
    expect(retryAfterHeader).toBeTruthy();
    expect(Number(retryAfterHeader)).toBeGreaterThan(0);
  });
});
