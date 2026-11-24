import React, { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Gauge,
  RotateCcw,
  Clock,
  Activity,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { TransitionLink } from "./TransitionLink";
import type { AtsHealthMetrics } from "../pages/api/statistics";
import {
  getAtsHealthTheme,
  getAtsStatusBadge,
  type AtsHealthTheme,
  type AtsStatusBadge,
} from "../utils/atsHealthUtils";

export { getAtsHealthTheme, getAtsStatusBadge };
export type { AtsHealthTheme, AtsStatusBadge };

export interface AtsHealthWidgetProps {
  compact?: boolean;
  className?: string;
  initialData?: AtsHealthMetrics | null;
  refreshIntervalMs?: number;
}

export function AtsHealthWidget({
  compact = false,
  className = "",
  initialData = null,
  refreshIntervalMs = 30000,
}: AtsHealthWidgetProps) {
  const [data, setData] = useState<AtsHealthMetrics | null>(initialData);
  const [isLoading, setIsLoading] = useState<boolean>(!initialData);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setIsLoading(false);
    }
  }, [initialData]);

  useEffect(() => {
    let isMounted = true;

    const fetchAtsHealth = async () => {
      try {
        const response = await fetch("/api/statistics");
        const json = await response.json();
        if (isMounted && json.success && json.data?.atsHealth) {
          setData(json.data.atsHealth);
        }
      } catch (err) {
        console.error("Erro ao carregar telemetria de saúde da ATS:", err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    if (!initialData) {
      fetchAtsHealth();
    }

    const interval = setInterval(fetchAtsHealth, refreshIntervalMs);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [initialData, refreshIntervalMs]);

  // Fallback nominal seguro para evitar que a UI desapareça ou quebre
  const safeAts: AtsHealthMetrics = data ?? {
    lifespanCycles: 10000,
    currentCycles: 0,
    remainingCycles: 10000,
    healthPercentage: 100,
    estimatedYearsRemaining: 13.7,
    dailyRate: 2.0,
    atsLastSwitchedAt: null,
    status: "EXCELLENT",
  };

  const theme = getAtsHealthTheme(safeAts.healthPercentage);
  const badge = getAtsStatusBadge(safeAts.status);
  const wearPercentage = Math.min(
    100,
    Math.max(0, (safeAts.currentCycles / (safeAts.lifespanCycles || 10000)) * 100)
  );

  if (isLoading && !data) {
    return (
      <div
        className={`animate-pulse rounded-2xl bg-slate-800/60 border border-slate-700/50 ${
          compact ? "h-9 w-44" : "h-64 w-full"
        } ${className}`}
        role="status"
        aria-label="Carregando dados de saúde da ATS"
      />
    );
  }

  // ==============================================================
  // VARIANTE COMPACTA (Para Badge de Barra Executiva ou Card Resumo)
  // ==============================================================
  if (compact) {
    return (
      <Tooltip enabled={true}>
        <TooltipTrigger asChild>
          <TransitionLink
            href="/statistics#ats-health"
            role="status"
            aria-label={`Saúde ATS: ${safeAts.healthPercentage.toFixed(1)}%`}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono font-medium transition-all select-none hover:border-slate-600 ${badge.classes} ${className}`}
          >
            <span className={`w-2 h-2 rounded-full ${theme.dot}`} aria-hidden="true" />
            <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
            <span>ATS: {safeAts.healthPercentage.toFixed(0)}%</span>
            <span className="text-slate-400 font-normal">
              (~{safeAts.estimatedYearsRemaining.toFixed(1)}a)
            </span>
          </TransitionLink>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-left font-mono text-xs space-y-1">
          <p className="font-bold text-slate-200">Saúde Mecânica da Chave ATS</p>
          <p className="text-slate-400">
            {safeAts.remainingCycles.toLocaleString("pt-BR")} ciclos restantes de{" "}
            {safeAts.lifespanCycles.toLocaleString("pt-BR")}.
          </p>
          <p className="text-slate-400">
            Taxa média: {safeAts.dailyRate} comutações/dia (~{safeAts.estimatedYearsRemaining} anos restantes).
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  // ==============================================================
  // VARIANTE COMPLETA (Card Executivo de Saúde da ATS)
  // ==============================================================
  return (
    <div
      id="ats-health"
      aria-label="Saúde Operacional da Chave de Transferência Automática"
      className={`animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5 flex flex-col justify-between ${className}`}
    >
      <div className="space-y-4">
        {/* Topo do Card: Título, Ícone e Status Badge */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 shrink-0 border border-cyan-500/20">
              <ArrowLeftRight className="w-5 h-5 animate-float" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                Saúde Operacional da ATS
              </h2>
              <p className="text-xs text-slate-400">
                Chave de Transferência Automática (Comutação Mecânica Solar / Rede)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <span
              className={`text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm ${badge.classes}`}
            >
              {badge.label}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-full bg-slate-950 text-slate-400 border border-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              1 comutação = 1 ciclo
            </span>
          </div>
        </div>

        {/* Gauge de % de Vida Útil e Barra de Progresso Animada */}
        <div className="p-4 sm:p-5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                Vida Útil Mecânica Aproximada
              </span>
              <div className="flex items-baseline gap-2.5 mt-1">
                <span
                  className={`text-3xl sm:text-4xl font-extrabold font-mono tracking-tight ${theme.text}`}
                >
                  {safeAts.healthPercentage.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  ({safeAts.remainingCycles.toLocaleString("pt-BR")} ciclos restantes de{" "}
                  {safeAts.lifespanCycles.toLocaleString("pt-BR")})
                </span>
              </div>
            </div>

            <div className="text-xs text-slate-400 font-mono">
              Desgaste Acumulado:{" "}
              <strong className="text-slate-200">{wearPercentage.toFixed(1)}%</strong>
            </div>
          </div>

          {/* Barra de Progresso com Cores Dinâmicas */}
          <div
            className="w-full bg-slate-900 rounded-full h-3.5 p-0.5 border border-slate-800 overflow-hidden"
            role="progressbar"
            aria-valuenow={safeAts.healthPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Porcentagem de vida útil restante da chave ATS"
          >
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r ${theme.barGradient}`}
              style={{
                width: `${Math.max(1.5, Math.min(100, safeAts.healthPercentage))}%`,
              }}
            />
          </div>
        </div>

        {/* Grid com Indicadores Principais */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {/* 1. Ciclos Realizados */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between group hover:border-slate-700 transition-colors">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <RotateCcw
                    className="w-3.5 h-3.5 text-sky-400 transition-transform group-hover:-rotate-90 duration-300"
                    aria-hidden="true"
                  />
                  Ciclos Realizados
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 text-sky-300 border border-slate-800">
                  1 acionamento
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 pt-1.5">
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-100 font-mono">
                  {safeAts.currentCycles.toLocaleString("pt-BR")}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  / {safeAts.lifespanCycles.toLocaleString("pt-BR")}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
              <span>Capacidade nominal:</span>
              <span className="font-mono text-slate-300 font-semibold">
                {safeAts.lifespanCycles.toLocaleString("pt-BR")} ciclos
              </span>
            </p>
          </div>

          {/* 2. Estimativa de Durabilidade */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between group hover:border-slate-700 transition-colors">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Clock
                  className="w-3.5 h-3.5 text-emerald-400 transition-transform group-hover:scale-110 duration-200"
                  aria-hidden="true"
                />
                Estimativa de Durabilidade
              </span>
              <div className="flex items-baseline gap-1.5 pt-1.5">
                <span className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono">
                  ~{safeAts.estimatedYearsRemaining}
                </span>
                <span className="text-xs text-slate-300 font-medium">anos restantes</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
              <span>Taxa média diária:</span>
              <span className="font-mono text-slate-300 font-semibold">
                {safeAts.dailyRate} comutações/dia {safeAts.isProratedEstimate && "(estimada)"}
              </span>
            </p>
          </div>

          {/* 3. Registro da Última Comutação */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-col justify-between group hover:border-slate-700 transition-colors">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Activity
                  className="w-3.5 h-3.5 text-amber-400 transition-transform group-hover:scale-110 duration-200"
                  aria-hidden="true"
                />
                Última Comutação
              </span>
              <div className="pt-1.5">
                <span className="text-sm sm:text-base font-bold text-slate-200 font-mono block truncate">
                  {safeAts.atsLastSwitchedAt
                    ? new Date(safeAts.atsLastSwitchedAt).toLocaleString("pt-BR")
                    : "Aguardando primeiro evento"}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
              <span>Estado da chave:</span>
              <span className="text-slate-300 font-semibold font-mono text-[11px]">
                {safeAts.atsLastSwitchedAt ? "Comutada fisicamente" : "Standby inicial"}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Rodapé Informativo com Link para Detalhamento */}
      <div className="pt-3 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500 font-mono">
        <div className="flex items-center gap-3">
          <span>Chave ATS: Comutação mecânica motorizada sob carga</span>
          <span>•</span>
          <span>Limite de ciclo: 10.000 operações</span>
        </div>
        <TransitionLink
          href="/statistics#ats-health"
          className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 font-semibold transition-colors"
        >
          <span>Ver histórico &amp; relatórios</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </TransitionLink>
      </div>
    </div>
  );
}
