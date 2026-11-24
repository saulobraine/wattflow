import { describe, it, expect } from "vitest";
import {
  AggregationEngine,
  type RawTelemetryLog,
} from "../AggregationEngine";
import type { DynamicTariffConfig } from "../TariffScheduleService";

describe("AggregationEngine (Motor de Downsampling & Exportação Multitemporal)", () => {
  // Data de referência determinística: Sexta-feira, 20/11/2026 às 15:30 BRT (18:30 UTC)
  const fixedRefDate = new Date("2026-11-20T18:30:00.000Z");

  const sampleDynamicTariff: DynamicTariffConfig = {
    isDynamicTariffActive: true,
    peakTariffPerKwh: 1.85,
    intermediateTariffPerKwh: 1.15,
    offPeakTariffPerKwh: 0.65,
    peakStartTime: "17:30",
    peakEndTime: "20:30",
    intermediateStartTime1: "16:30",
    intermediateEndTime1: "17:30",
    intermediateStartTime2: "20:30",
    intermediateEndTime2: "21:30",
    energyCostPerKwh: 0.92,
  };

  describe("Downsampling Janela 24 Horas ('24h')", () => {
    it("gera exatamente 96 buckets de 15 minutos e agrega métricas corretamente", () => {
      // Cria logs com amostras distribuídas nas últimas 24h
      const logs: RawTelemetryLog[] = [
        {
          executedAt: new Date(fixedRefDate.getTime() - 30 * 60 * 1000), // 30 min atrás (15:00 BRT)
          solarInputWatts: 800,
          outputWatts: 400,
          batteryPercentage: 90,
        },
        {
          executedAt: new Date(fixedRefDate.getTime() - 25 * 60 * 1000), // 25 min atrás (mesmo bucket ou adjacente)
          solarInputWatts: 600,
          outputWatts: 300,
          batteryPercentage: 92,
        },
        {
          executedAt: new Date(fixedRefDate.getTime() - 10 * 60 * 60 * 1000), // 10h atrás
          solarInputWatts: 1200,
          outputWatts: 500,
          batteryPercentage: 70,
        },
      ];

      const result = AggregationEngine.aggregate({
        logs,
        range: "24h",
        referenceDate: fixedRefDate,
        energyCostPerKwh: 0.92,
        dynamicTariffConfig: sampleDynamicTariff,
      });

      expect(result.range).toBe("24h");
      expect(result.points).toHaveLength(96);
      expect(result.summary.peakSolarWatts).toBe(1200);
      expect(result.summary.peakOutputWatts).toBe(500);
      expect(result.summary.totalSolarGeneratedKwh).toBeGreaterThan(0);
      expect(result.summary.totalConsumedKwh).toBeGreaterThan(0);
      expect(result.summary.gridAvoidancePercentage).toBeGreaterThanOrEqual(0);
      expect(result.summary.gridAvoidancePercentage).toBeLessThanOrEqual(100);

      // Valida formato dos rótulos (HH:mm)
      for (const point of result.points) {
        expect(point.label).toMatch(/^\d{2}:\d{2}$/);
      }
    });

    it("lida com lista de logs vazia sem lançar exceções", () => {
      const result = AggregationEngine.aggregate({
        logs: [],
        range: "24h",
        referenceDate: fixedRefDate,
      });

      expect(result.points).toHaveLength(96);
      expect(result.summary.totalSolarGeneratedKwh).toBe(0);
      expect(result.summary.totalConsumedKwh).toBe(0);
      expect(result.summary.netEnergyKwh).toBe(0);
      expect(result.summary.peakSolarWatts).toBe(0);
      expect(result.summary.gridAvoidancePercentage).toBe(0);
    });
  });

  describe("Downsampling Janela 7 Dias ('7d')", () => {
    it("gera 168 buckets de 1 hora e formata rótulos 'DD/MM HH:mm'", () => {
      const logs: RawTelemetryLog[] = [
        {
          executedAt: new Date(fixedRefDate.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 dias atrás
          solarInputWatts: 1500,
          outputWatts: 600,
          batteryPercentage: 85,
        },
      ];

      const result = AggregationEngine.aggregate({
        logs,
        range: "7d",
        referenceDate: fixedRefDate,
      });

      expect(result.range).toBe("7d");
      expect(result.points).toHaveLength(168);
      expect(result.summary.peakSolarWatts).toBe(1500);
      expect(result.points[0].label).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
    });

    it("integra energia contínua e preserva watts fracionários sem truncar para 0 em logs diluídos", () => {
      // Cenário do bug relatado por Baggute:
      // Em 1 hora (1 bucket), temos 1 leitura com consumo real (266W) e centenas de logs ociosos (0W).
      // Anteriormente: Math.round(266 / 600) = 0W, forçando bucketConsumedKwh = 0.00 e ponto = 0W.
      const bucketTime = new Date(fixedRefDate.getTime() - 2 * 60 * 60 * 1000); // 2h atrás
      const dilutedLogs: RawTelemetryLog[] = [
        {
          executedAt: new Date(bucketTime.getTime() + 10 * 1000),
          solarInputWatts: 0,
          outputWatts: 266,
          batteryPercentage: 80,
        },
      ];

      // Adiciona 599 amostras de 0W no mesmo bucket de 1 hora
      for (let i = 1; i < 600; i++) {
        dilutedLogs.push({
          executedAt: new Date(bucketTime.getTime() + (i * 5 + 10) * 1000),
          solarInputWatts: 0,
          outputWatts: 0,
          batteryPercentage: 80,
        });
      }

      const result = AggregationEngine.aggregate({
        logs: dilutedLogs,
        range: "7d",
        referenceDate: fixedRefDate,
      });

      expect(result.summary.peakOutputWatts).toBe(266);

      // Encontra o ponto correspondente ao bucket com as leituras
      const activePoint = result.points.find((p) => p.outputWatts > 0);
      expect(activePoint).toBeDefined();

      // Média real: 266 / 600 = 0.4433... W
      // Deve preservar 0.44W no ponto em vez de arredondar para 0W
      expect(activePoint!.outputWatts).toBe(0.44);
      expect(activePoint!.netWatts).toBe(-0.44);

      // E a energia acumulada no bucket não pode ter sido descartada para zero
      // (0.4433 W * 1h) / 1000 = ~0.00044 kWh
      expect(result.summary.peakOutputWatts).toBe(266);
    });
  });

  describe("Downsampling Janela 30 Dias ('30d')", () => {
    it("gera 180 buckets de 4 horas e calcula saldo líquido", () => {
      const logs: RawTelemetryLog[] = [
        {
          executedAt: new Date(fixedRefDate.getTime() - 15 * 24 * 60 * 60 * 1000), // 15 dias atrás
          solarInputWatts: 900,
          outputWatts: 450,
          batteryPercentage: 75,
        },
      ];

      const result = AggregationEngine.aggregate({
        logs,
        range: "30d",
        referenceDate: fixedRefDate,
      });

      expect(result.range).toBe("30d");
      expect(result.points).toHaveLength(180);
      expect(result.summary.peakSolarWatts).toBe(900);
      expect(result.points[0].label).toMatch(/^\d{2}\/\d{2} \d{2}h$/);
    });
  });

  describe("Downsampling Janela Anual ('year')", () => {
    it("gera exatamente 12 pontos mensais com rótulos semânticos como 'Nov/26'", () => {
      const logs: RawTelemetryLog[] = [
        {
          executedAt: fixedRefDate,
          solarInputWatts: 1000,
          outputWatts: 500,
          batteryPercentage: 80,
        },
      ];

      const result = AggregationEngine.aggregate({
        logs,
        range: "year",
        referenceDate: fixedRefDate,
      });

      expect(result.range).toBe("year");
      expect(result.points).toHaveLength(12);

      // O último ponto deve ser o mês corrente (Nov/26)
      const lastPoint = result.points[11];
      expect(lastPoint.label).toBe("Nov/26");
      expect(lastPoint.solarWatts).toBeGreaterThanOrEqual(0);
      expect(result.summary.peakSolarWatts).toBe(1000);
    });
  });

  describe("Curva Sobreposta 'Hoje vs Ontem' ('today-vs-yesterday')", () => {
    it("sincroniza séries de Hoje e Ontem em buckets de 15m e calcula divergência percentual", () => {
      // Ontem: 19/11/2026 às 12:00 BRT (15:00 UTC)
      const yesterdayLog: RawTelemetryLog = {
        executedAt: new Date("2026-11-19T15:00:00.000Z"),
        solarInputWatts: 1000,
        outputWatts: 500,
        batteryPercentage: 80,
      };

      // Hoje: 20/11/2026 às 12:00 BRT (15:00 UTC) - geração 20% maior (1200W)
      const todayLog: RawTelemetryLog = {
        executedAt: new Date("2026-11-20T15:00:00.000Z"),
        solarInputWatts: 1200,
        outputWatts: 500,
        batteryPercentage: 85,
      };

      const result = AggregationEngine.aggregate({
        logs: [yesterdayLog, todayLog],
        range: "today-vs-yesterday",
        referenceDate: fixedRefDate, // 15:30 BRT
      });

      expect(result.range).toBe("today-vs-yesterday");
      expect(result.comparison).toBeDefined();

      const comparison = result.comparison!;
      expect(comparison.yesterdayPoints).toHaveLength(96); // Dia de ontem completo (00:00 - 23:45)
      expect(comparison.todayPoints.length).toBeGreaterThan(0); // De 00:00 até 15:30 BRT (~63 slots)

      expect(comparison.yesterdayPeakWatts).toBe(1000);
      expect(comparison.todayPeakWatts).toBe(1200);

      // Como Hoje gerou 1200W no mesmo slot vs 1000W ontem, a divergência deve ser positiva
      expect(comparison.todayTotalKwh).toBeGreaterThan(comparison.yesterdayTotalKwh);
      expect(comparison.divergencePercentage).toBeGreaterThan(0);
    });

    it("divergência percentual reporta 100% se ontem não teve geração e hoje teve", () => {
      const todayLog: RawTelemetryLog = {
        executedAt: new Date("2026-11-20T14:00:00.000Z"),
        solarInputWatts: 800,
        outputWatts: 200,
        batteryPercentage: 70,
      };

      const result = AggregationEngine.aggregate({
        logs: [todayLog],
        range: "today-vs-yesterday",
        referenceDate: fixedRefDate,
      });

      expect(result.comparison?.yesterdayTotalKwh).toBe(0);
      expect(result.comparison?.todayTotalKwh).toBeGreaterThan(0);
      expect(result.comparison?.divergencePercentage).toBe(100);
    });
  });

  describe("Mitigação contra CSV Injection & Exportação RFC 4180", () => {
    it("desarma fórmulas maliciosas iniciadas com '=', '+', '-', '@' prefixando apóstrofo", () => {
      expect(AggregationEngine.sanitizeCsvValue("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(AggregationEngine.sanitizeCsvValue("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
      expect(AggregationEngine.sanitizeCsvValue("-2+3")).toBe("'-2+3");
      expect(AggregationEngine.sanitizeCsvValue("@SUM(A1:B10)")).toBe("'@SUM(A1:B10)");
      expect(AggregationEngine.sanitizeCsvValue("@SUM(1,2)")).toBe("\"'@SUM(1,2)\"");
      expect(AggregationEngine.sanitizeCsvValue("\tTabInjection")).toBe("'\tTabInjection");
    });

    it("preserva números puros e textos seguros sem prefixar apóstrofo desnecessário", () => {
      expect(AggregationEngine.sanitizeCsvValue(1500)).toBe("1500");
      expect(AggregationEngine.sanitizeCsvValue(-350)).toBe("-350"); // tipo number
      expect(AggregationEngine.sanitizeCsvValue("SOLAR")).toBe("SOLAR");
      expect(AggregationEngine.sanitizeCsvValue("CONCESSIONARIA")).toBe("CONCESSIONARIA");
      expect(AggregationEngine.sanitizeCsvValue(null)).toBe("");
      expect(AggregationEngine.sanitizeCsvValue(undefined)).toBe("");
    });

    it("escapa aspas e vírgulas conforme RFC 4180", () => {
      expect(AggregationEngine.sanitizeCsvValue('Texto com, vírgula e "aspas"')).toBe(
        '"Texto com, vírgula e ""aspas"""'
      );
    });

    it("gera CSV válido com BOM UTF-8 e cabeçalhos corretos", () => {
      const points = [
        {
          timestamp: "2026-11-20T14:15:00.000Z",
          label: "11:15",
          solarWatts: 750,
          outputWatts: 350,
          netWatts: 400,
          batteryPercentage: 85,
        },
      ];

      const csv = AggregationEngine.exportToCsv(points, {
        range: "24h",
        energyCostPerKwh: 0.92,
        dynamicTariffConfig: sampleDynamicTariff,
      });

      // Valida presença de BOM UTF-8 (\uFEFF)
      expect(csv.startsWith("\uFEFF")).toBe(true);

      // Valida cabeçalho
      expect(csv).toContain(
        "Data_Hora,Bateria_SOC_Percent,Geracao_Solar_Watts,Consumo_Residencial_Watts,Saldo_Liquido_Watts,Fonte_Ativa,Faixa_Tarifaria,Economia_Estimada_BRL"
      );

      // Valida linha de dados
      expect(csv).toContain("2026-11-20T14:15:00.000Z,85,750,350,400,SOLAR");
    });
  });
});
