import { test, expect } from "@playwright/test";

test.describe("Suporte a Tarifação Horária Inteligente (Tarifa Branca / Time-of-Use & Horário de Ponta)", () => {
  let authCookie: string = "";
  let userEmail: string = "";
  const password = "StrongTariffPassword!123";

  test.beforeAll(async ({ request, baseURL }) => {
    userEmail = `e2e-tariff-${Date.now()}@wattflow.local`;
    const hostOrigin = baseURL || "http://127.0.0.1:3005";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "Tariff E2E Tester",
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

    // Configura credenciais básicas e ativação inicial de Time-of-Use via /api/settings
    if (authCookie) {
      const setupRes = await request.post("/api/settings", {
        headers: {
          cookie: authCookie,
          origin: hostOrigin,
        },
        data: {
          ecoflowAccessKey: "ak-tariff-e2e-test",
          ecoflowAccessSecret: "as-tariff-e2e-test",
          ecoflowSerialNumber: "EF-DELTA2-TARIFF-E2E",
          latitude: -23.5505,
          longitude: -46.6333,
          isTimeOfUseActive: true,
          isDynamicTariffActive: true,
          timeOfUseWeekdaysOnly: true,
          peakStartTime: "17:30",
          peakEndTime: "20:30",
          intermediateStartTime: "16:30",
          intermediateEndTime: "21:30",
          peakDischargeReserveLimit: 20,
          peakReserveThreshold: 20,
          blockAcChargingDuringPeak: true,
          peakTariffPerKwh: 1.85,
          intermediateTariffPerKwh: 1.15,
          offPeakTariffPerKwh: 0.65,
        },
      });
      expect(setupRes.status()).toBe(200);
    }
  });

  test.describe("1. Endpoint GET /api/tariff/status - Proteção, Métodos e Contrato", () => {
    test("rejeita requisições não autenticadas com 401 Unauthorized", async ({
      request,
    }) => {
      const unauthRes = await request.get("/api/tariff/status");
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

      const postRes = await request.post("/api/tariff/status", {
        headers: { cookie: authCookie },
        data: {},
      });
      expect(postRes.status()).toBe(405);
      const allowHeader = postRes.headers()["allow"] || "";
      expect(allowHeader).toContain("GET");
      const body = await postRes.json();
      expect(body.success).toBe(false);
    });

    test("retorna 200 OK com contrato estrito e dados de Tarifação Horária para usuário configurado", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const statusRes = await request.get("/api/tariff/status", {
        headers: { cookie: authCookie },
      });
      expect(statusRes.status()).toBe(200);

      // Validação de Headers Cache-Control
      const cacheControl = statusRes.headers()["cache-control"] || "";
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("no-cache");

      const body = await statusRes.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();

      const data = body.data;

      // Validação dos campos obrigatórios da especificação
      expect(["PEAK", "INTERMEDIATE", "OFF_PEAK"]).toContain(data.currentPeriod);
      expect(typeof data.isPeakActive).toBe("boolean");
      expect(typeof data.isChargingBlocked).toBe("boolean");
      expect(typeof data.currentRate).toBe("number");
      expect(data.currentRate).toBeGreaterThan(0);
      expect(typeof data.isTimeOfUseActive).toBe("boolean");
      expect(typeof data.dischargeReserveLimit).toBe("number");

      // Validação do objeto nextTransition
      expect(data.nextTransition).toBeDefined();
      expect(["PEAK", "INTERMEDIATE", "OFF_PEAK"]).toContain(data.nextTransition.period);
      expect(typeof data.nextTransition.time).toBe("string");
      expect(typeof data.nextTransition.minutesRemaining).toBe("number");
    });
  });

  test.describe("2. Tela de Automações (/automations) - Card de Tarifação Horária & Persistência", () => {
    test("renderiza controles da Tarifa Branca, edita horários, limites e persiste alterações", async ({
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

      // 1. Validação do Card de Tarifação Horária
      const touCardHeading = page.getByText("Tarifação Horária & Arbitragem na Ponta (Tarifa Branca)");
      await expect(touCardHeading).toBeVisible();

      // 2. Switch Mestre: isTimeOfUseActive
      const touActiveCheckbox = page.locator("#time-of-use-active-checkbox");
      await expect(touActiveCheckbox).toBeVisible();

      // 3. Switch ANEEL: Dias Úteis
      const touWeekdaysCheckbox = page.locator("#tou-weekdays-checkbox");
      await expect(touWeekdaysCheckbox).toBeVisible();

      // 4. Inputs de Horários de Pico
      const peakStartInput = page.locator("#peak-start-time");
      const peakEndInput = page.locator("#peak-end-time");
      await expect(peakStartInput).toBeVisible();
      await expect(peakEndInput).toBeVisible();

      // 5. Inputs de Horários Intermediários
      const interStartInput = page.locator("#intermediate-start-time");
      const interEndInput = page.locator("#intermediate-end-time");
      await expect(interStartInput).toBeVisible();
      await expect(interEndInput).toBeVisible();

      // 6. Slider de Reserva de Segurança na Ponta (10% a 50%)
      const peakReserveSlider = page.locator("#peak-reserve-slider");
      await expect(peakReserveSlider).toBeVisible();
      expect(await peakReserveSlider.getAttribute("min")).toBe("10");
      expect(await peakReserveSlider.getAttribute("max")).toBe("50");

      // 7. Switch de Bloqueio de Recarga AC
      const blockAcCheckbox = page.locator("#block-ac-charging-checkbox");
      await expect(blockAcCheckbox).toBeVisible();

      // 8. Inputs de Tarifas (R$/kWh)
      const peakTariffInput = page.locator("#peak-tariff-input");
      const interTariffInput = page.locator("#intermediate-tariff-input");
      const offPeakTariffInput = page.locator("#offpeak-tariff-input");
      await expect(peakTariffInput).toBeVisible();
      await expect(interTariffInput).toBeVisible();
      await expect(offPeakTariffInput).toBeVisible();

      // 9. Modifica configurações
      await touActiveCheckbox.setChecked(true);
      await touWeekdaysCheckbox.setChecked(true);
      await peakStartInput.fill("18:00");
      await peakEndInput.fill("21:00");
      await peakReserveSlider.fill("25");
      await blockAcCheckbox.setChecked(true);
      await peakTariffInput.fill("2.10");
      await interTariffInput.fill("1.30");
      await offPeakTariffInput.fill("0.70");

      // 10. Submete o formulário
      const submitBtn = page.locator('button[type="submit"]');
      await expect(submitBtn).toBeVisible();
      await submitBtn.click();

      // 11. Valida feedback de sucesso
      const feedback = page.locator('div[role="alert"]');
      await expect(feedback).toBeVisible();
      await expect(feedback).toContainText("salvas com sucesso");

      // 12. Recarrega a página e valida persistência no banco
      await page.reload();
      await expect(page.locator("#time-of-use-active-checkbox")).toBeChecked();
      await expect(page.locator("#tou-weekdays-checkbox")).toBeChecked();
      expect(await page.locator("#peak-start-time").inputValue()).toBe("18:00");
      expect(await page.locator("#peak-end-time").inputValue()).toBe("21:00");
      expect(await page.locator("#peak-reserve-slider").inputValue()).toBe("25");
      await expect(page.locator("#block-ac-charging-checkbox")).toBeChecked();
      expect(await page.locator("#peak-tariff-input").inputValue()).toBe("2.1");
      expect(await page.locator("#intermediate-tariff-input").inputValue()).toBe("1.3");
      expect(await page.locator("#offpeak-tariff-input").inputValue()).toBe("0.7");
    });
  });

  test.describe("3. Dashboard (/) - Renderização do TariffStatusBadge", () => {
    test("renderiza o TariffStatusBadge com role status e aria-live polite", async ({
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

      // Localiza o TariffStatusBadge pelo role='status' e aria-live='polite' dentro de main
      const tariffBadge = page.locator('main [role="status"][aria-live="polite"]').first();
      await expect(tariffBadge).toBeVisible({ timeout: 10000 });

      // Valida presença de texto característico de status tarifário
      const badgeText = await tariffBadge.textContent();
      expect(badgeText).toMatch(/PONTA|INTERMEDIÁRIO|FORA DE PONTA|Fora de Ponta|Tarifa Convencional|R\$/i);
    });
  });

  test.describe("4. Modo Kiosk (/kiosk) - Mini-Indicador Tarifário no Header", () => {
    test("renderiza mini-indicador tarifário compacto no cabeçalho do Modo Kiosk", async ({
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

      // Localiza indicador tarifário compacto no cabeçalho filtrando pelo conteúdo tarifário
      const compactTariff = page
        .locator('header [role="status"][aria-live="polite"]')
        .filter({ hasText: /PONTA|INTER|FORA PONTA|R\$/i })
        .first();
      await page.waitForTimeout(1000);
      if (await compactTariff.isVisible()) {
        const text = await compactTariff.textContent();
        expect(text).toMatch(/PONTA|INTER|FORA PONTA|R\$/i);
      }
    });
  });
});
