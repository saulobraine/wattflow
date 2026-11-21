import React, { useEffect, useState, FormEvent } from "react";
import { Layout } from "../components/Layout";
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
  AlertTriangle,
  Clock,
  DollarSign,
  Calendar,
  Ban,
  Scale,
  Thermometer,
  Flame,
  BatteryCharging,
  Sun,
} from "lucide-react";

export default function AutomationsPage() {
  // Limites Padrão da ATS (Histerese)
  const [turnOnThreshold, setTurnOnThreshold] = useState(90);
  const [turnOffThreshold, setTurnOffThreshold] = useState(30);
  const [isAutomationActive, setIsAutomationActive] = useState(true);

  // Estados de Otimização Climática de Níveis de Energia (Previsão Solar / Histerese Adaptativa)
  const [isAdaptiveHysteresisActive, setIsAdaptiveHysteresisActive] = useState(false);
  const [minAdaptiveThreshold, setMinAdaptiveThreshold] = useState(20);
  const [maxAdaptiveThreshold, setMaxAdaptiveThreshold] = useState(50);
  const [solarProjection, setSolarProjection] = useState<{
    estimatedDailyGenerationKwh: number | null;
    peakSunHours: number | null;
    irradianceKwhM2: number | null;
    irradianceMj?: number | null;
    expectationLevel?: string | null;
  } | null>(null);

  // Estados do Modo No-Break Preventivo & Defesa Meteorológica (Auto-Storm)
  const [isAutoStormActive, setIsAutoStormActive] = useState(false);
  const [autoStormReserveThreshold, setAutoStormReserveThreshold] = useState(85);
  const [autoStormRainThresholdMm, setAutoStormRainThresholdMm] = useState(20.0);
  const [autoStormPrechargeAc, setAutoStormPrechargeAc] = useState(true);
  const [isStormAlertActive, setIsStormAlertActive] = useState(false);
  const [lastStormAlertCode, setLastStormAlertCode] = useState<number | null>(null);
  const [lastStormAlertDescription, setLastStormAlertDescription] = useState<string | null>(null);
  const [lastStormAlertTriggeredAt, setLastStormAlertTriggeredAt] = useState<string | null>(null);
  const [lastStormAlertEndedAt, setLastStormAlertEndedAt] = useState<string | null>(null);
  const [ecoflowAccessKey, setEcoflowAccessKey] = useState<string>("");
  const [ecoflowSerialNumber, setEcoflowSerialNumber] = useState<string>("");

  // Estados de Tarifação Horária Inteligente (Tarifa Branca / Time-of-Use)
  const [isTimeOfUseActive, setIsTimeOfUseActive] = useState(false);
  const [timeOfUseWeekdaysOnly, setTimeOfUseWeekdaysOnly] = useState(true);
  const [peakStartTime, setPeakStartTime] = useState("17:30");
  const [peakEndTime, setPeakEndTime] = useState("20:30");
  const [intermediateStartTime, setIntermediateStartTime] = useState("16:30");
  const [intermediateEndTime, setIntermediateEndTime] = useState("21:30");
  const [peakDischargeReserveLimit, setPeakDischargeReserveLimit] = useState(20);
  const [blockAcChargingDuringPeak, setBlockAcChargingDuringPeak] = useState(true);
  const [peakTariffPerKwh, setPeakTariffPerKwh] = useState(1.85);
  const [intermediateTariffPerKwh, setIntermediateTariffPerKwh] = useState(1.15);
  const [offPeakTariffPerKwh, setOffPeakTariffPerKwh] = useState(0.65);

  // Estados de Proteção Térmica & Preservação do BMS (LiFePO4)
  const [isThermalProtectionActive, setIsThermalProtectionActive] = useState<boolean>(true);
  const [thermalThrottleTempThreshold, setThermalThrottleTempThreshold] = useState<number>(42);
  const [thermalCutoffTempThreshold, setThermalCutoffTempThreshold] = useState<number>(48);
  const [thermalThrottleSpeedWatts, setThermalThrottleSpeedWatts] = useState<number>(200);
  const [isThermalThrottleActive, setIsThermalThrottleActive] = useState<boolean>(false);
  const [isThermalCutoffActive, setIsThermalCutoffActive] = useState<boolean>(false);
  const [lastThermalActionMessage, setLastThermalActionMessage] = useState<string | null>(null);
  const [lastThermalEventAt, setLastThermalEventAt] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    async function loadAutomations() {
      try {
        const [autoRes, settingsRes, weatherRes] = await Promise.all([
          fetch("/api/automations"),
          fetch("/api/settings"),
          fetch("/api/weather/forecast").catch(() => null),
        ]);

        const autoJson = await autoRes.json();
        if (autoJson.success && autoJson.data) {
          setTurnOnThreshold(autoJson.data.turnOnThreshold ?? 90);
          setTurnOffThreshold(autoJson.data.turnOffThreshold ?? 30);
          setIsAutomationActive(autoJson.data.isAutomationActive ?? true);
        }

        if (weatherRes && weatherRes.ok) {
          const weatherJson = await weatherRes.json();
          if (weatherJson.success && weatherJson.data) {
            setSolarProjection({
              estimatedDailyGenerationKwh: weatherJson.data.estimatedDailyGenerationKwh ?? null,
              peakSunHours: weatherJson.data.peakSunHours ?? null,
              irradianceKwhM2: weatherJson.data.irradianceKwhM2 ?? null,
              irradianceMj: weatherJson.data.solarForecast?.irradianceMj ?? null,
              expectationLevel: weatherJson.data.solarForecast?.expectationLevel ?? null,
            });
          }
        }

        const settingsJson = await settingsRes.json();
        if (settingsJson.success && settingsJson.data) {
          const s = settingsJson.data;
          setEcoflowAccessKey(s.ecoflowAccessKey || "");
          setEcoflowSerialNumber(s.ecoflowSerialNumber || "");
          setIsAutoStormActive(s.isAutoStormActive ?? false);
          setAutoStormReserveThreshold(s.autoStormReserveThreshold ?? 85);
          setAutoStormRainThresholdMm(s.autoStormRainThresholdMm ?? 20.0);
          setAutoStormPrechargeAc(s.autoStormPrechargeAc ?? true);
          setIsStormAlertActive(s.isStormAlertActive ?? false);
          setLastStormAlertCode(s.lastStormAlertCode ?? null);
          setLastStormAlertDescription(s.lastStormAlertDescription ?? null);
          setLastStormAlertTriggeredAt(s.lastStormAlertTriggeredAt ?? null);
          setLastStormAlertEndedAt(s.lastStormAlertEndedAt ?? null);

          // Time-of-Use / Tarifa Branca
          setIsTimeOfUseActive(s.isTimeOfUseActive ?? s.isDynamicTariffActive ?? false);
          setTimeOfUseWeekdaysOnly(s.timeOfUseWeekdaysOnly ?? true);
          setPeakStartTime(s.peakStartTime || "17:30");
          setPeakEndTime(s.peakEndTime || "20:30");
          setIntermediateStartTime(s.intermediateStartTime || "16:30");
          setIntermediateEndTime(s.intermediateEndTime || "21:30");
          setPeakDischargeReserveLimit(s.peakDischargeReserveLimit ?? s.peakReserveThreshold ?? 20);
          setBlockAcChargingDuringPeak(s.blockAcChargingDuringPeak ?? true);
          setPeakTariffPerKwh(s.peakTariffPerKwh ?? 1.85);
          setIntermediateTariffPerKwh(s.intermediateTariffPerKwh ?? 1.15);
          setOffPeakTariffPerKwh(s.offPeakTariffPerKwh ?? 0.65);

          // Proteção Térmica do BMS
          setIsThermalProtectionActive(s.isThermalProtectionActive ?? true);
          setThermalThrottleTempThreshold(s.thermalThrottleTempThreshold ?? 42);
          setThermalCutoffTempThreshold(s.thermalCutoffTempThreshold ?? 48);
          setThermalThrottleSpeedWatts(s.thermalThrottleSpeedWatts ?? 200);
          setIsThermalThrottleActive(s.isThermalThrottleActive ?? false);
          setIsThermalCutoffActive(s.isThermalCutoffActive ?? false);
          setLastThermalActionMessage(s.lastThermalActionMessage ?? null);
          setLastThermalEventAt(s.lastThermalEventAt ?? null);

          // Otimização Climática de Níveis de Energia (Previsão Solar)
          setIsAdaptiveHysteresisActive(s.isAdaptiveHysteresisActive ?? false);
          setMinAdaptiveThreshold(s.minAdaptiveThreshold ?? 20);
          setMaxAdaptiveThreshold(s.maxAdaptiveThreshold ?? 50);
        }
      } catch (err) {
        console.error("Erro ao carregar automações:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadAutomations();
  }, []);

  const handleUpperThresholdChange = (newValue: number) => {
    const clampedUpper = Math.max(2, Math.min(100, newValue));
    if (clampedUpper <= turnOffThreshold) {
      setTurnOffThreshold(clampedUpper - 1);
    }
    setTurnOnThreshold(clampedUpper);
  };

  const handleLowerThresholdChange = (newValue: number) => {
    const clampedLower = Math.max(1, Math.min(99, newValue));
    if (clampedLower >= turnOnThreshold) {
      setTurnOnThreshold(clampedLower + 1);
    }
    setTurnOffThreshold(clampedLower);
  };

  const handleMinAdaptiveChange = (newValue: number) => {
    const clamped = Math.max(10, Math.min(50, newValue));
    if (clamped >= maxAdaptiveThreshold) {
      setMaxAdaptiveThreshold(clamped + 5);
    }
    setMinAdaptiveThreshold(clamped);
  };

  const handleMaxAdaptiveChange = (newValue: number) => {
    const clamped = Math.max(20, Math.min(70, newValue));
    if (clamped <= minAdaptiveThreshold) {
      setMinAdaptiveThreshold(clamped - 5);
    }
    setMaxAdaptiveThreshold(clamped);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    // Validação ATS
    if (turnOffThreshold >= turnOnThreshold) {
      setFeedback({
        type: "error",
        message: "O limite mínimo de bateria deve ser pelo menos 1% menor que o limite máximo.",
      });
      setIsSaving(false);
      return;
    }

    // Validação Otimização Climática
    if (isAdaptiveHysteresisActive && minAdaptiveThreshold >= maxAdaptiveThreshold) {
      setFeedback({
        type: "error",
        message: "O limite adaptativo em dia ensolarado deve ser menor que o limite em dia nublado.",
      });
      setIsSaving(false);
      return;
    }

    // Validação Auto-Storm
    if (autoStormReserveThreshold < 50 || autoStormReserveThreshold > 100) {
      setFeedback({
        type: "error",
        message: "O SOC de reserva emergencial do Auto-Storm deve estar entre 50% e 100%.",
      });
      setIsSaving(false);
      return;
    }

    if (autoStormRainThresholdMm < 5 || autoStormRainThresholdMm > 150) {
      setFeedback({
        type: "error",
        message: "O limiar de chuva do Auto-Storm deve estar entre 5mm e 150mm.",
      });
      setIsSaving(false);
      return;
    }

    // Validação Tarifa Branca / Time-of-Use
    if (peakDischargeReserveLimit < 10 || peakDischargeReserveLimit > 50) {
      setFeedback({
        type: "error",
        message: "A reserva de segurança na ponta deve estar entre 10% e 50%.",
      });
      setIsSaving(false);
      return;
    }

    if (peakTariffPerKwh <= 0 || intermediateTariffPerKwh <= 0 || offPeakTariffPerKwh <= 0) {
      setFeedback({
        type: "error",
        message: "Os valores das tarifas em R$/kWh devem ser maiores que zero.",
      });
      setIsSaving(false);
      return;
    }

    // Validação Proteção Térmica do BMS
    if (thermalThrottleTempThreshold >= thermalCutoffTempThreshold) {
      setFeedback({
        type: "error",
        message: "O limiar de início do Throttling deve ser menor que o limiar de Corte de Emergência.",
      });
      setIsSaving(false);
      return;
    }

    if (thermalThrottleTempThreshold < 30 || thermalThrottleTempThreshold > 50) {
      setFeedback({
        type: "error",
        message: "O limiar de throttling térmico deve estar entre 30°C e 50°C.",
      });
      setIsSaving(false);
      return;
    }

    if (thermalCutoffTempThreshold < 40 || thermalCutoffTempThreshold > 60) {
      setFeedback({
        type: "error",
        message: "O limiar de corte de emergência deve estar entre 40°C e 60°C.",
      });
      setIsSaving(false);
      return;
    }

    if (thermalThrottleSpeedWatts < 100 || thermalThrottleSpeedWatts > 1000) {
      setFeedback({
        type: "error",
        message: "A potência de recarga em throttling deve estar entre 100W e 1.000W.",
      });
      setIsSaving(false);
      return;
    }

    try {
      // 1. Executa primeiro /api/automations de forma sequencial segura
      const autoRes = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turnOnThreshold,
          turnOffThreshold,
          isAutomationActive,
        }),
      });

      const autoJson = await autoRes.json();
      if (!autoRes.ok || !autoJson.success) {
        setFeedback({
          type: "error",
          message: autoJson.message || "Erro ao salvar regras de automação.",
        });
        setIsSaving(false);
        return;
      }

      // 2. Em seguida, executa /api/settings evitando split-brain / corridas no banco
      const settingsRes = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ecoflowAccessKey: ecoflowAccessKey || undefined,
          ecoflowSerialNumber: ecoflowSerialNumber || undefined,
          isAutoStormActive,
          autoStormReserveThreshold,
          autoStormRainThresholdMm,
          autoStormPrechargeAc,
          // Otimização Climática (Previsão Solar)
          isAdaptiveHysteresisActive,
          minAdaptiveThreshold,
          maxAdaptiveThreshold,
          // Time-of-Use
          isTimeOfUseActive,
          isDynamicTariffActive: isTimeOfUseActive,
          timeOfUseWeekdaysOnly,
          peakStartTime,
          peakEndTime,
          intermediateStartTime: intermediateStartTime || null,
          intermediateEndTime: intermediateEndTime || null,
          peakDischargeReserveLimit,
          peakReserveThreshold: peakDischargeReserveLimit,
          blockAcChargingDuringPeak,
          peakTariffPerKwh,
          intermediateTariffPerKwh,
          offPeakTariffPerKwh,
          // Proteção Térmica do BMS
          isThermalProtectionActive,
          thermalThrottleTempThreshold,
          thermalCutoffTempThreshold,
          thermalRecoveryTempThreshold: Math.max(30, thermalCutoffTempThreshold - 4),
          thermalThrottleSpeedWatts,
        }),
      });

      const settingsJson = await settingsRes.json();
      if (!settingsRes.ok || !settingsJson.success) {
        setFeedback({
          type: "error",
          message: settingsJson.message || "Erro ao salvar configurações complementares.",
        });
        setIsSaving(false);
        return;
      }

      setFeedback({
        type: "success",
        message: "Regras de automação, Auto-Storm, Tarifa Branca e Proteção Térmica salvas com sucesso!",
      });
    } catch {
      setFeedback({ type: "error", message: "Falha na comunicação com o servidor." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Layout title="Gatilhos de Automação (EcoFlow + ATS)">
      <div className="space-y-6">
        {feedback && (
          <div
            role="alert"
            aria-live="polite"
            className={`animate-alert p-4 rounded-xl border flex items-center gap-3 text-sm transition-all duration-200 shadow-md ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 shadow-emerald-950/30"
                : "bg-rose-500/10 border-rose-500/40 text-rose-300 shadow-rose-950/30"
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
          aria-label="Como funciona a comutação automática"
          className="animate-card stagger-1 interactive-card p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3 shadow-lg"
        >
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
            <ArrowLeftRight className="w-5 h-5 animate-float" aria-hidden="true" />
          </div>
          <div className="text-xs text-slate-300 space-y-1">
            <span className="font-semibold text-slate-100 text-sm block">
              Comutação Automática via Chave de Transferência (ATS)
            </span>
            <p className="text-slate-400">
              A chave de transferência automática monitora a presença de tensão na saída AC da EcoFlow. Ao atingir o limite superior, o WattFlow aciona a saída AC e a chave ATS comuta as cargas da sua casa para a bateria/solar. Ao atingir o limite inferior, o WattFlow desliga a saída AC e a chave ATS retorna instantaneamente para a rede elétrica da concessionária.
            </p>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Card 1: Limites de Carga e Corte */}
          <div className="animate-card stagger-2 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Sliders className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">Limites de Carga e Corte</h2>
                  <p className="text-xs text-slate-400">
                    Defina quando ativar a EcoFlow (ATS &rarr; Bateria) e quando retornar para a Concessionária (ATS &rarr; Rede)
                  </p>
                </div>
              </div>

              <label htmlFor="automation-active-checkbox" className="flex items-center gap-3 cursor-pointer group self-start sm:self-auto min-h-[44px]">
                <div className="flex flex-col items-start sm:items-end">
                  <span className="text-xs font-semibold text-slate-200 group-hover:text-emerald-300 transition-colors">
                    Disjuntor Geral da Automação (Loop 24/7)
                  </span>
                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
                    Comanda histerese e horário de ponta
                  </span>
                </div>
                <input
                  id="automation-active-checkbox"
                  type="checkbox"
                  checked={isAutomationActive}
                  onChange={(e) => setIsAutomationActive(e.target.checked)}
                  className="w-5 h-5 accent-emerald-500 rounded cursor-pointer transition-transform active:scale-90"
                />
              </label>
            </div>

            {/* Slider Limite Superior */}
            <div className="space-y-2">
              <div className="flex flex-wrap sm:flex-nowrap justify-between items-start sm:items-center gap-2">
                <label htmlFor="upper-threshold-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  Limite Superior (Bateria Cheia &rarr; Comutar ATS para EcoFlow)
                </label>
                <span className="font-mono text-emerald-400 font-bold text-lg bg-emerald-500/10 px-3 py-1 rounded-lg border border-emerald-500/20 transition-all">
                  {turnOnThreshold}%
                </span>
              </div>
              <p id="upper-threshold-desc" className="text-xs text-slate-400">
                Quando a bateria atingir ou superar este valor (&ge; {turnOnThreshold}%): a saída AC da EcoFlow será <strong>LIGADA</strong>. A chave ATS detecta a tensão e comuta a alimentação das cargas para a energia solar/bateria.
              </p>
              <input
                id="upper-threshold-slider"
                type="range"
                min="2"
                max="100"
                value={turnOnThreshold}
                aria-label="Limite Superior de Carga da Bateria"
                aria-valuenow={turnOnThreshold}
                aria-valuemin={2}
                aria-valuemax={100}
                aria-describedby="upper-threshold-desc"
                onChange={(e) => handleUpperThresholdChange(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-2 py-4 min-h-[44px] bg-slate-800 rounded-lg transition-all"
              />
            </div>

            {/* Slider Limite Inferior */}
            <div className="space-y-2">
              <div className="flex flex-wrap sm:flex-nowrap justify-between items-start sm:items-center gap-2">
                <label htmlFor="lower-threshold-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Power className="w-4 h-4 text-rose-400" aria-hidden="true" />
                  Limite Inferior (Bateria Baixa &rarr; Comutar ATS para Concessionária)
                </label>
                <span className="font-mono text-rose-400 font-bold text-lg bg-rose-500/10 px-3 py-1 rounded-lg border border-rose-500/20 transition-all">
                  {turnOffThreshold}%
                </span>
              </div>
              <p id="lower-threshold-desc" className="text-xs text-slate-400">
                Quando a bateria descer até este valor ou menos (&le; {turnOffThreshold}%): a saída AC da EcoFlow será <strong>DESLIGADA</strong> para preservar a bateria. A chave ATS transfere instantaneamente a alimentação para a concessionária.
              </p>
              <input
                id="lower-threshold-slider"
                type="range"
                min="1"
                max="99"
                value={turnOffThreshold}
                aria-label="Limite Inferior de Corte da Bateria"
                aria-valuenow={turnOffThreshold}
                aria-valuemin={1}
                aria-valuemax={99}
                aria-describedby="lower-threshold-desc"
                onChange={(e) => handleLowerThresholdChange(Number(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer h-2 py-4 min-h-[44px] bg-slate-800 rounded-lg transition-all"
              />
            </div>

            {/* Visualização de Faixas */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Comportamento da Chave de Transferência Automática:
              </span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3 text-xs text-slate-300">
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900/40 space-y-1.5 transition-all hover:border-rose-700/60 hover:bg-rose-950/60">
                  <div className="font-semibold text-rose-400">&le; {turnOffThreshold}% (Bateria Baixa)</div>
                  <div className="text-slate-200">• Saída AC EcoFlow: <span className="text-rose-400 font-bold">DESLIGADA</span></div>
                  <div className="text-slate-200">• Chave ATS: <span className="text-amber-400 font-bold">POSIÇÃO A (REDE)</span></div>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5 transition-all hover:border-slate-700 hover:bg-slate-850">
                  <div className="font-semibold text-amber-400">{turnOffThreshold}% a {turnOnThreshold}% (Histerese)</div>
                  <div className="text-slate-300">• Faixa intermediária estável</div>
                  <div className="text-slate-400">Mantém a posição atual da chave ATS</div>
                </div>
                <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-900/40 space-y-1.5 transition-all hover:border-emerald-700/60 hover:bg-emerald-950/60">
                  <div className="font-semibold text-emerald-400">&ge; {turnOnThreshold}% (Bateria Carregada)</div>
                  <div className="text-slate-200">• Saída AC EcoFlow: <span className="text-emerald-400 font-bold">LIGADA</span></div>
                  <div className="text-slate-200">• Chave ATS: <span className="text-emerald-400 font-bold">POSIÇÃO B (SOLAR/BAT)</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Card: Otimização Climática de Níveis de Energia (Previsão Solar) */}
          <div className="animate-card stagger-2 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Sun className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-100">
                      Otimização Climática de Níveis de Energia (Previsão Solar)
                    </h2>
                    {isAdaptiveHysteresisActive ? (
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        Otimização Solar Ativa
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold bg-slate-800 text-slate-300 border border-slate-700">
                        Níveis 100% Estáticos
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Ajuste dinâmico inteligente da profundidade de descarga com base na irradiação solar esperada
                  </p>
                </div>
              </div>

              <label htmlFor="adaptive-hysteresis-checkbox" className="flex items-center gap-3 cursor-pointer group self-start sm:self-auto min-h-[44px]">
                <div className="flex flex-col items-start sm:items-end">
                  <span className="text-xs font-semibold text-slate-200 group-hover:text-amber-300 transition-colors">
                    Ajustar níveis automaticamente pela previsão do tempo
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {isAdaptiveHysteresisActive ? "Adaptação dinâmica ligada" : "Desativado (opera estático)"}
                  </span>
                </div>
                <input
                  id="adaptive-hysteresis-checkbox"
                  type="checkbox"
                  checked={isAdaptiveHysteresisActive}
                  onChange={(e) => setIsAdaptiveHysteresisActive(e.target.checked)}
                  className="w-5 h-5 accent-amber-500 rounded cursor-pointer transition-transform active:scale-90"
                />
              </label>
            </div>

            {/* Explicação contextual */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-2">
              <p>
                {isAdaptiveHysteresisActive ? (
                  <span>
                    ☀️ <strong>Modo Otimizado Ativo:</strong> O sistema consulta a previsão de irradiação solar diária. Em dias ensolarados, permite descarregar mais a bateria até o limite mínimo ({minAdaptiveThreshold}%), aproveitando a recarga abundante do dia seguinte. Em dias chuvosos ou nublados, preserva mais reserva elevando o corte até ({maxAdaptiveThreshold}%).
                  </span>
                ) : (
                  <span>
                    🛡️ <strong>Modo 100% Estático Ativo:</strong> A meteorologia está desativada para a histerese. Os limites de comutação da ATS são fixos e imutáveis exatamente em <strong>{turnOffThreshold}% (corte)</strong> e <strong>{turnOnThreshold}% (religamento)</strong>, sem qualquer variação climática.
                  </span>
                )}
              </p>
            </div>

            {/* Projeção de Geração Solar do Dia */}
            {solarProjection && solarProjection.estimatedDailyGenerationKwh !== null && (
              <div className="p-3.5 sm:p-4 rounded-xl bg-gradient-to-r from-amber-950/30 via-slate-950 to-slate-950 border border-amber-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                    <Sun className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400 font-mono uppercase tracking-wider">
                      Previsão de Geração Solar do Dia
                    </div>
                    <div className="text-sm font-bold text-slate-100 flex items-baseline gap-2">
                      <span>Geração Estimada Hoje:</span>
                      <span className="text-amber-400 font-mono text-base sm:text-lg font-extrabold">
                        ~{solarProjection.estimatedDailyGenerationKwh.toFixed(1)} kWh
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {solarProjection.peakSunHours !== null && (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm"
                      title="Horas de Sol Pleno (HSP = Irradiação Solar / 3.6 MJ/m²)"
                    >
                      <Sun className="w-3.5 h-3.5 text-amber-400" />
                      {solarProjection.peakSunHours.toFixed(1)} HSP Previstas
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Sliders condicionais */}
            {isAdaptiveHysteresisActive && (
              <div className="space-y-6 pt-2">
                {/* Slider Limite Minimo Adaptativo (Dias de Sol) */}
                <div className="space-y-2">
                  <div className="flex flex-wrap sm:flex-nowrap justify-between items-start sm:items-center gap-2">
                    <label htmlFor="min-adaptive-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
                      Corte Mínimo em Dias Ensolarados (Máxima Economia Solar)
                    </label>
                    <span className="font-mono text-amber-400 font-bold text-lg bg-amber-500/10 px-3 py-1 rounded-lg border border-amber-500/20">
                      {minAdaptiveThreshold}%
                    </span>
                  </div>
                  <p id="min-adaptive-desc" className="text-xs text-slate-400">
                    Em dias de sol pleno com previsão de alta irradiação, a bateria pode descer até este patamar (&ge; {minAdaptiveThreshold}%), pois haverá sol para recarregá-la rapidamente.
                  </p>
                  <input
                    id="min-adaptive-slider"
                    type="range"
                    min="10"
                    max="50"
                    value={minAdaptiveThreshold}
                    aria-describedby="min-adaptive-desc"
                    onChange={(e) => handleMinAdaptiveChange(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer h-2 py-4 min-h-[44px] bg-slate-800 rounded-lg transition-all"
                  />
                </div>

                {/* Slider Limite Maximo Adaptativo (Dias Nublados) */}
                <div className="space-y-2">
                  <div className="flex flex-wrap sm:flex-nowrap justify-between items-start sm:items-center gap-2">
                    <label htmlFor="max-adaptive-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <CloudRain className="w-4 h-4 text-sky-400" aria-hidden="true" />
                      Corte Máximo em Dias Nublados / Chuva (Proteção de Reserva)
                    </label>
                    <span className="font-mono text-sky-400 font-bold text-lg bg-sky-500/10 px-3 py-1 rounded-lg border border-sky-500/20">
                      {maxAdaptiveThreshold}%
                    </span>
                  </div>
                  <p id="max-adaptive-desc" className="text-xs text-slate-400">
                    Em dias chuvosos ou de tempo fechado, a saída AC é desligada mais cedo (&le; {maxAdaptiveThreshold}%) para evitar descarregar a bateria quando a geração solar será fraca.
                  </p>
                  <input
                    id="max-adaptive-slider"
                    type="range"
                    min="20"
                    max="70"
                    value={maxAdaptiveThreshold}
                    aria-describedby="max-adaptive-desc"
                    onChange={(e) => handleMaxAdaptiveChange(Number(e.target.value))}
                    className="w-full accent-sky-500 cursor-pointer h-2 py-4 min-h-[44px] bg-slate-800 rounded-lg transition-all"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Card 2: Modo No-Break Preventivo & Defesa Meteorológica (Auto-Storm) */}
          <div className="animate-card stagger-3 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <CloudLightning className="w-5 h-5 animate-pulse" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-100">
                      Modo No-Break Preventivo &amp; Defesa Meteorológica (Auto-Storm)
                    </h2>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      Preditivo
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Protege sua residência contra apagões retendo a chave ATS na concessionária e elevando a reserva antes de tempestades severas.
                  </p>
                </div>
              </div>

              <label htmlFor="auto-storm-active-checkbox" className="flex items-center gap-2 cursor-pointer group self-start sm:self-auto min-h-[44px]">
                <span className="text-xs font-semibold text-slate-300 group-hover:text-amber-300 transition-colors">
                  Auto-Storm Ativo
                </span>
                <input
                  id="auto-storm-active-checkbox"
                  type="checkbox"
                  checked={isAutoStormActive}
                  onChange={(e) => setIsAutoStormActive(e.target.checked)}
                  className="w-5 h-5 accent-amber-500 rounded cursor-pointer transition-transform active:scale-90"
                />
              </label>
            </div>

            {/* Painel de Status do Alerta em Tempo Real */}
            <div className={`p-4 rounded-xl border transition-all ${
              isStormAlertActive
                ? "bg-rose-950/60 border-rose-500/80 text-rose-200 shadow-lg shadow-rose-950/40 animate-pulse"
                : "bg-slate-950/80 border-slate-800/80 text-slate-300"
            }`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg shrink-0 ${
                  isStormAlertActive ? "bg-rose-500/20 text-rose-400" : "bg-emerald-500/10 text-emerald-400"
                }`}>
                  {isStormAlertActive ? (
                    <AlertTriangle className="w-5 h-5" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="w-5 h-5" aria-hidden="true" />
                  )}
                </div>
                <div className="space-y-1 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-sm">
                      {isStormAlertActive
                        ? "⚠️ ALERTA DE TEMPESTADE ATIVO — MODO NO-BREAK EM OPERAÇÃO"
                        : "Monitoramento Meteorológico Preditivo 24/7"}
                    </span>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                      isStormAlertActive
                        ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                        : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                    }`}>
                      {isStormAlertActive ? "DEFESA ATIVA" : "STANDBY NORMAL"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {isStormAlertActive
                      ? `${lastStormAlertDescription || "Tempestade severa detectada"}. Disparado em ${
                          lastStormAlertTriggeredAt
                            ? new Date(lastStormAlertTriggeredAt).toLocaleString("pt-BR")
                            : "agora"
                        }. O ATS está comutado na rede e a bateria mantida em reserva emergencial.`
                      : "O sistema consulta a previsão de tempestades (códigos WMO 80-82, 95-99 e volume de chuva) via Open-Meteo. Quando uma tempestade for detectada, a proteção será acionada automaticamente."}
                  </p>
                </div>
              </div>
            </div>

            {/* Slider 1: SOC de Reserva Emergencial */}
            <div className="space-y-2">
              <div className="flex flex-wrap sm:flex-nowrap justify-between items-start sm:items-center gap-2">
                <label htmlFor="auto-storm-reserve-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  SOC de Reserva Emergencial durante Tempestade
                </label>
                <span className="font-mono text-amber-400 font-bold text-lg bg-amber-500/10 px-3 py-1 rounded-lg border border-amber-500/20 transition-all">
                  {autoStormReserveThreshold}%
                </span>
              </div>
              <p id="auto-storm-reserve-desc" className="text-xs text-slate-400">
                Durante o alerta de tempestade, o limite inferior de corte é elevado temporariamente para este valor (50% a 100%, padrão 85%). A bateria não será descarregada abaixo desse patamar enquanto houver risco.
              </p>
              <input
                id="auto-storm-reserve-slider"
                type="range"
                min="50"
                max="100"
                value={autoStormReserveThreshold}
                aria-label="SOC de Reserva Emergencial"
                aria-valuenow={autoStormReserveThreshold}
                aria-valuemin={50}
                aria-valuemax={100}
                aria-describedby="auto-storm-reserve-desc"
                onChange={(e) => setAutoStormReserveThreshold(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer h-2 py-4 min-h-[44px] bg-slate-800 rounded-lg transition-all"
              />
            </div>

            {/* Slider 2: Limiar de Chuva Severa em mm */}
            <div className="space-y-2">
              <div className="flex flex-wrap sm:flex-nowrap justify-between items-start sm:items-center gap-2">
                <label htmlFor="auto-storm-rain-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <CloudRain className="w-4 h-4 text-sky-400" aria-hidden="true" />
                  Limiar de Precipitação Diária para Gatilho (Chuva Forte)
                </label>
                <span className="font-mono text-sky-400 font-bold text-lg bg-sky-500/10 px-3 py-1 rounded-lg border border-sky-500/20 transition-all">
                  {autoStormRainThresholdMm} mm
                </span>
              </div>
              <p id="auto-storm-rain-desc" className="text-xs text-slate-400">
                Se a precipitação acumulada prevista para as próximas 24 horas for igual ou superior a este valor (5mm a 150mm, padrão 20mm), o Modo No-Break Preventivo será acionado mesmo sem código explícito de trovoada.
              </p>
              <input
                id="auto-storm-rain-slider"
                type="range"
                min="5"
                max="150"
                step="5"
                value={autoStormRainThresholdMm}
                aria-label="Limiar de Chuva em Milímetros"
                aria-valuenow={autoStormRainThresholdMm}
                aria-valuemin={5}
                aria-valuemax={150}
                aria-describedby="auto-storm-rain-desc"
                onChange={(e) => setAutoStormRainThresholdMm(Number(e.target.value))}
                className="w-full accent-sky-500 cursor-pointer h-2 py-4 min-h-[44px] bg-slate-800 rounded-lg transition-all"
              />
            </div>

            {/* Switch 3: Pré-Recarga AC Rápida */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-start sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <label htmlFor="auto-storm-precharge-checkbox" className="text-sm font-semibold text-slate-200 flex items-center gap-2 cursor-pointer">
                  <Zap className="w-4 h-4 text-amber-400" />
                  Pré-Recarga AC Rápida da Bateria
                </label>
                <p className="text-xs text-slate-400">
                  Se a bateria estiver abaixo do limiar de reserva ({autoStormReserveThreshold}%) no momento do alerta, aciona a entrada AC da EcoFlow para completar a carga antes do início da tempestade.
                </p>
              </div>
              <input
                id="auto-storm-precharge-checkbox"
                type="checkbox"
                checked={autoStormPrechargeAc}
                onChange={(e) => setAutoStormPrechargeAc(e.target.checked)}
                className="w-5 h-5 accent-amber-500 rounded cursor-pointer transition-transform active:scale-90 shrink-0 mt-1 sm:mt-0 min-h-[44px] min-w-[44px]"
              />
            </div>
          </div>

          {/* Card 3: Tarifação Horária & Arbitragem na Ponta (Tarifa Branca ANEEL) */}
          <div className="animate-card stagger-4 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Clock className="w-5 h-5 animate-float" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-100">
                      Tarifação Horária &amp; Arbitragem na Ponta (Tarifa Branca)
                    </h2>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      Norma ANEEL
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Comutação forçada para bateria durante o pico mais caro e bloqueio estrito de recarga AC para maximizar a economia.
                  </p>
                </div>
              </div>

              <label htmlFor="time-of-use-active-checkbox" className="flex items-center gap-2 cursor-pointer group self-start sm:self-auto min-h-[44px]">
                <span className="text-xs font-semibold text-slate-300 group-hover:text-emerald-300 transition-colors">
                  Tarifa Branca Ativa
                </span>
                <input
                  id="time-of-use-active-checkbox"
                  type="checkbox"
                  checked={isTimeOfUseActive}
                  onChange={(e) => setIsTimeOfUseActive(e.target.checked)}
                  className="w-5 h-5 accent-emerald-500 rounded cursor-pointer transition-transform active:scale-90"
                />
              </label>
            </div>

            {/* Switch ANEEL: Dias Úteis */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-start sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <label htmlFor="tou-weekdays-checkbox" className="text-sm font-semibold text-slate-200 flex items-center gap-2 cursor-pointer">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  Aplicar Horário de Ponta Apenas em Dias Úteis (Segunda a Sexta)
                </label>
                <p className="text-xs text-slate-400">
                  Conforme a regulamentação oficial da ANEEL, fins de semana (Sábado e Domingo) operam em regime 100% Fora de Ponta com a menor tarifa.
                </p>
              </div>
              <input
                id="tou-weekdays-checkbox"
                type="checkbox"
                checked={timeOfUseWeekdaysOnly}
                onChange={(e) => setTimeOfUseWeekdaysOnly(e.target.checked)}
                className="w-5 h-5 accent-emerald-500 rounded cursor-pointer transition-transform active:scale-90 shrink-0 mt-1 sm:mt-0 min-h-[44px] min-w-[44px]"
              />
            </div>

            {/* Horários de Ponta (Início e Fim) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300 uppercase tracking-wider">
                <Zap className="w-3.5 h-3.5 text-rose-400" />
                <span>Janela Crítica: Horário de Ponta (Tarifa Máxima)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="peak-start-time" className="text-xs font-semibold text-slate-300 block">
                    Início do Horário de Ponta
                  </label>
                  <input
                    id="peak-start-time"
                    type="time"
                    value={peakStartTime}
                    onChange={(e) => setPeakStartTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-rose-500 focus:outline-none transition-colors"
                  />
                  <span className="text-[11px] text-slate-500 block">Padrão ANEEL: 17:30</span>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="peak-end-time" className="text-xs font-semibold text-slate-300 block">
                    Término do Horário de Ponta
                  </label>
                  <input
                    id="peak-end-time"
                    type="time"
                    value={peakEndTime}
                    onChange={(e) => setPeakEndTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-rose-500 focus:outline-none transition-colors"
                  />
                  <span className="text-[11px] text-slate-500 block">Padrão ANEEL: 20:30 (3 horas consecutivas)</span>
                </div>
              </div>
            </div>

            {/* Horários Intermediários (Opcionais) */}
            <div className="space-y-3 pt-2 border-t border-slate-800/80">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-wider">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Janelas de Transição: Horário Intermediário</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="intermediate-start-time" className="text-xs font-semibold text-slate-300 block">
                    Início Faixa Pré-Ponta
                  </label>
                  <input
                    id="intermediate-start-time"
                    type="time"
                    value={intermediateStartTime}
                    onChange={(e) => setIntermediateStartTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-amber-500 focus:outline-none transition-colors"
                  />
                  <span className="text-[11px] text-slate-500 block">Tipicamente 1h antes da ponta (16:30)</span>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="intermediate-end-time" className="text-xs font-semibold text-slate-300 block">
                    Término Faixa Pós-Ponta
                  </label>
                  <input
                    id="intermediate-end-time"
                    type="time"
                    value={intermediateEndTime}
                    onChange={(e) => setIntermediateEndTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-amber-500 focus:outline-none transition-colors"
                  />
                  <span className="text-[11px] text-slate-500 block">Tipicamente 1h após a ponta (21:30)</span>
                </div>
              </div>
            </div>

            {/* Slider de Reserva de Segurança na Ponta */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <div className="flex flex-wrap sm:flex-nowrap justify-between items-start sm:items-center gap-2">
                <label htmlFor="peak-reserve-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  Reserva de Segurança de Descarga na Ponta
                </label>
                <span className="font-mono text-emerald-400 font-bold text-lg bg-emerald-500/10 px-3 py-1 rounded-lg border border-emerald-500/20 transition-all">
                  {peakDischargeReserveLimit}%
                </span>
              </div>
              <p id="peak-reserve-desc" className="text-xs text-slate-400">
                Durante o horário de ponta, o inversor EcoFlow assume a casa descarregando agressivamente para blindar contra o kWh caro, até atingir este limite seguro ({peakDischargeReserveLimit}%). Abaixo disso, o ATS comuta de volta para a concessionária preservando a bateria.
              </p>
              <input
                id="peak-reserve-slider"
                type="range"
                min="10"
                max="50"
                value={peakDischargeReserveLimit}
                aria-label="Reserva de Segurança na Ponta"
                aria-valuenow={peakDischargeReserveLimit}
                aria-valuemin={10}
                aria-valuemax={50}
                aria-describedby="peak-reserve-desc"
                onChange={(e) => setPeakDischargeReserveLimit(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-2 py-4 min-h-[44px] bg-slate-800 rounded-lg transition-all"
              />
            </div>

            {/* Switch de Bloqueio de Recarga AC na Ponta */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-start sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <label htmlFor="block-ac-charging-checkbox" className="text-sm font-semibold text-slate-200 flex items-center gap-2 cursor-pointer">
                  <Ban className="w-4 h-4 text-rose-400" />
                  Bloqueio Estrito de Recarga pela Tomada no Pico
                </label>
                <p className="text-xs text-slate-400">
                  Impede categoricamente que a estação EcoFlow carregue usando a energia cara da rede concessionária durante o horário de ponta, mesmo que o carregamento inteligente esteja ativo.
                </p>
              </div>
              <input
                id="block-ac-charging-checkbox"
                type="checkbox"
                checked={blockAcChargingDuringPeak}
                onChange={(e) => setBlockAcChargingDuringPeak(e.target.checked)}
                className="w-5 h-5 accent-rose-500 rounded cursor-pointer transition-transform active:scale-90 shrink-0 mt-1 sm:mt-0 min-h-[44px] min-w-[44px]"
              />
            </div>

            {/* Tarifas em R$/kWh */}
            <div className="space-y-3 pt-2 border-t border-slate-800/80">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300 uppercase tracking-wider">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                <span>Valores das Tarifas por Faixa (R$/kWh da sua Concessionária)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <label htmlFor="peak-tariff-input" className="text-xs font-semibold text-rose-300 block">
                    🔴 Tarifa de Ponta
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs text-slate-400 font-mono">R$</span>
                    <input
                      id="peak-tariff-input"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="50"
                      value={peakTariffPerKwh}
                      onChange={(e) => setPeakTariffPerKwh(Number(e.target.value))}
                      className="w-full pl-9 pr-3 py-2 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-sm focus:border-rose-500 focus:outline-none"
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 block">Média Brasil: R$ 1,85</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <label htmlFor="intermediate-tariff-input" className="text-xs font-semibold text-amber-300 block">
                    🟡 Intermediário
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs text-slate-400 font-mono">R$</span>
                    <input
                      id="intermediate-tariff-input"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="50"
                      value={intermediateTariffPerKwh}
                      onChange={(e) => setIntermediateTariffPerKwh(Number(e.target.value))}
                      className="w-full pl-9 pr-3 py-2 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-sm focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 block">Média Brasil: R$ 1,15</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <label htmlFor="offpeak-tariff-input" className="text-xs font-semibold text-emerald-300 block">
                    🟢 Fora de Ponta
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs text-slate-400 font-mono">R$</span>
                    <input
                      id="offpeak-tariff-input"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="50"
                      value={offPeakTariffPerKwh}
                      onChange={(e) => setOffPeakTariffPerKwh(Number(e.target.value))}
                      className="w-full pl-9 pr-3 py-2 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 block">Média Brasil: R$ 0,65</span>
                </div>
              </div>
            </div>

            {/* Infográfico de Economia da Tarifa Branca */}
            <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800/80 space-y-2 text-xs">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-emerald-400" />
                Multiplicador de Arbitragem Energética:
              </span>
              <p className="text-slate-400 leading-relaxed">
                Cada 1 kWh consumido da bateria durante o horário de ponta economiza{" "}
                <strong className="text-emerald-400 font-mono">
                  R$ {(peakTariffPerKwh - offPeakTariffPerKwh).toFixed(2)}
                </strong>{" "}
                em comparação direta com a rede pública. Em uma residência consumindo 1,5 kW médios nas 3 horas de pico, a economia mensal estimada ultrapassa{" "}
                <strong className="text-emerald-300 font-mono">
                  R$ {((peakTariffPerKwh - offPeakTariffPerKwh) * 1.5 * 3 * 22).toFixed(2)}
                </strong>.
              </p>
            </div>
          </div>

          {/* Card 4: Proteção Térmica & Preservação do BMS (LiFePO4) */}
          <div className="animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 shrink-0 border border-rose-500/20">
                  <Thermometer className="w-6 h-6 animate-pulse" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                    Proteção Térmica &amp; Preservação do BMS (LiFePO4)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Mitigação preditiva de estresse térmico, throttling de recarga e corte preventivo para extensão de vida útil
                  </p>
                </div>
              </div>

              {/* Switch Mestre isThermalProtectionActive */}
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                  isThermalProtectionActive
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                    : "bg-slate-800 text-slate-400 border-slate-700"
                }`}>
                  {isThermalProtectionActive ? "Proteção Ativa" : "Desativada"}
                </span>
                <label htmlFor="thermal-protection-switch" className="relative inline-flex items-center cursor-pointer min-h-[44px] min-w-[44px]">
                  <input
                    id="thermal-protection-switch"
                    type="checkbox"
                    checked={isThermalProtectionActive}
                    onChange={(e) => setIsThermalProtectionActive(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[14px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>
            </div>

            {/* Banner de Estado Térmico Ativo */}
            {isThermalCutoffActive && (
              <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-500/80 text-rose-200 flex items-start gap-3 shadow-md">
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-xs space-y-1">
                  <span className="font-bold text-rose-100 block">🚨 Corte Térmico de Emergência Ativo</span>
                  <p className="text-rose-300 leading-relaxed">
                    {lastThermalActionMessage || "O inversor foi desarmado e a carga transferida para a rede elétrica para evitar degradação térmica das células LiFePO4."}
                  </p>
                </div>
              </div>
            )}

            {isThermalThrottleActive && !isThermalCutoffActive && (
              <div className="p-3.5 rounded-xl bg-orange-950/80 border border-orange-500/80 text-orange-200 flex items-start gap-3 shadow-md">
                <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-xs space-y-1">
                  <span className="font-bold text-orange-100 block">⚠️ Thermal Throttling de Recarga Ativo</span>
                  <p className="text-orange-300 leading-relaxed">
                    {lastThermalActionMessage || `A velocidade de recarga AC está temporariamente limitada a ${thermalThrottleSpeedWatts}W para resfriamento das células.`}
                  </p>
                </div>
              </div>
            )}

            {/* Slider 1: Limiar de Início do Throttling Térmico */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <label htmlFor="throttle-temp-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-400" />
                  Limiar de Início do Throttling Térmico
                </label>
                <span className="text-xs font-mono font-bold text-orange-400 bg-orange-500/10 border border-orange-500/30 px-2.5 py-0.5 rounded-full w-fit">
                  {thermalThrottleTempThreshold}°C
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Ao atingir esta temperatura no BMS, o orquestrador reduz imediatamente a velocidade de recarga AC para desacelerar o acúmulo de calor interno sem interromper a operação.
              </p>
              <input
                id="throttle-temp-slider"
                type="range"
                min="35"
                max="45"
                step="1"
                value={thermalThrottleTempThreshold}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setThermalThrottleTempThreshold(val);
                  if (val >= thermalCutoffTempThreshold) {
                    setThermalCutoffTempThreshold(val + 3);
                  }
                }}
                disabled={!isThermalProtectionActive}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500 disabled:opacity-40 min-h-[44px]"
              />
              <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                <span>35°C (Conservador)</span>
                <span className="text-orange-400 font-bold">42°C (Padrão Recomendado)</span>
                <span>45°C (Agressivo)</span>
              </div>
            </div>

            {/* Slider 2: Limiar de Corte de Emergência */}
            <div className="space-y-3 pt-4 border-t border-slate-800/80">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <label htmlFor="cutoff-temp-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  Limiar de Corte Térmico de Emergência
                </label>
                <span className="text-xs font-mono font-bold text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2.5 py-0.5 rounded-full w-fit">
                  {thermalCutoffTempThreshold}°C
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Se a temperatura das células atingir este patamar crítico, o orquestrador aciona imediatamente o desligamento do inversor ou comuta a ATS para a rede concessionária, protegendo contra degradação severa ou risco de shutdown abrupto.
              </p>
              <input
                id="cutoff-temp-slider"
                type="range"
                min="45"
                max="55"
                step="1"
                value={thermalCutoffTempThreshold}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setThermalCutoffTempThreshold(val);
                  if (val <= thermalThrottleTempThreshold) {
                    setThermalThrottleTempThreshold(val - 3);
                  }
                }}
                disabled={!isThermalProtectionActive}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500 disabled:opacity-40 min-h-[44px]"
              />
              <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                <span>45°C (Alta Proteção)</span>
                <span className="text-rose-400 font-bold">48°C (Padrão LFP)</span>
                <span>55°C (Limite Extremo BMS)</span>
              </div>
            </div>

            {/* Slider 3: Potência em Throttling */}
            <div className="space-y-3 pt-4 border-t border-slate-800/80">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <label htmlFor="throttle-speed-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <BatteryCharging className="w-4 h-4 text-amber-400" />
                  Potência de Recarga Durante o Throttling
                </label>
                <span className="text-xs font-mono font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-full w-fit">
                  {thermalThrottleSpeedWatts} W
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Velocidade controlada em Watts enviada via comando EcoFlow quando a temperatura atinge o limiar de alerta, permitindo dissipação de calor sem interromper o carregamento.
              </p>
              <input
                id="throttle-speed-slider"
                type="range"
                min="100"
                max="500"
                step="50"
                value={thermalThrottleSpeedWatts}
                onChange={(e) => setThermalThrottleSpeedWatts(Number(e.target.value))}
                disabled={!isThermalProtectionActive}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-40 min-h-[44px]"
              />
              <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                <span>100W (Mínimo / Resfriamento Rápido)</span>
                <span className="text-amber-400 font-bold">200W (Equilibrado)</span>
                <span>500W (Moderado)</span>
              </div>
            </div>

            {/* Infográfico das 4 Zonas Térmicas */}
            <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800/80 space-y-2 text-xs">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Matriz de Proteção LiFePO4:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1 text-[11px]">
                <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30 space-y-1">
                  <span className="font-bold text-emerald-300 block">🟢 Ideal (&lt; 38°C)</span>
                  <p className="text-slate-400 text-[10px]">Células frias, recarga e descarga em potência total.</p>
                </div>
                <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-500/30 space-y-1">
                  <span className="font-bold text-amber-300 block">🟡 Alerta (38°C - 42°C)</span>
                  <p className="text-slate-400 text-[10px]">Aquecimento moderado, ventoinhas ativadas no inversor.</p>
                </div>
                <div className="p-2 rounded-lg bg-orange-950/40 border border-orange-500/30 space-y-1">
                  <span className="font-bold text-orange-300 block">🟠 Throttling (42°C - 48°C)</span>
                  <p className="text-slate-400 text-[10px]">Recarga limitada a {thermalThrottleSpeedWatts}W para conter subida térmica.</p>
                </div>
                <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-500/30 space-y-1">
                  <span className="font-bold text-rose-300 block">🔴 Corte (&gt;= 48°C)</span>
                  <p className="text-slate-400 text-[10px]">ATS transferida para rede, preservando 3.000 ciclos.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving || isLoading}
              className="w-full sm:w-auto py-3 px-6 min-h-[44px] rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all duration-150 shadow-lg shadow-emerald-950 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isSaving ? "Salvando..." : "Salvar Regras de Automação"}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
