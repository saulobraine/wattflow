import React, { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useVisibilityPolling } from "../hooks/useVisibilityPolling";
import { useLiveTelemetry } from "../hooks/useLiveTelemetry";
import { ReportExportModal } from "../components/ReportExportModal";
import { PaybackAmortizationChart } from "../components/PaybackAmortizationChart";
import { AtsHealthWidget } from "../components/AtsHealthWidget";
import { formatCurrency } from "../utils/currencyFormatter";
import {
  Sun,
  Zap,
  TrendingUp,
  TrendingDown,
  BatteryCharging,
  RefreshCw,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Calendar,
  Activity,
  Gauge,
  Scale,
  ArrowLeftRight,
  ShieldCheck,
  RotateCcw,
  DollarSign,
  Timer,
  Wallet,
  CloudSun,
  Thermometer,
  Flame,
  CloudRain,
  Layers,
  Download,
  Printer,
  FileSpreadsheet,
  Cpu,
} from "lucide-react";
import type {
  StatisticsRange,
  StatisticsHistoryResponse,
  StatisticsHistoryPoint,
  TodayVsYesterdayPoint,
  StatisticsHistoryComparison,
} from "../domain/services/AggregationEngine";
import type {
  FinancialSavingsMetrics,
  AutonomyEstimateMetrics,
  SolarForecastMetrics,
  BmsAnalyticsMetrics,
  SolarExpectationLevel,
  TariffPeriod,
  ApplianceSimulationMetrics,
} from "./api/statistics";

export interface AtsHealthData {
  lifespanCycles: number;
  currentCycles: number;
  remainingCycles: number;
  healthPercentage: number;
  estimatedYearsRemaining: number;
  dailyRate: number;
  atsLastSwitchedAt: string | null;
  status: "EXCELLENT" | "GOOD" | "ATTENTION" | "CRITICAL";
  isProratedEstimate?: boolean;
}

interface SolarChartPoint {
  time: string;
  watts: number;
  outputWatts: number;
  netWatts: number;
  battery: number;
}

interface StatisticsData {
  currentWatts: number;
  currentOutputWatts: number;
  netWatts: number;
  peakWatts: number;
  averageWatts: number;
  averageOutputWatts: number;
  estimatedEnergyWattHours: number;
  estimatedEnergyKwh: number;
  estimatedConsumedWattHours: number;
  estimatedConsumedKwh: number;
  netEnergyWattHours: number;
  netEnergyKwh: number;
  totalReadingsCount: number;
  chartPoints: SolarChartPoint[];
  recentLogs: Array<{
    id: string;
    batteryPercentage: number;
    solarInputWatts: number;
    outputWatts: number;
    actionTriggered: string;
    executionDetails: string | null;
    executedAt: string;
  }>;
  atsHealth?: AtsHealthData;
  financialSavings?: FinancialSavingsMetrics;
  autonomyEstimate?: AutonomyEstimateMetrics;
  solarForecast?: SolarForecastMetrics;
  bmsAnalytics?: BmsAnalyticsMetrics;
  applianceSimulation?: ApplianceSimulationMetrics;
}

export default function StatisticsPage() {
  const { telemetry: liveTelemetry } = useLiveTelemetry();
  const [data, setData] = useState<StatisticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<SolarChartPoint | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Estados do Histórico Multitemporal & Análise Avançada
  const [selectedRange, setSelectedRange] = useState<StatisticsRange>("today-vs-yesterday");
  const [historyData, setHistoryData] = useState<StatisticsHistoryResponse | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [hoveredHistPoint, setHoveredHistPoint] = useState<StatisticsHistoryPoint | null>(null);
  const [hoveredCompPoint, setHoveredCompPoint] = useState<{
    today?: TodayVsYesterdayPoint;
    yesterday?: TodayVsYesterdayPoint;
    time: string;
  } | null>(null);

  const fetchHistory = async (range: StatisticsRange) => {
    setIsHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/api/statistics/history?range=${range}&t=${Date.now()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok && json.range) {
        setHistoryData(json);
      } else {
        setHistoryError(json.message || "Não foi possível carregar o histórico multitemporal.");
      }
    } catch (err) {
      console.error("Erro ao carregar histórico multitemporal:", err);
      setHistoryError("Falha de conexão ao carregar o histórico multitemporal.");
    } finally {
      setIsHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory(selectedRange);
  }, [selectedRange]);

  const fetchStatistics = async () => {
    try {
      const response = await fetch(`/api/statistics?t=${Date.now()}`, {
        cache: "no-store",
      });
      const json = await response.json();
      if (json.success && json.data) {
        setData(json.data);
      }
    } catch (error) {
      console.error("Erro ao carregar estatísticas:", error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatistics();
  }, []);

  useVisibilityPolling({
    pollingIntervalMs: 2000,
    onPoll: fetchStatistics,
  });

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchStatistics();
  };

  const rawMaxGen = Math.max(
    ...(data?.chartPoints.map((point) => point.watts) || [0]),
    data?.currentWatts ?? 0,
    0
  );
  const rawMaxOut = Math.max(
    ...(data?.chartPoints.map((point) => point.outputWatts) || [0]),
    data?.currentOutputWatts ?? 0,
    0
  );
  const rawMaxNet = Math.max(
    ...(data?.chartPoints.map((point) => Math.abs(point.netWatts)) || [0]),
    Math.abs(data?.netWatts ?? 0),
    0
  );
  const rawMaxWatts = Math.max(rawMaxGen, rawMaxOut, rawMaxNet);

  const calculateScaleMax = (maxVal: number) => {
    if (maxVal <= 0) return 100;
    const withHeadroom = maxVal * 1.25;
    if (withHeadroom <= 100) return 100;
    if (withHeadroom <= 200) return 200;
    if (withHeadroom <= 400) return 400;
    if (withHeadroom <= 600) return 600;
    if (withHeadroom <= 800) return 800;
    if (withHeadroom <= 1000) return 1000;
    if (withHeadroom <= 1500) return 1500;
    return Math.ceil(withHeadroom / 500) * 500;
  };

  const scaleMaxWatts = calculateScaleMax(rawMaxWatts);
  const scaleMidWatts = Math.round(scaleMaxWatts / 2);

  const liveSolarWatts = liveTelemetry?.solarInputWatts ?? data?.currentWatts ?? 0;
  const liveOutputWatts = liveTelemetry?.outputWatts ?? data?.currentOutputWatts ?? 0;
  const liveNetWatts = liveTelemetry ? (liveSolarWatts - liveOutputWatts) : (data?.netWatts ?? 0);

  const isInstantNetPositive = liveNetWatts >= 0;
  const isPeriodNetPositive = (data?.netEnergyKwh ?? 0) >= 0;
  const atsHealth = data?.atsHealth;

  const getSolarExpectationBadge = (level: SolarExpectationLevel | null | undefined) => {
    switch (level) {
      case "SOLAR_EXCELLENT":
        return {
          label: "Sol Pleno",
          classes: "bg-amber-500/20 text-amber-300 border-amber-500/40",
          icon: Sun,
        };
      case "SOLAR_GOOD":
        return {
          label: "Sol Parcial / Bom",
          classes: "bg-sky-500/20 text-sky-300 border-sky-500/40",
          icon: CloudSun,
        };
      case "SOLAR_MODERATE":
        return {
          label: "Sol Moderado",
          classes: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
          icon: CloudSun,
        };
      case "SOLAR_POOR":
      default:
        return {
          label: "Nublado / Chuva",
          classes: "bg-slate-800 text-slate-300 border-slate-700",
          icon: CloudRain,
        };
    }
  };

  const getBmsThermalTheme = (tempCelsius: number | null | undefined) => {
    if (tempCelsius === null || tempCelsius === undefined) {
      return {
        text: "text-emerald-400",
        bg: "bg-emerald-400",
        badge: "bg-emerald-950/80 text-emerald-300 border-emerald-600/70 shadow-emerald-950/40",
        label: "Hardware EMS Ativo / Proteção Térmica Integrada",
      };
    }
    if (tempCelsius < 38) {
      return {
        text: "text-emerald-400",
        bg: "bg-emerald-500",
        badge: "bg-emerald-950/80 text-emerald-300 border-emerald-700/60",
        label: "Normal / Fria",
      };
    }
    if (tempCelsius <= 45) {
      return {
        text: "text-amber-400",
        bg: "bg-amber-500",
        badge: "bg-amber-950/80 text-amber-300 border-amber-700/60",
        label: "Aquecimento Moderado",
      };
    }
    return {
      text: "text-rose-400",
      bg: "bg-rose-500",
      badge: "bg-rose-950/80 text-rose-300 border-rose-700/60",
      label: "Alerta Térmico Crítico",
    };
  };

  const getTariffPeriodBadge = (
    period?: TariffPeriod,
    rate?: number,
    isDynamicActive?: boolean
  ) => {
    if (!isDynamicActive) {
      return {
        label: "Tarifa Convencional",
        classes: "bg-slate-800 text-slate-300 border-slate-700",
        dot: "bg-slate-400",
        desc: "Tarifa fixa única",
      };
    }
    switch (period) {
      case "PEAK":
        return {
          label: `Ponta (R$ ${rate?.toFixed(2) ?? "--"})`,
          classes: "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse",
          dot: "bg-rose-500",
          desc: "Horário mais caro — prioridade máxima solar/bateria",
        };
      case "INTERMEDIATE":
        return {
          label: `Intermediário (R$ ${rate?.toFixed(2) ?? "--"})`,
          classes: "bg-amber-500/20 text-amber-300 border-amber-500/40",
          dot: "bg-amber-400",
          desc: "Tarifa moderada pré/pós ponta",
        };
      case "OFF_PEAK":
      default:
        return {
          label: `Fora de Ponta (R$ ${rate?.toFixed(2) ?? "--"})`,
          classes: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
          dot: "bg-emerald-400",
          desc: "Tarifa reduzida",
        };
    }
  };

  return (
    <Layout title="Estatísticas de Geração e Consumo">
      <div className="space-y-4 md:space-y-8 max-w-6xl mx-auto">
        {/* Cabeçalho da Seção */}
        <div className="animate-card stagger-1 interactive-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-4 sm:p-6 rounded-2xl border border-slate-800 backdrop-blur shadow-xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sun className="w-5 h-5 text-amber-400 animate-float" />
              <h2 className="text-lg sm:text-xl font-bold text-slate-100">
                Balanço Energético EcoFlow (Últimos 30 Minutos)
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-400">
              Histórico dos últimos 30 minutos agrupados pela média de 5 em 5 minutos, comparando geração fotovoltaica, consumo e saldo líquido.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsReportModalOpen(true)}
              className="w-full sm:w-auto px-4 py-2.5 sm:py-2 min-h-[44px] rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-750 text-emerald-400 border border-emerald-500/40 active:scale-95 transition-all duration-150 flex items-center justify-center gap-2 shadow-md cursor-pointer shrink-0"
              aria-label="Abrir módulo de exportação e relatórios analíticos"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <span>Exportar Relatório</span>
            </button>

            <button
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
              className="w-full sm:w-auto px-4 py-2.5 sm:py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all duration-150 flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>

        {/* 1. Potência Instantânea em Tempo Real (3 Cards) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-wider">
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <span>Potência Instantânea (Ao Vivo)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
            {/* Geração Solar Instantânea */}
            <div className="animate-card stagger-2 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl relative overflow-hidden flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sun className="w-4 h-4 text-amber-400 transition-transform group-hover:rotate-45 duration-300" />
                    Geração Solar
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border transition-all ${
                      liveSolarWatts > 0
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse-glow"
                        : "bg-slate-800 text-slate-400 border-slate-700"
                    }`}
                  >
                    {liveSolarWatts > 0 ? "GERANDO" : "STANDBY"}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-100 font-mono">
                    {liveSolarWatts}
                  </span>
                  <span className="text-slate-400 font-medium text-sm">W</span>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                {liveSolarWatts > 0
                  ? "Entrada solar fotovoltaica captando energia ao vivo."
                  : "Sem radiação solar direta no momento."}
              </p>
            </div>

            {/* Consumo Instantâneo */}
            <div className="animate-card stagger-3 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl relative overflow-hidden flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-sky-400 transition-transform group-hover:scale-110 duration-200" />
                    Consumo em Tempo Real
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border transition-all ${
                      liveOutputWatts > 0
                        ? "bg-sky-500/20 text-sky-300 border-sky-500/30"
                        : "bg-slate-800 text-slate-400 border-slate-700"
                    }`}
                  >
                    {liveOutputWatts > 0 ? "EM CARGA" : "SEM CARGA"}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-sky-300 font-mono">
                    {liveOutputWatts}
                  </span>
                  <span className="text-slate-400 font-medium text-sm">W</span>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                Potência entregue pelas saídas AC e DC em tempo real.
              </p>
            </div>

            {/* Balanço Instantâneo (Diferença) */}
            <div className="animate-card stagger-4 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl relative overflow-hidden flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    {isInstantNetPositive ? (
                      <TrendingUp className="w-4 h-4 text-emerald-400 transition-transform group-hover:scale-110 duration-200" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-amber-400 transition-transform group-hover:scale-110 duration-200" />
                    )}
                    Balanço Instantâneo
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border transition-all ${
                      liveNetWatts > 0
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        : liveNetWatts < 0
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                        : "bg-slate-800 text-slate-400 border-slate-700"
                    }`}
                  >
                    {liveNetWatts > 0
                      ? "SUPERÁVIT"
                      : liveNetWatts < 0
                      ? "DÉFICIT"
                      : "EQUILÍBRIO"}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-3xl sm:text-4xl font-extrabold tracking-tight font-mono ${
                      isInstantNetPositive ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {liveNetWatts > 0
                      ? `+${liveNetWatts}`
                      : liveNetWatts}
                  </span>
                  <span className="text-slate-400 font-medium text-sm">W</span>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                {liveNetWatts > 0
                  ? "Geração supera o consumo. Bateria absorvendo excedente."
                  : liveNetWatts < 0
                  ? "Consumo maior que geração solar. Bateria fornecendo energia."
                  : "Geração e consumo em equilíbrio."}
              </p>
            </div>
          </div>
        </div>

        {/* 2. Energia Acumulada do Período - Últimas 24 Horas (3 Cards) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-wider">
            <Scale className="w-3.5 h-3.5 text-indigo-400" />
            <span>Gasto & Balanço Energético Acumulado (Últimas 24 Horas)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
            {/* Energia Solar Gerada (24h) */}
            <div className="animate-card stagger-4 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sun className="w-4 h-4 text-amber-400 transition-transform group-hover:scale-110 duration-200" />
                    Energia Solar Gerada (24h)
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-amber-300 border border-slate-700">
                    GERAÇÃO 24H
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-amber-300 font-mono">
                    {data?.estimatedEnergyKwh !== undefined ? data.estimatedEnergyKwh.toFixed(3) : "0.000"}
                  </span>
                  <span className="text-slate-400 font-medium text-sm">kWh</span>
                  <span className="text-xs font-mono text-slate-500 ml-1">
                    ({data?.estimatedEnergyWattHours ?? 0} Wh)
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                Energia solar limpa captada nas últimas 24 horas.
              </p>
            </div>

            {/* Gasto Energético Acumulado (Energia Consumida 24h) */}
            <div className="animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-sky-400 transition-transform group-hover:scale-110 duration-200" />
                    Energia Consumida (24h)
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-sky-300 border border-slate-700">
                    CONSUMO 24H
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-sky-300 font-mono">
                    {data?.estimatedConsumedKwh !== undefined ? data.estimatedConsumedKwh.toFixed(3) : "0.000"}
                  </span>
                  <span className="text-slate-400 font-medium text-sm">kWh</span>
                  <span className="text-xs font-mono text-slate-500 ml-1">
                    ({data?.estimatedConsumedWattHours ?? 0} Wh)
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                Gasto energético total das cargas nas últimas 24 horas.
              </p>
            </div>

            {/* Saldo Energético Líquido do Período (24h) */}
            <div className="animate-card stagger-6 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    {isPeriodNetPositive ? (
                      <TrendingUp className="w-4 h-4 text-emerald-400 transition-transform group-hover:scale-110 duration-200" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-amber-400 transition-transform group-hover:scale-110 duration-200" />
                    )}
                    Saldo Líquido (24h)
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                      isPeriodNetPositive
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                    }`}
                  >
                    {isPeriodNetPositive ? "SUPERÁVIT" : "DÉFICIT"}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-3xl sm:text-4xl font-extrabold tracking-tight font-mono ${
                      isPeriodNetPositive ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {data?.netEnergyKwh !== undefined
                      ? data.netEnergyKwh > 0
                        ? `+${data.netEnergyKwh.toFixed(3)}`
                        : data.netEnergyKwh.toFixed(3)
                      : "0.000"}
                  </span>
                  <span className="text-slate-400 font-medium text-sm">kWh</span>
                  <span className="text-xs font-mono text-slate-500 ml-1">
                    ({(data?.netEnergyWattHours ?? 0) > 0 ? `+${data?.netEnergyWattHours}` : data?.netEnergyWattHours ?? 0} Wh)
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                {isPeriodNetPositive
                  ? "Balanço positivo: a geração solar superou o consumo total nas últimas 24 horas."
                  : "Balanço deficitário: a residência demandou mais energia do que a captação solar nas 24h."}
              </p>
            </div>
          </div>
        </div>

        {/* Economia Financeira Real (Solar & Bateria) */}
        {data?.financialSavings && (
          <section
            aria-label="Economia Financeira Real"
            className="animate-card stagger-4 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5"
          >
            {/* Topo do Card: Título, ícone e Tarifa */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0 border border-emerald-500/20">
                  <DollarSign className="w-5 h-5 animate-float" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                    Economia Financeira Real (Solar &amp; Bateria)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Conversão econômica direta da energia solar gerada e consumida para alívio da fatura da concessionária
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                {(() => {
                  const tariff = getTariffPeriodBadge(
                    data.financialSavings.currentTariffPeriod,
                    data.financialSavings.currentTariffRate,
                    data.financialSavings.isDynamicTariffActive
                  );
                  return (
                    <span className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm ${tariff.classes}`}>
                      <span className={`w-2 h-2 rounded-full ${tariff.dot}`} />
                      {tariff.label}
                    </span>
                  );
                })()}
                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 shadow-sm">
                  <Zap className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  Tarifa: {formatCurrency(data.financialSavings.currentTariffRate ?? data.financialSavings.energyCostPerKwh, data.financialSavings.currencySymbol)} / kWh
                </span>
                {data.autonomyEstimate && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-full bg-slate-950 text-sky-300 border border-slate-800">
                    <Timer className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                    {data.autonomyEstimate.isRecharging
                      ? "Carga Solar Ativa"
                      : `Autonomia: ~${data.autonomyEstimate.formattedRuntime}`}
                  </span>
                )}
              </div>
            </div>

            {/* Grid dos 3 Horizontes Executivos: Hoje, Mês e Total Acumulado */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {/* 1. Horizonte Hoje */}
              <div className="p-4 sm:p-5 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between group hover:border-emerald-500/40 transition-all">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      Economia Hoje
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                      Dia Atual
                    </span>
                  </div>
                  <div className="pt-2">
                    <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono tracking-tight">
                      {formatCurrency(data.financialSavings.todaySavings, data.financialSavings.currencySymbol)}
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      {data.financialSavings.todayKwh.toFixed(2)} kWh gerados no dia
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                  <span>Equivalente tarifário:</span>
                  <span className="font-mono text-emerald-300 font-semibold">100% compensado</span>
                </p>
              </div>

              {/* 2. Horizonte Mês Atual */}
              <div className="p-4 sm:p-5 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between group hover:border-emerald-500/40 transition-all">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      Economia no Mês
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 text-slate-300 border border-slate-800">
                      Mês Corrente
                    </span>
                  </div>
                  <div className="pt-2">
                    <div className="text-2xl sm:text-3xl font-extrabold text-emerald-300 font-mono tracking-tight">
                      {formatCurrency(data.financialSavings.monthSavings, data.financialSavings.currencySymbol)}
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      {data.financialSavings.monthKwh.toFixed(1)} kWh economizados
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                  <span>Projeção mensal:</span>
                  <span className="font-mono text-slate-300 font-semibold">Acumulado do ciclo</span>
                </p>
              </div>

              {/* 3. Horizonte Total Acumulado */}
              <div className="p-4 sm:p-5 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between group hover:border-emerald-500/40 transition-all">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                      Total Acumulado
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800/60">
                      Histórico Geral
                    </span>
                  </div>
                  <div className="pt-2">
                    <div className="text-2xl sm:text-3xl font-extrabold text-slate-100 font-mono tracking-tight">
                      {formatCurrency(data.financialSavings.totalSavings, data.financialSavings.currencySymbol)}
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      {data.financialSavings.totalKwh.toFixed(1)} kWh desde a ativação
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                  <span>Retorno do Investimento:</span>
                  <span className="font-mono text-sky-300 font-semibold">Retorno Direto (ROI)</span>
                </p>
              </div>
            </div>

            {/* Rateio e Distribuição por Faixa Tarifária (Tarifa Branca ANEEL) */}
            <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  <span className="text-xs uppercase font-semibold tracking-wider text-slate-300">
                    Rateio de Economia por Faixa Tarifária (Hoje)
                  </span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  {data.financialSavings.isDynamicTariffActive
                    ? "Tarifa Branca Ativa (Pontas Otimizadas)"
                    : "Tarifa Convencional Ativa"}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                {/* Economia na Ponta */}
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">Economia no Horário de Ponta</span>
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                  </div>
                  <div className="my-1">
                    <span className="text-lg sm:text-xl font-bold font-mono text-rose-300">
                      {formatCurrency(data.financialSavings.peakSavingsToday ?? 0, data.financialSavings.currencySymbol)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Descarga agressiva da bateria
                  </span>
                </div>

                {/* Economia Fora de Ponta */}
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">Economia Fora de Ponta</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  </div>
                  <div className="my-1">
                    <span className="text-lg sm:text-xl font-bold font-mono text-emerald-300">
                      {formatCurrency(data.financialSavings.offPeakSavingsToday ?? 0, data.financialSavings.currencySymbol)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Geração solar direta e autoconsumo
                  </span>
                </div>

                {/* Período Vigente */}
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">Status Tarifário Atual</span>
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="my-1">
                    <span className="text-sm font-bold font-mono text-amber-300">
                      {data.financialSavings.isDynamicTariffActive
                        ? data.financialSavings.currentTariffPeriod === "PEAK"
                          ? "🔴 Horário de Ponta"
                          : data.financialSavings.currentTariffPeriod === "INTERMEDIATE"
                          ? "🟡 Intermediário"
                          : "🟢 Fora de Ponta"
                        : "⚪ Convencional"}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {formatCurrency(data.financialSavings.currentTariffRate ?? data.financialSavings.energyCostPerKwh, data.financialSavings.currencySymbol)} / kWh
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800/40">
                A Tarifa Branca ANEEL tarifará o consumo na ponta em valor substancialmente maior. O sistema Wattflow prioriza o descarregamento das baterias nesse horário crítico para blindar a residência contra os custos mais elevados da rede elétrica.
              </p>
            </div>
          </section>
        )}

        {/* 3. Saúde Operacional da ATS (Chave de Transferência Automática) */}
        <AtsHealthWidget initialData={atsHealth} />

        {/* 4. Painel Analítico: Previsão Solar Preditiva & Diagnóstico BMS (Etapa 2) */}
        <section
          aria-label="Painel Analítico de Previsão Solar e BMS"
          className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6"
        >
          {/* Card Analítico 1: Previsão Solar Preditiva & Histerese Adaptativa */}
          {data?.solarForecast && (
            <div className="animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 shrink-0 border border-amber-500/20">
                      <CloudSun className="w-5 h-5 animate-float" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                        Previsão Solar Preditiva
                      </h3>
                      <p className="text-xs text-slate-400">
                        Irradiância Open-Meteo &amp; Modulação Adaptativa de Descarga
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const badge = getSolarExpectationBadge(data.solarForecast?.expectation);
                    const BadgeIcon = badge.icon;
                    return (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm ${badge.classes}`}>
                        <BadgeIcon className="w-3.5 h-3.5" aria-hidden="true" />
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>

                {/* Banner de Destaque do Limiar */}
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase font-semibold tracking-wider text-slate-400">
                      Limiar de Corte Efetivo
                    </span>
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${
                      data.solarForecast.isAdaptiveActive
                        ? "bg-amber-950 text-amber-300 border-amber-800/60"
                        : "bg-slate-900 text-slate-400 border-slate-800"
                    }`}>
                      {data.solarForecast.isAdaptiveActive ? "Adaptativo Ativo" : "Estático / Standby"}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl sm:text-3xl font-extrabold font-mono text-amber-300">
                      ≤ {data.solarForecast.effectiveTurnOffThreshold}%
                    </span>
                    <span className="text-xs text-slate-400">
                      (Corte padrão: 30%)
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed pt-1">
                    {data.solarForecast.forecastSummary}
                  </p>
                </div>

                {/* Grid das 3 Métricas Solares */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-slate-400 block text-[11px]">Irradiância Prevista</span>
                    <span className="text-base sm:text-lg font-bold font-mono text-slate-200 mt-0.5 block">
                      {data.solarForecast.radiationMj !== null ? `${data.solarForecast.radiationMj.toFixed(1)} MJ/m²` : "--"}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-slate-400 block text-[11px]">Horas de Sol Estimadas</span>
                    <span className="text-base sm:text-lg font-bold font-mono text-slate-200 mt-0.5 block">
                      {data.solarForecast.sunshineDurationSeconds
                        ? `${(data.solarForecast.sunshineDurationSeconds / 3600).toFixed(1)} h`
                        : "--"}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-slate-400 block text-[11px]">Código Meteorológico</span>
                    <span className="text-base sm:text-lg font-bold font-mono text-slate-200 mt-0.5 block">
                      WMO: {data.solarForecast.weatherCode ?? "--"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                <span>Open-Meteo Integration</span>
                <span>Atualização horária</span>
              </div>
            </div>
          )}

          {/* Card Analítico 2: Diagnóstico BMS & Segurança Térmica */}
          {data?.bmsAnalytics && (
            <div className="animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 shrink-0 border border-rose-500/20">
                      <Thermometer className="w-5 h-5 animate-float" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                        Diagnóstico BMS &amp; Segurança Térmica
                      </h3>
                      <p className="text-xs text-slate-400">
                        Telemetria em tempo real das células LiFePO4 e proteção contra sobreaquecimento
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const thermalTheme = getBmsThermalTheme(data.bmsAnalytics?.temperatureCelsius);
                    return (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm ${thermalTheme.badge}`}>
                        <span className={`w-2 h-2 rounded-full ${thermalTheme.bg}`} />
                        {thermalTheme.label}
                      </span>
                    );
                  })()}
                </div>

                {/* Termômetro e Barra de Gradiente Térmico OU Card de Hardware EMS */}
                {data.bmsAnalytics.temperatureCelsius !== null ? (
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase font-semibold tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Thermometer className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
                        Temperatura das Células
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        Pico Histórico:{" "}
                        <strong className="text-slate-200">
                          {data.bmsAnalytics.maxRecordedTemp !== null
                            ? `${data.bmsAnalytics.maxRecordedTemp.toFixed(1)}°C`
                            : "--"}
                        </strong>
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className={`text-3xl sm:text-4xl font-extrabold font-mono tracking-tight ${
                        getBmsThermalTheme(data.bmsAnalytics.temperatureCelsius).text
                      }`}>
                        {`${data.bmsAnalytics.temperatureCelsius.toFixed(1)}°C`}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        (Alerta: {data.bmsAnalytics.thermalWarningThreshold}°C | Corte: {data.bmsAnalytics.thermalShutdownThreshold}°C)
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div
                        className="w-full bg-slate-900 rounded-full h-3 p-0.5 border border-slate-800 overflow-hidden"
                        role="progressbar"
                        aria-valuenow={data.bmsAnalytics.temperatureCelsius}
                        aria-valuemin={20}
                        aria-valuemax={60}
                        aria-label="Temperatura das células da bateria EcoFlow"
                      >
                        <div
                          className={`h-full rounded-full transition-all duration-700 ease-out ${
                            data.bmsAnalytics.temperatureCelsius < 38
                              ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                              : data.bmsAnalytics.temperatureCelsius <= 45
                              ? "bg-gradient-to-r from-emerald-500 via-amber-400 to-amber-500"
                              : "bg-gradient-to-r from-amber-500 via-rose-500 to-red-600 animate-pulse"
                          }`}
                          style={{
                            width: `${Math.max(5, Math.min(100, (((data.bmsAnalytics.temperatureCelsius) - 20) / 40) * 100))}%`,
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-slate-500">
                        <span>20°C (Fria)</span>
                        <span className="text-amber-500/80">38°C (Atenção)</span>
                        <span className="text-rose-500/80">50°C (Corte AC)</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-emerald-900/50 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase font-semibold tracking-wider text-emerald-300 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                        Hardware EMS Ativo / Proteção Térmica Integrada
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800/60">
                        EcoFlow River 2
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      O hardware EcoFlow gerencia a proteção térmica internamente no firmware do BMS (corte automático a &lt; 0°C e &gt; 45°C na carga, e &gt; 60°C na descarga). Células LiFePO4 protegidas ativamente pelo controlador embarcado.
                    </p>
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] font-mono text-slate-400 border-t border-slate-900">
                      <span>Subtemperatura Carga: &lt; 0°C</span>
                      <span>•</span>
                      <span>Sobretemperatura Carga: &gt; 45°C</span>
                      <span>•</span>
                      <span>Sobretemperatura Descarga: &gt; 60°C</span>
                    </div>
                  </div>
                )}

                {/* Grid com SOH %, Ciclos BMS e Tensão (Apenas Modelos com 100% de Compatibilidade Nativa) OU Painel Transparente */}
                {(!data.bmsAnalytics.isAnalyticalBms && data.bmsAnalytics.temperatureCelsius !== null) ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                    <div className="p-3 sm:p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Saúde Química (SOH)
                        </span>
                        <Gauge className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      </div>
                      <div className="flex items-center gap-2.5 my-2">
                        <div className="relative w-11 h-11 shrink-0 flex items-center justify-center">
                          <svg className="w-11 h-11 transform -rotate-90" viewBox="0 0 36 36">
                            <path
                              className="text-slate-800"
                              strokeWidth="3.5"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                            <path
                              className="text-emerald-400 transition-all duration-700 ease-out"
                              strokeDasharray={`${Math.max(0, Math.min(100, data.bmsAnalytics.sohPercentage ?? 100))}, 100`}
                              strokeWidth="3.5"
                              strokeLinecap="round"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                          </svg>
                          <span className="absolute text-[11px] font-bold font-mono text-slate-100">
                            {data.bmsAnalytics.sohPercentage ?? "--"}%
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="font-bold text-emerald-300 block">
                            {(data.bmsAnalytics.sohPercentage ?? 100) >= 90 ? "Excelente" : "Degradação Leve"}
                          </span>
                          <span className="text-[10px] text-slate-400">LiFePO4 Cells</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">Retenção de Carga</span>
                    </div>

                    <div className="p-3 sm:p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Ciclos BMS
                        </span>
                        <RefreshCw className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                      </div>
                      <div className="my-1.5">
                        <div className="text-xl sm:text-2xl font-extrabold font-mono text-slate-100 flex items-baseline gap-1.5">
                          <span>
                            {data.bmsAnalytics.bmsCycles !== null ? data.bmsAnalytics.bmsCycles : "--"}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">/ ~3.000 ciclos nominais</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">Contagem DOD</span>
                    </div>

                    <div className="p-3 sm:p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Tensão Barramento
                        </span>
                        <Zap className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                      </div>
                      <div className="my-1.5">
                        <div className="text-xl sm:text-2xl font-extrabold font-mono text-amber-300 flex items-baseline gap-1.5">
                          <span>
                            {data.bmsAnalytics.voltageVolts !== null ? `${data.bmsAnalytics.voltageVolts.toFixed(1)} V` : "-- V"}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                          Corrente: {data.bmsAnalytics.amperageAmps !== null ? `${data.bmsAnalytics.amperageAmps.toFixed(1)} A` : "-- A"}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">Barramento CC</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 sm:p-5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        <Cpu className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-200">
                          Telemetria de Células &amp; BMS Integrada
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          Gerenciamento autônomo pelo controlador de fábrica da EcoFlow
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Para esta estação portátil (família EcoFlow River 2), o balanceamento das células LiFePO4, a integridade química e a proteção térmica operam de forma autônoma pelo firmware embarcado de fábrica (sem expor as sondas de células na Open API para desenvolvedores). A telemetria aberta de células é nativa na linha DELTA.
                    </p>
                    <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] text-slate-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-slate-300">
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                        <span>Proteção e balanceamento ativo pelo firmware do hardware</span>
                      </span>
                      <span className="text-[10px] font-mono text-cyan-400/90 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-800/40 self-start sm:self-auto">
                        Telemetria aberta de células: Linha DELTA
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                <span>EcoFlow BMS Protocol</span>
                <span>Proteção Ativa</span>
              </div>
            </div>
          )}
        </section>

        {/* 5. Painel Analítico de Cargas & Projeção de Autonomia (Etapa 4) */}
        {data?.applianceSimulation && (
          <section
            aria-label="Projeção Analítica de Cargas e Autonomia"
            className="animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 shrink-0 border border-cyan-500/20">
                  <Layers className="w-5 h-5 animate-float" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                    Projeção Analítica de Autonomia &amp; Perfil de Cargas
                  </h3>
                  <p className="text-xs text-slate-400">
                    Balanço entre a telemetria medida em tempo real e a simulação de cargas ativas
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-700/60 shadow-sm">
                  <BatteryCharging className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                  {data.applianceSimulation.activeAppliancesCount} / {data.applianceSimulation.totalAppliancesCount} Aparelhos Ativos
                </span>
              </div>
            </div>

            {/* Grid dos 4 Indicadores Analíticos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {/* 1. Potência Simulada */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    Demanda Simulada
                  </span>
                  <div className="text-2xl sm:text-3xl font-extrabold text-amber-300 font-mono tracking-tight mt-2">
                    {data.applianceSimulation.totalSimulatedWatts} W
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800/60 font-mono">
                  Soma das cargas ativas
                </p>
              </div>

              {/* 2. Autonomia Simulada */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5 text-emerald-400" />
                    Autonomia Simulada
                  </span>
                  <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono tracking-tight mt-2">
                    {data.applianceSimulation.formattedSimulatedRuntime}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800/60 font-mono">
                  Duração estimada com as cargas
                </p>
              </div>

              {/* 3. Autonomia Real Medida */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    Autonomia Real Medida
                  </span>
                  <div className="text-2xl sm:text-3xl font-extrabold text-sky-300 font-mono tracking-tight mt-2">
                    {data.applianceSimulation.formattedBaselineRuntime}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800/60 font-mono">
                  Baseado na saída AC atual
                </p>
              </div>

              {/* 4. Delta de Impacto */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    Variação Temporal
                  </span>
                  <div className={`text-2xl sm:text-3xl font-extrabold font-mono tracking-tight mt-2 ${
                    (data.applianceSimulation.runtimeDeltaMinutes ?? 0) >= 0
                      ? "text-emerald-400"
                      : "text-amber-400"
                  }`}>
                    {data.applianceSimulation.runtimeDeltaMinutes !== null
                      ? `${data.applianceSimulation.runtimeDeltaMinutes >= 0 ? "+" : ""}${Math.floor(
                          Math.abs(data.applianceSimulation.runtimeDeltaMinutes) / 60
                        )}h ${Math.abs(data.applianceSimulation.runtimeDeltaMinutes) % 60}m`
                      : "--"}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800/60 font-mono">
                  {(data.applianceSimulation.runtimeDeltaMinutes ?? 0) >= 0
                    ? "Economia de tempo projetada"
                    : "Redução de tempo por carga extra"}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Curva de Amortização & Payback Solar (Amortização do CAPEX e ROI) */}
        <PaybackAmortizationChart />

        {/* 5. Histórico Multitemporal & Análise Avançada */}
        <section
          aria-label="Histórico Multitemporal e Curva Sobreposta"
          className="animate-card stagger-6 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5"
        >
          {/* Topo do Card: Título, Filtros por Abas e Ações de Exportação */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                <h3 className="font-bold text-lg text-slate-100">
                  Histórico Multitemporal & Análise Avançada
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                Filtre por períodos, compare a geração de hoje contra ontem e exporte relatórios consolidados
              </p>
            </div>

            {/* Ações: Exportar Relatório e Imprimir/PDF (Ocultos na impressão) */}
            <div className="flex flex-wrap items-center gap-2.5 no-print">
              <button
                type="button"
                onClick={() => setIsReportModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 transition-all shadow-md shadow-emerald-950 cursor-pointer"
                aria-label="Abrir módulo de relatórios analíticos e exportação"
              >
                <FileSpreadsheet className="w-4 h-4 text-white" aria-hidden="true" />
                <span>Exportar Relatório</span>
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 active:scale-95 transition-all shadow-sm cursor-pointer"
                aria-label="Imprimir relatório executivo ou salvar como PDF"
              >
                <Printer className="w-4 h-4 text-sky-400" aria-hidden="true" />
                <span>Imprimir Página</span>
              </button>
            </div>
          </div>

          {/* Barra de Filtros por Abas em Pills */}
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="flex flex-wrap p-1 rounded-xl bg-slate-950 border border-slate-800/90 gap-1 max-w-full">
              {(
                [
                  { id: "today-vs-yesterday", label: "Hoje vs Ontem" },
                  { id: "24h", label: "24 Horas" },
                  { id: "7d", label: "7 Dias" },
                  { id: "30d", label: "30 Dias" },
                  { id: "year", label: "Anual" },
                ] as const
              ).map((tab) => {
                const isActive = selectedRange === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setSelectedRange(tab.id);
                      setHoveredHistPoint(null);
                      setHoveredCompPoint(null);
                    }}
                    className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                      isActive
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {isHistoryLoading && (
              <span className="text-xs font-mono text-emerald-400 flex items-center gap-1.5 animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Atualizando série...
              </span>
            )}
          </div>

          {/* Grid de Resumo Executivo da Janela Selecionada */}
          {historyData?.summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <span className="text-[11px] font-mono text-slate-400 uppercase block">Geração Solar</span>
                <div className="text-lg font-bold font-mono text-amber-400 mt-0.5">
                  {historyData.summary.totalSolarGeneratedKwh.toFixed(2)} kWh
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  Pico: {historyData.summary.peakSolarWatts} W
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <span className="text-[11px] font-mono text-slate-400 uppercase block">Consumo Residencial</span>
                <div className="text-lg font-bold font-mono text-sky-300 mt-0.5">
                  {historyData.summary.totalConsumedKwh.toFixed(2)} kWh
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  Pico: {historyData.summary.peakOutputWatts} W
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <span className="text-[11px] font-mono text-slate-400 uppercase block">Economia Estimada</span>
                <div className="text-lg font-bold font-mono text-emerald-400 mt-0.5">
                  R$ {historyData.summary.estimatedSavingsBrl.toFixed(2)}
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  Saldo: {historyData.summary.netEnergyKwh >= 0 ? "+" : ""}{historyData.summary.netEnergyKwh.toFixed(2)} kWh
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <span className="text-[11px] font-mono text-slate-400 uppercase block">Cobertura Solar</span>
                <div className="text-lg font-bold font-mono text-emerald-300 mt-0.5">
                  {historyData.summary.gridAvoidancePercentage.toFixed(1)}%
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  Bateria Média: {historyData.summary.averageBatteryPercentage.toFixed(0)}%
                </span>
              </div>
            </div>
          )}

          {/* Renderização do Gráfico conforme o Modo Selecionado */}
          {historyError ? (
            <div className="py-12 px-4 text-center rounded-xl bg-slate-950/60 border border-rose-900/40 space-y-3">
              <div className="text-sm font-medium text-rose-400">
                {historyError}
              </div>
              <button
                type="button"
                onClick={() => fetchHistory(selectedRange)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-200 hover:text-emerald-300 hover:border-emerald-500/50 transition-all cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Tentar Novamente
              </button>
            </div>
          ) : isHistoryLoading && !historyData ? (
            <div className="py-16 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
              <span>Carregando dados do histórico...</span>
            </div>
          ) : selectedRange === "today-vs-yesterday" ? (
            /* ==============================================================
               MODO A: CURVA SOBREPOSTA HOJE VS ONTEM
               ============================================================== */
            !historyData?.comparison ? (
              <div className="py-16 text-center text-slate-500 text-sm">
                Carregando dados comparativos de Hoje vs Ontem...
              </div>
            ) : (
              <div className="space-y-3">
                {/* Header da Comparação com Badge de Divergência Solar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/80 border border-slate-800/90 p-3.5 rounded-xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono text-slate-400">Eficiência Fotovoltaica Comparativa:</span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                        historyData.comparison.divergencePercentage >= 0
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                          : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      }`}
                    >
                      {historyData.comparison.divergencePercentage >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" />
                      )}
                      {historyData.comparison.divergencePercentage >= 0 ? "+" : ""}
                      {historyData.comparison.divergencePercentage.toFixed(1)}% vs ontem
                    </span>
                  </div>

                  {/* Legenda das Séries */}
                  <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-1 bg-emerald-500 rounded-full shadow-sm shadow-emerald-500/50" />
                      <span className="text-slate-200 font-bold">
                        Hoje ({historyData.comparison.todayTotalKwh.toFixed(2)} kWh)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-1 border-t-2 border-dashed border-slate-400" />
                      <span className="text-slate-400">
                        Ontem ({historyData.comparison.yesterdayTotalKwh.toFixed(2)} kWh)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Área SVG da Curva Sobreposta */}
                {(() => {
                  const comp = historyData.comparison;
                  const todayPts = comp.todayPoints;
                  const yesterdayPts = comp.yesterdayPoints;
                  const totalDaySlots = 96;
                  const maxPtsCount = Math.max(todayPts.length, yesterdayPts.length, totalDaySlots);

                  const maxWatts = Math.max(
                    comp.todayPeakWatts,
                    comp.yesterdayPeakWatts,
                    ...(todayPts.map((p) => p.solarWatts) || [0]),
                    ...(yesterdayPts.map((p) => p.solarWatts) || [0]),
                    100
                  );
                  const scaleMax = calculateScaleMax(maxWatts);
                  const scaleMid = Math.round(scaleMax / 2);

                  const svgW = 1000;
                  const svgH = 220;
                  const padX = 35;
                  const padTop = 20;
                  const padBottom = 25;
                  const chartW = svgW - padX * 2;
                  const chartH = svgH - padTop - padBottom;
                  const yZero = svgH - padBottom;

                  // Alinhamento temporal correto em 96 slots de 15 minutos (24 horas)
                  const getTodayX = (i: number) => padX + (i / (totalDaySlots - 1)) * chartW;
                  const getYesterdayX = (i: number, total: number) =>
                    padX + (total > 1 ? (i / (total - 1)) * chartW : chartW / 2);
                  const getY = (watts: number) => {
                    const clamped = Math.max(0, Math.min(watts, scaleMax));
                    return yZero - (clamped / scaleMax) * chartH;
                  };

                  const todayPath = todayPts
                    .map((p, i) => `${i === 0 ? "M" : "L"} ${getTodayX(i).toFixed(1)} ${getY(p.solarWatts).toFixed(1)}`)
                    .join(" ");
                  const todayArea =
                    todayPts.length > 0
                      ? `${todayPath} L ${getTodayX(todayPts.length - 1).toFixed(1)} ${yZero} L ${getTodayX(0).toFixed(1)} ${yZero} Z`
                      : "";

                  const yesterdayPath = yesterdayPts
                    .map((p, i) => `${i === 0 ? "M" : "L"} ${getYesterdayX(i, yesterdayPts.length).toFixed(1)} ${getY(p.solarWatts).toFixed(1)}`)
                    .join(" ");

                  return (
                    <div className="relative h-52 sm:h-64 w-full pt-6 pb-2 px-1">
                      {/* Linhas de Grade de Escala */}
                      <div className="absolute inset-x-1 inset-y-0 pt-6 pb-6 pointer-events-none flex flex-col justify-between z-0">
                        <div className="w-full flex items-center justify-between border-b border-dashed border-slate-800/70">
                          <span className="text-xs font-mono text-slate-400 select-none -translate-y-2">
                            {scaleMax} W
                          </span>
                        </div>
                        <div className="w-full flex items-center justify-between border-b border-dashed border-slate-800/40">
                          <span className="text-xs font-mono text-slate-400 select-none -translate-y-2">
                            {scaleMid} W
                          </span>
                        </div>
                        <div className="w-full flex items-center justify-between border-b border-slate-800/90">
                          <span className="text-xs font-mono text-slate-400 select-none -translate-y-2">
                            0 W
                          </span>
                        </div>
                      </div>

                      <svg
                        viewBox={`0 0 ${svgW} ${svgH}`}
                        preserveAspectRatio="none"
                        className="w-full h-full relative z-10 overflow-visible"
                      >
                        <defs>
                          <linearGradient id="todaySolarGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* Área sob a curva de hoje */}
                        <path d={todayArea} fill="url(#todaySolarGrad)" />

                        {/* Curva de Ontem: Cinza tracejada */}
                        <path
                          d={yesterdayPath}
                          fill="none"
                          stroke="#94a3b8"
                          strokeWidth="2"
                          strokeDasharray="5 4"
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />

                        {/* Curva de Hoje: Verde esmeralda contínua */}
                        <path
                          d={todayPath}
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="2.5"
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />

                        {/* Marcadores circulares em Hoje */}
                        {todayPts.map((p, i) => (
                          <circle
                            key={i}
                            cx={getTodayX(i)}
                            cy={getY(p.solarWatts)}
                            r={3}
                            fill="#10b981"
                            stroke="#0f172a"
                            strokeWidth="1.5"
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                      </svg>

                      {/* Fatias transparentes de captura de hover/touch para Tooltip Comparativo */}
                      <div className="history-chart-points absolute inset-0 pt-6 pb-6 px-1 flex items-stretch justify-between z-20">
                        {Array.from({ length: maxPtsCount }).map((_, idx) => {
                          const ptToday = todayPts[idx];
                          const ptYesterday = yesterdayPts[idx];
                          const time =
                            ptToday?.time ||
                            ptYesterday?.time ||
                            `${Math.floor((idx * 15) / 60)
                              .toString()
                              .padStart(2, "0")}:${((idx * 15) % 60).toString().padStart(2, "0")}`;
                          const diff =
                            ptToday !== undefined
                              ? ptToday.solarWatts - (ptYesterday?.solarWatts ?? 0)
                              : null;
                          const isSelected =
                            hoveredCompPoint?.today === ptToday && hoveredCompPoint?.yesterday === ptYesterday;

                          return (
                            <div
                              key={idx}
                              onMouseEnter={() =>
                                setHoveredCompPoint({ today: ptToday, yesterday: ptYesterday, time })
                              }
                              onMouseLeave={() => setHoveredCompPoint(null)}
                              onTouchStart={() =>
                                setHoveredCompPoint({ today: ptToday, yesterday: ptYesterday, time })
                              }
                              onPointerDown={() =>
                                setHoveredCompPoint({ today: ptToday, yesterday: ptYesterday, time })
                              }
                              className="history-chart-point flex-1 min-w-0 h-full relative cursor-pointer group flex items-start justify-center"
                            >
                              <div
                                className={`history-chart-tooltip transition-all duration-150 pointer-events-none absolute -top-12 z-30 bg-slate-950/95 border border-slate-700 text-slate-100 px-3 py-1.5 rounded-lg text-[10px] sm:text-[11px] whitespace-normal sm:whitespace-nowrap max-w-[280px] sm:max-w-none shadow-2xl backdrop-blur-md flex items-center gap-2 ${
                                  isSelected ? "opacity-100 scale-100" : "opacity-0 group-hover:opacity-100 scale-95"
                                } ${
                                  idx < 4
                                    ? "left-0"
                                    : idx > maxPtsCount - 5
                                    ? "right-0"
                                    : "left-1/2 -translate-x-1/2"
                                }`}
                              >
                                <span className="text-slate-400 font-mono">{time}:</span>
                                {ptToday !== undefined ? (
                                  <>
                                    <span className="font-bold text-emerald-400 font-mono">
                                      Hoje: {ptToday.solarWatts}W
                                    </span>
                                    <span className="text-slate-600">•</span>
                                    <span className="font-bold text-slate-300 font-mono">
                                      Ontem: {ptYesterday?.solarWatts ?? 0}W
                                    </span>
                                    {diff !== null && (
                                      <>
                                        <span className="text-slate-600">•</span>
                                        <span
                                          className={`font-mono font-bold ${
                                            diff >= 0 ? "text-emerald-300" : "text-amber-400"
                                          }`}
                                        >
                                          {diff >= 0 ? `+${diff}W` : `${diff}W`}
                                        </span>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <span className="font-medium text-slate-400 font-mono text-[10px]">
                                      Hoje: Aguardando leitura
                                    </span>
                                    <span className="text-slate-600">•</span>
                                    <span className="font-bold text-slate-300 font-mono">
                                      Ontem: {ptYesterday?.solarWatts ?? 0}W
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Eixo X com marcações de 00:00, Meio-dia e 23:45 */}
                <div className="flex justify-between items-center text-[11px] text-slate-400 font-mono px-3 pt-2 border-t border-slate-800/80">
                  <span>00:00 (Madrugada)</span>
                  <span className="text-slate-500 hidden sm:inline">12:00 (Zênite Solar)</span>
                  <span>23:59 (Noite)</span>
                </div>
              </div>
            )
          ) : (
            /* ==============================================================
               MODO B: MULTI-SÉRIES TEMPORAIS (24H, 7D, 30D, YEAR)
               ============================================================== */
            !historyData?.points || historyData.points.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-sm">
                Nenhuma leitura consolidada disponível para este período.
              </div>
            ) : (
              <div className="space-y-3">
                {/* Legenda visual com as 3 séries */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono bg-slate-950/70 border border-slate-800/90 px-3.5 py-2.5 rounded-xl">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-0.5 bg-amber-400 rounded-full" />
                      <span className="text-slate-300">Geração Solar (W)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-0.5 bg-sky-400 rounded-full" />
                      <span className="text-slate-300">Consumo Residencial (W)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-0.5 bg-emerald-400 rounded-full" />
                      <span className="text-slate-300">Balanço Líquido (W)</span>
                    </div>
                  </div>
                  <span className="text-slate-400">
                    Pontos consolidadores: <strong>{historyData.points.length}</strong>
                  </span>
                </div>

                {/* SVG do Histórico Agregado */}
                {(() => {
                  const pts = historyData.points;
                  const ptsCount = pts.length;
                  const maxVal = Math.max(
                    ...pts.map((p) => Math.max(p.solarWatts, p.outputWatts, Math.abs(p.netWatts))),
                    100
                  );
                  const scaleMax = calculateScaleMax(maxVal);
                  const scaleMid = Math.round(scaleMax / 2);

                  const svgW = 1000;
                  const svgH = 220;
                  const padX = 35;
                  const padTop = 20;
                  const padBottom = 25;
                  const chartW = svgW - padX * 2;
                  const chartH = svgH - padTop - padBottom;
                  const yZero = svgH - padBottom;

                  const getX = (i: number) =>
                    padX + (ptsCount > 1 ? (i / (ptsCount - 1)) * chartW : chartW / 2);
                  const getY = (watts: number) => {
                    const clamped = Math.max(0, Math.min(watts, scaleMax));
                    return yZero - (clamped / scaleMax) * chartH;
                  };

                  const solarPath = pts
                    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(p.solarWatts).toFixed(1)}`)
                    .join(" ");
                  const solarArea =
                    pts.length > 0
                      ? `${solarPath} L ${getX(ptsCount - 1).toFixed(1)} ${yZero} L ${getX(0).toFixed(1)} ${yZero} Z`
                      : "";

                  const outputPath = pts
                    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(p.outputWatts).toFixed(1)}`)
                    .join(" ");
                  const outputArea =
                    pts.length > 0
                      ? `${outputPath} L ${getX(ptsCount - 1).toFixed(1)} ${yZero} L ${getX(0).toFixed(1)} ${yZero} Z`
                      : "";

                  const netPath = pts
                    .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(Math.max(0, p.netWatts)).toFixed(1)}`)
                    .join(" ");

                  return (
                    <div className="relative h-52 sm:h-64 w-full pt-6 pb-2 px-1">
                      {/* Linhas de Grade de Escala */}
                      <div className="absolute inset-x-1 inset-y-0 pt-6 pb-6 pointer-events-none flex flex-col justify-between z-0">
                        <div className="w-full flex items-center justify-between border-b border-dashed border-slate-800/70">
                          <span className="text-xs font-mono text-slate-400 select-none -translate-y-2">
                            {scaleMax} W
                          </span>
                        </div>
                        <div className="w-full flex items-center justify-between border-b border-dashed border-slate-800/40">
                          <span className="text-xs font-mono text-slate-400 select-none -translate-y-2">
                            {scaleMid} W
                          </span>
                        </div>
                        <div className="w-full flex items-center justify-between border-b border-slate-800/90">
                          <span className="text-xs font-mono text-slate-400 select-none -translate-y-2">
                            0 W
                          </span>
                        </div>
                      </div>

                      <svg
                        viewBox={`0 0 ${svgW} ${svgH}`}
                        preserveAspectRatio="none"
                        className="w-full h-full relative z-10 overflow-visible"
                      >
                        <defs>
                          <linearGradient id="histSolarGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                          </linearGradient>
                          <linearGradient id="histOutGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.18" />
                            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* Áreas */}
                        <path d={solarArea} fill="url(#histSolarGrad)" />
                        <path d={outputArea} fill="url(#histOutGrad)" />

                        {/* Linhas */}
                        <path
                          d={solarPath}
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth="2.5"
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d={outputPath}
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="2.5"
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d={netPath}
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="2"
                          strokeDasharray="5 3"
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />

                        {/* Pontos circulares */}
                        {pts.map((p, i) => (
                          <circle
                            key={i}
                            cx={getX(i)}
                            cy={getY(p.solarWatts)}
                            r={3.5}
                            fill="#f59e0b"
                            stroke="#0f172a"
                            strokeWidth="1.5"
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                      </svg>

                      {/* Fatias de hover/touch */}
                      <div className="history-chart-points absolute inset-0 pt-6 pb-6 px-1 flex items-stretch justify-between z-20">
                        {pts.map((point, i) => {
                          const isSelected = hoveredHistPoint === point;
                          return (
                            <div
                              key={i}
                              onMouseEnter={() => setHoveredHistPoint(point)}
                              onMouseLeave={() => setHoveredHistPoint(null)}
                              onTouchStart={() => setHoveredHistPoint(point)}
                              onPointerDown={() => setHoveredHistPoint(point)}
                              className="history-chart-point flex-1 min-w-0 h-full relative cursor-pointer group flex items-start justify-center"
                            >
                              <div
                                className={`history-chart-tooltip transition-all duration-150 pointer-events-none absolute -top-12 z-30 bg-slate-950/95 border border-slate-700 text-slate-100 px-3 py-1.5 rounded-lg text-[10px] sm:text-[11px] whitespace-normal sm:whitespace-nowrap max-w-[280px] sm:max-w-none shadow-2xl backdrop-blur-md flex items-center gap-2 ${
                                  isSelected ? "opacity-100 scale-100" : "opacity-0 group-hover:opacity-100 scale-95"
                                } ${
                                  i < 3
                                    ? "left-0"
                                    : i > ptsCount - 4
                                    ? "right-0"
                                    : "left-1/2 -translate-x-1/2"
                                }`}
                              >
                                <span className="text-slate-400 font-mono">{point.label}:</span>
                                <span className="font-bold text-amber-400 font-mono">{point.solarWatts}W Sol</span>
                                <span className="text-slate-600">•</span>
                                <span className="font-bold text-sky-300 font-mono">{point.outputWatts}W Uso</span>
                                <span className="text-slate-600">•</span>
                                <span
                                  className={`font-mono font-bold ${
                                    point.netWatts >= 0 ? "text-emerald-300" : "text-amber-400"
                                  }`}
                                >
                                  {point.netWatts > 0 ? `+${point.netWatts}` : point.netWatts}W Bal
                                </span>
                                <span className="text-slate-600">•</span>
                                <span className="text-emerald-400 font-mono">{point.batteryPercentage}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Eixos */}
                <div className="flex justify-between items-center text-[11px] text-slate-400 font-mono px-3 pt-2 border-t border-slate-800/80">
                  <span>{historyData.points[0]?.label || "Início"}</span>
                  <span className="text-slate-500 hidden sm:inline">Período consolidado</span>
                  <span>{historyData.points[historyData.points.length - 1]?.label || "Fim"}</span>
                </div>
              </div>
            )
          )}
        </section>

        {/* 5. Tabela com as Amostras Detalhadas da Janela */}
        <section
          aria-label="Tabela de Amostras de Telemetria"
          className="animate-card stagger-7 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-400" aria-hidden="true" />
              <h3 className="font-bold text-slate-100">Amostras Detalhadas da Janela (Últimos 30 Minutos)</h3>
            </div>
            <span className="text-xs font-mono text-slate-400">
              Exibindo {data?.recentLogs.length ?? 0} amostras
            </span>
          </div>

          {!data?.recentLogs || data.recentLogs.length === 0 ? (
            <div className="text-center py-6 sm:py-8 text-slate-500 text-sm">
              Nenhuma amostra salva no banco de dados.
            </div>
          ) : (
            <>
              {/* Mobile View: Cards Verticais / Timeline (< md) */}
              <div className="md:hidden space-y-3">
                {data.recentLogs.map((log) => {
                  const hasSolar = log.solarInputWatts > 0;
                  const hasOutput = (log.outputWatts ?? 0) > 0;
                  const net = log.solarInputWatts - (log.outputWatts ?? 0);
                  const isNetPositive = net >= 0;

                  return (
                    <div
                      key={log.id}
                      className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 shadow-sm space-y-2 animate-fade-in"
                    >
                      {/* Topo do card: Horário legível à esquerda + Decisão à direita */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500 shrink-0" aria-hidden="true" />
                          {new Date(log.executedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>

                        <div className="shrink-0">
                          {log.actionTriggered === "BATTERY_HIGH_DISCHARGE" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              <ArrowUpRight className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" />
                              Modo Bateria
                            </span>
                          )}
                          {log.actionTriggered === "BATTERY_LOW_RECHARGE" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              <ArrowDownRight className="w-3 h-3 text-amber-400 shrink-0" aria-hidden="true" />
                              Modo Recarga
                            </span>
                          )}
                          {log.actionTriggered === "HOLD_CURRENT_STATE" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                              <Clock className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                              Estável (Histerese)
                            </span>
                          )}
                          {log.actionTriggered !== "BATTERY_HIGH_DISCHARGE" &&
                            log.actionTriggered !== "BATTERY_LOW_RECHARGE" &&
                            log.actionTriggered !== "HOLD_CURRENT_STATE" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                                {log.actionTriggered}
                              </span>
                            )}
                        </div>
                      </div>

                      {/* Métricas em pills */}
                      <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                        <div
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono font-semibold border ${
                            hasSolar
                              ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                              : "bg-slate-900 text-slate-400 border-slate-800"
                          }`}
                        >
                          <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                          <span className="truncate">Solar: {log.solarInputWatts} W</span>
                        </div>

                        <div
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono font-semibold border ${
                            hasOutput
                              ? "bg-sky-500/10 text-sky-300 border-sky-500/20"
                              : "bg-slate-900 text-slate-400 border-slate-800"
                          }`}
                        >
                          <Zap className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
                          <span className="truncate">Saída: {log.outputWatts ?? 0} W</span>
                        </div>

                        <div
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono font-semibold border ${
                            isNetPositive
                              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                          }`}
                        >
                          <span className="truncate">Líquido: {isNetPositive ? "+" : ""}{net} W</span>
                        </div>

                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono font-semibold bg-slate-900 text-slate-200 border border-slate-800">
                          <BatteryCharging className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                          <span className="truncate">SOC: {log.batteryPercentage}%</span>
                        </div>
                      </div>

                      {/* Status / Detalhes dos dispositivos */}
                      {log.executionDetails && (
                        <div className="text-xs text-slate-300 font-sans break-words bg-slate-900/80 p-2 rounded-lg border border-slate-800/50 leading-relaxed">
                          {log.executionDetails}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop & Tablet View: Tabela Tradicional Densa (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300" aria-label="Histórico detalhado de amostras de telemetria">
                  <thead className="text-xs uppercase bg-slate-800/60 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th scope="col" className="py-3 px-4">Horário</th>
                      <th scope="col" className="py-3 px-4">Entrada Solar (PV)</th>
                      <th scope="col" className="py-3 px-4">Saída / Consumo</th>
                      <th scope="col" className="py-3 px-4">Saldo Líquido</th>
                      <th scope="col" className="py-3 px-4">Bateria (SOC)</th>
                      <th scope="col" className="py-3 px-4">Decisão de Automação</th>
                      <th scope="col" className="py-3 px-4">Status dos Dispositivos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {data.recentLogs.map((log) => {
                      const hasSolar = log.solarInputWatts > 0;
                      const hasOutput = (log.outputWatts ?? 0) > 0;
                      const net = log.solarInputWatts - (log.outputWatts ?? 0);
                      const isNetPositive = net >= 0;

                      return (
                        <tr key={log.id} className="hover:bg-slate-800/40 transition-colors duration-150">
                          <td className="py-3 px-4 text-xs font-mono text-slate-400 whitespace-nowrap">
                            {new Date(log.executedAt).toLocaleString("pt-BR")}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold transition-all ${
                                hasSolar
                                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              <Sun className="w-3 h-3 text-amber-400" aria-hidden="true" />
                              {log.solarInputWatts} W
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold transition-all ${
                                hasOutput
                                  ? "bg-sky-500/15 text-sky-300 border border-sky-500/30"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              <Zap className="w-3 h-3 text-sky-400" aria-hidden="true" />
                              {log.outputWatts ?? 0} W
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border transition-all ${
                                isNetPositive
                                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                              }`}
                            >
                              {isNetPositive ? "+" : ""}
                              {net} W
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                            {log.batteryPercentage}%
                          </td>
                          <td className="py-3 px-4 text-xs whitespace-nowrap">
                            {log.actionTriggered === "BATTERY_HIGH_DISCHARGE" && (
                              <span className="text-emerald-400 font-semibold inline-flex items-center gap-1">
                                <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                                Modo Bateria
                              </span>
                            )}
                            {log.actionTriggered === "BATTERY_LOW_RECHARGE" && (
                              <span className="text-amber-400 font-semibold inline-flex items-center gap-1">
                                <ArrowDownRight className="w-3 h-3" aria-hidden="true" />
                                Modo Recarga
                              </span>
                            )}
                            {log.actionTriggered === "HOLD_CURRENT_STATE" && (
                              <span className="text-slate-400">Estável (Histerese)</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-400 truncate max-w-sm">
                            {log.executionDetails || "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Modal de Relatórios Analíticos & Exportação (CSV / PDF) */}
      <ReportExportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
      />
    </Layout>
  );
}
