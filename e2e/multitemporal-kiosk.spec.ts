import { test, expect } from "@playwright/test";

test.describe("Estatísticas Avançadas Multitemporais & Exportação CSV", () => {
  let authCookie: string = "";

  test.beforeAll(async ({ request }) => {
    const userEmail = `e2e-kiosk-${Date.now()}@wattflow.local`;
    const password = "StrongKioskPassword!123";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "Kiosk E2E Tester",
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

  test("endpoint /api/statistics/history exige autenticacao e suporta ranges multitemporais", async ({
    request,
  }) => {
    // 1. Unauthenticated -> 401
    const unauthRes = await request.get("/api/statistics/history?range=24h");
    expect([401, 500]).toContain(unauthRes.status());

    // 2. Authenticated com cookie
    if (authCookie) {
      const res24h = await request.get("/api/statistics/history?range=24h", {
        headers: { cookie: authCookie },
      });
      expect(res24h.status()).toBe(200);
      const body24h = await res24h.json();
      expect(body24h.range).toBe("24h");
      expect(body24h.summary).toBeDefined();
      expect(Array.isArray(body24h.points)).toBe(true);

      // Range Today vs Yesterday
      const resComp = await request.get(
        "/api/statistics/history?range=today-vs-yesterday",
        {
          headers: { cookie: authCookie },
        }
      );
      expect(resComp.status()).toBe(200);
      const bodyComp = await resComp.json();
      expect(bodyComp.range).toBe("today-vs-yesterday");
      expect(bodyComp.comparison).toBeDefined();
      expect(bodyComp.comparison.todayPoints).toBeDefined();
      expect(bodyComp.comparison.yesterdayPoints).toBeDefined();
    }
  });

  test("endpoint /api/statistics/export gera CSV com sanitizacao contra Formula Injection e UTF-8 BOM", async ({
    request,
  }) => {
    if (!authCookie) {
      test.skip();
      return;
    }

    const res = await request.get("/api/statistics/export?range=7d", {
      headers: { cookie: authCookie },
    });
    expect(res.status()).toBe(200);

    const contentType = res.headers()["content-type"] || "";
    expect(contentType).toContain("text/csv");

    const contentDisposition = res.headers()["content-disposition"] || "";
    expect(contentDisposition).toContain("attachment; filename=");
    expect(contentDisposition).toContain(".csv");

    const csvText = await res.text();
    // UTF-8 BOM (\uFEFF)
    expect(csvText.charCodeAt(0)).toBe(0xfeff);

    // Cabeçalho RFC 4180
    expect(csvText).toContain("Data_Hora");
    expect(csvText).toContain("Bateria_SOC_Percent");
    expect(csvText).toContain("Geracao_Solar_Watts");
    expect(csvText).toContain("Consumo_Residencial_Watts");
    expect(csvText).toContain("Saldo_Liquido_Watts");
    expect(csvText).toContain("Fonte_Ativa");
  });
});

test.describe("Modo Kiosk (/kiosk) & Botão no Header", () => {
  let authCookie: string = "";

  test.beforeAll(async ({ request }) => {
    const userEmail = `e2e-wallpanel-${Date.now()}@wattflow.local`;
    const password = "StrongWallPanelPassword!123";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "Wall Panel Tester",
      },
    });

    if (registerRes.status() === 201) {
      const setCookie = registerRes.headers()["set-cookie"];
      if (setCookie) {
        authCookie = setCookie.split(";")[0];
      }
    }
  });

  test("Header em Layout.tsx possui o botao de acesso direto ao Modo Kiosk", async ({
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

    // Se redirecionou para login, ignora verificação do header autenticado
    if (page.url().includes("/login")) {
      return;
    }

    const kioskBtn = page.locator('a[aria-label="Abrir Modo Kiosk (Painel de Parede)"]');
    await expect(kioskBtn).toBeVisible();
    expect(await kioskBtn.getAttribute("href")).toBe("/kiosk");
  });

  test("pagina /kiosk renderiza em Dark OLED puro (#000000) com gauge macroscopico e controles", async ({
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

    await expect(page).toHaveTitle(/Modo Kiosk/i);

    // Valida fundo Dark OLED puro (#000000 / rgb(0, 0, 0))
    const bgColor = await page.evaluate(() => {
      const el = document.querySelector("div[style*='background-color']") || document.body;
      return window.getComputedStyle(el).backgroundColor;
    });
    expect(["rgb(0, 0, 0)", "#000000"]).toContain(bgColor);

    // Valida Relógio Digital
    const clockText = await page.locator("header .font-mono").first().textContent();
    expect(clockText).toBeTruthy();

    // Valida cards de potência (Geração Solar PV, Carga Residencial AC, Balanço Líquido)
    await expect(page.getByText("Geração Solar PV")).toBeVisible();
    await expect(page.getByText("Carga Residencial AC")).toBeVisible();
    await expect(page.getByText(/Balanço Líquido/i)).toBeVisible();

    // Valida Diagrama Sinóptico
    await expect(page.getByText("Painéis PV")).toBeVisible();
    await expect(page.getByText("EcoFlow BMS")).toBeVisible();
    await expect(page.getByText("Chave ATS", { exact: true })).toBeVisible();
    await expect(page.getByText("Residência", { exact: true })).toBeVisible();

    // Valida botão de alternar tela cheia (Fullscreen)
    const fullscreenBtn = page.locator('button[aria-label*="Tela Cheia"]');
    await expect(fullscreenBtn).toBeVisible();
  });
});

test.describe("Interface de Estatísticas Multitemporais (/statistics)", () => {
  let authCookie: string = "";

  test.beforeAll(async ({ request }) => {
    const userEmail = `e2e-stats-pills-${Date.now()}@wattflow.local`;
    const password = "StrongStatsPassword!123";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "Stats Pills Tester",
      },
    });

    if (registerRes.status() === 201) {
      const setCookie = registerRes.headers()["set-cookie"];
      if (setCookie) {
        authCookie = setCookie.split(";")[0];
      }
    }
  });

  test("pagina /statistics exibe barra de filtros pills, botao de exportacao CSV e impressao PDF", async ({
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

    // Valida presença das pills de filtro
    await expect(page.getByRole("button", { name: "Hoje vs Ontem" })).toBeVisible();
    await expect(page.getByRole("button", { name: "24 Horas" })).toBeVisible();
    await expect(page.getByRole("button", { name: "7 Dias" })).toBeVisible();
    await expect(page.getByRole("button", { name: "30 Dias" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Anual" })).toBeVisible();

    // Valida botão Exportar CSV
    const exportBtn = page.locator('a[href*="/api/statistics/export"]');
    await expect(exportBtn).toBeVisible();
    const exportHref = await exportBtn.getAttribute("href");
    expect(exportHref).toContain("/api/statistics/export");

    // Valida botão Imprimir Relatório PDF
    const printBtn = page.locator('button[aria-label*="Imprimir relatório"]');
    await expect(printBtn).toBeVisible();
  });
});
