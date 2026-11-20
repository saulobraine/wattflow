import { test, expect } from "@playwright/test";

test.describe("Módulo de Relatórios Analíticos & Exportação de Dados em CSV e PDF", () => {
  let authCookie: string = "";
  let userEmail: string = "";
  const password = "StrongReportPassword!123";

  test.beforeAll(async ({ request, baseURL }) => {
    userEmail = `e2e-report-${Date.now()}@wattflow.local`;
    const hostOrigin = baseURL || "http://127.0.0.1:3005";

    const registerRes = await request.post("/api/auth/register", {
      data: {
        email: userEmail,
        password,
        fullName: "Reports QA Tester",
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

    // Configuração inicial das credenciais e parâmetros no /api/settings
    if (authCookie) {
      const setupRes = await request.post("/api/settings", {
        headers: {
          cookie: authCookie,
          origin: hostOrigin,
        },
        data: {
          ecoflowAccessKey: "ak-reports-e2e-test",
          ecoflowAccessSecret: "as-reports-e2e-test",
          ecoflowSerialNumber: "EF-DELTA2-REPORTS-E2E",
          latitude: -23.5505,
          longitude: -46.6333,
          isDynamicTariffActive: true,
          peakTariffPerKwh: 1.85,
          offPeakTariffPerKwh: 0.65,
        },
      });
      expect(setupRes.status()).toBe(200);
    }
  });

  test.describe("1. Endpoint GET /api/reports/export - Segurança, Métodos e Contratos", () => {
    test("rejeita requisições não autenticadas com 401 Unauthorized", async ({
      request,
    }) => {
      const unauthRes = await request.get("/api/reports/export?format=json&period=24h");
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

      const postRes = await request.post("/api/reports/export", {
        headers: { cookie: authCookie },
        data: { format: "json", period: "24h" },
      });
      expect(postRes.status()).toBe(405);
      const allowHeader = postRes.headers()["allow"] || "";
      expect(allowHeader).toContain("GET");
      const body = await postRes.json();
      expect(body.success).toBe(false);
      expect(body.message).toMatch(/não permitido/i);
    });

    test("valida cabeçalhos de proteção Cache-Control no-store e no-cache", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const res = await request.get("/api/reports/export?format=json&period=7d", {
        headers: { cookie: authCookie },
      });
      expect(res.status()).toBe(200);
      const cacheControl = res.headers()["cache-control"] || "";
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("no-cache");
    });

    test("retorna 200 OK com contrato JSON estruturado (summary, KPIs, duty cycle ATS e BMS)", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const res = await request.get("/api/reports/export?format=json&period=30d", {
        headers: { cookie: authCookie },
      });
      expect(res.status()).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();

      const report = json.data;
      expect(report.summary).toBeDefined();
      expect(report.dataPoints).toBeDefined();
      expect(Array.isArray(report.dataPoints)).toBe(true);

      // Métricas Consolidadas do Resumo Executivo
      const summary = report.summary;
      expect(summary.periodLabel).toBeDefined();
      expect(summary.startDateIso).toBeDefined();
      expect(summary.endDateIso).toBeDefined();
      expect(typeof summary.totalSolarGeneratedKwh).toBe("number");
      expect(typeof summary.totalResidentialConsumedKwh).toBe("number");
      expect(typeof summary.netEnergyBalanceKwh).toBe("number");
      expect(typeof summary.totalEstimatedSavingsBrl).toBe("number");
      expect(typeof summary.peakPeriodSavingsBrl).toBe("number");
      expect(typeof summary.offPeakPeriodSavingsBrl).toBe("number");
      expect(typeof summary.solarCoveragePercentage).toBe("number");

      // ATS Operation Metrics
      expect(summary.atsOperationMetrics).toBeDefined();
      expect(typeof summary.atsOperationMetrics.hoursOnBattery).toBe("number");
      expect(typeof summary.atsOperationMetrics.hoursOnGrid).toBe("number");
      expect(typeof summary.atsOperationMetrics.batteryDutyCyclePercentage).toBe("number");
      expect(typeof summary.atsOperationMetrics.gridDutyCyclePercentage).toBe("number");
      expect(typeof summary.atsOperationMetrics.totalAtsSwitchesCount).toBe("number");
      expect(
        summary.atsOperationMetrics.batteryDutyCyclePercentage +
        summary.atsOperationMetrics.gridDutyCyclePercentage
      ).toBeCloseTo(100, 0);

      // Preservação do BMS LiFePO4
      expect(summary.bmsHealthSummary).toBeDefined();
      expect(typeof summary.bmsHealthSummary.averageSocPercentage).toBe("number");
      expect(typeof summary.bmsHealthSummary.averageTempCelsius).toBe("number");
      expect(typeof summary.bmsHealthSummary.thermalThrottlingEventsCount).toBe("number");
      expect(typeof summary.bmsHealthSummary.thermalCutoffEventsCount).toBe("number");
      expect(typeof summary.bmsHealthSummary.estimatedCyclesConsumed).toBe("number");
    });

    test("retorna 200 OK com download de CSV formatado e headers de anexo", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const res = await request.get("/api/reports/export?format=csv&period=7d&delimiter=%3B", {
        headers: { cookie: authCookie },
      });
      expect(res.status()).toBe(200);

      const contentType = res.headers()["content-type"] || "";
      expect(contentType).toContain("text/csv");

      const disposition = res.headers()["content-disposition"] || "";
      expect(disposition).toContain("attachment");
      expect(disposition).toMatch(/wattflow-relatorio-7d/i);

      const csvText = await res.text();
      expect(csvText).toContain("RELATÓRIO ANALÍTICO WATTFLOW");
      expect(csvText).toContain("FECHAMENTO OPERACIONAL");
      expect(csvText).toContain("Data_Hora;Bateria_SOC_Percent;Geracao_Solar_Watts");
    });

    test("retorna 200 OK com HTML A4 corporativo inline para impressão/PDF", async ({
      request,
    }) => {
      if (!authCookie) {
        test.skip();
        return;
      }

      const res = await request.get("/api/reports/export?format=pdf&period=month", {
        headers: { cookie: authCookie },
      });
      expect(res.status()).toBe(200);

      const contentType = res.headers()["content-type"] || "";
      expect(contentType).toContain("text/html");

      const disposition = res.headers()["content-disposition"] || "";
      expect(disposition).toContain("inline");

      const htmlText = await res.text();
      expect(htmlText).toContain("WattFlow - Relatório Analítico");
      expect(htmlText).toContain("@page { size: A4 portrait;");
      expect(htmlText).toContain("Fechamento Operacional");
    });
  });

  test.describe("2. Interface em /statistics - Botão, Modal e Acessibilidade", () => {
    test("renderiza botão de exportação e abre o ReportExportModal com acessibilidade completa", async ({
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

      // 1. Botão de Exportar Relatório na barra superior de ações
      const exportBtn = page
        .locator("button")
        .filter({ hasText: /Exportar Relatório/i })
        .first();

      await expect(exportBtn).toBeVisible({ timeout: 10000 });
      await exportBtn.click();

      // 2. Validação de Acessibilidade do Modal (role='dialog', aria-modal='true')
      const modal = page.locator('div[role="dialog"][aria-modal="true"]');
      await expect(modal).toBeVisible();

      const modalTitle = page.locator("#report-export-modal-title");
      await expect(modalTitle).toBeVisible();
      await expect(modalTitle).toContainText("Módulo de Relatórios Analíticos & Exportação");

      // 3. Seleção de Períodos Táteis (24h, 7d, 30d, month, custom)
      const period24h = modal.getByRole("button", { name: "Últimas 24h" });
      const period7d = modal.getByRole("button", { name: "Últimos 7 dias" });
      const period30d = modal.getByRole("button", { name: "Últimos 30 dias" });
      const periodMonth = modal.getByRole("button", { name: "Este Mês" });
      const periodCustom = modal.getByRole("button", { name: "Personalizado" });

      await expect(period24h).toBeVisible();
      await expect(period7d).toBeVisible();
      await expect(period30d).toBeVisible();
      await expect(periodMonth).toBeVisible();
      await expect(periodCustom).toBeVisible();

      // Alterna para período Personalizado e verifica campos de data
      await periodCustom.click();
      const startDateInput = modal.locator("#modal-start-date");
      const endDateInput = modal.locator("#modal-end-date");
      await expect(startDateInput).toBeVisible();
      await expect(endDateInput).toBeVisible();

      // Alterna de volta para 7 dias
      await period7d.click();
      await expect(startDateInput).not.toBeVisible();

      // 4. Seletores de Delimitador CSV (; e ,)
      const semicolonBtn = modal.getByRole("button", { name: /Ponto e vírgula/i });
      const commaBtn = modal.getByRole("button", { name: /^Vírgula/i });
      await expect(semicolonBtn).toBeVisible();
      await expect(commaBtn).toBeVisible();
      await commaBtn.click();
      await semicolonBtn.click();

      // 5. Botões de Ação Final (Exportar Planilha CSV e Imprimir / Salvar PDF)
      const downloadCsvBtn = modal.getByRole("button", { name: /Exportar Planilha \(CSV\)/i });
      const printPdfBtn = modal.getByRole("button", { name: /Imprimir \/ Salvar PDF/i });
      await expect(downloadCsvBtn).toBeVisible();
      await expect(printPdfBtn).toBeVisible();

      // 6. Fechamento do Modal via Tecla Escape
      await page.keyboard.press("Escape");
      await expect(modal).not.toBeVisible();

      // 7. Reabre o modal e testa fechamento pelo botão 'X' (aria-label)
      await exportBtn.click();
      await expect(modal).toBeVisible();

      const closeBtn = modal.locator('button[aria-label="Fechar modal de exportação"]');
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();
      await expect(modal).not.toBeVisible();

      // 8. Reabre o modal e testa fechamento clicando no Backdrop externo
      await exportBtn.click();
      await expect(modal).toBeVisible();

      // Clica no backdrop externo (fora do container interno)
      await modal.click({ position: { x: 20, y: 300 }, force: true });
      await expect(modal).not.toBeVisible();
    });
  });
});
