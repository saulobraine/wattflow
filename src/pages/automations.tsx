import React, { useEffect, useState, FormEvent } from "react";
import { Layout } from "../components/Layout";
import { Sliders, Zap, Power, AlertCircle, CheckCircle2, ArrowLeftRight } from "lucide-react";

export default function AutomationsPage() {
  const [turnOnThreshold, setTurnOnThreshold] = useState(90);
  const [turnOffThreshold, setTurnOffThreshold] = useState(30);
  const [isAutomationActive, setIsAutomationActive] = useState(true);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    async function loadAutomations() {
      try {
        const response = await fetch("/api/automations");
        const json = await response.json();
        if (json.success && json.data) {
          setTurnOnThreshold(json.data.turnOnThreshold ?? 90);
          setTurnOffThreshold(json.data.turnOffThreshold ?? 30);
          setIsAutomationActive(json.data.isAutomationActive ?? true);
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

    if (turnOffThreshold >= turnOnThreshold) {
      setFeedback({
        type: "error",
        message: "O limite mínimo de bateria deve ser pelo menos 1% menor que o limite máximo.",
      });
      setIsSaving(false);
      return;
    }

    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turnOnThreshold,
          turnOffThreshold,
          isAutomationActive,
        }),
      });

      const json = await response.json();
      if (json.success) {
        setFeedback({ type: "success", message: "Gatilhos de automação atualizados com sucesso!" });
      } else {
        setFeedback({ type: "error", message: json.message || "Erro ao salvar automação." });
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

              <label htmlFor="automation-active-checkbox" className="flex items-center gap-2 cursor-pointer group self-start sm:self-auto">
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
                className="w-full accent-emerald-500 cursor-pointer h-2 py-2 bg-slate-800 rounded-lg transition-all"
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
                className="w-full accent-rose-500 cursor-pointer h-2 py-2 bg-slate-800 rounded-lg transition-all"
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

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving || isLoading}
              className="w-full sm:w-auto py-3 px-6 rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all duration-150 shadow-lg shadow-emerald-950 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {isSaving ? "Salvando..." : "Salvar Regras de Automação"}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
