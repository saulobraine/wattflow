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

  const maxChartWatts = Math.max(
    ...(data?.chartPoints.map((point) => point.watts) || [100]),
    100
  );

  return (
    <Layout title="Estatísticas de Geração Solar">
      <div className="space-y-8 max-w-6xl mx-auto">
        {/* Cabeçalho da Seção */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 backdrop-blur">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sun className="w-5 h-5 text-amber-400" />
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
            className="self-start sm:self-auto px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center gap-2 shadow-lg shadow-emerald-950/40 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Atualizando..." : "Atualizar Estatísticas"}
          </button>
        </div>

        {/* Métricas Principais (KPIs) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* 1. Potência Solar Atual */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl relative overflow-hidden flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sun className="w-4 h-4 text-amber-400" />
                  Geração Atual
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                    (data?.currentWatts ?? 0) > 0
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
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
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
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
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-teal-400" />
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
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <BatteryCharging className="w-4 h-4 text-indigo-400" />
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
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-slate-100">Curva de Geração Solar Recente</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Escala máx: {maxChartWatts} W
            </span>
          </div>

          {!data?.chartPoints || data.chartPoints.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              Nenhuma leitura solar registrada ainda. Aguardando ciclos de coleta do Cron.
            </div>
          ) : (
            <div className="space-y-2">
              {/* Área das Barras do Gráfico */}
              <div className="h-52 w-full flex items-end gap-1.5 pt-6 pb-2 border-b border-slate-800 px-2 overflow-x-auto">
                {data.chartPoints.map((point, index) => {
                  const barHeightPercentage = Math.max(
                    Math.round((point.watts / maxChartWatts) * 100),
                    point.watts > 0 ? 6 : 2
                  );

                  return (
                    <div
                      key={index}
                      className="flex-1 min-w-[20px] max-w-[40px] flex flex-col items-center group relative h-full justify-end"
                    >
                      {/* Tooltip ao passar o mouse */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-12 z-20 pointer-events-none bg-slate-950 border border-slate-700 px-2 py-1 rounded text-[11px] text-slate-200 whitespace-nowrap shadow-xl">
                        <span className="text-amber-400 font-bold">{point.watts} W</span> &bull; {point.battery}% Bat &bull; {point.time}
                      </div>

                      {/* Barra de Watts Solar */}
                      <div
                        style={{ height: `${barHeightPercentage}%` }}
                        className={`w-full rounded-t transition-all ${
                          point.watts > 0
                            ? "bg-gradient-to-t from-amber-500/60 to-amber-400 group-hover:from-amber-400 group-hover:to-amber-300"
                            : "bg-slate-800/60"
                        }`}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Rótulos dos extremos de horário */}
              <div className="flex justify-between text-[11px] text-slate-500 font-mono px-2">
                <span>{data.chartPoints[0]?.time || "--"}</span>
                <span>Últimas leituras coletadas</span>
                <span>{data.chartPoints[data.chartPoints.length - 1]?.time || "--"}</span>
              </div>
            </div>
          )}
        </div>

        {/* Tabela de Telemetria Detalhada */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
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
                      <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 text-xs font-mono text-slate-400">
                          {new Date(log.executedAt).toLocaleString("pt-BR")}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold ${
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
