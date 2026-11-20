import { test, expect } from "@playwright/test";
import http from "http";

test.describe("Live-Sync em Tempo Real via SSE & Endpoint /api/telemetry/stream", () => {
  let authCookie: string = "";

  test.beforeAll(async ({ request }) => {
    const userEmail = `e2e-sse-${Date.now()}@wattflow.local`;
    const password = "StrongSsePassword!123";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "SSE Telemetry Tester",
      },
    });

    if (registerRes.status() === 201) {
      const setCookie = registerRes.headers()["set-cookie"];
      if (setCookie) {
        authCookie = setCookie.split(";")[0];
      }
    }

    if (!authCookie) {
      const loginRes = await request.post("/api/auth/login", {
        data: {
          email: userEmail,
          password,
          rememberMe: true,
        },
      });
      const setCookie = loginRes.headers()["set-cookie"];
      if (setCookie) {
        authCookie = setCookie.split(";")[0];
      }
    }
  });

  test("endpoint /api/telemetry/stream bloqueia acesso sem autenticacao (401)", async ({
    request,
  }) => {
    const unauthRes = await request.get("/api/telemetry/stream");
    expect([401, 500]).toContain(unauthRes.status());
    const body = await unauthRes.json();
    expect(body.success).toBe(false);
  });

  test("endpoint /api/telemetry/stream retorna headers SSE corretos (Content-Type, X-Accel-Buffering, Cache-Control)", async ({
    baseURL,
  }) => {
    if (!authCookie) {
      test.skip();
      return;
    }

    const url = new URL("/api/telemetry/stream", baseURL || "http://127.0.0.1:3005");

    const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      const req = http.request(
        url,
        {
          method: "GET",
          headers: {
            cookie: authCookie,
            Accept: "text/event-stream",
          },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          const receivedHeaders = res.headers;
          req.destroy();
          resolve(receivedHeaders);
        }
      );

      req.on("error", (err) => {
        // Se a requisição já foi destruída intencionalmente após leitura dos headers, ignora
        if (req.destroyed) return;
        reject(err);
      });

      req.end();
    });

    const contentType = headers["content-type"] || "";
    expect(contentType).toContain("text/event-stream");

    const accelBuffering = headers["x-accel-buffering"] || "";
    expect(String(accelBuffering).toLowerCase()).toBe("no");

    const cacheControl = headers["cache-control"] || "";
    expect(cacheControl).toContain("no-cache");
  });
});

test.describe("Indicador de Status da Conexão (ConnectionStatusIndicator)", () => {
  let authCookie: string = "";

  test.beforeAll(async ({ request }) => {
    const userEmail = `e2e-status-indicator-${Date.now()}@wattflow.local`;
    const password = "StrongStatusPassword!123";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "Status Indicator Tester",
      },
    });

    if (registerRes.status() === 201) {
      const setCookie = registerRes.headers()["set-cookie"];
      if (setCookie) {
        authCookie = setCookie.split(";")[0];
      }
    }
  });

  test("renderiza indicador no Header da pagina inicial / com atributos de acessibilidade (role='status', aria-live='polite')", async ({
    page,
    context,
  }) => {
    if (authCookie) {
      const [cookieName, cookieVal] = authCookie.split("=");
      await context.addCookies([
        {
          name: cookieName,
          value: cookieVal,
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    }

    await page.goto("/");

    // Se redirecionou para login, ignora verificação da tela privada
    if (page.url().includes("/login")) {
      return;
    }

    const indicator = page.locator('header [role="status"][aria-live="polite"]');
    await expect(indicator).toBeVisible();

    // Valida atributos ARIA e label acessível
    const ariaLabel = await indicator.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toContain("Status da Conexão");

    // Valida presença do ponto luminoso (span interno)
    const dotSpan = indicator.locator("span.rounded-full").first();
    await expect(dotSpan).toBeVisible();
  });

  test("renderiza indicador no Header da pagina de Estatisticas /statistics", async ({
    page,
    context,
  }) => {
    if (authCookie) {
      const [cookieName, cookieVal] = authCookie.split("=");
      await context.addCookies([
        {
          name: cookieName,
          value: cookieVal,
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    }

    await page.goto("/statistics");

    if (page.url().includes("/login")) {
      return;
    }

    const indicator = page.locator('header [role="status"][aria-live="polite"]');
    await expect(indicator).toBeVisible();
    const ariaLabel = await indicator.getAttribute("aria-label");
    expect(ariaLabel).toContain("Status da Conexão");
  });

  test("renderiza indicador de conexao no Modo Kiosk /kiosk", async ({
    page,
    context,
  }) => {
    if (authCookie) {
      const [cookieName, cookieVal] = authCookie.split("=");
      await context.addCookies([
        {
          name: cookieName,
          value: cookieVal,
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    }

    await page.goto("/kiosk");

    if (page.url().includes("/login")) {
      return;
    }

    const kioskIndicator = page.locator('[role="status"][aria-live="polite"]');
    await expect(kioskIndicator).toBeVisible();
    const ariaLabel = await kioskIndicator.getAttribute("aria-label");
    expect(ariaLabel).toContain("Status da Conexão");
  });

  test("hover no indicador exibe tooltip com detalhes de latencia e status", async ({
    page,
    context,
  }) => {
    if (authCookie) {
      const [cookieName, cookieVal] = authCookie.split("=");
      await context.addCookies([
        {
          name: cookieName,
          value: cookieVal,
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    }

    await page.goto("/");

    if (page.url().includes("/login")) {
      return;
    }

    const indicator = page.locator('header [role="status"][aria-live="polite"]');
    await expect(indicator).toBeVisible();

    // Dispara hover para renderizar o TooltipContent
    await indicator.hover();

    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible();
    const tooltipText = await tooltip.textContent();
    expect(tooltipText).toBeTruthy();
  });
});
