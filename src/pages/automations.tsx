import React, { useEffect, useState, FormEvent } from "react";
import { Layout } from "../components/Layout";
import { Sliders, Zap, Power, AlertCircle, CheckCircle2 } from "lucide-react";

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
    <Layout title="Gatilhos de Automação">
      <div className="max-w-4xl mx-auto space-y-6">
        {feedback && (
          <div
            className={`p-4 rounded-xl border flex items-center gap-3 text-sm ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-rose-500/10 border-rose-500/30 text-rose-300"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold text-slate-100">Regras de Histerese de Bateria</h2>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <span className="text-sm font-medium text-slate-300">Automação Ativa</span>
                <input
                  type="checkbox"
                  checked={isAutomationActive}
                  onChange={(e) => setIsAutomationActive(e.target.checked)}
                  className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                />
              </label>
            </div>

            {/* Slider Limite Superior */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  Limite Superior (Bateria Cheia &rarr; Modo Bateria)
                </label>
                <span className="font-mono text-emerald-400 font-bold text-lg bg-emerald-500/10 px-3 py-1 rounded-lg border border-emerald-500/20">
                  {turnOnThreshold}%
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Quando a bateria atingir ou superar este valor (&ge; {turnOnThreshold}%): a tomada Tuya será <strong>DESLIGADA</strong> (corta a recarga da rede) e a saída AC da EcoFlow será <strong>ATIVADA</strong> para alimentar suas cargas via bateria.
              </p>
              <input
                type="range"
                min="2"
                max="100"
                value={turnOnThreshold}
                onChange={(e) => handleUpperThresholdChange(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
              />
            </div>

            {/* Slider Limite Inferior */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Power className="w-4 h-4 text-rose-400" />
                  Limite Inferior (Bateria Baixa &rarr; Modo Recarga)
                </label>
                <span className="font-mono text-rose-400 font-bold text-lg bg-rose-500/10 px-3 py-1 rounded-lg border border-rose-500/20">
                  {turnOffThreshold}%
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Quando a bateria descer até este valor ou menos (&le; {turnOffThreshold}%): a tomada Tuya será <strong>LIGADA</strong> (inicia a recarga na tomada da concessionária) e a saída AC da EcoFlow será <strong>DESATIVADA</strong> para evitar descarga profunda.
              </p>
              <input
                type="range"
                min="1"
                max="99"
                value={turnOffThreshold}
                onChange={(e) => handleLowerThresholdChange(Number(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
              />
            </div>

            {/* Visualização de Faixas */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Fluxo de Orquestração Coordenada:
              </span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-300">
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900/40 space-y-1.5">
                  <div className="font-semibold text-rose-400">&le; {turnOffThreshold}% (Bateria Baixa)</div>
                  <div className="text-slate-200">&bull; Tomada Tuya: <span className="text-emerald-400 font-bold">LIGADA</span> (Recarga)</div>
                  <div className="text-slate-200">&bull; Saída AC EcoFlow: <span className="text-rose-400 font-bold">DESLIGADA</span> (Proteção)</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                  <div className="font-semibold text-amber-400">{turnOffThreshold}% a {turnOnThreshold}% (Histerese)</div>
                  <div className="text-slate-300">&bull; Faixa intermediária estável</div>
                  <div className="text-slate-400">Mantém estados atuais sem chaveamento</div>
                </div>
                <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-900/40 space-y-1.5">
                  <div className="font-semibold text-emerald-400">&ge; {turnOnThreshold}% (Bateria Cheia)</div>
                  <div className="text-slate-200">&bull; Tomada Tuya: <span className="text-rose-400 font-bold">DESLIGADA</span> (Corta Rede)</div>
                  <div className="text-slate-200">&bull; Saída AC EcoFlow: <span className="text-emerald-400 font-bold">ATIVADA</span> (Modo Bateria)</div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving || isLoading}
              className="py-3 px-6 rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-lg shadow-emerald-950 disabled:opacity-50"
            >
              {isSaving ? "Salvando..." : "Salvar Regras de Automação"}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
