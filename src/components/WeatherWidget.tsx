import React, { useEffect, useState } from "react";
import {
  Sun,
  CloudSun,
  Cloud,
  CloudRain,
  CloudLightning,
  Wind,
  Droplets,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  MapPin,
} from "lucide-react";
import { TransitionLink } from "./TransitionLink";
import type {
  WeatherForecastResponseData,
  StormSeverity,
} from "../infrastructure/services/OpenMeteoSolarForecastService";

export interface WeatherWidgetData extends WeatherForecastResponseData {
  isAutoStormActive: boolean;
  isStormAlertActive: boolean;
  autoStormReserveThreshold: number;
  autoStormRainThresholdMm: number;
  autoStormPrechargeAc: boolean;
}

export interface WeatherWidgetProps {
  className?: string;
  compact?: boolean;
}

export function getWeatherIcon(code: number, severity?: StormSeverity) {
  if (severity === "SEVERE" || [95, 96, 99].includes(code)) {
    return CloudLightning;
  }
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
    return CloudRain;
  }
  if ([45, 48, 3].includes(code)) {
    return Cloud;
  }
  if ([1, 2].includes(code)) {
    return CloudSun;
  }
  return Sun;
}

export function WeatherWidget({ className = "", compact = false }: WeatherWidgetProps) {
  const [data, setData] = useState<WeatherWidgetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchWeather = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    try {
      const res = await fetch("/api/weather/forecast");
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setData(json.data);
        setError(null);
      } else {
        if (res.status === 400 && json.message?.includes("Coordenadas geográficas")) {
          setError("LOCATION_NOT_CONFIGURED");
        } else {
          setError(json.message || "Não foi possível obter a previsão meteorológica.");
        }
      }
    } catch {
      setError("Falha de rede ao consultar o serviço meteorológico.");
    } finally {
      setIsLoading(false);
      if (showRefresh) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchWeather();
    // Atualiza a cada 30 minutos em segundo plano
    const timer = setInterval(() => {
      fetchWeather();
    }, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  if (isLoading) {
    return (
      <div
        className={`p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl animate-pulse space-y-3 ${className}`}
        role="status"
        aria-label="Carregando previsão meteorológica"
      >
        <div className="flex items-center justify-between">
          <div className="h-4 w-32 bg-slate-800 rounded" />
          <div className="h-5 w-20 bg-slate-800 rounded-full" />
        </div>
        <div className="flex items-center gap-4 py-2">
          <div className="h-10 w-10 bg-slate-800 rounded-xl" />
          <div className="space-y-1.5 flex-1">
            <div className="h-6 w-24 bg-slate-800 rounded" />
            <div className="h-3 w-40 bg-slate-800 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error === "LOCATION_NOT_CONFIGURED") {
    return (
      <div
        className={`p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-2 text-xs text-slate-400 ${className}`}
      >
        <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
          <MapPin className="w-4 h-4 text-emerald-400" />
          <span>Localização Geográfica</span>
        </div>
        <p>
          Configure sua Latitude e Longitude para habilitar a previsão do tempo e o Modo No-Break Preventivo.
        </p>
        <TransitionLink
          href="/settings"
          className="inline-block pt-1 font-semibold text-emerald-400 hover:text-emerald-300 underline"
        >
          Acessar Configurações (BYOK &amp; Localização) &rarr;
        </TransitionLink>
      </div>
    );
  }

  if (error && !data) {
    return null; // Falha graciosa e silenciosa
  }

  if (!data) return null;

  const { assessment } = data;
  const WeatherIcon = getWeatherIcon(assessment.weatherCode, assessment.severity);

  const getSeverityBadge = (severity: StormSeverity, isAlertActive: boolean) => {
    if (isAlertActive || severity === "SEVERE") {
      return {
        label: "Risco Severo (No-Break Ativo)",
        classes: "bg-rose-950/80 text-rose-300 border-rose-600/70 shadow-rose-950/50 shadow-md animate-pulse",
        icon: AlertTriangle,
      };
    }
    if (severity === "MODERATE") {
      return {
        label: "Atenção: Chuva / Vento",
        classes: "bg-amber-950/80 text-amber-300 border-amber-600/70 shadow-amber-950/40 shadow-sm",
        icon: CloudRain,
      };
    }
    return {
      label: "Clima Estável",
      classes: "bg-emerald-950/80 text-emerald-300 border-emerald-600/70 shadow-emerald-950/40 shadow-sm",
      icon: ShieldCheck,
    };
  };

  const badge = getSeverityBadge(assessment.severity, data.isStormAlertActive);
  const BadgeIcon = badge.icon;

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs font-mono select-none ${className}`}
        title={`${assessment.weatherDescription} • ${assessment.temperatureMaxCelsius.toFixed(0)}°C / ${assessment.temperatureMinCelsius.toFixed(0)}°C`}
      >
        <WeatherIcon className="w-4 h-4 text-amber-400" aria-hidden="true" />
        <span className="font-semibold text-slate-200">
          {assessment.temperatureMaxCelsius.toFixed(0)}°C
        </span>
        {data.isStormAlertActive && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
            NO-BREAK PREVENTIVO
          </span>
        )}
      </div>
    );
  }

  return (
    <section
      aria-label="Previsão do Tempo e Defesa Meteorológica"
      className={`animate-card interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4 flex flex-col justify-between ${className}`}
    >
      <div className="space-y-4">
        {/* Cabeçalho do Card */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <WeatherIcon className="w-5 h-5 animate-float" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                Clima &amp; Previsão Local
              </h2>
              <p className="text-xs text-slate-400">
                Detecção de tempestades para acionamento do Modo No-Break
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-full border shadow-sm ${badge.classes}`}
            >
              <BadgeIcon className="w-3.5 h-3.5" aria-hidden="true" />
              {badge.label}
            </span>

            <button
              type="button"
              onClick={() => fetchWeather(true)}
              disabled={isRefreshing}
              aria-label="Atualizar previsão do tempo agora"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Destaque Climático */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/80 border border-slate-800/80">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-amber-400 shrink-0">
              <WeatherIcon className="w-8 h-8" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-100">
                  {assessment.temperatureMaxCelsius.toFixed(1)}°C
                </span>
                <span className="text-xs font-mono text-slate-400">
                  (Mín: {assessment.temperatureMinCelsius.toFixed(1)}°C)
                </span>
              </div>
              <p className="text-xs font-medium text-slate-300 mt-0.5">
                {assessment.weatherDescription}
              </p>
            </div>
          </div>

          <div className="text-right sm:text-right text-xs space-y-1">
            <div className="text-slate-400 flex items-center gap-1.5 sm:justify-end">
              <Droplets className="w-3.5 h-3.5 text-sky-400" />
              <span>Chuva: <strong className="text-slate-200">{assessment.precipitationSumMm.toFixed(1)} mm</strong> ({assessment.precipitationProbabilityMax}%)</span>
            </div>
            <div className="text-slate-400 flex items-center gap-1.5 sm:justify-end">
              <Wind className="w-3.5 h-3.5 text-teal-400" />
              <span>Vento máx: <strong className="text-slate-200">{assessment.windSpeedMaxKmh.toFixed(0)} km/h</strong></span>
            </div>
          </div>
        </div>

        {/* Resumo do Risco / Auto-Storm Status */}
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 font-mono text-[11px] uppercase tracking-wider">
              Defesa Meteorológica (Auto-Storm)
            </span>
            <span
              className={`text-xs font-bold font-mono ${
                data.isAutoStormActive ? "text-emerald-400" : "text-slate-500"
              }`}
            >
              {data.isAutoStormActive ? "ATIVADA" : "DESATIVADA"}
            </span>
          </div>

          <p className="text-slate-300 leading-relaxed text-[11px]">
            {assessment.alertSummary}
          </p>

          {data.isAutoStormActive && (
            <div className="text-[10px] text-slate-400 font-mono pt-1 border-t border-slate-900 flex flex-wrap justify-between gap-1">
              <span>Reserva Alvo: {data.autoStormReserveThreshold}%</span>
              <span>Gatilho de Chuva: &gt; {data.autoStormRainThresholdMm} mm</span>
              <span>Pré-recarga AC: {data.autoStormPrechargeAc ? "Sim" : "Não"}</span>
            </div>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500 font-mono">
        <span>Fonte: Open-Meteo Weather Model</span>
        <TransitionLink
          href="/automations"
          className="text-emerald-400 hover:text-emerald-300 underline font-semibold transition-colors"
        >
          Ajustar Regras Auto-Storm &rarr;
        </TransitionLink>
      </div>
    </section>
  );
}