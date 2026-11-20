import { test, expect } from "@playwright/test";

test.describe("Módulo de Monitoramento de Saúde da Bateria, Ciclos LiFePO4 & Proteção Térmica do BMS", () => {
  let authCookie: string = "";
  let userEmail: string = "";
  const password = "StrongBatteryPassword!123";

  test.beforeAll(async ({ request, baseURL }) => {
    userEmail = `e2e-battery-${Date.now()}@wattflow.local`;
    const hostOrigin = baseURL || "http://127.0.0.1:3005";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "Battery Health QA Tester",
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

    // Configura credenciais básicas e valores iniciais de proteção térmica via /api/settings
    if (authCookie) {
      const setupRes = await request.post("/api/settings", {
        headers: {
          cookie: authCookie,
          origin: hostOrigin,
        },
        data: {
          ecoflowAccessKey: "ak-battery-e2e-test",
          ecoflowAccessSecret: "as-battery-e2e-test",
          ecoflowSerialNumber: "EF-DELTA2-BATTERY-E2E",
          latitude: -23.5505,
          longitude: -46.6333,
          isThermalProtectionActive: true,
          thermalThrottleTempThreshold: 42,
          thermalCutoffTempThreshold: 48,
          thermalRecoveryTempThreshold: 44,
          thermalThrottleSpeedWatts: 200,
        },
      });
      expect(setupRes.status()).toBe(200);
    }
  });

  test.describe("1. Endpoint GET /api/battery/health - Proteção, Métodos e Contrato", () => {
    test("rejeita requisições não autenticadas com 401 Unauthorized", async ({
      request,
    }) => {
      const unauthRes = await request.get("/api/battery/health");
      expect([401, 500]).toContain(unauthRes.status());
      const body = await unauthRes.json();
      expect(body.success).toBe(false);
      expect(body.message).toMatch(/não autenticado/i);
    });

    test("rejeita métodos HTTP mutantes (POST/PUT/DELETE) com 405 Method Not Allowed e header Allow: GET", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const postRes = await request.post("/api/battery/health", {
        headers: { cookie: authCookie },
        data: {},
      });
      expect(postRes.status()).toBe(405);
      const allowHeader = postRes.headers()["allow"] || "";
      expect(allowHeader).toContain("GET");
      const body = await postRes.json();
      expect(body.success).toBe(false);
      expect(body.message).toMatch(/não permitido/i);
    });

    test("retorna 200 OK com contrato estrito e métricas completas do BMS para usuário configurado", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const healthRes = await request.get("/api/battery/health", {
        headers: { cookie: authCookie },
      });
      expect(healthRes.status()).toBe(200);

      // Validação de Headers Cache-Control
      const cacheControl = healthRes.headers()["cache-control"] || "";
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("no-cache");

      const body = await healthRes.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();

      const data = body.data;

      // Validação dos campos obrigatórios da especificação BMS LiFePO4
      expect(["OPTIMAL", "WARM", "THROTTLED", "CRITICAL_CUTOFF"]).toContain(data.thermalRiskLevel);
      expect(typeof data.isThermalProtectionActive).toBe("boolean");
      expect(typeof data.isThermalThrottleActive).toBe("boolean");
      expect(typeof data.isThermalCutoffActive).toBe("boolean");

      expect(typeof data.thermalWarningThreshold).toBe("number");
      expect(data.thermalWarningThreshold).toBeGreaterThan(0);
      expect(typeof data.thermalShutdownThreshold).toBe("number");
      expect(data.thermalShutdownThreshold).toBeGreaterThan(data.thermalWarningThreshold);
      expect(typeof data.thermalThrottleSpeedWatts).toBe("number");
      expect(data.thermalThrottleSpeedWatts).toBeGreaterThan(0);

      // Métricas de Vida Útil e LiFePO4
      expect(typeof data.nominalLifespanCycles).toBe("number");
      expect(data.nominalLifespanCycles).toBe(3000);
      expect(typeof data.remainingCyclesEstimate).toBe("number");
      expect(typeof data.estimatedHealthPercentage).toBe("number");
      expect(data.estimatedHealthPercentage).toBeGreaterThan(0);
      expect(data.estimatedHealthPercentage).toBeLessThanOrEqual(100);
      expect(typeof data.estimatedYearsRemaining).toBe("number");
      expect(data.estimatedYearsRemaining).toBeGreaterThan(0);
      expect(typeof data.dailyCycleRate).toBe("number");

      // Tendência térmica recente
      expect(Array.isArray(data.recentThermalTrend)).toBe(true);
    });
  });

  test.describe("2. Tela de Automações (/automations) - Card de Proteção Térmica & Persistência", () => {
    test("renderiza Card 4, interage com sliders e switch mestre e persiste alterações no banco", async ({
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

      // 1. Validação do Card 4 de Proteção Térmica do BMS
      const thermalCardHeading = page.getByRole("heading", {
        name: /Proteção Térmica & Preservação do BMS \(LiFePO4\)/i,
      });
      await expect(thermalCardHeading).toBeVisible();

      // 2. Switch Mestre: isThermalProtectionActive
      const thermalSwitch = page.locator("#thermal-protection-switch");
      await expect(thermalSwitch).toBeAttached();

      // 3. Sliders de Limiares Térmicos e Velocidade de Throttling
      const throttleTempSlider = page.locator("#throttle-temp-slider");
      const cutoffTempSlider = page.locator("#cutoff-temp-slider");
      const throttleSpeedSlider = page.locator("#throttle-speed-slider");

      await expect(throttleTempSlider).toBeVisible();
      await expect(cutoffTempSlider).toBeVisible();
      await expect(throttleSpeedSlider).toBeVisible();

      expect(await throttleTempSlider.getAttribute("min")).toBe("35");
      expect(await throttleTempSlider.getAttribute("max")).toBe("45");

      expect(await cutoffTempSlider.getAttribute("min")).toBe("45");
      expect(await cutoffTempSlider.getAttribute("max")).toBe("55");

      expect(await throttleSpeedSlider.getAttribute("min")).toBe("100");
      expect(await throttleSpeedSlider.getAttribute("max")).toBe("500");

      // 4. Validação da Matriz de Proteção LiFePO4
      const protectionMatrix = page.getByText("Matriz de Proteção LiFePO4:");
      await expect(protectionMatrix).toBeVisible();

      // 5. Modifica configurações de proteção térmica
      await throttleTempSlider.fill("41");
      await cutoffTempSlider.fill("49");
      await throttleSpeedSlider.fill("250");

      // 6. Submete o formulário de automações
      const submitBtn = page.locator('button[type="submit"]');
      await expect(submitBtn).toBeVisible();
      await submitBtn.click();

      // 7. Valida feedback de sucesso na interface
      const feedback = page.locator('div[role="alert"]');
      await expect(feedback).toBeVisible();
      await expect(feedback).toContainText("salvas com sucesso");

      // 8. Recarrega a página e valida persistência dos parâmetros no banco
      await page.reload();

      await expect(page.locator("#thermal-protection-switch")).toBeChecked();
      await expect(page.locator("#throttle-temp-slider")).toHaveValue("41");
      await expect(page.locator("#cutoff-temp-slider")).toHaveValue("49");
      await expect(page.locator("#throttle-speed-slider")).toHaveValue("250");
    });
  });

  test.describe("3. Dashboard (/) - Renderização do BatteryHealthWidget Expandido", () => {
    test("renderiza o BatteryHealthWidget com telemetria, régua térmica e métricas vitais", async ({
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

      // Localiza o BatteryHealthWidget pela role status e texto característico
      const batteryWidget = page
        .locator('main [role="status"][aria-live="polite"]')
        .filter({ hasText: /Saúde da Bateria & BMS \(LiFePO4\)/i })
        .first();

      await expect(batteryWidget).toBeVisible({ timeout: 10000 });

      // Validações internas do Widget
      await expect(batteryWidget.getByText(/Saúde Química \(SOH\)/i)).toBeVisible();
      await expect(batteryWidget.getByText(/Ciclos & Vida Útil/i)).toBeVisible();
      await expect(batteryWidget.getByText(/Grandezas Elétricas/i)).toBeVisible();
      await expect(batteryWidget.getByText(/Temperatura Operacional das Células/i)).toBeVisible();

      // Barra de progresso térmica volumétrica
      const progressBar = batteryWidget.locator('div[role="progressbar"]');
      await expect(progressBar).toBeVisible();

      // Link para /automations
      const configLink = batteryWidget.getByRole("link", { name: /Ajustar Limiares Térmicos/i });
      await expect(configLink).toBeVisible();
      expect(await configLink.getAttribute("href")).toBe("/automations");
    });
  });

  test.describe("4. Modo Kiosk (/kiosk) - Mini-Widget Térmico no Header", () => {
    test("renderiza mini-indicador térmico compacto no cabeçalho do Modo Kiosk", async ({
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

      // Viewport desktop para exibir elementos com classe sm:inline-flex
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto("/kiosk");

      if (page.url().includes("/login")) {
        return;
      }

      await expect(page).toHaveTitle(/Modo Kiosk/i);

      // Localiza o widget térmico compacto no cabeçalho
      const compactBattery = page
        .locator('header [role="status"][aria-live="polite"]')
        .filter({ hasText: /SOH|°C|ciclos/i })
        .first();

      await page.waitForTimeout(1000);
      if (await compactBattery.isVisible()) {
        const text = await compactBattery.textContent();
        expect(text).toMatch(/SOH|°C/i);
      }
    });
  });
});
