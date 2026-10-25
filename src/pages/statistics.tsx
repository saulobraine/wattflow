import React, { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import {
  Sun,
  Zap,
  TrendingUp,
  BatteryCharging,
  RefreshCw,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Calendar,
} from "lucide-react";

interface SolarChartPoint {
  time: string;
  watts: number;
  battery: number;
}

interface StatisticsData {
  currentWatts: number;
  peakWatts: number;
  averageWatts: number;
  estimatedEnergyWattHours: number;
  estimatedEnergyKwh: number;
  totalReadingsCount: number;
  chartPoints: SolarChartPoint[];
  recentLogs: Array<{
    id: string;
    batteryPercentage: number;
    solarInputWatts: number;
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
      const response = await fetch("/api/statistics");
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
    const interval = setInterval(fetchStatistics, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchStatistics();
  };

  const rawMaxWatts = Math.max(
    ...(data?.chartPoints.map((point) => point.watts) || [0]),
    0
  );

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

  return (
    <Layout title="Estatísticas de Geração Solar">
      <div className="space-y-8 max-w-6xl mx-auto">
        {/* Cabeçalho da Seção */}
        <div className="animate-card stagger-1 interactive-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 backdrop-blur shadow-xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sun className="w-5 h-5 text-amber-400 animate-float" />
              <h2 className="text-xl font-bold text-slate-100">
                Telemetria Solar EcoFlow (PV Input)
              </h2>
            </div>
            <p className="text-sm text-slate-400">
              Coleta contínua da entrada fotovoltaica conectada à estação e histórico de geração limpa.
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

        {/* Métricas Principais (KPIs) com Animação Escalonada */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* 1. Potência Solar Atual */}
          <div className="animate-card stagger-2 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl relative overflow-hidden flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sun className="w-4 h-4 text-amber-400 transition-transform group-hover:rotate-45 duration-300" />
                  Geração Atual
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border transition-all ${
                    (data?.currentWatts ?? 0) > 0
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse-glow"
                      : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                >
                  {(data?.currentWatts ?? 0) > 0 ? "ATIVO" : "STANDBY"}
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
                ? "Painéis fotovoltaicos gerando em tempo real."
                : "Sem radiação direta captada no momento."}
            </p>
          </div>

          {/* 2. Pico Máximo de Geração */}
          <div className="animate-card stagger-3 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-400 transition-transform group-hover:scale-110 duration-200" />
                  Pico Solar
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  MAX
                </span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-emerald-400 font-mono">
                  {data?.peakWatts ?? 0}
                </span>
                <span className="text-slate-400 font-medium text-sm">W</span>
              </div>
            </div>

            <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
              Maior potência solar captada entre as amostras.
            </p>
          </div>

          {/* 3. Média de Geração Solar */}
          <div className="animate-card stagger-4 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-teal-400 transition-transform group-hover:scale-110 duration-200" />
                  Média de Potência
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  AVG
                </span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-teal-300 font-mono">
                  {data?.averageWatts ?? 0}
                </span>
                <span className="text-slate-400 font-medium text-sm">W</span>
              </div>
            </div>

            <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
              Média calculada sobre o histórico de telemetria.
            </p>
          </div>

          {/* 4. Total Estimado de Energia */}
          <div className="animate-card stagger-5 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <BatteryCharging className="w-4 h-4 text-indigo-400 transition-transform group-hover:scale-110 duration-200" />
                  Energia Estimada
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  kWh
                </span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-indigo-300 font-mono">
                  {data?.estimatedEnergyKwh ?? 0}
                </span>
                <span className="text-slate-400 font-medium text-sm">kWh</span>
              </div>
            </div>

            <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
              Total acumulado em {data?.totalReadingsCount ?? 0} ciclos de coleta.
            </p>
          </div>
        </div>

        {/* Gráfico da Curva de Potência Solar */}
        <div className="animate-card stagger-5 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-slate-100">Curva de Geração Solar Recente</h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 font-mono">
                Escala máx: <strong className="text-amber-400 font-semibold">{scaleMaxWatts} W</strong>
              </span>
            </div>
          </div>

          {!data?.chartPoints || data.chartPoints.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              Nenhuma leitura solar registrada ainda. Aguardando ciclos de coleta do Cron.
            </div>
          ) : (
            <div className="space-y-3">
              {/* Barra de Inspeção Ativa de Telemetria (sempre visível ao passar o mouse) */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono bg-slate-950/70 border border-slate-800/90 px-3.5 py-2 rounded-xl text-slate-300">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Ponto Selecionado:</span>
                  {hoveredPoint ? (
                    <span className="flex items-center gap-2">
                      <span className="text-amber-400 font-bold">{hoveredPoint.watts} W</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-emerald-400 font-semibold">{hoveredPoint.battery}% Bat</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-300">{hoveredPoint.time}</span>
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">Passe o mouse sobre as barras para inspecionar</span>
                  )}
                </div>
                <div className="text-slate-400">
                  Pico no período: <strong className="text-amber-400 font-bold">{rawMaxWatts} W</strong>
                </div>
              </div>

              {/* Área do Gráfico - 100% da largura, zero overflow vertical e horizontal */}
              <div className="relative h-56 w-full pt-8 pb-3 px-1">
                {/* Linhas de Grade de Escala (Eixo Y com marcadores) */}
                <div className="absolute inset-x-1 inset-y-0 pt-8 pb-3 pointer-events-none flex flex-col justify-between">
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

                {/* Barras dinâmicas ocupando 100% do espaço disponível sem scrollbar */}
                <div className="relative h-full w-full flex items-end gap-1 sm:gap-1.5 z-10">
                  {data.chartPoints.map((point, index) => {
                    const barHeightPercentage = Math.min(
                      Math.max(Math.round((point.watts / scaleMaxWatts) * 100), point.watts > 0 ? 5 : 2),
                      100
                    );
                    const isHovered = hoveredPoint === point;

                    return (
                      <div
                        key={index}
                        onMouseEnter={() => setHoveredPoint(point)}
                        onMouseLeave={() => setHoveredPoint(null)}
                        className="flex-1 min-w-0 max-w-[32px] h-full flex flex-col items-center justify-end relative group cursor-pointer"
                      >
                        {/* Tooltip flutuante suave com auto-alinhamento nas pontas */}
                        <div
                          className={`opacity-0 group-hover:opacity-100 transition-all duration-150 pointer-events-none absolute -top-10 z-30 bg-slate-950/95 border border-amber-500/40 text-slate-100 px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap shadow-2xl backdrop-blur-md flex items-center gap-1.5 ${
                            index < 2
                              ? "left-0"
                              : index > data.chartPoints.length - 3
                              ? "right-0"
                              : "left-1/2 -translate-x-1/2"
                          }`}
                        >
                          <span className="font-bold text-amber-400 font-mono">{point.watts} W</span>
                          <span className="text-slate-500">•</span>
                          <span className="text-emerald-400 font-mono">{point.battery}%</span>
                          <span className="text-slate-500">•</span>
                          <span className="text-slate-300 font-mono text-[10px]">{point.time}</span>
                        </div>

                        {/* Barra de Watts Solar com Transição Fluida */}
                        <div
                          style={{ height: `${barHeightPercentage}%` }}
                          className={`w-full rounded-t transition-all duration-300 origin-bottom ${
                            point.watts > 0
                              ? isHovered
                                ? "bg-gradient-to-t from-amber-500 to-amber-300 shadow-lg shadow-amber-500/30 brightness-110"
                                : "bg-gradient-to-t from-amber-600/80 to-amber-400/90 group-hover:brightness-110"
                              : isHovered
                              ? "bg-slate-700/80"
                              : "bg-slate-800/50 group-hover:bg-slate-700/60"
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Rótulos dos extremos de horário */}
              <div className="flex justify-between text-[11px] text-slate-500 font-mono px-1 pt-1">
                <span>{data.chartPoints[0]?.time || "--"}</span>
                <span>Últimas leituras coletadas</span>
                <span>{data.chartPoints[data.chartPoints.length - 1]?.time || "--"}</span>
              </div>
            </div>
          )}
        </div>

        {/* Tabela de Telemetria Detalhada */}
        <div className="animate-card stagger-6 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-slate-100">Histórico de Amostras de Telemetria</h3>
          </div>

          {!data?.recentLogs || data.recentLogs.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              Nenhuma amostra salva no banco de dados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="text-xs uppercase bg-slate-800/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Horário</th>
                    <th className="py-3 px-4">Entrada Solar (PV)</th>
                    <th className="py-3 px-4">Bateria (SOC)</th>
                    <th className="py-3 px-4">Decisão de Automação</th>
                    <th className="py-3 px-4">Status dos Dispositivos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {data.recentLogs.map((log) => {
                    const hasSolar = log.solarInputWatts > 0;

                    return (
                      <tr key={log.id} className="hover:bg-slate-800/40 transition-colors duration-150">
                        <td className="py-3 px-4 text-xs font-mono text-slate-400">
                          {new Date(log.executedAt).toLocaleString("pt-BR")}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold transition-all ${
                              hasSolar
                                ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            <Sun className="w-3 h-3 text-amber-400" />
                            {log.solarInputWatts} W
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold">
                          {log.batteryPercentage}%
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {log.actionTriggered === "BATTERY_HIGH_DISCHARGE" && (
                            <span className="text-emerald-400 font-semibold inline-flex items-center gap-1">
                              <ArrowUpRight className="w-3 h-3" />
                              Modo Bateria
                            </span>
                          )}
                          {log.actionTriggered === "BATTERY_LOW_RECHARGE" && (
                            <span className="text-amber-400 font-semibold inline-flex items-center gap-1">
                              <ArrowDownRight className="w-3 h-3" />
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
        </div>
      </div>
    </Layout>
  );
}
