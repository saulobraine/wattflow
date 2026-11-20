import React, { useState } from "react";
import { CloudLightning, X, ShieldAlert, Zap, ArrowRight } from "lucide-react";
import { TransitionLink } from "./TransitionLink";

export interface StormAlertBannerProps {
  isStormAlertActive: boolean;
  alertDescription?: string | null;
  triggeredAt?: string | null;
  reserveThreshold?: number;
  isPrechargeActive?: boolean;
  className?: string;
  onDismiss?: () => void;
}

export function StormAlertBanner({
  isStormAlertActive,
  alertDescription,
  triggeredAt,
  reserveThreshold = 85,
  isPrechargeActive = true,
  className = "",
  onDismiss,
}: StormAlertBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (!isStormAlertActive || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  const formattedTime = triggeredAt
    ? new Date(triggeredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <section
      role="alert"
      aria-live="assertive"
      aria-label="Alerta de Modo No-Break Preventivo Ativo por Tempestade"
      className={`animate-card stagger-1 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-rose-950/80 via-red-950/70 to-slate-900 border-2 border-rose-500 shadow-2xl shadow-rose-950/60 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 ${className}`}
    >
      <div className="flex items-start gap-3.5">
        <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 shrink-0 mt-0.5 border border-rose-500/40 shadow-inner shadow-rose-500/20">
          <CloudLightning className="w-6 h-6 animate-pulse text-rose-400" aria-hidden="true" />
        </div>

        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-rose-200 flex items-center gap-1.5">
              <span>⛈️ Modo No-Break Preventivo Ativado</span>
            </h2>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-rose-500/30 text-rose-200 border border-rose-500/50 font-mono animate-pulse">
              Defesa Meteorológica Ativa
            </span>
            {formattedTime && (
              <span className="text-[11px] font-mono text-rose-300/80">
                Disparado às {formattedTime}
              </span>
            )}
          </div>

          <p className="text-xs sm:text-sm text-rose-100/90 leading-relaxed max-w-3xl">
            Previsão de tempestade iminente detectada{" "}
            {alertDescription ? (
              <strong className="text-rose-200">({alertDescription})</strong>
            ) : null}
            . A chave ATS foi retida na rede elétrica da concessionária e a reserva de bateria foi
            elevada para <strong className="text-rose-200 font-mono">{reserveThreshold}%</strong>{" "}
            {isPrechargeActive ? "com pré-recarga rápida AC " : ""}para garantir que sua casa tenha máxima autonomia durante possíveis apagões.
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] font-mono text-rose-300">
            <span className="inline-flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400" />
              Inversor em Standby
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-rose-400" />
              Proteção contra Blackout
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end md:self-center shrink-0">
        <TransitionLink
          href="/automations"
          className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-all duration-150 shadow-md shadow-rose-950 flex items-center gap-1.5 active:scale-95"
        >
          <span>Gerenciar</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </TransitionLink>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dispensar aviso de alerta de tempestade"
          className="p-2 rounded-xl text-rose-300 hover:text-white hover:bg-rose-900/50 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
}