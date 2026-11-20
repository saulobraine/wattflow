import React, { useEffect, useState } from "react";
import {
  Thermometer,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  BatteryCharging,
  Zap,
  Activity,
  Cpu,
  Clock,
  Flame,
  ArrowRight,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { TransitionLink } from "./TransitionLink";
import type {
  BatteryHealthMetrics,
  ThermalRiskLevel,
} from "../domain/services/BatteryHealthService";

export interface BatteryHealthWidgetProps {
  compact?: boolean;
  className?: string;
  initialData?: BatteryHealthMetrics | null;
  refreshIntervalMs?: number;
}

interface ThermalBadgeConfig {
  label: string;
  dotColor: string;
  badgeClass: string;
  textClass: string;
  barGradient: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
}

export function BatteryHealthWidget({
  compact = false,
  className = "",
  initialData = null,
  refreshIntervalMs = 60000,
}: BatteryHealthWidgetProps) {
  const [data, setData] = useState<BatteryHealthMetrics | null>(initialData);
  const [isLoading, setIsLoading] = useState<boolean>(!initialData);

  const fetchBatteryHealth = async () => {
    try {
      const response = await fetch("/api/battery/health");
      const json = await response.json();
      if (response.ok && json.success && json.data) {
        setData(json.data);
      }
    } catch {
      // Falha silenciosa com retenção graciosa de estado anterior
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!initialData) {
      fetchBatteryHealth();
    }
    const interval = setInterval(fetchBatteryHealth, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [initialData, refreshIntervalMs]);

  const getThermalBadgeConfig = (
    riskLevel: ThermalRiskLevel,
    throttleWatts: number,
    isCutoff: boolean,
    isThrottle: boolean
  ): ThermalBadgeConfig => {
    if (isCutoff || riskLevel === "CRITICAL_CUTOFF") {
      return {
        label: "🚨 Corte Térmico de Emergência - ATS na Rede",
        dotColor: "bg-rose-500 animate-ping",
        badgeClass: "bg-rose-950/90 text-rose-300 border-rose-600 animate-pulse shadow-rose-950/60 shadow-lg",
        textClass: "text-rose-400",
        barGradient: "from-orange-500 to-rose-600",
        icon: AlertCircle,
      };
    }

    if (isThrottle || riskLevel === "THROTTLED") {
      return {
        label: `⚠️ Thermal Throttling Ativo (${throttleWatts || 200}W)`,
        dotColor: "bg-orange-500 animate-pulse",
        badgeClass: "bg-orange-950/90 text-orange-300 border-orange-600 animate-pulse shadow-orange-950/50 shadow-md",
        textClass: "text-orange-400",
        barGradient: "from-amber-500 to-orange-500",
        icon: AlertTriangle,
      };
    }

    if (riskLevel === "WARM") {
      return {
        label: "Temperatura Elevada",
        dotColor: "bg-amber-400",
        badgeClass: "bg-amber-950/80 text-amber-300 border-amber-600/70 shadow-amber-950/40 shadow-sm",
        textClass: "text-amber-400",
        barGradient: "from-emerald-500 via-amber-400 to-amber-500",
        icon: Flame,
      };
    }

    return {
      label: "Temperatura Ideal",
      dotColor: "bg-emerald-400",
      badgeClass: "bg-emerald-950/80 text-emerald-300 border-emerald-600/70 shadow-emerald-950/40 shadow-sm",
      textClass: "text-emerald-400",
      barGradient: "from-emerald-500 to-teal-400",
      icon: ShieldCheck,
    };
  };

  if (isLoading) {
    return (
      <div
        className={`animate-pulse rounded-2xl bg-slate-800/60 border border-slate-700/50 ${
          compact ? "h-9 w-44" : "h-64 w-full"
        } ${className}`}
        role="status"
        aria-label="Carregando dados de saúde da bateria"
      />
    );
  }

  // Se não houver dados, exibe fallback gracioso
  const currentTemp = data?.currentTempCelsius ?? null;
  const riskLevel: ThermalRiskLevel = data?.thermalRiskLevel ?? "OPTIMAL";
  const throttleWatts = data?.thermalThrottleSpeedWatts ?? 200;
  const isCutoff = Boolean(data?.isThermalCutoffActive);
  const isThrottle = Boolean(data?.isThermalThrottleActive);
  const thermalConfig = getThermalBadgeConfig(riskLevel, throttleWatts, isCutoff, isThrottle);

  const soh = data?.bmsSohPercentage ?? data?.estimatedHealthPercentage ?? 100;
  const cycles = data?.bmsCycleCount ?? 0;
  const yearsRemaining = data?.estimatedYearsRemaining ?? 8.2;
  const nominalCycles = data?.nominalLifespanCycles ?? 3000;
  const remainingCycles = data?.remainingCyclesEstimate ?? Math.max(0, nominalCycles - cycles);

  // ==============================================================
  // VARIANTE COMPACTA (Para Barra Executiva / Kiosk OLED)
  // ==============================================================
  if (compact) {
    return (
      <Tooltip enabled={true}>
        <TooltipTrigger asChild>
          <div
            role="status"
            aria-live="polite"
            aria-label={`Saúde da Bateria: SOH ${soh}%, Temperatura ${
              currentTemp !== null ? `${currentTemp.toFixed(1)}°C` : "--"
            }, Estado: ${thermalConfig.label}`}
            className={`inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full border text-xs font-mono font-medium transition-all select-none ${thermalConfig.badgeClass} ${className}`}
          >
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${thermalConfig.dotColor}`} aria-hidden="true" />
              <Thermometer className="w-3.5 h-3.5" aria-hidden="true" />
              <strong className="font-bold text-slate-100">
                {currentTemp !== null ? `${currentTemp.toFixed(1)}°C` : "--"}
              </strong>
            </div>

            <span className="opacity-40 select-none">|</span>

            <div className="flex items-center gap-1 text-slate-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              <span>{soh}% SOH</span>
            </div>

            <span className="opacity-40 select-none hidden lg:inline">•</span>

            <span className="text-[11px] opacity-90 hidden lg:inline font-sans">
              {cycles} ciclos
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-xs space-y-1.5 max-w-[260px] p-1 font-sans">
            <div className="font-bold text-slate-100 flex items-center justify-between border-b border-slate-800 pb-1">
              <span>BMS &amp; Saúde LiFePO4</span>
              <span className="text-[11px] font-mono text-emerald-400">{soh}% SOH</span>
            </div>
            <div className="text-slate-300">
              <strong>Estado Térmico:</strong> {thermalConfig.label}
            </div>
            <div className="text-slate-400 text-[11px]">
              Ciclos Registrados: <span className="font-mono text-slate-200">{cycles}</span> / {nominalCycles} (Restam ~{yearsRemaining} anos)
            </div>
            {isCutoff && (
              <div className="text-rose-400 font-bold text-[11px]">
                🚨 Inversor isolado na rede por proteção térmica preventiva.
              </div>
            )}
            {isThrottle && (
              <div className="text-orange-400 font-semibold text-[11px]">
                ⚠️ Recarga reduzida para {throttleWatts}W para resfriamento.
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  // ==============================================================
  // VARIANTE EXPANDIDA (Para Dashboard Executivo)
  // ==============================================================
  const warningThreshold = data?.thermalWarningThreshold ?? 42;
  const cutoffThreshold = data?.thermalShutdownThreshold ?? 48;
  const maxRecorded = data?.maxRecordedTempCelsius ?? null;

  // Cálculo da barra térmica volumétrica (escala 20°C a 60°C)
  const tempGaugePercent = currentTemp !== null
    ? Math.max(5, Math.min(100, ((currentTemp - 20) / 40) * 100))
    : 15;

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Módulo de Monitoramento de Saúde da Bateria e Proteção Térmica do BMS"
      className={`animate-card interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5 flex flex-col justify-between ${className}`}
    >
      {/* 1. Topo: Título, Ícone e Badge Térmico em Tempo Real */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0 shadow-md shadow-cyan-950/30">
            <BatteryCharging className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
              Saúde da Bateria &amp; BMS (LiFePO4)
            </h2>
            <p className="text-xs text-slate-400">
              Química LFP de Alta Durabilidade • Proteção Ativa contra Degradação Térmica
            </p>
          </div>
        </div>

        {/* Badge Dinâmico de Risco Térmico */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono font-bold shadow-sm transition-all ${thermalConfig.badgeClass}`}
          >
            <span className={`w-2 h-2 rounded-full ${thermalConfig.dotColor}`} aria-hidden="true" />
            <span>{thermalConfig.label}</span>
          </span>
        </div>
      </div>

      {/* 2. Banner de Alerta Crítico / Throttling se Ativo */}
      {isCutoff && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-950/80 border-2 border-rose-500/80 text-rose-200 flex items-start gap-3 shadow-lg shadow-rose-950/50"
        >
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs space-y-1">
            <span className="font-bold text-rose-100 block text-sm">
              🚨 Corte Térmico Preventivo Acionado (BMS &gt;= {cutoffThreshold}°C)
            </span>
            <p className="text-rose-300 leading-relaxed">
              A Chave de Transferência (ATS) reteve o consumo na rede elétrica da concessionária para descarregar o inversor e proteger a integridade química das células de lítio. O sistema rearmará automaticamente quando a temperatura baixar.
            </p>
          </div>
        </div>
      )}

      {isThrottle && !isCutoff && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-orange-950/80 border border-orange-500/80 text-orange-200 flex items-start gap-3 shadow-md shadow-orange-950/40"
        >
          <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs space-y-1">
            <span className="font-bold text-orange-100 block text-sm">
              ⚠️ Thermal Throttling Ativo (Temperatura &gt;= {warningThreshold}°C)
            </span>
            <p className="text-orange-300 leading-relaxed">
              A taxa de recarga AC foi limitada a <strong className="font-mono text-orange-200">{throttleWatts}W</strong> pelo orquestrador para dissipar calor acumulado e manter a vida útil de 3.000 ciclos nominais.
            </p>
          </div>
        </div>
      )}

      {/* 3. Indicador de Temperatura das Células & Régua Térmica Volumétrica */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Thermometer className={`w-5 h-5 ${thermalConfig.textClass}`} aria-hidden="true" />
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Temperatura Operacional das Células
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <span>Máx. Registrada:</span>
            <strong className="text-slate-200">
              {maxRecorded !== null ? `${maxRecorded.toFixed(1)}°C` : "--"}
            </strong>
          </div>
        </div>

        <div className="flex items-baseline gap-3">
          <span className={`text-3xl sm:text-4xl font-extrabold font-mono tracking-tight ${thermalConfig.textClass}`}>
            {currentTemp !== null ? `${currentTemp.toFixed(1)}°C` : "--"}
          </span>
          <span className="text-xs text-slate-400 font-mono">
            (Alerta: {warningThreshold}°C | Corte: {cutoffThreshold}°C)
          </span>
        </div>

        {/* Barra Volumétrica de Temperatura com Gradiente Térmico */}
        <div className="space-y-1.5">
          <div className="w-full bg-slate-800/90 h-3 rounded-full overflow-hidden p-0.5 border border-slate-700/60 relative">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r ${thermalConfig.barGradient}`}
              style={{ width: `${tempGaugePercent}%` }}
              role="progressbar"
              aria-valuenow={currentTemp ?? 25}
              aria-valuemin={20}
              aria-valuemax={60}
              aria-label="Nível de temperatura das células"
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            <span>20°C (Fria)</span>
            <span className="text-amber-400/90">38°C (Ideal)</span>
            <span className="text-orange-400/90">{warningThreshold}°C (Throttling)</span>
            <span className="text-rose-400/90">{cutoffThreshold}°C (Corte)</span>
          </div>
        </div>
      </div>

      {/* 4. Grade de Métricas Vitais: SOH, Ciclos LiFePO4 e Grandezas Elétricas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Pilar 1: SOH % (State of Health) com Barra Volumétrica Semântica */}
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Saúde Química (SOH)
            </span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
          </div>

          <div className="flex items-center gap-3">
            {/* Medidor Circular Compacto SVG */}
            <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
              <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-slate-800"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-emerald-400 transition-all duration-700 ease-out"
                  strokeDasharray={`${Math.max(0, Math.min(100, soh))}, 100`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span className="absolute text-[11px] font-bold font-mono text-slate-100">
                {soh}%
              </span>
            </div>

            <div className="text-xs">
              <span className="font-bold text-emerald-300 block">
                {soh >= 90 ? "Excelente" : soh >= 80 ? "Normal" : "Degradação Leve"}
              </span>
              <span className="text-[10px] text-slate-400">
                Capacidade íntegra
              </span>
            </div>
          </div>

          <div className="text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-900">
            Curva de retenção LiFePO4
          </div>
        </div>

        {/* Pilar 2: Ciclos LiFePO4 e Projeção de Vida Útil em Anos */}
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Ciclos &amp; Vida Útil
            </span>
            <Activity className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          </div>

          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold font-mono text-slate-100">
                {cycles}
              </span>
              <span className="text-xs font-mono text-slate-400">
                / {nominalCycles} ciclos
              </span>
            </div>
            <div className="text-xs text-cyan-300 font-medium mt-0.5">
              ~{yearsRemaining} anos de vida útil restante
            </div>
          </div>

          <div className="text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-900">
            Restam {remainingCycles} ciclos (1 ciclo/dia)
          </div>
        </div>

        {/* Pilar 3: Tensão e Grandezas Elétricas do BMS */}
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Grandezas Elétricas
            </span>
            <Zap className="w-4 h-4 text-amber-400" aria-hidden="true" />
          </div>

          <div>
            <div className="text-2xl font-extrabold font-mono text-amber-300">
              {data?.voltageVolts !== null && data?.voltageVolts !== undefined
                ? `${data.voltageVolts.toFixed(1)} V`
                : "-- V"}
            </div>
            <div className="text-xs text-slate-400 font-mono mt-0.5">
              Corrente: {data?.amperageAmps !== null && data?.amperageAmps !== undefined
                ? `${data.amperageAmps.toFixed(1)} A`
                : "-- A"}
            </div>
          </div>

          <div className="text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-900">
            Potência BMS: {data?.powerWatts !== null && data?.powerWatts !== undefined
              ? `${data.powerWatts} W`
              : "-- W"}
          </div>
        </div>
      </div>

      {/* 5. Rodapé: Status da Telemetria & Link Rápido de Configuração */}
      <div className="pt-2 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500 font-mono">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>Telemetria BMS: EcoFlow MQTT Stream &amp; REST</span>
        </div>

        <TransitionLink
          href="/automations"
          className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors font-sans font-medium"
        >
          <span>Ajustar Limiares Térmicos</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </TransitionLink>
      </div>
    </section>
  );
}
