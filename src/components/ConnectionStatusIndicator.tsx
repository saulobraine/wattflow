import React from "react";
import { useLiveTelemetry, type ConnectionStatus } from "../hooks/useLiveTelemetry";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";

export interface ConnectionStatusIndicatorProps {
  status?: ConnectionStatus;
  onReconnect?: () => void;
  className?: string;
  showLabelOnMobile?: boolean;
  compact?: boolean;
}

export function ConnectionStatusIndicator({
  status: propStatus,
  onReconnect: propReconnect,
  className = "",
  showLabelOnMobile = false,
  compact = false,
}: ConnectionStatusIndicatorProps) {
  const hookResult = useLiveTelemetry();
  const status = propStatus ?? hookResult.connectionStatus;
  const handleReconnect = propReconnect ?? hookResult.reconnect;

  const configs: Record<
    ConnectionStatus,
    {
      label: string;
      tooltip: string;
      dotClass: string;
      pingClass?: string;
      containerClass: string;
      textClass: string;
    }
  > = {
    LIVE: {
      label: "Ao Vivo",
      tooltip: "Conectado via MQTT/SSE em tempo real. Latência inferior a 100ms.",
      dotClass: "bg-emerald-500 shadow-[0_0_8px_#10b981]",
      pingClass: "bg-emerald-400 opacity-75",
      containerClass: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
      textClass: "text-emerald-400",
    },
    POLLING: {
      label: "Reconectando",
      tooltip: "Modo de contingência ativo. Atualizando via polling a cada 5s.",
      dotClass: "bg-amber-500 shadow-[0_0_8px_#f59e0b]",
      pingClass: "bg-amber-400 opacity-60 animate-pulse",
      containerClass: "bg-amber-500/10 border-amber-500/30 text-amber-300",
      textClass: "text-amber-400",
    },
    OFFLINE: {
      label: "Offline",
      tooltip: "Sem conexão com o servidor. Verifique sua rede.",
      dotClass: "bg-rose-500 shadow-[0_0_8px_#f43f5e]",
      containerClass: "bg-rose-500/10 border-rose-500/30 text-rose-300",
      textClass: "text-rose-400",
    },
  };

  const config = configs[status];

  return (
    <Tooltip enabled={true}>
      <TooltipTrigger asChild>
        <div
          role="status"
          aria-live="polite"
          aria-label={`Status da Conexão: ${config.label}. ${config.tooltip}`}
          onClick={status !== "LIVE" ? handleReconnect : undefined}
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border transition-all duration-200 select-none ${
            config.containerClass
          } ${status !== "LIVE" ? "cursor-pointer hover:scale-105 active:scale-95" : "cursor-default"} ${className}`}
        >
          <span className="relative flex h-2 w-2 sm:h-2.5 sm:w-2.5 shrink-0">
            {config.pingClass && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.pingClass}`} />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 sm:h-2.5 sm:w-2.5 ${config.dotClass}`} />
          </span>

          {!compact && (
            <span
              className={`text-[11px] font-mono font-semibold truncate ${
                showLabelOnMobile ? "inline" : "hidden sm:inline"
              } ${config.textClass}`}
            >
              {config.label}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="text-xs space-y-0.5 max-w-[200px]">
          <p className="font-semibold text-slate-100">{config.label}</p>
          <p className="text-slate-300 leading-tight">{config.tooltip}</p>
          {status !== "LIVE" && (
            <p className="text-[10px] text-emerald-400 font-mono pt-0.5">Clique para tentar reconectar</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
