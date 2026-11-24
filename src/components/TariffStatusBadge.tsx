import React, { useEffect, useState } from "react";
import { Zap, Clock, ShieldCheck, AlertTriangle, ArrowRight } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { TransitionLink } from "./TransitionLink";
import { formatCurrency } from "../utils/currencyFormatter";
import type { TariffStatusDetail } from "../domain/services/TariffScheduleService";

export interface TariffStatusBadgeProps {
  compact?: boolean;
  className?: string;
  initialData?: TariffStatusDetail | null;
}

export function TariffStatusBadge({
  compact = false,
  className = "",
  initialData = null,
}: TariffStatusBadgeProps) {
  const [data, setData] = useState<TariffStatusDetail | null>(initialData);
  const [isLoading, setIsLoading] = useState(!initialData);

  const fetchTariffStatus = async () => {
    try {
      const res = await fetch("/api/tariff/status");
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setData(json.data);
      }
    } catch {
      // Falha graciosa
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!initialData) {
      fetchTariffStatus();
    }
    const interval = setInterval(fetchTariffStatus, 60000);
    return () => clearInterval(interval);
  }, [initialData]);

  if (isLoading) {
    return (
      <div
        className={`animate-pulse rounded-full bg-slate-800/80 ${
          compact ? "h-6 w-24" : "h-7 w-48"
        } ${className}`}
        role="status"
        aria-label="Carregando status tarifário"
      />
    );
  }

  if (!data || !data.isTimeOfUseActive) {
    if (compact) return null;
    return (
      <Tooltip enabled={true}>
        <TooltipTrigger asChild>
          <div
            role="status"
            aria-live="polite"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-800 bg-slate-900/60 text-slate-400 text-xs font-mono select-none ${className}`}
          >
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            <span>Tarifa Convencional: R$ {data?.currentRate?.toFixed(2) ?? "--"}/kWh</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-xs space-y-1 max-w-[220px]">
            <p className="font-semibold text-slate-100">Tarifa Fixa Única</p>
            <p className="text-slate-300">
              A Tarifa Branca não está ativada. Ative nas automações para arbitrar a bateria no horário de pico.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  const {
    currentPeriod,
    currentRate,
    currencySymbol,
    minutesToNextTransition,
    nextTransitionTime,
    isPeakActive,
    isChargingBlocked,
    isWeekend,
    dischargeReserveLimit,
  } = data;

  // Modo Compacto (ex: Kiosk / Headers / Barra Superior)
  if (compact) {
    if (currentPeriod === "PEAK") {
      return (
        <Tooltip enabled={true}>
          <TooltipTrigger asChild>
            <div
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-rose-500/60 bg-rose-950/80 text-rose-200 text-xs font-mono font-bold shadow-md shadow-rose-950/50 animate-pulse select-none ${className}`}
            >
              <Zap className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
              <span>PONTA: {formatCurrency(currentRate, currencySymbol)}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="text-xs space-y-1 max-w-[200px]">
              <p className="font-bold text-rose-300">Horário de Ponta Ativo</p>
              <p className="text-slate-200">
                Tarifa crítica ({formatCurrency(currentRate, currencySymbol)}/kWh). Bateria alimentando as cargas. Restam {minutesToNextTransition} min.
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      );
    }

    if (currentPeriod === "INTERMEDIATE") {
      return (
        <Tooltip enabled={true}>
          <TooltipTrigger asChild>
            <div
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/50 bg-amber-950/70 text-amber-200 text-xs font-mono font-semibold select-none ${className}`}
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              <span>INTER: {formatCurrency(currentRate, currencySymbol)}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="text-xs space-y-1 max-w-[200px]">
              <p className="font-bold text-amber-300">Horário Intermediário</p>
              <p className="text-slate-200">
                Tarifa de transição ({formatCurrency(currentRate, currencySymbol)}/kWh). Mudança em {minutesToNextTransition} min.
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <Tooltip enabled={true}>
        <TooltipTrigger asChild>
          <div
            role="status"
            aria-live="polite"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/40 bg-emerald-950/60 text-emerald-200 text-xs font-mono font-medium select-none ${className}`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>FORA PONTA: {formatCurrency(currentRate, currencySymbol)}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-xs space-y-1 max-w-[200px]">
            <p className="font-bold text-emerald-300">Horário Fora de Ponta</p>
            <p className="text-slate-200">
              Tarifa econômica ({formatCurrency(currentRate, currencySymbol)}/kWh). {isWeekend ? "Fim de semana (100% Fora de Ponta)." : `Próximo pico às ${nextTransitionTime}.`}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Modo Expandido (Dashboard Principal)
  if (currentPeriod === "PEAK") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`animate-card flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-rose-950/80 via-red-950/70 to-slate-900 border border-rose-500/80 shadow-lg shadow-rose-950/40 text-xs sm:text-sm ${className}`}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40">
            <Zap className="w-4 h-4 animate-pulse" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-rose-300 tracking-wide font-mono uppercase">
                ⚡ HORÁRIO DE PONTA ATIVO
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/30 text-rose-200 border border-rose-500/50 animate-pulse">
                {formatCurrency(currentRate, currencySymbol)}/kWh
              </span>
            </div>
            <p className="text-rose-200/90 text-xs mt-0.5">
              Bateria prioritária para blindar contra a tarifa cara. {minutesToNextTransition > 0 ? `Restam ${minutesToNextTransition} min (até ${nextTransitionTime}).` : ""}
              {isChargingBlocked ? " Recarga pela tomada bloqueada." : ""} Reserva: {dischargeReserveLimit}%.
            </p>
          </div>
        </div>

        <TransitionLink
          href="/automations"
          className="self-end sm:self-auto inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300 hover:text-white underline transition-colors"
        >
          <span>Regras</span>
          <ArrowRight className="w-3 h-3" />
        </TransitionLink>
      </div>
    );
  }

  if (currentPeriod === "INTERMEDIATE") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`animate-card flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-slate-900/90 border border-amber-500/60 shadow-md shadow-amber-950/20 text-xs sm:text-sm ${className}`}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Clock className="w-4 h-4 animate-float" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-amber-300 font-mono uppercase">
                ⏳ Horário Intermediário
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {formatCurrency(currentRate, currencySymbol)}/kWh
              </span>
            </div>
            <p className="text-slate-400 text-xs mt-0.5">
              Faixa tarifária moderada. Próxima transição em {minutesToNextTransition} minutos (às {nextTransitionTime}).
            </p>
          </div>
        </div>

        <TransitionLink
          href="/automations"
          className="self-end sm:self-auto inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300 underline transition-colors"
        >
          <span>Regras</span>
          <ArrowRight className="w-3 h-3" />
        </TransitionLink>
      </div>
    );
  }

  // Fora de Ponta
  return (
    <div
      role="status"
      aria-live="polite"
      className={`animate-card flex flex-wrap items-center justify-between gap-3 px-4 py-2 rounded-2xl bg-slate-900/70 border border-emerald-500/40 text-xs text-slate-300 ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <ShieldCheck className="w-4 h-4" aria-hidden="true" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-emerald-300 font-mono uppercase">
              🟢 Fora de Ponta (Econômico)
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              {formatCurrency(currentRate, currencySymbol)}/kWh
            </span>
          </div>
          <p className="text-slate-400 text-[11px] mt-0.5">
            {isWeekend
              ? "Regime de Fim de Semana (100% Fora de Ponta conforme ANEEL)."
              : `Tarifa mais baixa. Próximo horário de ponta às ${nextTransitionTime}.`}
          </p>
        </div>
      </div>

      <TransitionLink
        href="/automations"
        className="self-end sm:self-auto inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 underline transition-colors"
      >
        <span>Tarifa Branca</span>
        <ArrowRight className="w-3 h-3" />
      </TransitionLink>
    </div>
  );
}
