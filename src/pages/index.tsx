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
  Sliders,
  CloudLightning,
  DollarSign,
  Timer,
  Loader2,
  CloudSun,
  Thermometer,
  CloudRain,
  Gauge,
  Flame,
  SunMedium,
  BellRing,
  AlertTriangle,
} from "lucide-react";
import type {
  FinancialSavingsMetrics,
  AutonomyEstimateMetrics,
  SolarForecastMetrics,
  BmsAnalyticsMetrics,
  SolarExpectationLevel,
  TariffPeriod,
} from "./api/statistics";

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
  isStormModeActive?: boolean;
  turnOnThreshold: number;
  turnOffThreshold: number;
  lastBatteryPercentage: number | null;
  lastSolarWatts: number | null;
  lastOutputWatts?: number | null;
  inverterMaxWatts?: number;
  lastAction: string | null;
  lastSyncTime: string | null;
  logs: SyncLogItem[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Estados da Suíte de Inteligência Operacional (Modo Tempestade, Autonomia, Economia, Previsão Solar & BMS)
  const [isStormModeActive, setIsStormModeActive] = useState<boolean>(false);
  const [isTogglingStormMode, setIsTogglingStormMode] = useState<boolean>(false);
  const [autonomyData, setAutonomyData] = useState<AutonomyEstimateMetrics | null>(null);
  const [savingsData, setSavingsData] = useState<FinancialSavingsMetrics | null>(null);
  const [solarForecast, setSolarForecast] = useState<SolarForecastMetrics | null>(null);
  const [bmsAnalytics, setBmsAnalytics] = useState<BmsAnalyticsMetrics | null>(null);

  const fetchStatus = async () => {
    try {
      const [statusRes, statsRes] = await Promise.all([
        fetch("/api/dashboard-status"),
        fetch("/api/statistics"),
      ]);

      const statusJson = await statusRes.json();
      if (statusJson.success && statusJson.data) {
        setData(statusJson.data);
        if (typeof statusJson.data.isStormModeActive === "boolean") {
          setIsStormModeActive(statusJson.data.isStormModeActive);
        }
      }

      const statsJson = await statsRes.json();
      if (statsJson.success && statsJson.data) {
        if (statsJson.data.autonomyEstimate) {
          setAutonomyData(statsJson.data.autonomyEstimate);
        }
        if (statsJson.data.financialSavings) {
          setSavingsData(statsJson.data.financialSavings);
        }
        if (statsJson.data.solarForecast) {
          setSolarForecast(statsJson.data.solarForecast);
        }
        if (statsJson.data.bmsAnalytics) {
          setBmsAnalytics(statsJson.data.bmsAnalytics);
        }
      }
    } catch (err) {
      console.error("Erro ao carregar status:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleStormMode = async () => {
    setIsTogglingStormMode(true);
    try {
      const nextMode = !isStormModeActive;
      const response = await fetch("/api/storm-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isStormModeActive: nextMode }),
      });
      const json = await response.json();
      if (json.success) {
        setIsStormModeActive(nextMode);
        setSyncFeedback({
          type: "success",
          message: nextMode
            ? "Modo Tempestade ATIVADO: Inversor desarmado para a rede da concessionária para preservar 100% da bateria."
            : "Modo Tempestade DESATIVADO: Orquestração solar/bateria normalizada.",
        });
        await fetchStatus();
      } else {
        setSyncFeedback({
          type: "error",
          message: json.message || "Falha ao alterar Modo Tempestade.",
        });
      }
    } catch {
      setSyncFeedback({
        type: "error",
        message: "Erro de comunicação ao acionar Modo Tempestade.",
      });
    } finally {
      setIsTogglingStormMode(false);
    }
  };

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

  const renderActionBadge = (action: string, isCompact = false) => {
    if (action === "ENABLE_ECOFLOW_AC" || action === "BATTERY_HIGH_DISCHARGE" || action === "TURN_OFF") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all">
          <ArrowUpRight className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" />
          <span className="truncate">{isCompact ? "Solar / Bateria" : "ATS no EcoFlow (Solar/Bateria)"}</span>
        </span>
      );
    }
    if (action === "DISABLE_ECOFLOW_AC" || action === "BATTERY_LOW_RECHARGE" || action === "TURN_ON") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all">
          <ArrowDownRight className="w-3 h-3 text-rose-400 shrink-0" aria-hidden="true" />
          <span className="truncate">{isCompact ? "Rede Elétrica" : "ATS na Concessionária (Rede)"}</span>
        </span>
      );
    }
    if (action === "MONITORAMENTO") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition-all">
          <Activity className="w-3 h-3 text-cyan-400 shrink-0" aria-hidden="true" />
          <span className="truncate">{isCompact ? "Telemetria" : "Monitoramento (Telemetria)"}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all">
        <Clock className="w-3 h-3 text-amber-400 shrink-0" aria-hidden="true" />
        <span className="truncate">{isCompact ? "Histerese" : "Histerese (Estado Mantido)"}</span>
      </span>
    );
  };

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
        text: "text-slate-400",
        bg: "bg-slate-500",
        border: "border-slate-800",
        badge: "bg-slate-800 text-slate-400 border-slate-700",
        label: "Standby",
      };
    }
    if (tempCelsius < 38) {
      return {
        text: "text-emerald-400",
        bg: "bg-emerald-500",
        border: "border-emerald-500/30",
        badge: "bg-emerald-950/80 text-emerald-300 border-emerald-700/60",
        label: "Normal / Fria",
      };
    }
    if (tempCelsius <= 45) {
      return {
        text: "text-amber-400",
        bg: "bg-amber-500",
        border: "border-amber-500/30",
        badge: "bg-amber-950/80 text-amber-300 border-amber-700/60",
        label: "Aquecimento Moderado",
      };
    }
    return {
      text: "text-rose-400",
      bg: "bg-rose-500",
      border: "border-rose-500/40",
      badge: "bg-rose-950/80 text-rose-300 border-rose-700/60",
      label: "Alerta de Temperatura",
    };
  };

  const getTariffPeriodBadge = (period?: TariffPeriod, rate?: number, isDynamicActive?: boolean) => {
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
          label: "🔴 HORÁRIO DE PONTA",
          classes: "bg-rose-950/80 text-rose-300 border-rose-600/70 shadow-rose-950/50 shadow-md animate-pulse",
          dot: "bg-rose-500",
          desc: `Tarifa mais cara (${savingsData?.currencySymbol || "R$"} ${(rate ?? 1.85).toFixed(2)}/kWh) — Priorizando Bateria`,
        };
      case "INTERMEDIATE":
        return {
          label: "🟡 INTERMEDIÁRIO",
          classes: "bg-amber-950/80 text-amber-300 border-amber-600/70 shadow-amber-950/40 shadow-sm",
          dot: "bg-amber-400",
          desc: `Faixa de transição (${savingsData?.currencySymbol || "R$"} ${(rate ?? 1.15).toFixed(2)}/kWh)`,
        };
      case "OFF_PEAK":
      default:
        return {
          label: "🟢 FORA DE PONTA",
          classes: "bg-emerald-950/80 text-emerald-300 border-emerald-600/70 shadow-emerald-950/40 shadow-sm",
          dot: "bg-emerald-400",
          desc: `Tarifa mais econômica (${savingsData?.currencySymbol || "R$"} ${(rate ?? 0.65).toFixed(2)}/kWh)`,
        };
    }
  };

  return (
    <Layout>
      <div className="space-y-8">
        {/* Banner de Alerta Crítico: Modo Tempestade Ativo */}
        {isStormModeActive && (
          <section
            role="alert"
            aria-label="Alerta de Modo Tempestade Ativo"
            className="animate-card stagger-1 p-4 sm:p-5 rounded-2xl bg-amber-950/60 border-2 border-amber-500/80 shadow-2xl shadow-amber-950/50 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all"
          >
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 shrink-0 mt-0.5 border border-amber-500/40">
                <CloudLightning className="w-6 h-6 animate-pulse" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold text-amber-200">
                    ⚠️ Modo Tempestade Ativo — Proteção contra Blackout
                  </h2>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                    ATS Retida na Rede
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-amber-300/90 mt-1 leading-relaxed">
                  O inversor EcoFlow foi desarmado para a rede da concessionária para preservar 100% da carga da bateria para caso de interrupção no fornecimento.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggleStormMode}
              disabled={isTogglingStormMode}
              aria-label="Desativar Modo Tempestade"
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm transition-all duration-150 shadow-md shadow-amber-950/50 flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-50 active:scale-95"
            >
              {isTogglingStormMode ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" aria-hidden="true" />
              ) : (
                <Power className="w-4 h-4" aria-hidden="true" />
              )}
              {isTogglingStormMode ? "Alterando..." : "Desativar Modo Tempestade"}
            </button>
          </section>
        )}

        {/* Banner de Boas-vindas e Status do Sistema */}
        <section
          aria-label="Status Geral do Sistema"
          className="animate-card stagger-1 interactive-card flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
              <Zap className="w-6 h-6 text-emerald-400 animate-float" aria-hidden="true" />
              Painel de Energia EcoFlow &amp; ATS
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Gerenciamento automatizado do inversor EcoFlow integrado à Chave de Transferência Automática.
            </p>

            {/* Badge Dinâmico de Tarifa em Tempo Real (Tarifa Branca ANEEL) */}
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              {(() => {
                const tariff = getTariffPeriodBadge(
                  savingsData?.currentTariffPeriod,
                  savingsData?.currentTariffRate,
                  savingsData?.isDynamicTariffActive
                );
                return (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm ${tariff.classes}`}>
                    <span className={`w-2 h-2 rounded-full ${tariff.dot}`} />
                    {tariff.label}
                    {savingsData?.isDynamicTariffActive && (
                      <span className="font-normal text-[11px] opacity-90 hidden sm:inline">
                        — {tariff.desc}
                      </span>
                    )}
                  </span>
                );
              })()}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Botão de 1 Clique: Modo Tempestade */}
            <button
              type="button"
              onClick={handleToggleStormMode}
              disabled={isTogglingStormMode}
              aria-label={isStormModeActive ? "Desativar Modo Tempestade" : "Ativar Modo Tempestade"}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-semibold text-xs sm:text-sm transition-all duration-150 border cursor-pointer disabled:cursor-not-allowed active:scale-95 ${
                isStormModeActive
                  ? "bg-amber-500 text-slate-950 border-amber-400 hover:bg-amber-400 shadow-md shadow-amber-950/40"
                  : "bg-slate-800/80 hover:bg-slate-700 text-amber-400 border-amber-500/30 hover:border-amber-500/60"
              }`}
            >
              {isTogglingStormMode ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <CloudLightning className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{isStormModeActive ? "Tempestade Ativa" : "Modo Tempestade"}</span>
            </button>

            <button
              onClick={triggerManualSync}
              disabled={isSyncing || !data?.isConfigured}
              aria-label="Sincronizar telemetria e estado agora"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm transition-all duration-150 shadow-lg shadow-emerald-950 cursor-pointer disabled:cursor-not-allowed"
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

        {/* Grade de Indicadores Principais (8 métricas em 4 colunas perfeitamente distribuídas) */}
        <section aria-label="Indicadores Operacionais" className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4 lg:gap-5">
          {/* Card 1: Bateria (SOC %) */}
          <div className="animate-card stagger-2 interactive-card min-h-[105px] sm:min-h-[125px] flex flex-col justify-between p-3 sm:p-4 rounded-xl border border-slate-800/80 bg-slate-900/90 hover:border-slate-700 transition-all shadow-md group">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
                <BatteryCharging className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-[11px] sm:text-xs text-slate-400 font-medium truncate">
                Bateria
              </span>
            </div>

            <div className="text-xl sm:text-2xl font-bold font-mono text-slate-100 truncate my-1">
              {data?.lastBatteryPercentage !== null && data?.lastBatteryPercentage !== undefined
                ? `${battery}%`
                : "--"}
            </div>

            <div className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 w-fit max-w-full truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
              <span className="truncate">SOC Bateria</span>
            </div>
          </div>

          {/* Card 2: Geração Solar (PV Input) */}
          <div className="animate-card stagger-2 interactive-card min-h-[105px] sm:min-h-[125px] flex flex-col justify-between p-3 sm:p-4 rounded-xl border border-slate-800/80 bg-slate-900/90 hover:border-slate-700 transition-all shadow-md group">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 transition-transform group-hover:rotate-45 duration-300">
                <Sun className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-[11px] sm:text-xs text-slate-400 font-medium truncate">
                Solar PV
              </span>
            </div>

            <div className="text-xl sm:text-2xl font-bold font-mono text-amber-400 truncate my-1">
              {data?.lastSolarWatts !== null && data?.lastSolarWatts !== undefined
                ? `${data.lastSolarWatts} W`
                : "-- W"}
            </div>

            <div className={`inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-md border w-fit max-w-full truncate ${
              (data?.lastSolarWatts ?? 0) > 0
                ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                : "text-slate-400 bg-slate-800/80 border-slate-700/60"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                (data?.lastSolarWatts ?? 0) > 0 ? "bg-amber-400 animate-pulse" : "bg-slate-500"
              }`} aria-hidden="true" />
              <span className="truncate">{(data?.lastSolarWatts ?? 0) > 0 ? "Geração Ativa" : "Standby"}</span>
            </div>
          </div>

          {/* Card 3: Autonomia Preditiva */}
          <div className="animate-card stagger-2 interactive-card min-h-[105px] sm:min-h-[125px] flex flex-col justify-between p-3 sm:p-4 rounded-xl border border-slate-800/80 bg-slate-900/90 hover:border-slate-700 transition-all shadow-md group">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
                <Timer className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-[11px] sm:text-xs text-slate-400 font-medium truncate">
                Autonomia
              </span>
            </div>

            <div className="truncate my-1">
              {autonomyData?.isRecharging ? (
                <span className="text-sm sm:text-base font-bold text-emerald-400 leading-tight block truncate">
                  Carregando
                </span>
              ) : autonomyData?.formattedRuntime ? (
                <span className="text-lg sm:text-2xl font-bold font-mono text-sky-300 truncate block">
                  ~{autonomyData.formattedRuntime}
                </span>
              ) : (
                <span className="text-lg sm:text-2xl font-bold font-mono text-slate-500 truncate block">
                  --
                </span>
              )}
            </div>

            <div className={`inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-md border w-fit max-w-full truncate ${
              autonomyData?.isRecharging
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : (autonomyData?.netDrainWatts ?? 0) > 0
                ? "text-sky-400 bg-sky-500/10 border-sky-500/20"
                : "text-slate-400 bg-slate-800/80 border-slate-700/60"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                autonomyData?.isRecharging
                  ? "bg-emerald-400 animate-pulse"
                  : (autonomyData?.netDrainWatts ?? 0) > 0
                  ? "bg-sky-400"
                  : "bg-slate-500"
              }`} aria-hidden="true" />
              <span className="truncate">
                {autonomyData?.isRecharging
                  ? "Geração supera consumo — Bateria carregando"
                  : autonomyData?.formattedRuntime
                  ? `~${autonomyData.formattedRuntime} restantes`
                  : "Autonomia Preditiva"}
              </span>
            </div>
          </div>

          {/* Card 4: Economia Financeira */}
          <div className="animate-card stagger-2 interactive-card min-h-[105px] sm:min-h-[125px] flex flex-col justify-between p-3 sm:p-4 rounded-xl border border-slate-800/80 bg-slate-900/90 hover:border-slate-700 transition-all shadow-md group">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
                <DollarSign className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-[11px] sm:text-xs text-slate-400 font-medium truncate">
                Economia
              </span>
            </div>

            <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-400 truncate my-1">
              {savingsData
                ? `${savingsData.currencySymbol} ${savingsData.todaySavings.toFixed(2)}`
                : "--"}
            </div>

            <div className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 w-fit max-w-full truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {savingsData
                  ? `Hoje: ${savingsData.todayKwh.toFixed(1)} kWh | Mês: ${savingsData.currencySymbol} ${savingsData.monthSavings.toFixed(2)}`
                  : "Economia Real"}
              </span>
            </div>
          </div>

          {/* Card 5: Fonte Ativa (ATS) */}
          <div className="animate-card stagger-3 interactive-card min-h-[105px] sm:min-h-[125px] flex flex-col justify-between p-3 sm:p-4 rounded-xl border border-slate-800/80 bg-slate-900/90 hover:border-slate-700 transition-all shadow-md group">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
                <ArrowLeftRight className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-[11px] sm:text-xs text-slate-400 font-medium truncate">
                Fonte ATS
              </span>
            </div>

            <div className={`text-xl sm:text-2xl font-bold font-mono truncate my-1 ${
              isSolarBatteryMode
                ? "text-emerald-400"
                : isGridMode
                ? "text-rose-400"
                : "text-slate-200"
            }`}>
              {isSolarBatteryMode ? "SOLAR" : isGridMode ? "REDE" : "--"}
            </div>

            <div className={`inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-md border w-fit max-w-full truncate ${
              isSolarBatteryMode
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : isGridMode
                ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                : "text-slate-400 bg-slate-800/80 border-slate-700/60"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isSolarBatteryMode ? "bg-emerald-400" : isGridMode ? "bg-rose-400" : "bg-slate-500"
              }`} aria-hidden="true" />
              <span className="truncate">{isSolarBatteryMode ? "Inversor ATS" : isGridMode ? "Rede ATS" : "Standby"}</span>
            </div>
          </div>

          {/* Card 6: Automação */}
          <div className="animate-card stagger-3 interactive-card min-h-[105px] sm:min-h-[125px] flex flex-col justify-between p-3 sm:p-4 rounded-xl border border-slate-800/80 bg-slate-900/90 hover:border-slate-700 transition-all shadow-md group">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
                <Sliders className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-[11px] sm:text-xs text-slate-400 font-medium truncate">
                Automação
              </span>
            </div>

            <div className={`text-xl sm:text-2xl font-bold font-mono truncate my-1 ${
              data?.isAutomationActive ? "text-indigo-300" : "text-amber-400"
            }`}>
              {data?.isAutomationActive ? "ATIVA" : "PAUSA"}
            </div>

            <div className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20 w-fit max-w-full truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" aria-hidden="true" />
              <span className="truncate">Loop 24/7</span>
            </div>
          </div>

          {/* Card 7: Limiar Corte */}
          <div className="animate-card stagger-4 interactive-card min-h-[105px] sm:min-h-[125px] flex flex-col justify-between p-3 sm:p-4 rounded-xl border border-slate-800/80 bg-slate-900/90 hover:border-slate-700 transition-all shadow-md group">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
                <Power className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-[11px] sm:text-xs text-slate-400 font-medium truncate">
                Corte
              </span>
            </div>

            <div className="text-xl sm:text-2xl font-bold font-mono text-rose-400 truncate my-1">
              &le; {solarForecast?.isAdaptiveActive ? solarForecast.effectiveTurnOffThreshold : (data?.turnOffThreshold ?? 30)}%
            </div>

            <div className={`inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-md border w-fit max-w-full truncate ${
              solarForecast?.isAdaptiveActive
                ? "text-amber-300 bg-amber-500/10 border-amber-500/30"
                : "text-rose-400 bg-rose-500/10 border-rose-500/20"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                solarForecast?.isAdaptiveActive ? "bg-amber-400 animate-pulse" : "bg-rose-400"
              }`} aria-hidden="true" />
              <span className="truncate">{solarForecast?.isAdaptiveActive ? "Corte Adaptado" : "Corte Rede"}</span>
            </div>
          </div>

          {/* Card 8: Limiar Ativação */}
          <div className="animate-card stagger-4 interactive-card min-h-[105px] sm:min-h-[125px] flex flex-col justify-between p-3 sm:p-4 rounded-xl border border-slate-800/80 bg-slate-900/90 hover:border-slate-700 transition-all shadow-md group">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
                <Zap className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-[11px] sm:text-xs text-slate-400 font-medium truncate">
                Ativação
              </span>
            </div>

            <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-400 truncate my-1">
              &ge; {data?.turnOnThreshold ?? 90}%
            </div>

            <div className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 w-fit max-w-full truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
              <span className="truncate">Chaveia Solar</span>
            </div>
          </div>
        </section>

        {/* Seção Executiva de Inteligência Avançada (Previsão Solar, Inversor & BMS EcoFlow) */}
        <section
          aria-label="Inteligência Solar, Inversor & Diagnóstico BMS"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
        >
          {/* Card 1: Previsão Solar Preditiva (Open-Meteo) */}
          <div className="animate-card stagger-4 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 shrink-0 border border-amber-500/20">
                    <CloudSun className="w-5 h-5 animate-float" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                      Previsão Solar Preditiva
                    </h2>
                    <p className="text-xs text-slate-400">
                      Irradiância via Open-Meteo &amp; Histerese Adaptativa Autônoma
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {(() => {
                    const badge = getSolarExpectationBadge(solarForecast?.expectation);
                    const BadgeIcon = badge.icon;
                    return (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm ${badge.classes}`}>
                        <BadgeIcon className="w-3.5 h-3.5" aria-hidden="true" />
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Destaque do Corte Adaptado Efetivo */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                  <span className="text-xs uppercase font-semibold tracking-wider text-slate-400">
                    Corte Adaptativo do Dia
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Padrão: {data?.turnOffThreshold ?? 30}% | Efetivo:{" "}
                    <strong className="text-amber-300">
                      {solarForecast ? `${solarForecast.effectiveTurnOffThreshold}%` : `${data?.turnOffThreshold ?? 30}%`}
                    </strong>
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-extrabold font-mono text-amber-300">
                    {solarForecast
                      ? `Corte adaptado para ${solarForecast.effectiveTurnOffThreshold}% hoje`
                      : "Aguardando previsão meteorológica"}
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed pt-1">
                  {solarForecast?.forecastSummary ||
                    "Com base na irradiância solar prevista para hoje, a histerese ajusta a profundidade de descarga da bateria para maximizar a economia."}
                </p>
              </div>

              {/* Grid com Métricas da Previsão */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <span className="text-slate-400 block text-[11px]">Irradiância Diária</span>
                  <span className="text-base sm:text-lg font-bold font-mono text-slate-200 mt-0.5 block">
                    {solarForecast?.radiationMj !== null && solarForecast?.radiationMj !== undefined
                      ? `${solarForecast.radiationMj.toFixed(1)} MJ/m²`
                      : "-- MJ/m²"}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <span className="text-slate-400 block text-[11px]">Horas de Sol Estimadas</span>
                  <span className="text-base sm:text-lg font-bold font-mono text-slate-200 mt-0.5 block">
                    {solarForecast?.sunshineDurationSeconds
                      ? `${(solarForecast.sunshineDurationSeconds / 3600).toFixed(1)}h`
                      : "-- h"}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 col-span-2 sm:col-span-1">
                  <span className="text-slate-400 block text-[11px]">Histerese Adaptativa</span>
                  <span className={`text-xs font-bold font-mono mt-1.5 block ${
                    solarForecast?.isAdaptiveActive ? "text-emerald-400" : "text-slate-400"
                  }`}>
                    {solarForecast?.isAdaptiveActive ? "ATIVA (Dinâmica)" : "Standby / Fixa"}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span>Fonte: Open-Meteo Solar Forecast API</span>
              <span>Cache TTL: 2 horas</span>
            </div>
          </div>

          {/* Card 2: Monitoramento do Inversor & Sobrecarga AC */}
          <div className="animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl shrink-0 border ${
                    (data?.inverterMaxWatts ?? 2400) > 0 && ((data?.lastOutputWatts ?? 0) / (data?.inverterMaxWatts ?? 2400)) >= 0.9
                      ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                      : "bg-sky-500/10 text-sky-400 border-sky-500/20"
                  }`}>
                    <Zap className="w-5 h-5 animate-float" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                      Carga do Inversor
                    </h2>
                    <p className="text-xs text-slate-400">
                      Potência ativa de saída AC vs limite nominal
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {(() => {
                    const outputWatts = data?.lastOutputWatts ?? 0;
                    const maxWatts = data?.inverterMaxWatts ?? 2400;
                    const loadPct = maxWatts > 0 ? (outputWatts / maxWatts) * 100 : 0;
                    if (loadPct >= 90) {
                      return (
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
                          Sobrecarga (≥ 90%)
                        </span>
                      );
                    }
                    if (loadPct >= 70) {
                      return (
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm bg-amber-500/10 text-amber-300 border-amber-500/30">
                          <span className="w-2 h-2 rounded-full bg-amber-400" aria-hidden="true" />
                          Carga Alta
                        </span>
                      );
                    }
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" />
                        Operação Segura
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Destaque da Carga Atual e Barra de Uso */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-3">
                {(() => {
                  const outputWatts = data?.lastOutputWatts ?? 0;
                  const maxWatts = data?.inverterMaxWatts ?? 2400;
                  const loadPct = maxWatts > 0 ? (outputWatts / maxWatts) * 100 : 0;
                  const isOverload = loadPct >= 90;
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase font-semibold tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                          Demanda Residencial
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          Capacidade: <strong className="text-slate-200">{maxWatts} W</strong>
                        </span>
                      </div>

                      <div className="flex items-baseline gap-2">
                        <span className={`text-3xl sm:text-4xl font-extrabold font-mono tracking-tight ${
                          isOverload
                            ? "text-rose-400 animate-pulse"
                            : loadPct >= 70
                            ? "text-amber-300"
                            : "text-sky-300"
                        }`}>
                          {outputWatts.toLocaleString("pt-BR")} W
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          ({loadPct.toFixed(1)}% do limite)
                        </span>
                      </div>

                      {/* Barra de Progresso com Alerta de Sobrecarga */}
                      <div className="space-y-1">
                        <div
                          className="w-full bg-slate-900 rounded-full h-3 p-0.5 border border-slate-800 overflow-hidden"
                          role="progressbar"
                          aria-valuenow={outputWatts}
                          aria-valuemin={0}
                          aria-valuemax={maxWatts}
                          aria-label="Carga de saída do inversor EcoFlow"
                        >
                          <div
                            className={`h-full rounded-full transition-all duration-700 ease-out ${
                              loadPct < 70
                                ? "bg-gradient-to-r from-emerald-500 to-sky-400"
                                : loadPct < 90
                                ? "bg-gradient-to-r from-emerald-500 via-amber-400 to-amber-500"
                                : "bg-gradient-to-r from-amber-500 via-rose-500 to-red-600 animate-pulse"
                            }`}
                            style={{
                              width: `${Math.max(3, Math.min(100, loadPct))}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] font-mono text-slate-500">
                          <span>0 W</span>
                          <span className="text-amber-500/80">70% ({Math.round(maxWatts * 0.7)}W)</span>
                          <span className="text-rose-500/80">90% ({Math.round(maxWatts * 0.9)}W)</span>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Grid com Sub-Métricas do Inversor */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <span className="text-slate-400 block text-[11px]">Potência Nominal</span>
                  <span className="text-base sm:text-lg font-bold font-mono text-slate-200 mt-0.5 block">
                    {data?.inverterMaxWatts ?? 2400} W
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <span className="text-slate-400 block text-[11px]">Folga Disponível</span>
                  <span className="text-base sm:text-lg font-bold font-mono text-emerald-400 mt-0.5 block">
                    {Math.max(0, (data?.inverterMaxWatts ?? 2400) - (data?.lastOutputWatts ?? 0)).toLocaleString("pt-BR")} W
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 col-span-2 sm:col-span-1">
                  <span className="text-slate-400 block text-[11px]">Status da Saída AC</span>
                  <span className={`text-xs font-bold font-mono mt-1.5 block ${
                    (data?.lastOutputWatts ?? 0) > 0 ? "text-emerald-400" : "text-slate-400"
                  }`}>
                    {(data?.lastOutputWatts ?? 0) > 0 ? "Fornecendo AC" : "Standby / Rede"}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span>Proteção Anti-Sobrecarga: Ativa</span>
              <span>Alerta: ≥ 90%</span>
            </div>
          </div>

          {/* Card 3: Saúde da Bateria & BMS EcoFlow */}
          <div className="animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 shrink-0 border border-rose-500/20">
                    <Thermometer className="w-5 h-5 animate-float" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                      Saúde da Bateria (BMS EcoFlow)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Telemetria térmica das células, SOH químico e ciclos acumulados
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {(() => {
                    const thermalTheme = getBmsThermalTheme(bmsAnalytics?.temperatureCelsius);
                    return (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm ${thermalTheme.badge}`}>
                        <span className={`w-2 h-2 rounded-full ${thermalTheme.bg}`} />
                        {thermalTheme.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Termômetro e Barra de Gradiente Térmico */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase font-semibold tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Thermometer className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
                    Temperatura das Células
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Pico Histórico:{" "}
                    <strong className="text-slate-200">
                      {bmsAnalytics?.maxRecordedTemp !== null && bmsAnalytics?.maxRecordedTemp !== undefined
                        ? `${bmsAnalytics.maxRecordedTemp.toFixed(1)}°C`
                        : "--"}
                    </strong>
                  </span>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl sm:text-4xl font-extrabold font-mono tracking-tight ${
                    getBmsThermalTheme(bmsAnalytics?.temperatureCelsius).text
                  }`}>
                    {bmsAnalytics?.temperatureCelsius !== null && bmsAnalytics?.temperatureCelsius !== undefined
                      ? `${bmsAnalytics.temperatureCelsius.toFixed(1)}°C`
                      : "-- °C"}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    (Alerta: {bmsAnalytics?.thermalWarningThreshold ?? 45}°C | Corte: {bmsAnalytics?.thermalShutdownThreshold ?? 50}°C)
                  </span>
                </div>

                {/* Barra com Gradiente Térmico (Verde < 38°C, Âmbar 38-45°C, Vermelho > 45°C) */}
                <div className="space-y-1">
                  <div
                    className="w-full bg-slate-900 rounded-full h-3 p-0.5 border border-slate-800 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={bmsAnalytics?.temperatureCelsius ?? 0}
                    aria-valuemin={20}
                    aria-valuemax={60}
                    aria-label="Temperatura das células da bateria EcoFlow"
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out ${
                        (bmsAnalytics?.temperatureCelsius ?? 0) < 38
                          ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                          : (bmsAnalytics?.temperatureCelsius ?? 0) <= 45
                          ? "bg-gradient-to-r from-emerald-500 via-amber-400 to-amber-500"
                          : "bg-gradient-to-r from-amber-500 via-rose-500 to-red-600 animate-pulse"
                      }`}
                      style={{
                        width: `${Math.max(5, Math.min(100, (((bmsAnalytics?.temperatureCelsius ?? 25) - 20) / 40) * 100))}%`,
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

              {/* Grid com SOH %, Ciclos BMS e Tensão */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                {/* 1. SOH (State of Health) em Anel Circular / Radial Gauge */}
                <div className="p-3 sm:p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Saúde Química (SOH)
                    </span>
                    <Gauge className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  </div>
                  <div className="flex items-center gap-2.5 my-2">
                    {/* Anel SVG Circular compacto */}
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
                          strokeDasharray={`${Math.max(0, Math.min(100, bmsAnalytics?.sohPercentage ?? 100))}, 100`}
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <span className="absolute text-[11px] font-bold font-mono text-slate-100">
                        {bmsAnalytics?.sohPercentage ?? "--"}%
                      </span>
                    </div>
                    <div className="text-xs">
                      <span className="font-bold text-emerald-300 block">
                        {(bmsAnalytics?.sohPercentage ?? 100) >= 90 ? "Excelente" : "Degradação Leve"}
                      </span>
                      <span className="text-[10px] text-slate-400">Células LiFePO4</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">Retenção de Carga</span>
                </div>

                {/* 2. Ciclos Químicos do BMS */}
                <div className="p-3 sm:p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Ciclos do BMS
                    </span>
                    <RefreshCw className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                  </div>
                  <div className="my-1.5">
                    <div className="text-xl sm:text-2xl font-extrabold font-mono text-slate-100">
                      {bmsAnalytics?.bmsCycles !== null && bmsAnalytics?.bmsCycles !== undefined
                        ? bmsAnalytics.bmsCycles
                        : "--"}
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">/ ~3.000 ciclos nominais</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">Contagem DOD BMS</span>
                </div>

                {/* 3. Tensão Nominal do Barramento */}
                <div className="p-3 sm:p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Tensão Barramento
                    </span>
                    <Zap className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  </div>
                  <div className="my-1.5">
                    <div className="text-xl sm:text-2xl font-extrabold font-mono text-amber-300">
                      {bmsAnalytics?.voltageVolts !== null && bmsAnalytics?.voltageVolts !== undefined
                        ? `${bmsAnalytics.voltageVolts.toFixed(1)} V`
                        : "-- V"}
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Corrente: {bmsAnalytics?.amperageAmps !== null && bmsAnalytics?.amperageAmps !== undefined ? `${bmsAnalytics.amperageAmps.toFixed(1)} A` : "-- A"}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">Barramento CC</span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span>BMS Telemetry: MQTT Stream &amp; Polling</span>
              <span>Proteção Térmica: Ativa</span>
            </div>
          </div>
        </section>

        {/* Tabela de Execuções e Logs Recentes */}
        <section
          aria-label="Histórico de Logs Recentes"
          className="animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4"
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

          {/* Mobile View: Feed de Cards Verticais / Timeline (< sm) */}
          <div className="sm:hidden space-y-2.5">
            {data?.logs && data.logs.length > 0 ? (
              data.logs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 shadow-sm space-y-2 animate-fade-in"
                >
                  {/* Topo do card: Horário legível à esquerda + Badge da Ação à direita */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500 shrink-0" aria-hidden="true" />
                      {new Date(log.executedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <div className="shrink-0">{renderActionBadge(log.actionTriggered, true)}</div>
                  </div>

                  {/* Métricas em pills lado a lado */}
                  <div className="flex items-center gap-2 pt-0.5">
                    {/* Bateria */}
                    <div
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border ${
                        log.batteryPercentage >= (data?.turnOnThreshold ?? 90)
                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                          : log.batteryPercentage <= (data?.turnOffThreshold ?? 30)
                          ? "bg-rose-500/10 text-rose-300 border-rose-500/20"
                          : "bg-slate-900 text-slate-200 border-slate-800"
                      }`}
                    >
                      <BatteryCharging className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                      <span>{log.batteryPercentage}%</span>
                    </div>

                    {/* Solar */}
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                      <span>{log.solarInputWatts ?? 0} W</span>
                    </div>
                  </div>

                  {/* Detalhes da Execução */}
                  {log.executionDetails && (
                    <div className="text-xs text-slate-300 font-sans break-words bg-slate-900/80 p-2 rounded-lg border border-slate-800/50 leading-relaxed">
                      {log.executionDetails}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-slate-500 font-sans">
                <div className="flex flex-col items-center justify-center gap-2">
                  <Inbox className="w-7 h-7 text-slate-600" aria-hidden="true" />
                  <span className="text-xs font-medium text-slate-400">Nenhum registro encontrado</span>
                </div>
              </div>
            )}
          </div>

          {/* Desktop & Tablet View: Tabela Tradicional Densa (>= sm) */}
          <div className="hidden sm:block overflow-x-auto">
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
