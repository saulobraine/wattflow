import React, { useEffect, useRef, useState, FormEvent } from "react";
import { Layout } from "../components/Layout";
import { useLiveTelemetry } from "../hooks/useLiveTelemetry";
import { toast } from "../hooks/use-toast";
import { formatCurrency } from "../utils/currencyFormatter";
import { formatSolarTime } from "../components/WeatherWidget";
import {
  Sliders,
  Zap,
  Power,
  AlertCircle,
  CheckCircle2,
  ArrowLeftRight,
  CloudLightning,
  CloudRain,
  ShieldCheck,
  Clock,
  DollarSign,
  Sun,
  Moon,
  SunMedium,
  BatteryCharging,
  Loader2,
} from "lucide-react";

export default function AutomationsPage() {
  const { telemetry: liveTelemetry } = useLiveTelemetry();

  // 1. Limiares de Comutação ATS (Histerese)
  const [turnOnThreshold, setTurnOnThreshold] = useState(90);
  const [turnOffThreshold, setTurnOffThreshold] = useState(30);
  const [isAutomationActive, setIsAutomationActive] = useState(true);

  // 2. Modo No-Break Preventivo & Defesa Meteorológica (Auto-Storm)
  const [isAutoStormActive, setIsAutoStormActive] = useState(false);
  const [autoStormReserveThreshold, setAutoStormReserveThreshold] = useState(85);
  const [autoStormRainThresholdMm, setAutoStormRainThresholdMm] = useState(20.0);
  const [autoStormPrechargeAc, setAutoStormPrechargeAc] = useState(true);
  const [isStormAlertActive, setIsStormAlertActive] = useState(false);
  const [lastStormAlertDescription, setLastStormAlertDescription] = useState<string | null>(null);

  // 3. Solar Smart Charging (Modulação de Recarga AC)
  const [isSmartChargingActive, setIsSmartChargingActive] = useState(false);
  const [minAcChargingWatts, setMinAcChargingWatts] = useState(200);
  const [maxAcChargingWatts, setMaxAcChargingWatts] = useState(1200);
  const [chargeOnlyOffPeak, setChargeOnlyOffPeak] = useState(true);
  const [cloudyPrechargeActive, setCloudyPrechargeActive] = useState(true);

  // 4. Arbitragem de Tarifa Branca (Time-of-Use ANEEL)
  const [isTimeOfUseActive, setIsTimeOfUseActive] = useState(false);
  const [timeOfUseWeekdaysOnly, setTimeOfUseWeekdaysOnly] = useState(true);
  const [peakStartTime, setPeakStartTime] = useState("17:30");
  const [peakEndTime, setPeakEndTime] = useState("20:30");
  const [intermediateStartTime, setIntermediateStartTime] = useState("16:30");
  const [intermediateEndTime, setIntermediateEndTime] = useState("21:30");
  const [peakDischargeReserveLimit, setPeakDischargeReserveLimit] = useState(20);
  const [blockAcChargingDuringPeak, setBlockAcChargingDuringPeak] = useState(true);
  const [peakTariffPerKwh, setPeakTariffPerKwh] = useState(1.85);
  const [currencySymbol, setCurrencySymbol] = useState("R$");

  // 5. Operação Solar Diurna & Histerese Adaptativa
  const [isDaylightOnlyActive, setIsDaylightOnlyActive] = useState(false);
  const [isAdaptiveHysteresisActive, setIsAdaptiveHysteresisActive] = useState(false);
  const [minAdaptiveThreshold, setMinAdaptiveThreshold] = useState(20);
  const [maxAdaptiveThreshold, setMaxAdaptiveThreshold] = useState(50);
  const [solarTimes, setSolarTimes] = useState<{
    sunrise: string | null;
    sunset: string | null;
    isDaylight: boolean;
  } | null>(null);
  const [solarProjection, setSolarProjection] = useState<{
    estimatedDailyGenerationKwh: number | null;
    peakSunHours: number | null;
    irradianceKwhM2: number | null;
  } | null>(null);

  // Estados de Controle & Feedback
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const hasUserEditedAtsRef = useRef(false);

  const showFormFeedback = (next: { type: "success" | "error"; message: string }) => {
    setFeedback(next);
    toast({
      title: next.type === "success" ? "Automações Salvas" : "Erro nas Automações",
      description: next.message,
      variant: next.type === "success" ? "success" : "destructive",
    });
  };

  useEffect(() => {
    let isMounted = true;

    async function loadConfigurations() {
      try {
        const [autoRes, settingsRes] = await Promise.all([
          fetch("/api/automations", { cache: "no-store" }),
          fetch("/api/settings", { cache: "no-store" }),
        ]);

        if (autoRes.ok) {
          const autoJson = await autoRes.json().catch(() => null);
          if (isMounted && autoJson?.success && autoJson.data) {
            if (!hasUserEditedAtsRef.current) {
              setTurnOnThreshold(autoJson.data.turnOnThreshold ?? 90);
              setTurnOffThreshold(autoJson.data.turnOffThreshold ?? 30);
              setIsAutomationActive(autoJson.data.isAutomationActive ?? true);
            }
          }
        }

        if (settingsRes.ok) {
          const settingsJson = await settingsRes.json().catch(() => null);
          if (isMounted && settingsJson?.success && settingsJson.data) {
            const s = settingsJson.data;
            setIsAutoStormActive(s.isAutoStormActive ?? false);
            setAutoStormReserveThreshold(s.autoStormReserveThreshold ?? 85);
            setAutoStormRainThresholdMm(s.autoStormRainThresholdMm ?? 20.0);
            setAutoStormPrechargeAc(s.autoStormPrechargeAc ?? true);
            setIsStormAlertActive(s.isStormAlertActive ?? false);
            setLastStormAlertDescription(s.lastStormAlertDescription ?? null);

            setIsSmartChargingActive(Boolean(s.isSmartChargingActive));
            setMinAcChargingWatts(s.minAcChargingWatts ?? 200);
            setMaxAcChargingWatts(s.maxAcChargingWatts ?? 1200);
            setChargeOnlyOffPeak(s.chargeOnlyOffPeak ?? true);
            setCloudyPrechargeActive(s.cloudyPrechargeActive ?? true);

            setIsTimeOfUseActive(s.isTimeOfUseActive ?? s.isDynamicTariffActive ?? false);
            setTimeOfUseWeekdaysOnly(s.timeOfUseWeekdaysOnly ?? true);
            setPeakStartTime(s.peakStartTime || "17:30");
            setPeakEndTime(s.peakEndTime || "20:30");
            setIntermediateStartTime(s.intermediateStartTime || "16:30");
            setIntermediateEndTime(s.intermediateEndTime || "21:30");
            setPeakDischargeReserveLimit(s.peakDischargeReserveLimit ?? s.peakReserveThreshold ?? 20);
            setBlockAcChargingDuringPeak(s.blockAcChargingDuringPeak ?? true);
            setPeakTariffPerKwh(s.peakTariffPerKwh ?? 1.85);
            setCurrencySymbol(s.currencySymbol ?? "R$");

            setIsDaylightOnlyActive(Boolean(s.isDaylightOnlyActive));
            setIsAdaptiveHysteresisActive(s.isAdaptiveHysteresisActive ?? false);
            setMinAdaptiveThreshold(s.minAdaptiveThreshold ?? 20);
            setMaxAdaptiveThreshold(Math.max(30, s.maxAdaptiveThreshold ?? 50));
          }
        }
      } catch (err) {
        console.error("Erro ao carregar regras de automação:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    async function loadWeatherForecast() {
      try {
        const weatherRes = await fetch("/api/weather/forecast", { cache: "no-store" });
        if (!weatherRes.ok) return;
        const weatherJson = await weatherRes.json().catch(() => null);
        if (isMounted && weatherJson?.success && weatherJson.data) {
          setSolarTimes({
            sunrise: weatherJson.data.sunrise || weatherJson.data.solarForecast?.sunrise || null,
            sunset: weatherJson.data.sunset || weatherJson.data.solarForecast?.sunset || null,
            isDaylight: Boolean(weatherJson.data.isDaylight ?? weatherJson.data.solarForecast?.isDaylight ?? true),
          });
          setSolarProjection({
            estimatedDailyGenerationKwh: weatherJson.data.estimatedDailyGenerationKwh ?? null,
            peakSunHours: weatherJson.data.peakSunHours ?? null,
            irradianceKwhM2: weatherJson.data.irradianceKwhM2 ?? null,
          });
        }
      } catch {
        // Fallback silencioso
      }
    }

    loadConfigurations();
    loadWeatherForecast();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleUpperThresholdChange = (newValue: number) => {
    hasUserEditedAtsRef.current = true;
    const clampedUpper = Math.max(2, Math.min(100, newValue));
    if (clampedUpper <= turnOffThreshold) {
      setTurnOffThreshold(clampedUpper - 1);
    }
    setTurnOnThreshold(clampedUpper);
  };

  const handleLowerThresholdChange = (newValue: number) => {
    hasUserEditedAtsRef.current = true;
    const clampedLower = Math.max(1, Math.min(99, newValue));
    if (clampedLower >= turnOnThreshold) {
      setTurnOnThreshold(clampedLower + 1);
    }
    setTurnOffThreshold(clampedLower);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    if (turnOffThreshold >= turnOnThreshold) {
      showFormFeedback({
        type: "error",
        message: "O limite mínimo de bateria deve ser pelo menos 1% menor que o limite máximo.",
      });
      setIsSaving(false);
      return;
    }

    try {
      // 1. Salva Limiares da ATS em /api/automations
      const autoRes = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turnOnThreshold,
          turnOffThreshold,
          isAutomationActive,
        }),
      });

      const autoJson = await autoRes.json().catch(() => ({}));
      if (!autoRes.ok || !autoJson.success) {
        showFormFeedback({
          type: "error",
          message: autoJson.message || `Erro ao salvar limites ATS (HTTP ${autoRes.status}).`,
        });
        setIsSaving(false);
        return;
      }

      // 2. Salva Regras de Automação em /api/settings
      const settingsRes = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isAutoStormActive,
          autoStormReserveThreshold: Number(autoStormReserveThreshold),
          autoStormRainThresholdMm: Number(autoStormRainThresholdMm),
          autoStormPrechargeAc,

          isSmartChargingActive,
          minAcChargingWatts: Number(minAcChargingWatts),
          maxAcChargingWatts: Number(maxAcChargingWatts),
          chargeOnlyOffPeak,
          cloudyPrechargeActive,

          isTimeOfUseActive,
          isDynamicTariffActive: isTimeOfUseActive,
          timeOfUseWeekdaysOnly,
          peakStartTime,
          peakEndTime,
          intermediateStartTime: intermediateStartTime || null,
          intermediateEndTime: intermediateEndTime || null,
          peakDischargeReserveLimit: Number(peakDischargeReserveLimit),
          peakReserveThreshold: Number(peakDischargeReserveLimit),
          blockAcChargingDuringPeak,

          isDaylightOnlyActive,
          isAdaptiveHysteresisActive,
          minAdaptiveThreshold: Number(minAdaptiveThreshold),
          maxAdaptiveThreshold: Number(maxAdaptiveThreshold),
        }),
      });

      const settingsJson = await settingsRes.json().catch(() => ({}));
      if (!settingsRes.ok || !settingsJson.success) {
        showFormFeedback({
          type: "error",
          message: settingsJson.message || "Erro ao salvar regras avançadas de automação.",
        });
        setIsSaving(false);
        return;
      }

      showFormFeedback({
        type: "success",
        message: "Regras de automação, Auto-Storm, Smart Charging e Tarifa Branca salvas com sucesso!",
      });
    } catch (err) {
      console.error("Erro ao salvar regras:", err);
      showFormFeedback({ type: "error", message: "Falha de comunicação com o servidor." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Layout title="Gatilhos &amp; Regras de Automação">
      <div className="space-y-4 md:space-y-6">
        {feedback && (
          <div
            role="alert"
            aria-live="polite"
            className={`p-4 rounded-xl border flex items-center gap-3 text-sm shadow-md ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                : "bg-rose-500/10 border-rose-500/40 text-rose-300"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" aria-hidden="true" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" aria-hidden="true" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
        )}

        {/* Card Explicativo sobre a Comutação da ATS */}
        <section
          aria-label="Como funciona a automação EcoFlow e ATS"
          className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3 shadow-lg"
        >
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
            <ArrowLeftRight className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-xs text-slate-300 space-y-1">
            <span className="font-semibold text-slate-100 text-sm block">
              Comutação Automática Inteligente (EcoFlow + ATS)
            </span>
            <p className="text-slate-400 leading-relaxed">
              O WattFlow monitora a bateria, tarifas e meteorologia 24/7. Ao atingir o limiar superior, ativa o inversor AC e a ATS transfere a residência para a energia solar/bateria. Ao atingir o piso, retorna para a concessionária instantaneamente.
            </p>
          </div>
        </section>

        <form onSubmit={handleSubmit} noValidate className="space-y-4 md:space-y-6">
          {/* ============================================================ */}
          {/* 1. Limiares de Comutação ATS (Histerese SOC) */}
          {/* ============================================================ */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Sliders className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">1. Limiares de Comutação ATS (SOC)</h2>
                  <p className="text-xs text-slate-400">
                    Defina os percentuais exatos de bateria para acionar e desarmar a saída AC da estação
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer self-start sm:self-auto min-h-[44px]">
                <div className="flex flex-col items-start sm:items-end">
                  <span className="text-xs font-semibold text-slate-200">
                    Disjuntor Geral da Automação
                  </span>
                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
                    {isAutomationActive ? "Loop 24/7 Ativo" : "Pausado (Manual)"}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={isAutomationActive}
                  onChange={(e) => setIsAutomationActive(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-700 bg-slate-950 text-emerald-500 accent-emerald-500 cursor-pointer"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Limite Superior (Ativar AC / Bateria) */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    Ligar Saída AC (ATS &rarr; Solar)
                  </span>
                  <span className="text-base font-bold font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/30">
                    {turnOnThreshold}%
                  </span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={100}
                  value={turnOnThreshold}
                  onChange={(e) => handleUpperThresholdChange(Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
                <span className="text-[11px] text-slate-400 block leading-relaxed">
                  Quando a bateria atingir {turnOnThreshold}%, o inversor liga e as cargas comutam para a energia solar/bateria.
                </span>
              </div>

              {/* Limite Inferior (Desligar AC / Rede) */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Power className="w-4 h-4 text-rose-400" />
                    Desligar Saída AC (ATS &rarr; Rede)
                  </span>
                  <span className="text-base font-bold font-mono text-rose-400 bg-rose-500/10 px-2.5 py-0.5 rounded border border-rose-500/30">
                    {turnOffThreshold}%
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={99}
                  value={turnOffThreshold}
                  onChange={(e) => handleLowerThresholdChange(Number(e.target.value))}
                  className="w-full accent-rose-500 cursor-pointer"
                />
                <span className="text-[11px] text-slate-400 block leading-relaxed">
                  Quando a bateria descer para {turnOffThreshold}%, o inversor desliga e as cargas retornam para a concessionária.
                </span>
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* 2. Auto-Storm (Previsão de Tempestades & Modo No-Break) */}
          {/* ============================================================ */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
                  <CloudLightning className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    2. Modo No-Break Preventivo &amp; Defesa Meteorológica (Auto-Storm)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Blindagem proativa da bateria antes de chuvas fortes, tempestades severas e blecautes
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer self-start sm:self-auto">
                <span className="text-xs font-semibold text-slate-300">
                  {isAutoStormActive ? "Auto-Storm Ativo" : "Auto-Storm Desativado"}
                </span>
                <input
                  type="checkbox"
                  checked={isAutoStormActive}
                  onChange={(e) => setIsAutoStormActive(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-700 bg-slate-950 text-sky-500 accent-sky-500 cursor-pointer"
                />
              </label>
            </div>

            {isStormAlertActive && (
              <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2">
                <CloudRain className="w-4 h-4 shrink-0 text-amber-400" />
                <span>
                  <strong>Alerta de Tempestade Ativo:</strong> {lastStormAlertDescription || "Previsão de tempestade iminente. Reserva de segurança acionada."}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300">Reserva de SOC em Tempestade</span>
                  <span className="font-mono font-bold text-sky-400">{autoStormReserveThreshold}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={autoStormReserveThreshold}
                  onChange={(e) => setAutoStormReserveThreshold(Number(e.target.value))}
                  className="w-full accent-sky-500 cursor-pointer"
                />
                <span className="text-[11px] text-slate-500 block">
                  Corta comutação e mantém carga mínima de {autoStormReserveThreshold}% para garantir energia em caso de queda de postes.
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300">Gatilho de Chuva Prevista</span>
                  <span className="font-mono font-bold text-sky-400">{autoStormRainThresholdMm} mm</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={autoStormRainThresholdMm}
                  onChange={(e) => setAutoStormRainThresholdMm(Number(e.target.value))}
                  className="w-full accent-sky-500 cursor-pointer"
                />
                <span className="text-[11px] text-slate-500 block">
                  Dispara modo de defesa quando a previsão de precipitação ultrapassar {autoStormRainThresholdMm}mm nas próximas 24h.
                </span>
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* 3. Solar Smart Charging (Modulação de Recarga AC) */}
          {/* ============================================================ */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <SunMedium className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    3. Solar Smart Charging &amp; Modulação de Recarga AC
                  </h2>
                  <p className="text-xs text-slate-400">
                    Ajuste dinâmico da velocidade de recarga AC na tomada com bloqueio de ponta e pré-recarga inteligente
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer self-start sm:self-auto">
                <span className="text-xs font-semibold text-slate-300">
                  {isSmartChargingActive ? "Smart Charging Ativo" : "Smart Charging Desativado"}
                </span>
                <input
                  type="checkbox"
                  checked={isSmartChargingActive}
                  onChange={(e) => setIsSmartChargingActive(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-700 bg-slate-950 text-amber-500 accent-amber-500 cursor-pointer"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300">Potência Mínima de Recarga</span>
                  <span className="font-mono font-bold text-amber-400">{minAcChargingWatts} W</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={600}
                  step={50}
                  value={minAcChargingWatts}
                  onChange={(e) => setMinAcChargingWatts(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
                <span className="text-[11px] text-slate-500 block">
                  Velocidade suave de recarga durante a madrugada ou períodos com geração solar compartilhada.
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300">Potência Máxima de Recarga</span>
                  <span className="font-mono font-bold text-amber-400">{maxAcChargingWatts} W</span>
                </div>
                <input
                  type="range"
                  min={600}
                  max={2400}
                  step={100}
                  value={maxAcChargingWatts}
                  onChange={(e) => setMaxAcChargingWatts(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
                <span className="text-[11px] text-slate-500 block">
                  Teto de recarga rápida permitido pela instalação elétrica residencial.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chargeOnlyOffPeak}
                  onChange={(e) => setChargeOnlyOffPeak(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-500 bg-slate-900 border-slate-700"
                />
                <div>
                  <span className="font-semibold text-slate-200 block">Carregar Apenas Fora de Ponta</span>
                  <span className="text-[11px] text-slate-500">Bloqueia recarga na tomada quando a tarifa de energia for cara</span>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cloudyPrechargeActive}
                  onChange={(e) => setCloudyPrechargeActive(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-500 bg-slate-900 border-slate-700"
                />
                <div>
                  <span className="font-semibold text-slate-200 block">Pré-Recarga em Dias Nublados</span>
                  <span className="text-[11px] text-slate-500">Recarrega suavemente na madrugada se a previsão solar do dia for fraca</span>
                </div>
              </label>
            </div>
          </div>

          {/* ============================================================ */}
          {/* 4. Arbitragem de Tarifa Branca (Time-of-Use ANEEL) */}
          {/* ============================================================ */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <DollarSign className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    4. Arbitragem de Tarifa Branca (Time-of-Use ANEEL)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Maximização da economia financeira alimentando as cargas via bateria durante os horários mais caros da rede
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer self-start sm:self-auto">
                <span className="text-xs font-semibold text-slate-300">
                  {isTimeOfUseActive ? "Tarifa Branca Ativa" : "Desativada"}
                </span>
                <input
                  type="checkbox"
                  checked={isTimeOfUseActive}
                  onChange={(e) => setIsTimeOfUseActive(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-700 bg-slate-950 text-emerald-500 accent-emerald-500 cursor-pointer"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-slate-400 block">Horário de Ponta (Início / Fim)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={peakStartTime}
                    onChange={(e) => setPeakStartTime(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 font-mono"
                  />
                  <span className="text-slate-500">até</span>
                  <input
                    type="time"
                    value={peakEndTime}
                    onChange={(e) => setPeakEndTime(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-slate-400 block">Reserva de Segurança na Ponta</span>
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono text-emerald-400 text-sm">{peakDischargeReserveLimit}%</span>
                  <input
                    type="range"
                    min={10}
                    max={50}
                    value={peakDischargeReserveLimit}
                    onChange={(e) => setPeakDischargeReserveLimit(Number(e.target.value))}
                    className="accent-emerald-500 cursor-pointer w-24"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-300 block">Bloquear Carga AC no Pico</span>
                  <span className="text-[11px] text-slate-500">Evita consumo caro da tomada</span>
                </div>
                <input
                  type="checkbox"
                  checked={blockAcChargingDuringPeak}
                  onChange={(e) => setBlockAcChargingDuringPeak(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700"
                />
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* 5. Operação Solar Diurna & Histerese Adaptativa */}
          {/* ============================================================ */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <Sun className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    5. Operação Solar Diurna &amp; Histerese Adaptativa
                  </h2>
                  <p className="text-xs text-slate-400">
                    Sincronização com a janela de insolação natural e ajuste dinâmico de limiares por radiação
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 self-start sm:self-auto text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-slate-300 font-medium">Standby Noturno</span>
                  <input
                    type="checkbox"
                    checked={isDaylightOnlyActive}
                    onChange={(e) => setIsDaylightOnlyActive(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500 bg-slate-950 border-slate-700"
                  />
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-slate-300 font-medium">Histerese Adaptativa</span>
                  <input
                    type="checkbox"
                    checked={isAdaptiveHysteresisActive}
                    onChange={(e) => setIsAdaptiveHysteresisActive(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500 bg-slate-950 border-slate-700"
                  />
                </label>
              </div>
            </div>

            {/* Janela Solar do Dia */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-4 text-slate-300">
                <div className="flex items-center gap-1.5">
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span>Nascer do Sol: <strong className="text-slate-100">{formatSolarTime(solarTimes?.sunrise)}</strong></span>
                </div>
                <span className="text-slate-600">•</span>
                <div className="flex items-center gap-1.5">
                  <Moon className="w-4 h-4 text-indigo-400" />
                  <span>Pôr do Sol: <strong className="text-slate-100">{formatSolarTime(solarTimes?.sunset)}</strong></span>
                </div>
              </div>

              <div>
                {solarTimes && !solarTimes.isDaylight ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700">
                    Modo Noturno (Standby Ativo)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
                    Período Solar Ativo
                  </span>
                )}
              </div>
            </div>

            {/* Configuração dos Limiares Adaptativos */}
            {isAdaptiveHysteresisActive && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300">Corte em Dia Ensolarado</span>
                    <span className="font-mono font-bold text-amber-400">{minAdaptiveThreshold}%</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={50}
                    value={minAdaptiveThreshold}
                    onChange={(e) => setMinAdaptiveThreshold(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                  <span className="text-[11px] text-slate-500 block">
                    Permite drenar a bateria até {minAdaptiveThreshold}% sabendo que o sol recarregará rapidamente.
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300">Corte em Dia Nublado/Chuvoso</span>
                    <span className="font-mono font-bold text-amber-400">{maxAdaptiveThreshold}%</span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={80}
                    value={maxAdaptiveThreshold}
                    onChange={(e) => setMaxAdaptiveThreshold(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                  <span className="text-[11px] text-slate-500 block">
                    Preserva {maxAdaptiveThreshold}% de bateria de reserva para compensar baixa geração solar.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Botão de Envio Principal */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-3 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-lg shadow-emerald-950"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {isSaving ? "Salvando Automações..." : "Salvar Regras de Automação"}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
