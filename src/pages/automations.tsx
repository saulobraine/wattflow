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
} from "lucide-react";

export default function AutomationsPage() {
  // Limites Padrão da ATS (Histerese)
  const [turnOnThreshold, setTurnOnThreshold] = useState(90);
  const [turnOffThreshold, setTurnOffThreshold] = useState(30);
  const [isAutomationActive, setIsAutomationActive] = useState(true);

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

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    async function loadAutomations() {
      try {
        const [autoRes, settingsRes] = await Promise.all([
          fetch("/api/automations"),
          fetch("/api/settings"),
        ]);

        const autoJson = await autoRes.json();
        if (autoJson.success && autoJson.data) {
          setTurnOnThreshold(autoJson.data.turnOnThreshold ?? 90);
          setTurnOffThreshold(autoJson.data.turnOffThreshold ?? 30);
          setIsAutomationActive(autoJson.data.isAutomationActive ?? true);
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

    try {
      const [autoRes, settingsRes] = await Promise.all([
        fetch("/api/automations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turnOnThreshold,
            turnOffThreshold,
            isAutomationActive,
          }),
        }),
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ecoflowAccessKey: ecoflowAccessKey || undefined,
            ecoflowSerialNumber: ecoflowSerialNumber || undefined,
            isAutoStormActive,
            autoStormReserveThreshold,
            autoStormRainThresholdMm,
            autoStormPrechargeAc,
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
          }),
        }),
      ]);

      const autoJson = await autoRes.json();
      const settingsJson = await settingsRes.json();

      if (autoJson.success && settingsJson.success) {
        setFeedback({
          type: "success",
          message: "Regras de automação, Auto-Storm e Tarifação Horária salvas com sucesso!",
        });
      } else {
        const errMsg =
          (!autoJson.success ? autoJson.message : settingsJson.message) ||
          "Erro ao salvar regras de automação.";
        setFeedback({ type: "error", message: errMsg });
      }
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

              <label htmlFor="automation-active-checkbox" className="flex items-center gap-2 cursor-pointer group self-start sm:self-auto min-h-[44px]">
                <span className="text-xs font-semibold text-slate-300 group-hover:text-emerald-300 transition-colors">
                  Automação Ativa
                </span>
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
