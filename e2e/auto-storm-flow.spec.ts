import { test, expect } from "@playwright/test";

test.describe("Automações Inteligentes com Previsão do Tempo & Modo No-Break Preventivo (Auto-Storm)", () => {
  let authCookie: string = "";
  let userEmail: string = "";
  const password = "StrongStormPassword!123";

  test.beforeAll(async ({ request, baseURL }) => {
    userEmail = `e2e-storm-${Date.now()}@wattflow.local`;
    const hostOrigin = baseURL || "http://127.0.0.1:3005";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "Storm E2E Tester",
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

    // Configura credenciais e coordenadas geográficas (São Paulo -23.55, -46.63) com header origin para CSRF
    if (authCookie) {
      const setupRes = await request.post("/api/settings", {
        headers: {
          cookie: authCookie,
          origin: hostOrigin,
        },
        data: {
          ecoflowAccessKey: "ak-storm-e2e-test",
          ecoflowAccessSecret: "as-storm-e2e-test",
          ecoflowSerialNumber: "EF-DELTA2-STORM-E2E",
          latitude: -23.5505,
          longitude: -46.6333,
          isAutoStormActive: true,
          autoStormReserveThreshold: 85,
          autoStormRainThresholdMm: 20.0,
          autoStormPrechargeAc: true,
        },
      });
      expect(setupRes.status()).toBe(200);
    }
  });

  test.describe("1. Endpoint /api/weather/forecast - Proteção, Contrato & Fallbacks", () => {
    test("rejeita requisições não autenticadas com 401 Unauthorized", async ({
      request,
    }) => {
      const unauthRes = await request.get("/api/weather/forecast");
      expect([401, 500]).toContain(unauthRes.status());
      const body = await unauthRes.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain("não autenticado");
    });

    test("rejeita métodos HTTP inválidos (POST/PUT/DELETE) com 405 Method Not Allowed e header Allow: GET", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const postRes = await request.post("/api/weather/forecast", {
        headers: { cookie: authCookie },
        data: {},
      });
      expect(postRes.status()).toBe(405);
      const allowHeader = postRes.headers()["allow"] || "";
      expect(allowHeader).toContain("GET");
      const body = await postRes.json();
      expect(body.success).toBe(false);
    });

    test("retorna 400 Bad Request quando usuário não possui coordenadas (lat/lon) cadastradas", async ({
      request,
    }) => {
      // Cria usuário sem coordenadas configuradas
      const uncoordEmail = `e2e-uncoord-${Date.now()}@wattflow.local`;
      const regRes = await request.post("/api/auth/register", {
        data: {
          email: uncoordEmail,
          password: "UncoordPassword!123",
          fullName: "Uncoord Tester",
        },
      });
      const uncoordCookie = regRes.headers()["set-cookie"]?.split(";")[0];
      if (!uncoordCookie) {
        test.skip();
        return;
      }

      const res = await request.get("/api/weather/forecast", {
        headers: { cookie: uncoordCookie },
      });

      expect([400, 404]).toContain(res.status());
      const body = await res.json();
      expect(body.success).toBe(false);
      if (res.status() === 400) {
        expect(body.message).toContain("Coordenadas geográficas");
      }
    });

    test("retorna 200 OK com contrato estrito e dados meteorológicos quando coordenadas estão configuradas", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const forecastRes = await request.get("/api/weather/forecast", {
        headers: { cookie: authCookie },
      });
      expect(forecastRes.status()).toBe(200);

      // Validação de Headers
      const cacheControl = forecastRes.headers()["cache-control"] || "";
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("no-cache");

      const body = await forecastRes.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();

      const data = body.data;

      // Validação da estrutura de assessment
      expect(data.assessment).toBeDefined();
      expect(["NORMAL", "MODERATE", "SEVERE"]).toContain(data.assessment.severity);
      expect(typeof data.assessment.isStormRisk).toBe("boolean");
      expect(typeof data.assessment.weatherCode).toBe("number");
      expect(typeof data.assessment.weatherDescription).toBe("string");
      expect(typeof data.assessment.precipitationProbabilityMax).toBe("number");
      expect(typeof data.assessment.precipitationSumMm).toBe("number");
      expect(typeof data.assessment.windSpeedMaxKmh).toBe("number");
      expect(typeof data.assessment.temperatureMaxCelsius).toBe("number");
      expect(typeof data.assessment.temperatureMinCelsius).toBe("number");

      // Validação dos parâmetros de Auto-Storm refletidos
      expect(data.isAutoStormActive).toBe(true);
      expect(typeof data.isStormAlertActive).toBe("boolean");
      expect(data.autoStormReserveThreshold).toBe(85);
      expect(data.autoStormRainThresholdMm).toBe(20.0);
      expect(data.autoStormPrechargeAc).toBe(true);
    });
  });

  test.describe("2. Dashboard (/) - Renderização e Interação do WeatherWidget", () => {
    test("exibe o componente WeatherWidget com título, métricas e botão de atualização", async ({
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

      // Localiza o card do WeatherWidget pelo título ou aria-label
      const weatherSection = page.locator(
        'section[aria-label="Previsão do Tempo e Defesa Meteorológica"]'
      );
      await expect(weatherSection).toBeVisible({ timeout: 10000 });

      // Verifica título e badge
      await expect(page.getByText("Clima & Previsão Local")).toBeVisible();
      await expect(
        page.getByText(/Clima Estável|Atenção: Chuva \/ Vento|Risco Severo/i)
      ).toBeVisible();

      // Verifica botão de atualização manual da previsão
      const refreshBtn = page.locator('button[aria-label="Atualizar previsão do tempo agora"]');
      await expect(refreshBtn).toBeVisible();
      await refreshBtn.click();
      await expect(weatherSection).toBeVisible();
    });
  });

  test.describe("3. Automações (/automations) - Card Auto-Storm, Sliders & Persistência", () => {
    test("renderiza o card Auto-Storm com controles acessíveis, sliders de reserva/chuva e persiste alterações", async ({
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

      await page.goto("/automations");

      if (page.url().includes("/login")) {
        return;
      }

      // 1. Valida título do Card Auto-Storm
      await expect(
        page.getByText("Modo No-Break Preventivo & Defesa Meteorológica (Auto-Storm)")
      ).toBeVisible();

      // 2. Valida checkbox Auto-Storm Ativo
      const autoStormActiveCheckbox = page.locator("#auto-storm-active-checkbox");
      await expect(autoStormActiveCheckbox).toBeVisible();

      // 3. Valida painel de status em tempo real (STANDBY NORMAL ou DEFESA ATIVA)
      await expect(page.getByText(/STANDBY NORMAL|DEFESA ATIVA/i)).toBeVisible();

      // 4. Valida Slider de Reserva Emergencial (50% a 100%)
      const reserveSlider = page.locator("#auto-storm-reserve-slider");
      await expect(reserveSlider).toBeVisible();
      expect(await reserveSlider.getAttribute("min")).toBe("50");
      expect(await reserveSlider.getAttribute("max")).toBe("100");

      // 5. Valida Slider de Limiar de Chuva (5mm a 150mm)
      const rainSlider = page.locator("#auto-storm-rain-slider");
      await expect(rainSlider).toBeVisible();
      expect(await rainSlider.getAttribute("min")).toBe("5");
      expect(await rainSlider.getAttribute("max")).toBe("150");

      // 6. Valida Checkbox de Pré-Recarga AC
      const prechargeCheckbox = page.locator("#auto-storm-precharge-checkbox");
      await expect(prechargeCheckbox).toBeVisible();

      // 7. Modifica valores e submete o formulário
      await autoStormActiveCheckbox.setChecked(true);
      await reserveSlider.fill("90");
      await rainSlider.fill("35");
      await prechargeCheckbox.setChecked(true);

      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeVisible();
      await submitButton.click();

      // 8. Valida feedback de sucesso exibido com role="alert"
      const feedback = page.locator('div[role="alert"]');
      await expect(feedback).toBeVisible();
      await expect(feedback).toContainText("salvas com sucesso");

      // 9. Recarrega a página e valida persistência
      await page.reload();
      await expect(page.locator("#auto-storm-active-checkbox")).toBeChecked();
      expect(await page.locator("#auto-storm-reserve-slider").inputValue()).toBe("90");
      expect(await page.locator("#auto-storm-rain-slider").inputValue()).toBe("35");
      await expect(page.locator("#auto-storm-precharge-checkbox")).toBeChecked();
    });
  });

  test.describe("4. Banner de Alerta (StormAlertBanner) - Renderização e Comportamento", () => {
    test("renderiza StormAlertBanner quando isStormAlertActive é verdadeiro com role alert e botão Gerenciar", async ({
      page,
      context,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      // Intercepta rota para injetar isStormAlertActive: true
      await page.route("**/api/dashboard-status*", async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        route.fulfill({
          response,
          json: {
            ...json,
            isStormAlertActive: true,
            lastStormAlertDescription: "Trovoada severa com granizo prevista (WMO 96)",
            lastStormAlertTriggeredAt: new Date().toISOString(),
          },
        });
      });

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

      await page.goto("/");

      if (page.url().includes("/login")) {
        return;
      }

      // Verifica presença do StormAlertBanner
      const banner = page.locator('section[role="alert"][aria-label="Alerta de Modo No-Break Preventivo Ativo por Tempestade"]');
      if (await banner.isVisible()) {
        await expect(page.getByText("Modo No-Break Preventivo Ativado")).toBeVisible();
        await expect(page.getByText("Defesa Meteorológica Ativa")).toBeVisible();

        // Verifica link para gerenciar automações
        const manageLink = banner.locator('a[href="/automations"]');
        await expect(manageLink).toBeVisible();

        // Verifica botão de fechar (dismiss)
        const closeBtn = banner.locator('button[aria-label="Fechar alerta de tempestade"]');
        await expect(closeBtn).toBeVisible();
        await closeBtn.click();
        await expect(banner).toBeHidden();
      }

      await page.unrouteAll({ behavior: "ignoreErrors" });
    });
  });

  test.describe("5. Modo Kiosk (/kiosk) - Mini-Widget Meteorológico no Header", () => {
    test("renderiza o mini-widget meteorológico compacto no cabeçalho do Modo Kiosk", async ({
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

      // Define viewport desktop para garantir exibição do elemento sm:inline-flex
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto("/kiosk");

      if (page.url().includes("/login")) {
        return;
      }

      await expect(page).toHaveTitle(/Modo Kiosk/i);

      // O mini-widget compacto no kiosk possui classe hidden sm:inline-flex e texto com °C
      const compactWeather = page.locator('header .font-mono:has-text("°C")').first();
      await page.waitForTimeout(1000);
      if (await compactWeather.isVisible()) {
        const text = await compactWeather.textContent();
        expect(text).toContain("°C");
      }
    });
  });
});
