import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AnalyticalReportService,
  RawReportLog,
  ReportConfigInput,
} from "../AnalyticalReportService";
import handleReportsExport from "../../../pages/api/reports/export";
import { reportsExportQuerySchema } from "../../../infrastructure/security/apiSchemas";
import type { NextApiRequest, NextApiResponse } from "next";

describe("AnalyticalReportService - Serviço de Relatórios Analíticos", () => {
  let service: AnalyticalReportService;

  beforeEach(() => {
    service = AnalyticalReportService.getInstance();
  });

  describe("Resolução de Períodos Temporais (resolveDateRange)", () => {
    const fixedNow = new Date("2026-11-20T12:00:00.000Z");

    it("resolve período 24h exatamente 24 horas antes da data de referência", () => {
      const range = service.resolveDateRange("24h", undefined, undefined, fixedNow);
      expect(range.periodLabel).toBe("Últimas 24 Horas");
      expect(range.endDate.getTime()).toBe(fixedNow.getTime());
      expect(range.startDate.getTime()).toBe(fixedNow.getTime() - 24 * 60 * 60 * 1000);
    });

    it("resolve período 7d exatamente 7 dias antes da data de referência", () => {
      const range = service.resolveDateRange("7d", undefined, undefined, fixedNow);
      expect(range.periodLabel).toBe("Últimos 7 Dias");
      expect(range.startDate.getTime()).toBe(fixedNow.getTime() - 7 * 24 * 60 * 60 * 1000);
    });

    it("resolve período 30d exatamente 30 dias antes da data de referência", () => {
      const range = service.resolveDateRange("30d", undefined, undefined, fixedNow);
      expect(range.periodLabel).toBe("Últimos 30 Dias");
      expect(range.startDate.getTime()).toBe(fixedNow.getTime() - 30 * 24 * 60 * 60 * 1000);
    });

    it("resolve período month para o primeiro dia do mês corrente", () => {
      const range = service.resolveDateRange("month", undefined, undefined, fixedNow);
      expect(range.periodLabel).toContain("Mês Atual");
      expect(range.startDate.getDate()).toBe(1);
    });

    it("resolve período custom com datas válidas no formato YYYY-MM-DD", () => {
      const range = service.resolveDateRange("custom", "2026-11-01", "2026-11-15", fixedNow);
      expect(range.periodLabel).toContain("Personalizado");
      expect(service.formatPtBrDate(range.startDate)).toBe("01/11/2026");
      expect(service.formatPtBrDate(range.endDate)).toBe("15/11/2026");
    });

    it("inverte automaticamente datas custom se startDate for posterior a endDate", () => {
      const range = service.resolveDateRange("custom", "2026-11-20", "2026-11-05", fixedNow);
      expect(range.startDate.getTime()).toBeLessThan(range.endDate.getTime());
    });
  });

  describe("Detecção de Fonte Ativa (isBatterySource)", () => {
    it("identifica como BATERIA quando actionTriggered for ENABLE_ECOFLOW_AC", () => {
      const isBat = service.isBatterySource({
        executedAt: new Date(),
        solarInputWatts: 0,
        outputWatts: 0,
        batteryPercentage: 90,
        actionTriggered: "ENABLE_ECOFLOW_AC",
      });
      expect(isBat).toBe(true);
    });

    it("identifica como BATERIA quando outputWatts > 0 e não houver corte", () => {
      const isBat = service.isBatterySource({
        executedAt: new Date(),
        solarInputWatts: 500,
        outputWatts: 350,
        batteryPercentage: 85,
        actionTriggered: "MQTT_STREAM",
      });
      expect(isBat).toBe(true);
    });

    it("identifica como REDE CONCESSIONÁRIA quando actionTriggered for DISABLE_ECOFLOW_AC", () => {
      const isBat = service.isBatterySource({
        executedAt: new Date(),
        solarInputWatts: 0,
        outputWatts: 150,
        batteryPercentage: 20,
        actionTriggered: "DISABLE_ECOFLOW_AC",
      });
      expect(isBat).toBe(false);
    });

    it("identifica como REDE CONCESSIONÁRIA em desarmes térmicos ou de tempestade", () => {
      const isStorm = service.isBatterySource({
        executedAt: new Date(),
        solarInputWatts: 0,
        outputWatts: 200,
        batteryPercentage: 50,
        actionTriggered: "AUTO_STORM_DEFENSE",
      });
      expect(isStorm).toBe(false);

      const isThermal = service.isBatterySource({
        executedAt: new Date(),
        solarInputWatts: 0,
        outputWatts: 200,
        batteryPercentage: 50,
        actionTriggered: "THERMAL_PROTECTION_DISARM",
      });
      expect(isThermal).toBe(false);
    });

    it("identifica como REDE CONCESSIONÁRIA quando outputWatts for zero", () => {
      const isBat = service.isBatterySource({
        executedAt: new Date(),
        solarInputWatts: 100,
        outputWatts: 0,
        batteryPercentage: 50,
      });
      expect(isBat).toBe(false);
    });
  });

  describe("Consolidação Analítica (consolidateReport)", () => {
    const startDate = new Date("2026-11-20T00:00:00.000Z");
    const endDate = new Date("2026-11-20T23:59:59.999Z");

    const sampleLogs: RawReportLog[] = [
      {
        executedAt: new Date("2026-11-20T08:00:00.000Z"),
        solarInputWatts: 800,
        outputWatts: 400,
        batteryPercentage: 70,
        actionTriggered: "ENABLE_ECOFLOW_AC",
        batteryTempCelsius: 32.5,
        batterySoh: 99,
        batteryCycles: 110,
      },
      {
        executedAt: new Date("2026-11-20T12:00:00.000Z"),
        solarInputWatts: 1400,
        outputWatts: 600,
        batteryPercentage: 95,
        actionTriggered: "MQTT_STREAM",
        batteryTempCelsius: 43.5, // Throttling
        batterySoh: 99,
        batteryCycles: 110,
      },
      {
        executedAt: new Date("2026-11-20T18:00:00.000Z"),
        solarInputWatts: 100,
        outputWatts: 800,
        batteryPercentage: 60,
        actionTriggered: "MQTT_STREAM",
        batteryTempCelsius: 49.0, // Cutoff
        batterySoh: 99,
        batteryCycles: 111,
      },
      {
        executedAt: new Date("2026-11-20T20:00:00.000Z"),
        solarInputWatts: 0,
        outputWatts: 0,
        batteryPercentage: 30,
        actionTriggered: "DISABLE_ECOFLOW_AC",
        batteryTempCelsius: 35.0,
        batterySoh: 99,
        batteryCycles: 111,
      },
    ];

    const config: ReportConfigInput = {
      energyCostPerKwh: 0.92,
      currencySymbol: "R$",
      batteryCapacityWh: 2048,
      isDynamicTariffActive: true,
      peakTariffPerKwh: 1.85,
      offPeakTariffPerKwh: 0.65,
      thermalThrottleTempThreshold: 42.0,
      thermalCutoffTempThreshold: 48.0,
      lastBatterySoh: 99,
    };

    it("satisfaz o critério de que a soma de horas em bateria + concessionária totaliza o período", () => {
      const report = service.consolidateReport({
        logs: sampleLogs,
        config,
        period: "24h",
        startDate,
        endDate,
      });

      const { hoursOnBattery, hoursOnGrid } = report.summary.atsOperationMetrics;
      const totalPeriodHours = Number(((endDate.getTime() - startDate.getTime()) / 3600000).toFixed(1));

      expect(Number((hoursOnBattery + hoursOnGrid).toFixed(1))).toBe(totalPeriodHours);
      expect(
        Number(
          (
            report.summary.atsOperationMetrics.batteryDutyCyclePercentage +
            report.summary.atsOperationMetrics.gridDutyCyclePercentage
          ).toFixed(1)
        )
      ).toBe(100.0);
    });

    it("calcula pico solar, pico residencial e balanço líquido de energia", () => {
      const report = service.consolidateReport({
        logs: sampleLogs,
        config,
        period: "24h",
        startDate,
        endDate,
      });

      expect(report.summary.peakSolarWatts).toBe(1400);
      expect(report.summary.peakResidentialOutputWatts).toBe(800);
      expect(report.summary.totalSolarGeneratedKwh).toBeGreaterThan(0);
      expect(report.summary.totalResidentialConsumedKwh).toBeGreaterThan(0);
      expect(report.summary.netEnergyBalanceKwh).toBe(
        Number(
          (
            report.summary.totalSolarGeneratedKwh -
            report.summary.totalResidentialConsumedKwh
          ).toFixed(2)
        )
      );
    });

    it("registra eventos de throttling e corte térmico no resumo do BMS", () => {
      const report = service.consolidateReport({
        logs: sampleLogs,
        config,
        period: "24h",
        startDate,
        endDate,
      });

      expect(report.summary.bmsHealthSummary.thermalThrottlingEventsCount).toBeGreaterThanOrEqual(1);
      expect(report.summary.bmsHealthSummary.thermalCutoffEventsCount).toBeGreaterThanOrEqual(1);
      expect(report.summary.bmsHealthSummary.maxTempCelsius).toBe(49.0);
      expect(report.summary.bmsHealthSummary.minTempCelsius).toBe(32.5);
      expect(report.summary.bmsHealthSummary.currentSohPercentage).toBe(99);
    });

    it("computa comutações da ATS ao detectar transições de fonte", () => {
      const report = service.consolidateReport({
        logs: sampleLogs,
        config,
        period: "24h",
        startDate,
        endDate,
      });

      expect(report.summary.atsOperationMetrics.totalAtsSwitchesCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Geração e Sanitização de CSV (generateCsv)", () => {
    it("inclui delimitador ponto-e-vírgula e prefixo BOM UTF-8", () => {
      const report = service.consolidateReport({
        logs: [
          {
            executedAt: new Date("2026-11-20T10:00:00.000Z"),
            solarInputWatts: 500,
            outputWatts: 250,
            batteryPercentage: 80,
            actionTriggered: "ENABLE_ECOFLOW_AC",
            batteryTempCelsius: 30.0,
          },
        ],
        config: { energyCostPerKwh: 0.95 },
        period: "24h",
        startDate: new Date("2026-11-20T00:00:00.000Z"),
        endDate: new Date("2026-11-20T23:59:59.000Z"),
      });

      const csv = service.generateCsv(report);

      // Deve começar com BOM UTF-8 (\uFEFF)
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain(";");
      expect(csv).toContain("# RELATÓRIO ANALÍTICO WATTFLOW - FECHAMENTO OPERACIONAL");
      expect(csv).toContain("Data_Hora;Bateria_SOC_Percent;Geracao_Solar_Watts");
    });

    it("desarma tentativas de CSV Injection (Formula Injection) com prefixo apóstrofo", () => {
      expect(service.sanitizeCsvCell("=1+2")).toBe("'=1+2");
      expect(service.sanitizeCsvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
      expect(service.sanitizeCsvCell("-SUM(A1:A10)")).toBe("'-SUM(A1:A10)");
      expect(service.sanitizeCsvCell("@threat")).toBe("'@threat");
      expect(service.sanitizeCsvCell("   =CMD()")).toBe("'   =CMD()");
      expect(service.sanitizeCsvCell("|pipe")).toBe("'|pipe");
      expect(service.sanitizeCsvCell("%percent")).toBe("'%percent");
      expect(service.sanitizeCsvCell("Operação Normal")).toBe("Operação Normal");
    });

    it("formata valores decimais no padrão pt-BR com vírgula", () => {
      expect(service.formatNumberPtBr(142.5)).toBe("142,50");
      expect(service.formatNumberPtBr(38.4, 1)).toBe("38,4");
      expect(service.formatNumberPtBr(null)).toBe("");
    });
  });

  describe("Geração de HTML Executivo para Impressão A4 / PDF (generatePrintableHtml)", () => {
    it("gera documento HTML contendo estilização A4 e classes no-print", () => {
      const report = service.consolidateReport({
        logs: [],
        config: {},
        period: "24h",
        startDate: new Date("2026-11-20T00:00:00.000Z"),
        endDate: new Date("2026-11-20T23:59:59.000Z"),
      });

      const html = service.generatePrintableHtml(report, "WattFlow");

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("@page { size: A4 portrait;");
      expect(html).toContain(".no-print");
      expect(html).toContain("Energia Solar Gerada");
      expect(html).toContain("Duty Cycle ATS");
    });
  });
});

describe("GET /api/reports/export API Endpoint", () => {
  it("rejeita requisições não-GET com 405 e cabeçalho Allow: GET", async () => {
    const req = {
      method: "POST",
    } as unknown as NextApiRequest;

    const resJson = vi.fn();
    const resHeader = vi.fn();
    const resStatus = vi.fn().mockReturnValue({ json: resJson });

    const res = {
      setHeader: resHeader,
      status: resStatus,
    } as unknown as NextApiResponse;

    await handleReportsExport(req, res);

    expect(resHeader).toHaveBeenCalledWith("Allow", ["GET"]);
    expect(resStatus).toHaveBeenCalledWith(405);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Método HTTP não permitido.",
      })
    );
  });

  it("rejeita requisições sem autenticação retornando 401", async () => {
    const req = {
      method: "GET",
      headers: {},
      query: {},
    } as unknown as NextApiRequest;

    const resJson = vi.fn();
    const resHeader = vi.fn();
    const resStatus = vi.fn().mockReturnValue({ json: resJson });

    const res = {
      setHeader: resHeader,
      status: resStatus,
    } as unknown as NextApiResponse;

    await handleReportsExport(req, res);

    expect(resStatus).toHaveBeenCalledWith(401);
  });

  describe("Validação Zod de Parâmetros de Query (reportsExportQuerySchema)", () => {
    it("valida parâmetros válidos de período e formato", () => {
      const parsed = reportsExportQuerySchema.safeParse({
        format: "csv",
        period: "30d",
        delimiter: ";",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejeita formatos não suportados", () => {
      const parsed = reportsExportQuerySchema.safeParse({
        format: "docx",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejeita períodos inválidos", () => {
      const parsed = reportsExportQuerySchema.safeParse({
        period: "decade",
      });
      expect(parsed.success).toBe(false);
    });
  });
});
