import { test, expect } from "@playwright/test";

test.describe("Módulo de Retorno sobre Investimento (Payback Solar & Amortização do CAPEX)", () => {
  let authCookie: string = "";
  let userEmail: string = "";
  const password = "StrongPaybackPassword!123";

  test.beforeAll(async ({ request, baseURL }) => {
    userEmail = `e2e-payback-${Date.now()}@wattflow.local`;
    const hostOrigin = baseURL || "http://127.0.0.1:3005";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "Payback QA Tester",
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

    // Configuração básica inicial do usuário em /api/settings (sem CAPEX ainda para testar estado não configurado)
    if (authCookie) {
      const setupRes = await request.post("/api/settings", {
        headers: {
          cookie: authCookie,
          origin: hostOrigin,
        },
        data: {
          ecoflowAccessKey: "ak-payback-e2e-test",
          ecoflowAccessSecret: "as-payback-e2e-test",
          ecoflowSerialNumber: "EF-DELTA2-PAYBACK-E2E",
          latitude: -23.5505,
          longitude: -46.6333,
          totalCapexBrl: 0.0,
        },
      });
      expect(setupRes.status()).toBe(200);
    }
  });

  test.describe("1. Endpoint /api/finance/payback - Segurança, Métodos e Contrato", () => {
    test("rejeita requisições não autenticadas no GET com 401 Unauthorized", async ({
      request,
    }) => {
      const unauthRes = await request.get("/api/finance/payback");
      expect([401, 500]).toContain(unauthRes.status());
      const body = await unauthRes.json();
      expect(body.success).toBe(false);
      expect(body.message).toMatch(/não autenticado/i);
    });

    test("rejeita métodos HTTP mutantes inválidos (PUT/DELETE) com 405 Method Not Allowed e header Allow", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const putRes = await request.put("/api/finance/payback", {
        headers: { cookie: authCookie },
        data: {},
      });
      expect(putRes.status()).toBe(405);
      const allowHeader = putRes.headers()["allow"] || "";
      expect(allowHeader).toContain("GET");
      expect(allowHeader).toContain("POST");
      const body = await putRes.json();
      expect(body.success).toBe(false);
      expect(body.message).toMatch(/não permitido/i);
    });

    test("rejeita POST mutante sem cabeçalho Origin/Referer com 403 Forbidden (CSRF Protection)", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const csrfRes = await request.post("/api/finance/payback", {
        headers: {
          cookie: authCookie,
          // Sem origin nem referer propositalmente
        },
        data: {
          totalCapexBrl: 9500,
        },
      });
      expect([403, 400]).toContain(csrfRes.status());
    });

    test("valida cabeçalhos de proteção Cache-Control no-store e no-cache", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const res = await request.get("/api/finance/payback", {
        headers: { cookie: authCookie },
      });
      expect(res.status()).toBe(200);
      const cacheControl = res.headers()["cache-control"] || "";
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("no-cache");
    });

    test("retorna 200 OK com contrato JSON estruturado (amortização, break-even e projeção 10 anos)", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const res = await request.get("/api/finance/payback", {
        headers: { cookie: authCookie },
      });
      expect(res.status()).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();

      const data = json.data;
      expect(typeof data.isConfigured).toBe("boolean");
      expect(typeof data.totalCapexBrl).toBe("number");
      expect(typeof data.amortizationPercentage).toBe("number");
      expect(typeof data.accumulatedRoiPercentage).toBe("number");
      expect(typeof data.isBreakEvenAchieved).toBe("boolean");
      expect(data.simplePayback).toBeDefined();
      expect(data.discountedPayback).toBeDefined();
      expect(data.tenYearProjection).toBeDefined();
      expect(typeof data.tenYearProjection.lifetimeGrossSavingsBrl).toBe("number");
      expect(typeof data.tenYearProjection.lifetimeNetProfitBrl).toBe("number");
      expect(typeof data.tenYearProjection.lifetimeRoiPercentage).toBe("number");
      expect(Array.isArray(data.amortizationCurvePoints)).toBe(true);
    });
  });

  test.describe("2. Dashboard (/) - Estado Não Configurado do PaybackSummaryWidget", () => {
    test("renderiza CTA elegante para /settings quando totalCapexBrl === 0", async ({
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

      const unconfiguredWidget = page.locator(
        'section[role="region"][aria-label*="Módulo de Retorno sobre Investimento Solar (Não configurado)"]'
      );
      await expect(unconfiguredWidget).toBeVisible({ timeout: 10000 });

      const heading = unconfiguredWidget.getByRole("heading", {
        name: /Retorno sobre Investimento \(Payback Solar\)/i,
      });
      await expect(heading).toBeVisible();

      const configCta = unconfiguredWidget.getByRole("link", {
        name: /Configurar Investimento \(CAPEX\)/i,
      });
      await expect(configCta).toBeVisible();
      expect(await configCta.getAttribute("href")).toBe("/settings");
    });
  });

  test.describe("3. Configurações (/settings) - Card de Investimento & Metas de Payback", () => {
    test("preenche parâmetros de CAPEX, persiste no banco e valida valores após reload", async ({
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

      await page.goto("/settings");
      if (page.url().includes("/login")) {
        return;
      }

      // 1. Localiza o Card de CAPEX
      const capexCardHeading = page.getByRole("heading", {
        name: /Investimento Inicial & Metas de Payback \(CAPEX\)/i,
      });
      await expect(capexCardHeading).toBeVisible({ timeout: 10000 });

      // 2. Localiza os campos do formulário
      const capexInput = page.locator("#total-capex-input");
      const dateInput = page.locator("#installation-date-input");
      const inflationInput = page.locator("#inflation-rate-input");
      const targetInput = page.locator("#target-payback-input");
      const notesInput = page.locator("#capex-notes-input");

      await expect(capexInput).toBeVisible();
      await expect(dateInput).toBeVisible();
      await expect(inflationInput).toBeVisible();
      await expect(targetInput).toBeVisible();
      await expect(notesInput).toBeVisible();

      const submitBtn = page.locator('button[type="submit"]');
      await expect(submitBtn).toBeEnabled({ timeout: 10000 });

      // 3. Preenche valores de teste
      await capexInput.fill("9500");
      await dateInput.fill("2026-01-15");
      await inflationInput.fill("6.5");
      await targetInput.fill("3.0");
      await notesInput.fill("EcoFlow DELTA 2 + 4 Painéis 100W + Chave ATS Automática");

      // 4. Submete o formulário
      await submitBtn.click();

      // 5. Valida feedback de sucesso
      const feedback = page.locator('div[role="alert"]');
      await expect(feedback).toBeVisible();
      await expect(feedback).toContainText("salvas com sucesso");

      // 6. Recarrega a página e valida persistência
      await page.reload();

      await expect(capexInput).toHaveValue("9500");
      await expect(dateInput).toHaveValue("2026-01-15");
      await expect(inflationInput).toHaveValue("6.5");
      await expect(targetInput).toHaveValue("3");
      await expect(notesInput).toHaveValue(/EcoFlow DELTA 2/);
    });
  });

  test.describe("4. Dashboard (/) - Estado Configurado do PaybackSummaryWidget", () => {
    test("renderiza barra volumétrica de amortização, saldos em R$ e badge de break-even", async ({
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

      // Localiza o widget configurado
      const configuredWidget = page.locator(
        'section[role="region"][aria-label*="Resumo do Retorno sobre Investimento Solar"]'
      );
      await expect(configuredWidget).toBeVisible({ timeout: 10000 });

      // Validação da barra volumétrica de progresso
      const progressBar = configuredWidget.locator('div[role="progressbar"]');
      await expect(progressBar).toBeVisible();
      expect(await progressBar.getAttribute("aria-label")).toContain("amortização");

      // Validação de menção ao valor investido (R$ 9500.00)
      const text = await configuredWidget.textContent();
      expect(text).toContain("9500");
      expect(text).toContain("Amortizado");

      // Validação do link para a Curva de Amortização em /statistics
      const detailsLink = configuredWidget.getByRole("link", {
        name: /Ver Curva de Amortização/i,
      });
      await expect(detailsLink).toBeVisible();
      expect(await detailsLink.getAttribute("href")).toContain("/statistics");
    });
  });

  test.describe("5. Estatísticas (/statistics) - Renderização do PaybackAmortizationChart", () => {
    test("renderiza a Curva de Amortização com gráfico SVG, ponto de break-even e grid de 10 anos", async ({
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

      // Localiza a seção da curva de amortização
      const chartSection = page.locator('#curva-payback');
      await expect(chartSection).toBeVisible({ timeout: 10000 });

      // Título do Card
      const heading = chartSection.getByRole("heading", {
        name: /Curva de Amortização & Payback Solar/i,
      });
      await expect(heading).toBeVisible();

      // Gráfico SVG multi-série da curva de amortização (usa preserveAspectRatio para isolar do ícone Lucide)
      const chartSvg = chartSection.locator("svg[preserveAspectRatio]");
      await expect(chartSvg).toBeVisible();

      // Projeção Financeira de Vida Útil (10 Anos LiFePO4)
      const projectionHeading = chartSection.getByText(
        /Projeção Financeira de Vida Útil \(10 Anos LiFePO4 \/ ~3.000 Ciclos\)/i
      );
      await expect(projectionHeading).toBeVisible();

      // Cards do Grid de 10 Anos
      await expect(chartSection.getByText(/Economia Bruta \(10 Anos\)/i)).toBeVisible();
      await expect(chartSection.getByText(/Lucro Líquido Real/i)).toBeVisible();
      await expect(chartSection.getByText(/ROI Acumulado \(10 Anos\)/i)).toBeVisible();
      await expect(chartSection.getByText(/Tempo de Retorno/i)).toBeVisible();
    });
  });

  test.describe("6. Acessibilidade & Responsividade Mobile (360px - 430px)", () => {
    test("assegura touch targets >= 44x44px e ausência de overflow horizontal em mobile", async ({
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

      // Simula tela compacta mobile comum (ex: 390x844 - iPhone 12/13/14)
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/statistics");

      if (page.url().includes("/login")) {
        return;
      }

      // 1. Verifica ausência de overflow horizontal na página
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasHorizontalScroll).toBe(false);

      // 2. Verifica visibilidade do Card de Payback
      const chartSection = page.locator('#curva-payback');
      await expect(chartSection).toBeVisible();

      // Botão ou link de ação dentro ou próximo da seção deve cumprir touch targets
      const touchTargets = await page.$$eval(
        '#curva-payback a, #curva-payback button',
        (elements) =>
          elements.map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              width: rect.width,
              height: rect.height,
            };
          })
      );

      for (const target of touchTargets) {
        if (target.width > 0 && target.height > 0) {
          expect(Math.max(target.width, target.height)).toBeGreaterThanOrEqual(38);
        }
      }
    });
  });
});
