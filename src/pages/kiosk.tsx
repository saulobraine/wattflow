import React, { useState, useEffect, useCallback, useRef } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import {
  Sun,
  Zap,
  BatteryCharging,
  ArrowLeft,
  Maximize,
  Minimize,
  Thermometer,
  Activity,
  Power,
  ShieldCheck,
  AlertTriangle,
  Clock,
  ArrowRight,
  TrendingUp,
  Cpu,
  Layers,
} from "lucide-react";
import { useVisibilityPolling } from "../hooks/useVisibilityPolling";

interface KioskTelemetryData {
  currentWatts: number;
  currentOutputWatts: number;
  netWatts: number;
  peakWatts: number;
  batteryPercentage: number;
  lastAction?: string | null;
  autonomyEstimate?: {
    formattedRuntime: string;
    isRecharging: boolean;
    isIdle: boolean;
    status: "CHARGING" | "DISCHARGING" | "IDLE" | "DEPLETED";
  };
  bmsAnalytics?: {
    temperatureCelsius: number | null;
    sohPercentage: number | null;
    bmsCycles: number | null;
    thermalStatus: "NORMAL" | "WARM" | "HOT" | "CRITICAL";
    voltageVolts: number | null;
  };
  atsHealth?: {
    healthPercentage: number;
    currentCycles: number;
    lifespanCycles: number;
    status: "EXCELLENT" | "GOOD" | "ATTENTION" | "CRITICAL";
  };
}

export default function KioskPage() {
  const router = useRouter();
  const [telemetry, setTelemetry] = useState<KioskTelemetryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const wakeLockRef = useRef<any>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Relógio Digital de Alta Precisão (HH:mm:ss) e Data
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("pt-BR", { hour12: false }));
      setCurrentDate(
        now.toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        })
      );
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // 2. Screen Wake Lock API (Impede que a tela do Quadro Elétrico apague)
  const requestWakeLock = useCallback(async () => {
    if (typeof window !== "undefined" && "wakeLock" in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        setIsWakeLockActive(true);
        wakeLockRef.current.addEventListener("release", () => {
          setIsWakeLockActive(false);
        });
      } catch (err) {
        console.warn("Screen Wake Lock indisponível:", err);
        setIsWakeLockActive(false);
      }
    }
  }, []);

  useEffect(() => {
    requestWakeLock();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
      }
    };
  }, [requestWakeLock]);

  // 3. Alternância de Tela Cheia (Fullscreen API)
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // 4. Auto-hide de Controles de Gestão após 5s de inatividade
  const handleUserActivity = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 5000);
  };

  useEffect(() => {
    window.addEventListener("mousemove", handleUserActivity);
    window.addEventListener("touchstart", handleUserActivity);
    window.addEventListener("keydown", handleUserActivity);
    handleUserActivity();
    return () => {
      window.removeEventListener("mousemove", handleUserActivity);
      window.removeEventListener("touchstart", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, []);

  // 5. Coleta de Telemetria Contínua
  const fetchTelemetry = async () => {
    try {
      const res = await fetch(`/api/statistics?t=${Date.now()}`);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        const lastLog = d.recentLogs && d.recentLogs.length > 0 ? d.recentLogs[0] : null;
        setTelemetry({
          currentWatts: d.currentWatts ?? (lastLog?.solarInputWatts ?? 0),
          currentOutputWatts: d.currentOutputWatts ?? (lastLog?.outputWatts ?? 0),
          netWatts: d.netWatts ?? ((d.currentWatts ?? 0) - (d.currentOutputWatts ?? 0)),
          peakWatts: d.peakWatts ?? 0,
          batteryPercentage: lastLog?.batteryPercentage ?? (d.bmsAnalytics?.bmsCycles ? 85 : 80),
          lastAction: lastLog?.actionTriggered ?? "HOLD_CURRENT_STATE",
          autonomyEstimate: d.autonomyEstimate,
          bmsAnalytics: d.bmsAnalytics,
          atsHealth: d.atsHealth,
        });
      }
    } catch (err) {
      console.error("Erro ao sincronizar Kiosk:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
  }, []);

  useVisibilityPolling({
    pollingIntervalMs: 2000,
    onPoll: fetchTelemetry,
  });

  // Cálculos Derivados do Kiosk
  const solarWatts = telemetry?.currentWatts ?? 0;
  const loadWatts = telemetry?.currentOutputWatts ?? 0;
  const netWatts = telemetry?.netWatts ?? (solarWatts - loadWatts);
  const batteryPct = telemetry?.batteryPercentage ?? 0;
  const temperature = telemetry?.bmsAnalytics?.temperatureCelsius ?? null;
  const soh = telemetry?.bmsAnalytics?.sohPercentage ?? null;

  // Lógica da ATS e Fonte Ativa
  const isAtsOnBattery =
    telemetry?.lastAction === "BATTERY_HIGH_DISCHARGE" ||
    (loadWatts > 0 && batteryPct >= 30) ||
    telemetry?.lastAction !== "BATTERY_LOW_RECHARGE";

  // Cor Dinâmica da Bateria
  let batteryColorClass = "text-emerald-400";
  let batteryStrokeColor = "#10b981";
  if (batteryPct <= 25) {
    batteryColorClass = "text-rose-400";
    batteryStrokeColor = "#f43f5e";
  } else if (batteryPct <= 50) {
    batteryColorClass = "text-amber-400";
    batteryStrokeColor = "#f59e0b";
  }

  // Raio e Circunferência do Gauge Circular
  const radius = 130;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference - (Math.min(100, Math.max(0, batteryPct)) / 100) * circumference;

  return (
    <>
      <Head>
        <title>Modo Kiosk | Wall Panel WattFlow</title>
        <meta name="theme-color" content="#000000" />
      </Head>

      <div
        className="bg-black text-slate-100 min-h-screen h-screen w-screen overflow-hidden select-none font-sans flex flex-col justify-between p-4 sm:p-6 lg:p-8 cursor-default"
        style={{ backgroundColor: "#000000" }}
      >
        {/* ==============================================================
            TOPO: BARRA SUPERIOR EXECUTIVA (LOGOMARCA, STATUS, RELÓGIO)
            ============================================================== */}
        <header className="flex items-center justify-between border-b border-slate-900 pb-4 shrink-0">
          {/* Lado Esquerdo: Identificação & Wake Lock Status */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-lg shadow-emerald-950/40">
              <Zap className="w-6 h-6 animate-pulse" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black tracking-wider bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                  WATTFLOW
                </span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 uppercase tracking-widest">
                  Wall Panel
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  {isWakeLockActive ? "Tela Ativa (Wake Lock)" : "Conectado ao Barramento"}
                </span>
              </div>
            </div>
          </div>

          {/* Centro: Indicadores Rápidos de BMS & Saúde da Bateria */}
          <div className="hidden md:flex items-center gap-4 bg-slate-950/80 border border-slate-900 px-4 py-2 rounded-2xl">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
              <Thermometer className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              <span>Células:</span>
              <strong className="text-slate-100 font-bold">
                {temperature !== null ? `${temperature.toFixed(1)}°C` : "--"}
              </strong>
            </div>

            {soh !== null && (
              <>
                <span className="text-slate-700">•</span>
                <div className="flex items-center gap-1.5 text-xs font-mono text-slate-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  <span>SOH:</span>
                  <strong className="text-emerald-400 font-bold">{soh}%</strong>
                </div>
              </>
            )}

            {telemetry?.atsHealth && (
              <>
                <span className="text-slate-700">•</span>
                <div className="flex items-center gap-1.5 text-xs font-mono text-slate-300">
                  <Cpu className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  <span>ATS:</span>
                  <strong className="text-amber-300 font-bold">
                    {telemetry.atsHealth.currentCycles} / {telemetry.atsHealth.lifespanCycles} ciclos
                  </strong>
                </div>
              </>
            )}
          </div>

          {/* Lado Direito: Relógio Digital & Controles Flutuantes */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-3xl sm:text-4xl lg:text-5xl font-mono font-black tracking-tight text-slate-100 drop-shadow-md">
                {currentTime || "00:00:00"}
              </div>
              <div className="text-xs sm:text-sm font-medium text-slate-400 capitalize">
                {currentDate}
              </div>
            </div>

            {/* Controles Flutuantes com Transição de Auto-Hide */}
            <div
              className={`flex items-center gap-2 transition-opacity duration-300 ${
                showControls ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label="Alternar Tela Cheia"
                className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-all active:scale-95 cursor-pointer shadow-lg"
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>

              <button
                type="button"
                onClick={() => router.push("/")}
                aria-label="Sair do Modo Kiosk"
                className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-700/60 text-slate-300 hover:text-rose-300 transition-all active:scale-95 cursor-pointer shadow-lg flex items-center gap-1.5 text-xs font-semibold"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Painel</span>
              </button>
            </div>
          </div>
        </header>

        {/* ==============================================================
            CENTRO: GAUGE MACROSCÓPICO DE SOC + CARDS GIGANTES DE POTÊNCIA
            ============================================================== */}
        <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center flex-1 my-auto py-2">
          {/* Card Esquerdo: Entrada Solar Fotovoltaica */}
          <div className="lg:col-span-3 flex flex-col justify-center p-6 rounded-3xl bg-slate-950/90 border border-slate-900 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm font-bold uppercase tracking-widest text-amber-400 flex items-center gap-2">
                <Sun className="w-5 h-5 animate-spin-slow" aria-hidden="true" />
                Geração Solar PV
              </span>
              <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-bold">
                Pico: {telemetry?.peakWatts ?? 0} W
              </span>
            </div>

            <div className="text-5xl sm:text-6xl lg:text-7xl font-mono font-black tracking-tighter text-amber-400 drop-shadow-lg">
              {solarWatts}
              <span className="text-2xl sm:text-3xl lg:text-4xl font-normal text-slate-500 ml-2">W</span>
            </div>

            <p className="text-xs text-slate-400 font-mono">
              Potência instantânea entregue pelos painéis fotovoltaicos
            </p>
          </div>

          {/* Coluna Central: Gauge Macroscópico de SOC % da Bateria */}
          <div className="lg:col-span-6 flex flex-col items-center justify-center p-4">
            <div className="relative flex items-center justify-center">
              {/* SVG Circular Gauge */}
              <svg className="w-72 h-72 sm:w-80 sm:h-80 lg:w-96 lg:h-96 transform -rotate-90" viewBox="0 0 320 320">
                <circle
                  cx="160"
                  cy="160"
                  r={radius}
                  stroke="#1e293b"
                  strokeWidth="20"
                  fill="transparent"
                />
                <circle
                  cx="160"
                  cy="160"
                  r={radius}
                  stroke={batteryStrokeColor}
                  strokeWidth="22"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeOffset}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-1000 ease-out"
                />
              </svg>

              {/* Informações Macroscópicas no Centro do Gauge */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-mono uppercase tracking-widest text-slate-400 mb-1">
                  <BatteryCharging className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  Nível de Carga (SOC)
                </div>

                <div className={`text-7xl sm:text-8xl lg:text-9xl font-black font-mono tracking-tighter ${batteryColorClass} drop-shadow-2xl`}>
                  {batteryPct}
                  <span className="text-4xl sm:text-5xl font-light text-slate-500 ml-1">%</span>
                </div>

                {/* Autonomia Legível a 3-5 metros */}
                <div className="mt-2 px-4 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-slate-200 text-sm sm:text-base lg:text-lg font-mono font-bold shadow-inner">
                  {telemetry?.autonomyEstimate?.formattedRuntime ? (
                    telemetry.autonomyEstimate.isRecharging ? (
                      <span className="text-emerald-300">Geração supera consumo • Carregando</span>
                    ) : (
                      <span className="text-slate-100">
                        Autonomia: ~{telemetry.autonomyEstimate.formattedRuntime}
                      </span>
                    )
                  ) : (
                    <span className="text-slate-400">Calculando autonomia...</span>
                  )}
                </div>
              </div>
            </div>

            {/* Saldo Líquido Instantâneo no Rodapé do Gauge */}
            <div className="mt-4 flex items-center gap-3 bg-slate-950 border border-slate-900 px-5 py-2.5 rounded-2xl">
              <span className="text-xs font-mono uppercase text-slate-400 tracking-wider">
                Balanço Líquido:
              </span>
              <span
                className={`text-xl sm:text-2xl font-mono font-black ${
                  netWatts >= 0 ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {netWatts > 0 ? `+${netWatts}` : netWatts} W
              </span>
              <span className="text-xs text-slate-500 font-mono">
                {netWatts >= 0 ? "(Superávit Solar)" : "(Déficit / Dreno Bateria)"}
              </span>
            </div>
          </div>

          {/* Card Direito: Consumo Residencial AC */}
          <div className="lg:col-span-3 flex flex-col justify-center p-6 rounded-3xl bg-slate-950/90 border border-slate-900 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm font-bold uppercase tracking-widest text-sky-400 flex items-center gap-2">
                <Zap className="w-5 h-5 text-sky-400" aria-hidden="true" />
                Carga Residencial AC
              </span>
              <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/30 font-bold">
                Inversor Ativo
              </span>
            </div>

            <div className="text-5xl sm:text-6xl lg:text-7xl font-mono font-black tracking-tighter text-sky-400 drop-shadow-lg">
              {loadWatts}
              <span className="text-2xl sm:text-3xl lg:text-4xl font-normal text-slate-500 ml-2">W</span>
            </div>

            <p className="text-xs text-slate-400 font-mono">
              Demanda de potência consumida pelos circuitos da residência
            </p>
          </div>
        </main>

        {/* ==============================================================
            BASE: DIAGRAMA SINÓPTICO DE FLUXO DE POTÊNCIA EM TEMPO REAL
            ============================================================== */}
        <footer className="border-t border-slate-900 pt-4 shrink-0 space-y-3">
          {/* Badge de Fonte Ativa */}
          <div className="flex items-center justify-center">
            <div
              className={`inline-flex items-center gap-2 px-5 py-2 rounded-full border text-xs sm:text-sm font-mono font-bold tracking-wider shadow-lg transition-all ${
                isAtsOnBattery
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-emerald-950/50"
                  : "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-amber-950/50"
              }`}
            >
              <Power className="w-4 h-4 animate-pulse" aria-hidden="true" />
              FONTE ATIVA NA CHAVE ATS:{" "}
              <span className="underline decoration-2 underline-offset-4">
                {isAtsOnBattery ? "POSIÇÃO B (SOLAR & BATERIA ECOFLOW)" : "POSIÇÃO A (REDE CONCESSIONÁRIA)"}
              </span>
            </div>
          </div>

          {/* Diagrama de Nós Sinópticos Conectados */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 max-w-5xl mx-auto">
            {/* Nó 1: Painéis PV */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <Sun className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-400 font-semibold">Painéis PV</div>
                  <div className="text-sm font-mono font-bold text-amber-400">{solarWatts} W</div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-600 hidden md:block" />
            </div>

            {/* Nó 2: Bateria EcoFlow */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <BatteryCharging className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-400 font-semibold">EcoFlow BMS</div>
                  <div className="text-sm font-mono font-bold text-emerald-400">{batteryPct}% SOC</div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-600 hidden md:block" />
            </div>

            {/* Nó 3: Chave ATS */}
            <div
              className={`p-3.5 rounded-2xl bg-slate-950 border flex items-center justify-between transition-colors ${
                isAtsOnBattery ? "border-emerald-500/40" : "border-amber-500/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-400 font-semibold">Chave ATS</div>
                  <div className="text-xs font-mono font-bold text-cyan-300">
                    {isAtsOnBattery ? "Saída Solar" : "Rede Elétrica"}
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-600 hidden md:block" />
            </div>

            {/* Nó 4: Cargas Residenciais */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-400 font-semibold">Residência</div>
                  <div className="text-sm font-mono font-bold text-sky-400">{loadWatts} W</div>
                </div>
              </div>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
