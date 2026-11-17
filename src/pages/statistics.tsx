import React, { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
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
} from "lucide-react";

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
}

export default function StatisticsPage() {
  const [data, setData] = useState<StatisticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<SolarChartPoint | null>(null);

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
    const interval = setInterval(fetchStatistics, 2000);
    return () => clearInterval(interval);
  }, []);

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

  const isInstantNetPositive = (data?.netWatts ?? 0) >= 0;
  const isPeriodNetPositive = (data?.netEnergyKwh ?? 0) >= 0;

  return (
    <Layout title="Estatísticas de Geração e Consumo">
      <div className="space-y-8 max-w-6xl mx-auto">
        {/* Cabeçalho da Seção */}
        <div className="animate-card stagger-1 interactive-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 backdrop-blur shadow-xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sun className="w-5 h-5 text-amber-400 animate-float" />
              <h2 className="text-xl font-bold text-slate-100">
                Balanço Energético EcoFlow (Últimos 30 Minutos)
              </h2>
            </div>
            <p className="text-sm text-slate-400">
              Histórico dos últimos 30 minutos agrupados pela média de 5 em 5 minutos, comparando geração fotovoltaica, consumo e saldo líquido.
            </p>
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="self-start sm:self-auto px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all duration-150 flex items-center gap-2 shadow-lg shadow-emerald-950/40 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Atualizando..." : "Atualizar Estatísticas"}
          </button>
        </div>

        {/* 1. Potência Instantânea em Tempo Real (3 Cards) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-wider">
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <span>Potência Instantânea (Ao Vivo)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Geração Solar Instantânea */}
            <div className="animate-card stagger-2 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl relative overflow-hidden flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sun className="w-4 h-4 text-amber-400 transition-transform group-hover:rotate-45 duration-300" />
                    Geração Solar
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border transition-all ${
                      (data?.currentWatts ?? 0) > 0
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse-glow"
                        : "bg-slate-800 text-slate-400 border-slate-700"
                    }`}
                  >
                    {(data?.currentWatts ?? 0) > 0 ? "GERANDO" : "STANDBY"}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tracking-tight text-slate-100 font-mono">
                    {data?.currentWatts ?? 0}
                  </span>
                  <span className="text-slate-400 font-medium text-sm">W</span>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                {(data?.currentWatts ?? 0) > 0
                  ? "Entrada solar fotovoltaica captando energia ao vivo."
                  : "Sem radiação solar direta no momento."}
              </p>
            </div>

            {/* Consumo Instantâneo */}
            <div className="animate-card stagger-3 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl relative overflow-hidden flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-sky-400 transition-transform group-hover:scale-110 duration-200" />
                    Consumo em Tempo Real
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border transition-all ${
                      (data?.currentOutputWatts ?? 0) > 0
                        ? "bg-sky-500/20 text-sky-300 border-sky-500/30"
                        : "bg-slate-800 text-slate-400 border-slate-700"
                    }`}
                  >
                    {(data?.currentOutputWatts ?? 0) > 0 ? "EM CARGA" : "SEM CARGA"}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tracking-tight text-sky-300 font-mono">
                    {data?.currentOutputWatts ?? 0}
                  </span>
                  <span className="text-slate-400 font-medium text-sm">W</span>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                Potência entregue pelas saídas AC e DC em tempo real.
              </p>
            </div>

            {/* Balanço Instantâneo (Diferença) */}
            <div className="animate-card stagger-4 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl relative overflow-hidden flex flex-col justify-between group">
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
                      (data?.netWatts ?? 0) > 0
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        : (data?.netWatts ?? 0) < 0
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                        : "bg-slate-800 text-slate-400 border-slate-700"
                    }`}
                  >
                    {(data?.netWatts ?? 0) > 0
                      ? "SUPERÁVIT"
                      : (data?.netWatts ?? 0) < 0
                      ? "DÉFICIT"
                      : "EQUILÍBRIO"}
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-4xl font-extrabold tracking-tight font-mono ${
                      isInstantNetPositive ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {(data?.netWatts ?? 0) > 0
                      ? `+${data?.netWatts}`
                      : data?.netWatts ?? 0}
                  </span>
                  <span className="text-slate-400 font-medium text-sm">W</span>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                {(data?.netWatts ?? 0) > 0
                  ? "Geração supera o consumo. Bateria absorvendo excedente."
                  : (data?.netWatts ?? 0) < 0
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Energia Solar Gerada (24h) */}
            <div className="animate-card stagger-4 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
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
                  <span className="text-4xl font-extrabold tracking-tight text-amber-300 font-mono">
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
            <div className="animate-card stagger-5 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
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
                  <span className="text-4xl font-extrabold tracking-tight text-sky-300 font-mono">
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
            <div className="animate-card stagger-6 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
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
                    className={`text-4xl font-extrabold tracking-tight font-mono ${
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

        {/* 3. Gráfico SVG de Linhas dos Últimos 30 Minutos (Média de 5 em 5 min) */}
        <section
          aria-label="Gráfico dos Últimos 30 Minutos com Média de 5 em 5 min"
          className="animate-card stagger-5 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-amber-400" aria-hidden="true" />
              <h3 className="font-bold text-slate-100">
                Histórico dos Últimos 30 Minutos (Média de 5 em 5 min)
              </h3>
            </div>
            
            {/* Legenda visual com as 3 séries em linhas horizontais */}
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-amber-400 rounded-full shadow-sm shadow-amber-500/50" />
                <span className="text-slate-300">Geração Solar (Média W)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-sky-400 rounded-full shadow-sm shadow-sky-500/50" />
                <span className="text-slate-300">Consumo (Média W)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-emerald-400 rounded-full shadow-sm shadow-emerald-500/50" />
                <span className="text-slate-300">Balanço Líquido (Média W)</span>
              </div>
              <span className="text-slate-500 font-mono">
                Escala: <strong className="text-slate-200">{scaleMaxWatts} W</strong>
              </span>
            </div>
          </div>

          {!data?.chartPoints || data.chartPoints.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              Nenhuma leitura registrada nos últimos 30 minutos. Aguardando novos ciclos de coleta.
            </div>
          ) : (
            <div className="space-y-3">
              {/* Barra de Inspeção Ativa de Telemetria */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono bg-slate-950/70 border border-slate-800/90 px-3.5 py-2.5 rounded-xl text-slate-300">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-400">Intervalo Selecionado (Média 5 min):</span>
                  {hoveredPoint ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-amber-400 font-bold">Geração Média: {hoveredPoint.watts}W</span>
                      <span className="text-slate-600">•</span>
                      <span className="text-sky-300 font-bold">Consumo Médio: {hoveredPoint.outputWatts}W</span>
                      <span className="text-slate-600">•</span>
                      <span
                        className={`font-bold ${
                          hoveredPoint.netWatts >= 0 ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        Balanço Médio: {hoveredPoint.netWatts > 0 ? `+${hoveredPoint.netWatts}` : hoveredPoint.netWatts}W
                      </span>
                      <span className="text-slate-600">•</span>
                      <span className="text-emerald-400 font-semibold">{hoveredPoint.battery}% Bat</span>
                      <span className="text-slate-600">•</span>
                      <span className="text-slate-300">{hoveredPoint.time}</span>
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">Passe o mouse sobre os pontos para inspecionar</span>
                  )}
                </div>
                <div className="text-slate-400">
                  Intervalos com dados: <strong className="text-slate-200 font-bold">{data.chartPoints.length} de 6</strong>
                </div>
              </div>

              {/* Área do Gráfico de Linhas Contínuas (SVG Vetorial 100% da Largura) */}
              {(() => {
                const points = data.chartPoints;
                const pointCount = points.length;
                const svgW = 1000;
                const svgH = 220;
                const padX = 35;
                const padTop = 20;
                const padBottom = 25;
                const chartW = svgW - padX * 2;
                const chartH = svgH - padTop - padBottom;
                const yZero = svgH - padBottom;

                const getX = (i: number) => padX + (pointCount > 1 ? (i / (pointCount - 1)) * chartW : chartW / 2);
                const getY = (watts: number) => {
                  const clamped = Math.max(0, Math.min(watts, scaleMaxWatts));
                  return yZero - (clamped / scaleMaxWatts) * chartH;
                };

                const solarPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(p.watts).toFixed(1)}`).join(" ");
                const solarArea = points.length > 0
                  ? `${solarPath} L ${getX(pointCount - 1).toFixed(1)} ${yZero} L ${getX(0).toFixed(1)} ${yZero} Z`
                  : "";

                const outputPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(p.outputWatts).toFixed(1)}`).join(" ");
                const outputArea = points.length > 0
                  ? `${outputPath} L ${getX(pointCount - 1).toFixed(1)} ${yZero} L ${getX(0).toFixed(1)} ${yZero} Z`
                  : "";

                const netPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(Math.max(0, p.netWatts)).toFixed(1)}`).join(" ");
                const netArea = points.length > 0
                  ? `${netPath} L ${getX(pointCount - 1).toFixed(1)} ${yZero} L ${getX(0).toFixed(1)} ${yZero} Z`
                  : "";

                return (
                  <div className="relative h-64 w-full pt-6 pb-2 px-1">
                    {/* Linhas de Grade de Escala (Eixo Y com marcadores) */}
                    <div className="absolute inset-x-1 inset-y-0 pt-6 pb-6 pointer-events-none flex flex-col justify-between z-0">
                      {/* Topo: Escala Máxima */}
                      <div className="w-full flex items-center justify-between border-b border-dashed border-slate-800/70">
                        <span className="text-[10px] font-mono text-slate-500 select-none -translate-y-2">
                          {scaleMaxWatts} W
                        </span>
                      </div>
                      {/* Meio: 50% da Escala */}
                      <div className="w-full flex items-center justify-between border-b border-dashed border-slate-800/40">
                        <span className="text-[10px] font-mono text-slate-500 select-none -translate-y-2">
                          {scaleMidWatts} W
                        </span>
                      </div>
                      {/* Base: 0W */}
                      <div className="w-full flex items-center justify-between border-b border-slate-800/90">
                        <span className="text-[10px] font-mono text-slate-500 select-none -translate-y-2">
                          0 W
                        </span>
                      </div>
                    </div>

                    {/* Canvas Vetorial em SVG ocupando 100% da largura do card */}
                    <svg
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      preserveAspectRatio="none"
                      className="w-full h-full relative z-10 overflow-visible"
                    >
                      <defs>
                        <linearGradient id="solarLineGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.30" />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                        </linearGradient>
                        <linearGradient id="outputLineGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.22" />
                          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                        </linearGradient>
                        <linearGradient id="netLineGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Áreas sombreadas sob as curvas */}
                      <path d={solarArea} fill="url(#solarLineGrad)" />
                      <path d={outputArea} fill="url(#outputLineGrad)" />
                      <path d={netArea} fill="url(#netLineGrad)" />

                      {/* Linha vertical tracejada do ponto selecionado via hover */}
                      {hoveredPoint && (
                        <line
                          x1={getX(points.indexOf(hoveredPoint))}
                          y1={padTop}
                          x2={getX(points.indexOf(hoveredPoint))}
                          y2={yZero}
                          stroke="#64748b"
                          strokeWidth="1.5"
                          strokeDasharray="4 4"
                          vectorEffect="non-scaling-stroke"
                        />
                      )}

                      {/* Linha 1: Geração Solar (Âmbar) */}
                      <path
                        d={solarPath}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="2.5"
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {/* Linha 2: Consumo / Saída (Azul Claro) */}
                      <path
                        d={outputPath}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="2.5"
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {/* Linha 3: Balanço Líquido (Verde Esmeralda) */}
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

                      {/* Marcadores circulares em cada ponto médio */}
                      {points.map((point, i) => {
                        const isHovered = hoveredPoint === point;
                        const x = getX(i);
                        const ySol = getY(point.watts);
                        const yOut = getY(point.outputWatts);
                        const yNet = getY(Math.max(0, point.netWatts));

                        return (
                          <g key={i}>
                            <circle
                              cx={x}
                              cy={ySol}
                              r={isHovered ? 6 : 4}
                              fill="#f59e0b"
                              stroke="#0f172a"
                              strokeWidth="2"
                              vectorEffect="non-scaling-stroke"
                            />
                            <circle
                              cx={x}
                              cy={yOut}
                              r={isHovered ? 6 : 4}
                              fill="#38bdf8"
                              stroke="#0f172a"
                              strokeWidth="2"
                              vectorEffect="non-scaling-stroke"
                            />
                            <circle
                              cx={x}
                              cy={yNet}
                              r={isHovered ? 5 : 3}
                              fill="#10b981"
                              stroke="#0f172a"
                              strokeWidth="2"
                              vectorEffect="non-scaling-stroke"
                            />
                          </g>
                        );
                      })}
                    </svg>

                    {/* Fatias transparentes para captura de hover e exibição de tooltip */}
                    <div className="absolute inset-0 pt-6 pb-6 px-1 flex items-stretch justify-between z-20">
                      {points.map((point, index) => {
                        const isNetPositive = point.netWatts >= 0;

                        return (
                          <div
                            key={index}
                            onMouseEnter={() => setHoveredPoint(point)}
                            onMouseLeave={() => setHoveredPoint(null)}
                            className="flex-1 h-full relative cursor-pointer group flex items-start justify-center"
                          >
                            {/* Tooltip flutuante indicando a média do intervalo de 5 minutos */}
                            <div
                              className={`opacity-0 group-hover:opacity-100 transition-all duration-150 pointer-events-none absolute -top-12 z-30 bg-slate-950/95 border border-slate-700 text-slate-100 px-3 py-1.5 rounded-lg text-[11px] whitespace-nowrap shadow-2xl backdrop-blur-md flex items-center gap-2 ${
                                index < 2
                                  ? "left-0"
                                  : index > pointCount - 3
                                  ? "right-0"
                                  : "left-1/2 -translate-x-1/2"
                              }`}
                            >
                              <span className="text-slate-400 font-mono">Média 5 min ({point.time}):</span>
                              <span className="font-bold text-amber-400 font-mono">{point.watts}W Sol</span>
                              <span className="text-slate-600">•</span>
                              <span className="font-bold text-sky-300 font-mono">{point.outputWatts}W Uso</span>
                              <span className="text-slate-600">•</span>
                              <span
                                className={`font-bold font-mono ${
                                  isNetPositive ? "text-emerald-400" : "text-amber-400"
                                }`}
                              >
                                {point.netWatts > 0 ? `+${point.netWatts}` : point.netWatts}W Bal
                              </span>
                              <span className="text-slate-600">•</span>
                              <span className="text-emerald-400 font-mono">{point.battery}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Rótulos dos eixos X marcando o início (-30 min) e o fim (agora) */}
              <div className="flex justify-between items-center text-[11px] text-slate-400 font-mono px-3 pt-2 border-t border-slate-800/80">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Início</span>
                  <span className="text-slate-200 font-semibold">(-30 min)</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-400">{data.chartPoints[0]?.time || "--"}</span>
                </div>
                <div className="text-slate-500 font-sans text-xs hidden sm:block">
                  Média calculada em blocos de 5 minutos
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">{data.chartPoints[data.chartPoints.length - 1]?.time || "--"}</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-500">Fim</span>
                  <span className="text-slate-200 font-semibold">(Agora)</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 4. Tabela com as Amostras Detalhadas da Janela */}
        <section
          aria-label="Tabela de Amostras de Telemetria"
          className="animate-card stagger-6 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4"
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
            <div className="text-center py-8 text-slate-500 text-sm">
              Nenhuma amostra salva no banco de dados.
            </div>
          ) : (
            <div className="overflow-x-auto">
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
          )}
        </section>
      </div>
    </Layout>
  );
}
