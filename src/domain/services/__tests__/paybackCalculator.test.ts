import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaybackCalculatorService } from "../PaybackCalculatorService";
import handlePayback from "../../../pages/api/finance/payback";
import { paybackPostBodySchema } from "../../../infrastructure/security/apiSchemas";
import type { NextApiRequest, NextApiResponse } from "next";

describe("PaybackCalculatorService - Módulo de Retorno sobre Investimento (Payback Solar)", () => {
  let service: PaybackCalculatorService;
  const fixedNow = new Date("2026-11-20T12:00:00.000Z");

  beforeEach(() => {
    service = PaybackCalculatorService.getInstance();
  });

  describe("Cenário Não Configurado (totalCapexBrl === 0)", () => {
    it("retorna isConfigured: false e valores zerados com segurança matemática sem divisões por zero", () => {
      const result = service.calculate({
        totalCapexBrl: 0,
        installationDate: new Date("2026-01-01"),
        totalAccumulatedSavingsBrl: 500,
        now: fixedNow,
      });

      expect(result.isConfigured).toBe(false);
      expect(result.totalCapexBrl).toBe(0);
      expect(result.amortizedAmountBrl).toBe(0);
      expect(result.remainingBalanceBrl).toBe(0);
      expect(result.amortizationPercentage).toBe(0);
      expect(result.accumulatedRoiPercentage).toBe(0);
      expect(result.isBreakEvenAchieved).toBe(false);
      expect(result.actualBreakEvenDateIso).toBeNull();
      expect(result.simplePayback.estimatedBreakEvenDateIso).toBeNull();
      expect(result.amortizationCurvePoints).toEqual([]);
    });

    it("trata valores negativos de CAPEX com fallback para zero sem gerar NaN", () => {
      const result = service.calculate({
        totalCapexBrl: -5000,
        totalAccumulatedSavingsBrl: 0,
        now: fixedNow,
      });

      expect(result.isConfigured).toBe(false);
      expect(result.totalCapexBrl).toBe(0);
      expect(isNaN(result.amortizationPercentage)).toBe(false);
    });
  });

  describe("Amortização em Andamento (Antes do Break-Even)", () => {
    it("calcula amortização parcial, saldo devedor e estimativa de break-even simples", () => {
      // 100 dias atrás
      const installationDate = new Date(fixedNow.getTime() - 100 * 86400000);
      const totalCapexBrl = 12000;
      const totalAccumulatedSavingsBrl = 4000; // 40 R$/dia

      const result = service.calculate({
        totalCapexBrl,
        installationDate,
        totalAccumulatedSavingsBrl,
        annualEnergyInflationRate: 6.5,
        now: fixedNow,
      });

      expect(result.isConfigured).toBe(true);
      expect(result.daysInOperation).toBe(100);
      expect(result.amortizedAmountBrl).toBe(4000);
      expect(result.remainingBalanceBrl).toBe(8000);
      expect(result.amortizationPercentage).toBe(33.3);
      expect(result.isBreakEvenAchieved).toBe(false);
      expect(result.actualBreakEvenDateIso).toBeNull();

      expect(result.dailyAverageSavingsBrl).toBe(40.0);
      expect(result.monthlyProjectedSavingsBrl).toBe(1217.5);
      expect(result.annualProjectedSavingsBrl).toBe(14610.0);

      // Saldo de 8000 / 40 R$/dia = 200 dias restantes
      expect(result.simplePayback.remainingDaysEstimate).toBe(200);
      expect(result.simplePayback.remainingYearsEstimate).toBe(0.5); // ~0.5 ano (200 / 365.25)
      expect(result.simplePayback.estimatedBreakEvenDateIso).toBe(
        new Date(fixedNow.getTime() + 200 * 86400000).toISOString()
      );
    });
  });

  describe("Break-Even Atingido (Investimento 100% Amortizado)", () => {
    it("sinaliza isBreakEvenAchieved: true, saldo zero e lucro líquido positivo", () => {
      const installationDate = new Date(fixedNow.getTime() - 300 * 86400000);
      const totalCapexBrl = 10000;
      const totalAccumulatedSavingsBrl = 12500; // Lucro de 2500

      const result = service.calculate({
        totalCapexBrl,
        installationDate,
        totalAccumulatedSavingsBrl,
        now: fixedNow,
      });

      expect(result.isConfigured).toBe(true);
      expect(result.isBreakEvenAchieved).toBe(true);
      expect(result.amortizedAmountBrl).toBe(10000);
      expect(result.remainingBalanceBrl).toBe(0);
      expect(result.amortizationPercentage).toBe(100);
      expect(result.accumulatedRoiPercentage).toBe(25.0);
      expect(result.simplePayback.remainingDaysEstimate).toBe(0);
      expect(result.simplePayback.remainingYearsEstimate).toBe(0);
      expect(result.actualBreakEvenDateIso).not.toBeNull();
    });
  });

  describe("Payback Descontado e Projeção de 10 Anos (LiFePO4)", () => {
    it("considera taxa anual de inflação energética da ANEEL para acelerar o payback descontado", () => {
      const installationDate = new Date(fixedNow.getTime() - 365 * 86400000);
      const totalCapexBrl = 25000;
      const totalAccumulatedSavingsBrl = 5000; // ~13.7 R$/dia

      const result = service.calculate({
        totalCapexBrl,
        installationDate,
        totalAccumulatedSavingsBrl,
        annualEnergyInflationRate: 8.0,
        now: fixedNow,
      });

      expect(result.discountedPayback.annualEnergyInflationRate).toBe(8.0);
      expect(result.discountedPayback.remainingYearsEstimate).toBeLessThan(
        result.simplePayback.remainingYearsEstimate
      );
      expect(result.tenYearProjection.lifetimeGrossSavingsBrl).toBeGreaterThan(
        result.annualProjectedSavingsBrl * 10
      );
      expect(result.tenYearProjection.lifetimeNetProfitBrl).toBe(
        Number((result.tenYearProjection.lifetimeGrossSavingsBrl - totalCapexBrl).toFixed(2))
      );
    });
  });

  describe("Curva Temporal de Amortização (amortizationCurvePoints)", () => {
    it("gera série histórica e projetada contendo linha constante do CAPEX e economia acumulada", () => {
      const installationDate = new Date(fixedNow.getTime() - 90 * 86400000);
      const totalCapexBrl = 8000;
      const totalAccumulatedSavingsBrl = 2000;

      const result = service.calculate({
        totalCapexBrl,
        installationDate,
        totalAccumulatedSavingsBrl,
        now: fixedNow,
      });

      expect(result.amortizationCurvePoints.length).toBeGreaterThan(0);
      const firstPoint = result.amortizationCurvePoints[0];
      expect(firstPoint.capexThresholdBrl).toBe(8000);
      expect(firstPoint.isProjected).toBe(false);

      const hasProjectedPoints = result.amortizationCurvePoints.some((p) => p.isProjected);
      expect(hasProjectedPoints).toBe(true);
    });
  });

  describe("Blindagem Matemática contra Casos Limítrofes", () => {
    it("protege contra instalação na mesma data (elapsedMs === 0) sem divisão por zero", () => {
      const result = service.calculate({
        totalCapexBrl: 5000,
        installationDate: fixedNow,
        totalAccumulatedSavingsBrl: 0,
        now: fixedNow,
      });

      expect(result.daysInOperation).toBe(1);
      expect(result.dailyAverageSavingsBrl).toBe(0);
      expect(isNaN(result.amortizationPercentage)).toBe(false);
    });
  });
});

describe("GET & POST /api/finance/payback Endpoint", () => {
  it("rejeita métodos HTTP não permitidos com status 405 e Allow: GET, POST", async () => {
    const req = {
      method: "DELETE",
    } as unknown as NextApiRequest;

    const resJson = vi.fn();
    const resHeader = vi.fn();
    const resStatus = vi.fn().mockReturnValue({ json: resJson });

    const res = {
      setHeader: resHeader,
      status: resStatus,
    } as unknown as NextApiResponse;

    await handlePayback(req, res);

    expect(resHeader).toHaveBeenCalledWith("Allow", ["GET", "POST"]);
    expect(resStatus).toHaveBeenCalledWith(405);
  });

  it("rejeita requisições sem autenticação retornando status 401", async () => {
    const req = {
      method: "GET",
      headers: {},
    } as unknown as NextApiRequest;

    const resJson = vi.fn();
    const resHeader = vi.fn();
    const resStatus = vi.fn().mockReturnValue({ json: resJson });

    const res = {
      setHeader: resHeader,
      status: resStatus,
    } as unknown as NextApiResponse;

    await handlePayback(req, res);

    expect(resStatus).toHaveBeenCalledWith(401);
  });

  describe("Validação Zod de Investimento (paybackPostBodySchema)", () => {
    it("valida parâmetros de CAPEX corretos", () => {
      const parsed = paybackPostBodySchema.safeParse({
        totalCapexBrl: 15000,
        installationDate: "2026-01-15",
        annualEnergyInflationRate: 6.5,
        targetPaybackYears: 3.5,
        capexNotes: "Estação EcoFlow DELTA 2 + 4x 100W",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejeita valores negativos de CAPEX", () => {
      const parsed = paybackPostBodySchema.safeParse({
        totalCapexBrl: -100,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejeita taxa de inflação exorbitante (> 50%)", () => {
      const parsed = paybackPostBodySchema.safeParse({
        totalCapexBrl: 10000,
        annualEnergyInflationRate: 60,
      });
      expect(parsed.success).toBe(false);
    });
  });
});
