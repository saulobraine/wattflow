import React, { useEffect, useState } from "react";
import { TransitionLink } from "../components/TransitionLink";
import { Layout } from "../components/Layout";
import {
  BatteryCharging,
  Power,
  RefreshCw,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  CheckCircle2,
  Zap,
  Sun,
  ArrowLeftRight,
  Inbox,
  Activity,
} from "lucide-react";

interface SyncLogItem {
  id: string;
  batteryPercentage: number;
  solarInputWatts: number;
  actionTriggered: string;
  executionDetails: string | null;
  executedAt: string;
}

interface DashboardData {
  isConfigured: boolean;
  isAutomationActive: boolean;
  turnOnThreshold: number;
  turnOffThreshold: number;
  lastBatteryPercentage: number | null;
  lastSolarWatts: number | null;
  lastAction: string | null;
  lastSyncTime: string | null;
  logs: SyncLogItem[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/dashboard-status");
      const json = await response.json();
      if (json.success) {
        setData(json.data);
      }
    } catch (err) {
      console.error("Erro ao carregar status:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const triggerManualSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const result = await response.json();
      if (result.success) {
        const detail = result.data?.detailMessage || result.message || "Sincronização realizada com sucesso!";
        setSyncFeedback({ type: "success", message: detail });
        await fetchStatus();
        return;
      }
      const failureMessage = result.message || "Falha na sincronização.";
      setSyncFeedback({ type: "error", message: failureMessage });
    } catch {
      setSyncFeedback({ type: "error", message: "Erro de rede ao conectar com a rota de sincronização." });
    } finally {
      setIsSyncing(false);
    }
  };

  const battery = data?.lastBatteryPercentage ?? 0;
  const isSolarBatteryMode =
    data?.lastAction === "ENABLE_ECOFLOW_AC" ||
    data?.lastAction === "BATTERY_HIGH_DISCHARGE" ||
    data?.lastAction === "TURN_OFF";

  const isGridMode =
    data?.lastAction === "DISABLE_ECOFLOW_AC" ||
    data?.lastAction === "BATTERY_LOW_RECHARGE" ||
    data?.lastAction === "TURN_ON";

  const renderActionBadge = (action: string) => {
    if (action === "ENABLE_ECOFLOW_AC" || action === "BATTERY_HIGH_DISCHARGE" || action === "TURN_OFF") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all">
          <ArrowUpRight className="w-3 h-3 text-emerald-400" aria-hidden="true" />
          ATS no EcoFlow (Solar/Bateria)
        </span>
      );
    }
    if (action === "DISABLE_ECOFLOW_AC" || action === "BATTERY_LOW_RECHARGE" || action === "TURN_ON") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all">
          <ArrowDownRight className="w-3 h-3 text-rose-400" aria-hidden="true" />
          ATS na Concessionária (Rede)
        </span>
      );
    }
    if (action === "MONITORAMENTO") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition-all">
          <Activity className="w-3 h-3 text-cyan-400" aria-hidden="true" />
          Monitoramento (Telemetria)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all">
        <Clock className="w-3 h-3 text-amber-400" aria-hidden="true" />
        Histerese (Estado Mantido)
      </span>
    );
  };

  return (
    <Layout>
      <div className="space-y-8">
        {/* Banner de Boas-vindas e Status do Sistema */}
        <section
          aria-label="Status Geral do Sistema"
          className="animate-card stagger-1 interactive-card flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-6 rounded-2xl shadow-xl"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
              <Zap className="w-6 h-6 text-emerald-400 animate-float" aria-hidden="true" />
              Painel de Energia EcoFlow &amp; ATS
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Gerenciamento automatizado do inversor EcoFlow integrado à Chave de Transferência Automática.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={triggerManualSync}
              disabled={isSyncing || !data?.isConfigured}
              aria-label="Sincronizar telemetria e estado agora"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white font-semibold text-sm transition-all duration-150 shadow-lg shadow-emerald-950 cursor-pointer disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : "transition-transform group-hover:rotate-45"}`} aria-hidden="true" />
              {isSyncing ? "Sincronizando..." : "Sincronizar Agora"}
            </button>
          </div>
        </section>

        {/* Feedback de Sincronização */}
        {syncFeedback && (
          <div
            role="alert"
            aria-live="polite"
            className={`animate-alert p-4 rounded-xl border flex items-center gap-3 text-sm transition-all duration-200 shadow-md ${
              syncFeedback.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 shadow-emerald-950/30"
                : "bg-rose-500/10 border-rose-500/40 text-rose-300 shadow-rose-950/30"
            }`}
          >
            {syncFeedback.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" aria-hidden="true" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" aria-hidden="true" />
            )}
            <span className="font-medium">{syncFeedback.message}</span>
          </div>
        )}

        {/* Alerta de Configuração Pendente */}
        {data && !data.isConfigured && !isLoading && (
          <div
            role="status"
            className="animate-alert p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-300 flex items-start gap-3 shadow-md shadow-amber-950/20"
          >
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
            <div className="text-sm">
              <span className="font-bold block">Configuração da EcoFlow Pendente</span>
              Preencha sua Access Key, Secret Key e Número de Série da estação nas{" "}
              <TransitionLink href="/settings" className="underline font-semibold hover:text-amber-200 transition-colors">
                Configurações (BYOK)
              </TransitionLink>{" "}
              para que a orquestração com a chave ATS funcione.
            </div>
          </div>
        )}

        {/* Grade de Indicadores Principais */}
        <section aria-label="Indicadores Operacionais" className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 1. Nível de Bateria EcoFlow */}
          <div className="animate-card stagger-2 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <BatteryCharging className="w-4 h-4 text-emerald-400 transition-transform group-hover:scale-110" aria-hidden="true" />
                  Bateria EcoFlow
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  SOC
                </span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-slate-100 font-mono transition-colors">
                  {data?.lastBatteryPercentage !== null && data?.lastBatteryPercentage !== undefined
                    ? `${battery}%`
                    : "--"}
                </span>
              </div>

              {/* Barra de Progresso com Transição Fluida e ARIA */}
              <div
                role="progressbar"
                aria-valuenow={battery}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Nível de Bateria EcoFlow"
                className="w-full bg-slate-800 h-2.5 rounded-full mt-3 overflow-hidden p-0.5 border border-slate-700/50"
              >
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    battery >= (data?.turnOnThreshold ?? 90)
                      ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]"
                      : battery <= (data?.turnOffThreshold ?? 30)
                      ? "bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.5)]"
                      : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]"
                  }`}
                  style={{ width: `${Math.min(Math.max(battery, 0), 100)}%` }}
                />
              </div>
            </div>

            <div className="flex justify-between text-[11px] text-slate-400 mt-3 font-mono border-t border-slate-800/80 pt-2">
              <span>Corte (&le; {data?.turnOffThreshold ?? 30}%): Rede</span>
              <span>Ativação (&ge; {data?.turnOnThreshold ?? 90}%): Bateria</span>
            </div>
          </div>

          {/* 2. Geração Solar EcoFlow (PV Input) */}
          <div className="animate-card stagger-3 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sun className="w-4 h-4 text-amber-400 transition-transform group-hover:rotate-45 duration-300" aria-hidden="true" />
                  Geração Solar
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold border transition-all ${
                    (data?.lastSolarWatts ?? 0) > 0
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse-glow"
                      : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                >
                  {(data?.lastSolarWatts ?? 0) > 0 ? "GERANDO" : "0 W"}
                </span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-amber-400 font-mono">
                  {data?.lastSolarWatts !== null && data?.lastSolarWatts !== undefined
                    ? `${data.lastSolarWatts}`
                    : "--"}
                </span>
                <span className="text-slate-400 font-medium text-sm">W</span>
              </div>

              <p className="text-xs text-slate-400 mt-2">
                {(data?.lastSolarWatts ?? 0) > 0
                  ? "Entrada solar conectada fornecendo energia limpa."
                  : "Sem captação fotovoltaica direta no momento."}
              </p>
            </div>

            <div className="text-[11px] text-amber-400/90 border-t border-slate-800/80 pt-2 font-medium">
              <TransitionLink href="/statistics" className="hover:underline flex items-center gap-1 transition-all group-hover:translate-x-0.5">
                Ver Estatísticas Completas &rarr;
              </TransitionLink>
            </div>
          </div>

          {/* 3. Chave de Transferência Automática (ATS) & Saída AC EcoFlow */}
          <div className="animate-card stagger-4 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ArrowLeftRight className="w-4 h-4 text-cyan-400 transition-transform group-hover:scale-110" aria-hidden="true" />
                  Fonte Ativa (ATS)
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold border transition-all ${
                    isSolarBatteryMode
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                      : isGridMode
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                      : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                >
                  {isSolarBatteryMode ? "SOLAR / BATERIA" : isGridMode ? "CONCESSIONÁRIA" : "STANDBY"}
                </span>
              </div>

              <div className="text-sm font-semibold text-slate-200 mt-1">
                {isSolarBatteryMode
                  ? "EcoFlow AC Ligada &bull; ATS no Inversor"
                  : isGridMode
                  ? "EcoFlow AC Desligada &bull; ATS na Rede"
                  : "Aguardando Leitura"}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {isSolarBatteryMode
                  ? "Cargas alimentadas pela estação EcoFlow com energia limpa."
                  : isGridMode
                  ? "Cargas alimentadas pela rede da concessionária com a bateria protegida."
                  : "Histerese ativa entre os limites configurados."}
              </p>
            </div>

            <div className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 font-mono flex items-center justify-between">
              <span>Automação: {data?.isAutomationActive ? "Ativa" : "Pausada"}</span>
              <TransitionLink href="/automations" className="text-emerald-400 hover:underline transition-colors">
                Ajustar &rarr;
              </TransitionLink>
            </div>
          </div>
        </section>

        {/* Tabela de Execuções e Logs Recentes */}
        <section
          aria-label="Histórico de Logs Recentes"
          className="animate-card stagger-5 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-100">Logs Recentes de Comutação</h2>
              <p className="text-xs text-slate-400">
                Histórico das últimas 10 verificações e ações sobre o inversor EcoFlow e chave ATS
              </p>
            </div>
            <div className="text-xs text-slate-500 font-mono">
              {data?.lastSyncTime
                ? `Último sync: ${new Date(data.lastSyncTime).toLocaleTimeString()}`
                : "Sem sincronização recente"}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" aria-label="Tabela de logs recentes de comutação da chave ATS">
              <thead className="bg-slate-950/60 text-slate-400 uppercase font-semibold border-b border-slate-800">
                <tr>
                  <th scope="col" className="px-4 py-3">Horário</th>
                  <th scope="col" className="px-4 py-3">Bateria</th>
                  <th scope="col" className="px-4 py-3">Solar</th>
                  <th scope="col" className="px-4 py-3">Ação ATS / EcoFlow</th>
                  <th scope="col" className="px-4 py-3">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {data?.logs && data.logs.length > 0 ? (
                  data.logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition-colors duration-150">
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        {new Date(log.executedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-200">
                        {log.batteryPercentage}%
                      </td>
                      <td className="px-4 py-3 text-amber-400 font-bold">
                        {log.solarInputWatts ?? 0} W
                      </td>
                      <td className="px-4 py-3">{renderActionBadge(log.actionTriggered)}</td>
                      <td className="px-4 py-3 text-slate-400 max-w-xs truncate font-sans" title={log.executionDetails || ""}>
                        {log.executionDetails || "--"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-500 font-sans">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Inbox className="w-8 h-8 text-slate-600" aria-hidden="true" />
                        <span className="font-medium text-slate-400">Nenhum registro de sincronização encontrado</span>
                        <p className="text-xs text-slate-500 max-w-sm">
                          Os logs serão registrados automaticamente pelos ciclos de sincronização ou ao clicar em &ldquo;Sincronizar Agora&rdquo;.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Layout>
  );
}
