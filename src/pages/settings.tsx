import React, { useEffect, useState, FormEvent } from "react";
import { Layout } from "../components/Layout";
import {
  KeyRound,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowLeftRight,
  Plug,
  Zap,
  Loader2,
} from "lucide-react";

export default function SettingsPage() {
  const [tuyaAccessId, setTuyaAccessId] = useState("");
  const [tuyaAccessSecret, setTuyaAccessSecret] = useState("");
  const [tuyaDeviceId, setTuyaDeviceId] = useState("");
  const [tuyaEndpointRegion, setTuyaEndpointRegion] = useState("https://openapi.tuyaus.com");
  const [ecoflowEndpointRegion, setEcoflowEndpointRegion] = useState("https://api.ecoflow.com");
  const [ecoflowAccessKey, setEcoflowAccessKey] = useState("");
  const [ecoflowAccessSecret, setEcoflowAccessSecret] = useState("");
  const [ecoflowSerialNumber, setEcoflowSerialNumber] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [isTesting, setIsTesting] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{
    isSuccess: boolean;
    summary: string;
    tuyaMessage: string;
    ecoflowMessage: string;
  } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        const json = await response.json();
        if (json.success && json.data) {
          setTuyaAccessId(json.data.tuyaAccessId || "");
          setTuyaAccessSecret(json.data.tuyaAccessSecretMasked || "");
          setTuyaDeviceId(json.data.tuyaDeviceId || "");
          setTuyaEndpointRegion(json.data.tuyaEndpointRegion || "https://openapi.tuyaus.com");
          setEcoflowEndpointRegion(json.data.ecoflowEndpointRegion || "https://api.ecoflow.com");
          setEcoflowAccessKey(json.data.ecoflowAccessKey || "");
          setEcoflowAccessSecret(json.data.ecoflowAccessSecretMasked || "");
          setEcoflowSerialNumber(json.data.ecoflowSerialNumber || "");
        }
      } catch (err) {
        console.error("Erro ao carregar configurações:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tuyaAccessId,
          tuyaAccessSecret,
          tuyaDeviceId,
          tuyaEndpointRegion,
          ecoflowEndpointRegion,
          ecoflowAccessKey,
          ecoflowAccessSecret,
          ecoflowSerialNumber,
        }),
      });

      const json = await response.json();
      if (json.success) {
        setFeedback({ type: "success", message: "Credenciais salvas com sucesso no banco de dados!" });
      } else {
        setFeedback({ type: "error", message: json.message || "Erro ao salvar credenciais." });
      }
    } catch {
      setFeedback({ type: "error", message: "Falha na comunicação com o servidor." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestControl = async (
    actionTarget: "TUYA_ON" | "TUYA_OFF" | "ECOFLOW_ON" | "ECOFLOW_OFF"
  ) => {
    setIsTesting(true);
    setTestFeedback(null);

    try {
      const response = await fetch("/api/test-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionTarget,
          tuyaAccessId,
          tuyaAccessSecret,
          tuyaDeviceId,
          tuyaEndpointRegion,
          ecoflowAccessKey,
          ecoflowAccessSecret,
          ecoflowSerialNumber,
          ecoflowEndpointRegion,
        }),
      });

      const json = await response.json();
      if (json.success && json.data) {
        setTestFeedback({
          isSuccess: json.data.isSuccess,
          summary: json.data.summaryMessage,
          tuyaMessage: json.data.tuyaMessage,
          ecoflowMessage: json.data.ecoflowMessage,
        });
        return;
      }

      const errorMessage = json.message || "Falha ao executar o comando de teste dos dispositivos.";
      setTestFeedback({
        isSuccess: false,
        summary: errorMessage,
        tuyaMessage: "Operação não concluída.",
        ecoflowMessage: "Operação não concluída.",
      });
    } catch {
      setTestFeedback({
        isSuccess: false,
        summary: "Erro na comunicação com a API interna do WattFlow.",
        tuyaMessage: "Falha de conexão.",
        ecoflowMessage: "Falha de conexão.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Layout title="Credenciais de Integração (BYOK)">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-300 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold text-slate-200">Arquitetura BYOK (Bring Your Own Key):</span>
            <p className="mt-1 text-slate-400">
              O WattFlow não armazena credenciais compartilhadas globais. Cada requisição utiliza diretamente
              as chaves da sua conta de desenvolvedor da Tuya Cloud e EcoFlow Open API.
            </p>
          </div>
        </div>

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
          {/* Seção Tuya Cloud */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <KeyRound className="w-5 h-5 text-emerald-400" />
              <h2 className="text-lg font-bold text-slate-100">Tuya Cloud OpenAPI (Smart Life)</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Tuya Access ID / Client ID
                </label>
                <input
                  type="text"
                  required
                  value={tuyaAccessId}
                  onChange={(e) => setTuyaAccessId(e.target.value)}
                  placeholder="Ex: 1a2b3c4d5e6f7g8h"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Tuya Access Secret
                </label>
                <input
                  type="text"
                  required
                  value={tuyaAccessSecret}
                  onChange={(e) => setTuyaAccessSecret(e.target.value)}
                  placeholder="Ex: 8h7g6f5e4d3c2b1a"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  ID do Dispositivo Tuya (Device ID)
                </label>
                <input
                  type="text"
                  required
                  value={tuyaDeviceId}
                  onChange={(e) => setTuyaDeviceId(e.target.value)}
                  placeholder="Ex: eb12345678abcdef"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Região do Endpoint Tuya
                </label>
                <select
                  value={tuyaEndpointRegion}
                  onChange={(e) => setTuyaEndpointRegion(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  <option value="https://openapi.tuyaus.com">América Ocidental (https://openapi.tuyaus.com)</option>
                  <option value="https://openapi-ueaz.tuyaus.com">América Oriental (https://openapi-ueaz.tuyaus.com)</option>
                  <option value="https://openapi.tuyaeu.com">Europa Central (https://openapi.tuyaeu.com)</option>
                  <option value="https://openapi-weaz.tuyaeu.com">Europa Ocidental (https://openapi-weaz.tuyaeu.com)</option>
                  <option value="https://openapi.tuyacn.com">China (https://openapi.tuyacn.com)</option>
                  <option value="https://openapi.tuyain.com">Índia (https://openapi.tuyain.com)</option>
                  <option value="https://openapi-sg.iotbing.com">Cingapura (https://openapi-sg.iotbing.com)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Seção EcoFlow Developer */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold text-slate-100">EcoFlow Developer Open API</h2>
              </div>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                {ecoflowEndpointRegion}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Certifique-se de selecionar a região onde sua conta no Developer Portal da EcoFlow foi criada (Global ou Europa). O WattFlow conta também com auto-fallback resiliente entre os dois servidores.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Região do Endpoint EcoFlow
                </label>
                <select
                  value={ecoflowEndpointRegion}
                  onChange={(e) => setEcoflowEndpointRegion(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  <option value="https://api.ecoflow.com">Global / Américas / Brasil (https://api.ecoflow.com)</option>
                  <option value="https://api-e.ecoflow.com">Europa (https://api-e.ecoflow.com)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Número de Série (SN) do Dispositivo EcoFlow
                </label>
                <input
                  type="text"
                  required
                  value={ecoflowSerialNumber}
                  onChange={(e) => setEcoflowSerialNumber(e.target.value)}
                  placeholder="Ex: R331XXXXXXXXX (River 2 / Delta 2)"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  EcoFlow Access Key
                </label>
                <input
                  type="text"
                  required
                  value={ecoflowAccessKey}
                  onChange={(e) => setEcoflowAccessKey(e.target.value)}
                  placeholder="Chave de acesso pública da EcoFlow"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  EcoFlow Access Secret
                </label>
                <input
                  type="text"
                  required
                  value={ecoflowAccessSecret}
                  onChange={(e) => setEcoflowAccessSecret(e.target.value)}
                  placeholder="Segredo de API da EcoFlow"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Seção de Teste de Acionamento com Intertravamento de Segurança */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold text-slate-100">
                  Teste Operacional de Intertravamento (Safety Interlock)
                </h2>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 w-fit">
                Intertravamento Ativo
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Teste os comandos de acionamento em tempo real diretamente com as APIs oficiais. Para proteção elétrica e evitar sobrecarga na rede, o sistema aplica regra estrita de intertravamento: <strong>ligar um dispositivo comuta o outro para desligado automaticamente</strong>.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card Tomada Tuya */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-3">
                <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
                  <Plug className="w-4 h-4 text-emerald-400" />
                  <span>Tomada Tuya (Rede AC)</span>
                </div>
                <p className="text-xs text-slate-400">
                  Ao ligar a tomada para alimentar pela rede, a saída AC da bateria é desarmada.
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isTesting || isLoading}
                    onClick={() => handleTestControl("TUYA_ON")}
                    className="w-full py-2.5 px-4 rounded-xl font-medium text-xs bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-between transition-colors shadow-md shadow-emerald-950/30 disabled:opacity-50"
                  >
                    <span className="font-semibold">Ligar Tomada</span>
                    <span className="text-[11px] bg-emerald-700/60 px-2 py-0.5 rounded">
                      Desliga AC EcoFlow
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={isTesting || isLoading}
                    onClick={() => handleTestControl("TUYA_OFF")}
                    className="w-full py-2.5 px-4 rounded-xl font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-between transition-colors disabled:opacity-50"
                  >
                    <span>Desligar Tomada</span>
                    <span className="text-[11px] bg-slate-900 px-2 py-0.5 rounded text-slate-300">
                      Liga AC EcoFlow
                    </span>
                  </button>
                </div>
              </div>

              {/* Card Saída AC EcoFlow */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-3">
                <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <span>Saída AC EcoFlow (Inversor / Bateria)</span>
                </div>
                <p className="text-xs text-slate-400">
                  Ao ligar a saída AC da bateria, a tomada da concessionária é desarmada.
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isTesting || isLoading}
                    onClick={() => handleTestControl("ECOFLOW_ON")}
                    className="w-full py-2.5 px-4 rounded-xl font-medium text-xs bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-between transition-colors shadow-md shadow-emerald-950/30 disabled:opacity-50"
                  >
                    <span className="font-semibold">Ligar Saída AC</span>
                    <span className="text-[11px] bg-emerald-700/60 px-2 py-0.5 rounded">
                      Desliga Tomada Tuya
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={isTesting || isLoading}
                    onClick={() => handleTestControl("ECOFLOW_OFF")}
                    className="w-full py-2.5 px-4 rounded-xl font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-between transition-colors disabled:opacity-50"
                  >
                    <span>Desligar Saída AC</span>
                    <span className="text-[11px] bg-slate-900 px-2 py-0.5 rounded text-slate-300">
                      Liga Tomada Tuya
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* Indicador de Execução */}
            {isTesting && (
              <div className="flex items-center justify-center gap-2.5 p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Enviando comandos coordenados com intertravamento para os servidores...</span>
              </div>
            )}

            {/* Resultado do Teste de Intertravamento */}
            {testFeedback && (
              <div
                className={`p-4 rounded-xl border space-y-3 text-xs ${
                  testFeedback.isSuccess
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-200"
                }`}
              >
                <div className="flex items-center gap-2 font-semibold text-sm">
                  {testFeedback.isSuccess ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                  )}
                  <span>{testFeedback.summary}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                  <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80">
                    <span className="text-slate-400 block mb-0.5 font-sans font-medium">Status Tuya:</span>
                    <span className="text-slate-200">{testFeedback.tuyaMessage}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80">
                    <span className="text-slate-400 block mb-0.5 font-sans font-medium">Status EcoFlow:</span>
                    <span className="text-slate-200">{testFeedback.ecoflowMessage}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving || isLoading}
              className="py-3 px-6 rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-lg shadow-emerald-950 disabled:opacity-50"
            >
              {isSaving ? "Salvando..." : "Salvar Configurações"}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
