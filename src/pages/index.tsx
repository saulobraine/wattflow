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
  const isChargingMode = data?.lastAction === "BATTERY_LOW_RECHARGE";
  const isDischargingMode = data?.lastAction === "BATTERY_HIGH_DISCHARGE";

  // Tomada Tuya: LIGADA se estiver em modo recarga; DESLIGADA se em modo bateria
  const isTuyaOn = isChargingMode || data?.lastAction === "TURN_ON";

  // Saída AC EcoFlow: ATIVADA se estiver em modo bateria; DESLIGADA se em modo recarga
  const isEcoFlowAcOn = isDischargingMode || data?.lastAction === "TURN_OFF";

  const renderActionBadge = (action: string) => {
    if (action === "BATTERY_HIGH_DISCHARGE") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
          <ArrowUpRight className="w-3 h-3" />
          Modo Bateria (Tuya OFF / AC ON)
        </span>
      );
    }

    if (action === "BATTERY_LOW_RECHARGE") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
          <ArrowDownRight className="w-3 h-3" />
          Modo Recarga (Tuya ON / AC OFF)
        </span>
      );
    }

    if (action === "HOLD_CURRENT_STATE") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400">
          Estável (Sem Alteração)
        </span>
      );
    }

    if (action === "FALHA_SINCRONIZACAO" || action === "ERROR") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
          <AlertCircle className="w-3 h-3" />
          Falha na Sincronização
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">
        {action}
      </span>
    );
  };

  return (
    <Layout title="Dashboard de Energia">
      {!isLoading && !data?.isConfigured && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-amber-300">Credenciais não configuradas</h3>
            <p className="text-sm text-slate-300 mt-1">
              Para iniciar o monitoramento da EcoFlow e o acionamento dos dispositivos Tuya, preencha suas chaves de API no modelo BYOK.
            </p>
            <TransitionLink
              href="/settings"
              className="inline-flex items-center gap-1 text-sm font-medium text-amber-400 hover:text-amber-300 mt-2 underline"
            >
              Configurar Chaves de API Agora &rarr;
            </TransitionLink>
          </div>
        </div>
      )}

      {syncFeedback && (
        <div
          className={`mb-6 p-4 rounded-xl border flex items-start justify-between gap-3 ${
            syncFeedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          <div className="flex items-start gap-2.5 text-sm">
            {syncFeedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
            )}
            <div className="space-y-1">
              <div className="font-medium">
                {syncFeedback.type === "success" ? "Sincronização Concluída" : "Aviso de Sincronização"}
              </div>
              <div className="text-xs leading-relaxed opacity-90 break-words font-mono">
                {syncFeedback.message}
              </div>
            </div>
          </div>
          <button
            onClick={() => setSyncFeedback(null)}
            className="text-xs text-slate-400 hover:text-slate-200 shrink-0 ml-2"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Grid de Cards de Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {/* 1. Nível de Bateria EcoFlow */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <BatteryCharging className="w-4 h-4 text-emerald-400" />
                Bateria EcoFlow
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                SOC
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold tracking-tight text-slate-100 font-mono">
                {data?.lastBatteryPercentage !== null && data?.lastBatteryPercentage !== undefined
                  ? `${battery}%`
                  : "--"}
              </span>
            </div>

            {/* Barra de Progresso */}
            <div className="w-full bg-slate-800 h-2.5 rounded-full mt-3 overflow-hidden p-0.5 border border-slate-700/50">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  battery >= (data?.turnOnThreshold ?? 90)
                    ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]"
                    : battery <= (data?.turnOffThreshold ?? 30)
                    ? "bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.5)]"
                    : "bg-amber-400"
                }`}
                style={{ width: `${Math.min(Math.max(battery, 0), 100)}%` }}
              />
            </div>
          </div>

          <div className="flex justify-between text-[11px] text-slate-400 mt-3 font-mono border-t border-slate-800/80 pt-2">
            <span>Recarga: &le; {data?.turnOffThreshold ?? 30}%</span>
            <span>Bateria: &ge; {data?.turnOnThreshold ?? 90}%</span>
          </div>
        </div>

        {/* 2. Geração Solar EcoFlow (PV Input) */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sun className="w-4 h-4 text-amber-400" />
                Geração Solar
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                  (data?.lastSolarWatts ?? 0) > 0
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
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
                ? "Entrada solar conectada fornecendo energia."
                : "Sem captação fotovoltaica direta no momento."}
            </p>
          </div>

          <div className="text-[11px] text-amber-400/90 border-t border-slate-800/80 pt-2 font-medium">
            <TransitionLink href="/statistics" className="hover:underline flex items-center gap-1">
              Ver Estatísticas Completas &rarr;
            </TransitionLink>
          </div>
        </div>

        {/* 3. Tomada Tuya (Recarga da Concessionária) */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Power className="w-4 h-4 text-emerald-400" />
                Tomada Tuya (Rede)
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                  isTuyaOn
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : "bg-slate-800 text-slate-400 border-slate-700"
                }`}
              >
                {isTuyaOn ? "LIGADA" : "DESLIGADA"}
              </span>
            </div>

            <div className="text-sm font-semibold text-slate-200 mt-1">
              {isTuyaOn ? "Carregando EcoFlow" : "Rede Elétrica Desconectada"}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {isTuyaOn
                ? "Bateria atingiu nível baixo; tomada ligada para repor carga."
                : "Bateria cheia; tomada desligada para economizar energia da rede."}
            </p>
          </div>

          <div className="text-[11px] text-slate-500 border-t border-slate-800/80 pt-2 font-mono">
            Entrada AC de Carga
          </div>
        </div>

        {/* 4. Saída AC EcoFlow (Inversor 127V/220V) */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-teal-400" />
                Saída AC EcoFlow
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                  isEcoFlowAcOn
                    ? "bg-teal-500/20 text-teal-300 border-teal-500/30"
                    : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                }`}
              >
                {isEcoFlowAcOn ? "ATIVADA" : "DESATIVADA"}
              </span>
            </div>

            <div className="text-sm font-semibold text-slate-200 mt-1">
              {isEcoFlowAcOn ? "Fornecendo via Bateria" : "Inversor AC em Espera"}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {isEcoFlowAcOn
                ? "Cargas sendo alimentadas com a energia armazenada na estação."
                : "Saída AC desligada para proteger bateria contra descarga profunda."}
            </p>
          </div>

          <div className="text-[11px] text-slate-500 border-t border-slate-800/80 pt-2 font-mono">
            Inversor Residencial
          </div>
        </div>
      </div>

      {/* Faixa de Ação Rápida e Status do Cron */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-200">Automação Contínua:</span>
              <span
                className={`text-xs px-2 py-0.5 rounded font-mono font-bold ${
                  data?.isAutomationActive
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/20 text-rose-300"
                }`}
              >
                {data?.isAutomationActive ? "ATIVA" : "PAUSADA"}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {data?.lastSyncTime
                ? `Último ciclo executado: ${new Date(data.lastSyncTime).toLocaleTimeString("pt-BR")}`
                : "Aguardando ciclo de verificação do Cron Job."}
            </p>
          </div>
        </div>

        <button
          onClick={triggerManualSync}
          disabled={isSyncing}
          className="px-4 py-2 rounded-xl font-medium text-xs bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-emerald-950"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Sincronizando..." : "Executar Sincronização Agora"}
        </button>
      </div>

      {/* Tabela de Logs de Execução */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            Histórico de Orquestração & Telemetria
          </h2>
          <TransitionLink
            href="/statistics"
            className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 underline"
          >
            Ver Análise Estatística &rarr;
          </TransitionLink>
        </div>

        {!data?.logs || data.logs.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            Nenhuma execução registrada no banco de dados ainda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs uppercase bg-slate-800/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Horário</th>
                  <th className="py-3 px-4">Bateria</th>
                  <th className="py-3 px-4">Geração Solar</th>
                  <th className="py-3 px-4">Decisão de Orquestração</th>
                  <th className="py-3 px-4">Detalhes das Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {data.logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 text-xs font-mono text-slate-400">
                      {new Date(log.executedAt).toLocaleString("pt-BR")}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold">
                      {log.batteryPercentage}%
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        <Sun className="w-3 h-3 text-amber-400" />
                        {log.solarInputWatts ?? 0} W
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {renderActionBadge(log.actionTriggered)}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400 max-w-xs truncate">
                      {log.executionDetails || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
