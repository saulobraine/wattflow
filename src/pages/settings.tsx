import React, { useEffect, useState, FormEvent } from "react";
import { Layout } from "../components/Layout";
import {
  KeyRound,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Power,
  Zap,
  Loader2,
  Activity,
  ArrowLeftRight,
  Bell,
  MessageSquare,
  Send,
} from "lucide-react";

export default function SettingsPage() {
  const [ecoflowEndpointRegion, setEcoflowEndpointRegion] = useState("https://api.ecoflow.com");
  const [ecoflowAccessKey, setEcoflowAccessKey] = useState("");
  const [ecoflowAccessSecret, setEcoflowAccessSecret] = useState("");
  const [ecoflowSerialNumber, setEcoflowSerialNumber] = useState("");

  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState("");
  const [whatsappApiKey, setWhatsappApiKey] = useState("");
  const [isNotificationActive, setIsNotificationActive] = useState(true);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [isTestingEcoFlow, setIsTestingEcoFlow] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{
    isSuccess: boolean;
    summary: string;
    ecoflowMessage: string;
    batteryPercentage?: number;
    solarWatts?: number;
    isAcOutputEnabled?: boolean | null;
  } | null>(null);

  // Estados de teste separados para Telegram e WhatsApp
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramFeedback, setTelegramFeedback] = useState<{
    isSuccess: boolean;
    message: string;
  } | null>(null);

  const [isTestingWhatsApp, setIsTestingWhatsApp] = useState(false);
  const [whatsappFeedback, setWhatsappFeedback] = useState<{
    isSuccess: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        const json = await response.json();
        if (json.success && json.data) {
          setEcoflowEndpointRegion(json.data.ecoflowEndpointRegion || "https://api.ecoflow.com");
          setEcoflowAccessKey(json.data.ecoflowAccessKey || "");
          setEcoflowAccessSecret(json.data.ecoflowAccessSecretMasked || "");
          setEcoflowSerialNumber(json.data.ecoflowSerialNumber || "");
          setTelegramBotToken(json.data.telegramBotTokenMasked || "");
          setTelegramChatId(json.data.telegramChatId || "");
          setWhatsappPhoneNumber(json.data.whatsappPhoneNumber || "");
          setWhatsappApiKey(json.data.whatsappApiKeyMasked || "");
          setIsNotificationActive(json.data.isNotificationActive ?? true);
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
          ecoflowEndpointRegion,
          ecoflowAccessKey,
          ecoflowAccessSecret,
          ecoflowSerialNumber,
          telegramBotToken,
          telegramChatId,
          whatsappPhoneNumber,
          whatsappApiKey,
          isNotificationActive,
        }),
      });

      const json = await response.json();
      if (json.success) {
        setFeedback({ type: "success", message: "Credenciais e configurações salvas com sucesso!" });
      } else {
        setFeedback({ type: "error", message: json.message || "Erro ao salvar credenciais." });
      }
    } catch {
      setFeedback({ type: "error", message: "Falha na comunicação com o servidor." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestControl = async (actionTarget: "ECOFLOW_ON" | "ECOFLOW_OFF" | "ECOFLOW_TELEMETRY") => {
    setIsTestingEcoFlow(true);
    setTestFeedback(null);

    try {
      const response = await fetch("/api/test-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionTarget,
          ecoflowEndpointRegion,
          ecoflowAccessKey,
          ecoflowAccessSecret,
          ecoflowSerialNumber,
        }),
      });

      const json = await response.json();
      if (json.data) {
        setTestFeedback({
          isSuccess: json.data.isSuccess,
          summary: json.data.summaryMessage,
          ecoflowMessage: json.data.ecoflowMessage,
          batteryPercentage: json.data.batteryPercentage,
          solarWatts: json.data.solarWatts,
          isAcOutputEnabled: json.data.isAcOutputEnabled,
        });
      } else {
        setTestFeedback({
          isSuccess: false,
          summary: json.message || "Falha na execução do teste.",
          ecoflowMessage: "Verifique suas credenciais e conexão de rede.",
        });
      }
    } catch {
      setTestFeedback({
        isSuccess: false,
        summary: "Erro ao comunicar com a rota de testes.",
        ecoflowMessage: "Falha de rede local.",
      });
    } finally {
      setIsTestingEcoFlow(false);
    }
  };

  const handleTestTelegram = async () => {
    setIsTestingTelegram(true);
    setTelegramFeedback(null);

    try {
      const response = await fetch("/api/test-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "TELEGRAM",
          telegramBotToken,
          telegramChatId,
        }),
      });

      const json = await response.json();
      setTelegramFeedback({
        isSuccess: json.success,
        message: json.message || "Resposta do teste Telegram recebida.",
      });
    } catch {
      setTelegramFeedback({
        isSuccess: false,
        message: "Erro de rede ao disparar teste para o Telegram.",
      });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleTestWhatsApp = async () => {
    setIsTestingWhatsApp(true);
    setWhatsappFeedback(null);

    try {
      const response = await fetch("/api/test-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "WHATSAPP",
          whatsappPhoneNumber,
          whatsappApiKey,
        }),
      });

      const json = await response.json();
      setWhatsappFeedback({
        isSuccess: json.success,
        message: json.message || "Resposta do teste WhatsApp recebida.",
      });
    } catch {
      setWhatsappFeedback({
        isSuccess: false,
        message: "Erro de rede ao disparar teste para o WhatsApp.",
      });
    } finally {
      setIsTestingWhatsApp(false);
    }
  };

  return (
    <Layout title="Configurações e Credenciais (BYOK)">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Banner Informativo sobre a Chave de Transferência Automática (ATS) */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
            <ArrowLeftRight className="w-5 h-5" />
          </div>
          <div className="text-xs text-slate-300 space-y-1">
            <span className="font-semibold text-slate-100 text-sm block">
              Automação EcoFlow + Chave de Transferência Automática (ATS)
            </span>
            <p className="text-slate-400">
              O WattFlow comuta a saída AC da sua estação <strong>EcoFlow</strong>. Quando a saída AC é ativada, a chave ATS transfere as cargas para solar/bateria. Ao desligar a saída AC, a ATS transfere para a concessionária. As notificações informam instantaneamente sobre cada comutação via Telegram ou WhatsApp.
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

        {/* Formulário Principal */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 1. EcoFlow Developer Open API */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-100">EcoFlow Developer Open API</h2>
                <p className="text-xs text-slate-400">
                  Credenciais obtidas no portal de desenvolvedores da EcoFlow (developer.ecoflow.com)
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-semibold text-slate-300">Região do Endpoint</label>
                <select
                  value={ecoflowEndpointRegion}
                  onChange={(e) => setEcoflowEndpointRegion(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="https://api.ecoflow.com">Global / Américas (api.ecoflow.com)</option>
                  <option value="https://api-e.ecoflow.com">Europa (api-e.ecoflow.com)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Access Key</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: ak_live_..."
                  value={ecoflowAccessKey}
                  onChange={(e) => setEcoflowAccessKey(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Secret Key</label>
                <input
                  type="password"
                  required
                  placeholder="Ex: sk_live_..."
                  value={ecoflowAccessSecret}
                  onChange={(e) => setEcoflowAccessSecret(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-semibold text-slate-300">
                  Número de Série da Estação (SN)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: R331Z..."
                  value={ecoflowSerialNumber}
                  onChange={(e) => setEcoflowSerialNumber(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
                <span className="text-[11px] text-slate-400 block">
                  Compatível com River 2, River 2 Max/Pro, Delta 2, Delta 2 Max, Delta Pro.
                </span>
              </div>
            </div>
          </div>

          {/* 2. Notificações Telegram & WhatsApp (Separados) */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">Notificações Instantâneas (Telegram &amp; WhatsApp)</h2>
                  <p className="text-xs text-slate-400">
                    Testes de envio independentes e alertas automáticos na comutação da chave ATS
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs font-semibold text-slate-300">Notificações Ativas</span>
                <input
                  type="checkbox"
                  checked={isNotificationActive}
                  onChange={(e) => setIsNotificationActive(e.target.checked)}
                  className="w-5 h-5 accent-cyan-500 rounded cursor-pointer"
                />
              </label>
            </div>

            {/* Subseção Telegram com Botão de Teste Próprio */}
            <div className="space-y-4 p-5 rounded-xl bg-slate-950 border border-sky-900/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4 text-sky-400" />
                  <span className="text-sm font-bold text-sky-300">Telegram Bot (100% Gratuito &amp; Imediato)</span>
                </div>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800/60 font-mono">
                  Canal 1
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Crie um bot no <strong>@BotFather</strong> para obter o Token. Envie uma mensagem para seu bot e descubra seu Chat ID com o <strong>@userinfobot</strong>.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Telegram Bot Token</label>
                  <input
                    type="password"
                    placeholder="Ex: 123456789:ABCdefGhIJKlmNoPQRstuVWxyz"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Chat ID do Telegram</label>
                  <input
                    type="text"
                    placeholder="Ex: 987654321 ou -100123456"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              {/* Botão de Teste Específico do Telegram */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
                <span className="text-[11px] text-slate-400">
                  Dispara uma mensagem de teste exclusiva para o seu chat no Telegram
                </span>
                <button
                  type="button"
                  disabled={isTestingTelegram || !telegramBotToken || !telegramChatId}
                  onClick={handleTestTelegram}
                  className="w-full sm:w-auto py-2 px-4 rounded-xl font-semibold text-xs bg-sky-950 hover:bg-sky-900/90 text-sky-200 border border-sky-700/60 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  {isTestingTelegram ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                  ) : (
                    <Send className="w-3.5 h-3.5 text-sky-400" />
                  )}
                  {isTestingTelegram ? "Enviando para Telegram..." : "Testar Envio Telegram"}
                </button>
              </div>

              {telegramFeedback && (
                <div
                  className={`p-3 rounded-xl border text-xs font-mono flex items-center gap-2 ${
                    telegramFeedback.isSuccess
                      ? "bg-slate-900 border-sky-500/40 text-sky-300"
                      : "bg-slate-900 border-rose-500/40 text-rose-300"
                  }`}
                >
                  {telegramFeedback.isSuccess ? (
                    <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span>{telegramFeedback.message}</span>
                </div>
              )}
            </div>

            {/* Subseção WhatsApp com Botão de Teste Próprio */}
            <div className="space-y-4 p-5 rounded-xl bg-slate-950 border border-emerald-900/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-bold text-emerald-300">WhatsApp (CallMeBot API Gratuita)</span>
                </div>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-mono">
                  Canal 2
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Envie <code>I allow callmebot to send me messages</code> no WhatsApp para <strong>+34 644 51 95 23</strong> para receber sua API Key gratuita (ou consulte callmebot.com).
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Número de WhatsApp (DDI + DDD)</label>
                  <input
                    type="text"
                    placeholder="Ex: +5511999999999"
                    value={whatsappPhoneNumber}
                    onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">API Key CallMeBot</label>
                  <input
                    type="password"
                    placeholder="Ex: 1234567"
                    value={whatsappApiKey}
                    onChange={(e) => setWhatsappApiKey(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              {/* Botão de Teste Específico do WhatsApp */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
                <span className="text-[11px] text-slate-400">
                  Dispara uma mensagem de teste exclusiva para o seu número de WhatsApp
                </span>
                <button
                  type="button"
                  disabled={isTestingWhatsApp || !whatsappPhoneNumber || !whatsappApiKey}
                  onClick={handleTestWhatsApp}
                  className="w-full sm:w-auto py-2 px-4 rounded-xl font-semibold text-xs bg-emerald-950 hover:bg-emerald-900/90 text-emerald-200 border border-emerald-700/60 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  {isTestingWhatsApp ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  {isTestingWhatsApp ? "Enviando para WhatsApp..." : "Testar Envio WhatsApp"}
                </button>
              </div>

              {whatsappFeedback && (
                <div
                  className={`p-3 rounded-xl border text-xs font-mono flex items-center gap-2 ${
                    whatsappFeedback.isSuccess
                      ? "bg-slate-900 border-emerald-500/40 text-emerald-300"
                      : "bg-slate-900 border-rose-500/40 text-rose-300"
                  }`}
                >
                  {whatsappFeedback.isSuccess ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span>{whatsappFeedback.message}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving || isLoading}
              className="py-3 px-8 rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-lg shadow-emerald-950 disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {isSaving ? "Salvando..." : "Salvar Configurações"}
            </button>
          </div>
        </form>

        {/* Painel de Validação e Teste do Acionamento AC */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                <Power className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Teste Direto do Inversor EcoFlow (ATS)</h3>
                <p className="text-xs text-slate-400">
                  Valide a comunicação com a API e verifique a comutação física da sua chave de transferência
                </p>
              </div>
            </div>
            {isTestingEcoFlow && (
              <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Testando...
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              disabled={isTestingEcoFlow || !ecoflowAccessKey || !ecoflowSerialNumber}
              onClick={() => handleTestControl("ECOFLOW_TELEMETRY")}
              className="py-3 px-4 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Activity className="w-4 h-4 text-cyan-400" />
              Testar Telemetria (SOC)
            </button>

            <button
              type="button"
              disabled={isTestingEcoFlow || !ecoflowAccessKey || !ecoflowSerialNumber}
              onClick={() => handleTestControl("ECOFLOW_ON")}
              className="py-3 px-4 rounded-xl font-semibold text-xs bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 border border-emerald-800/60 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Zap className="w-4 h-4 text-emerald-400" />
              Ligar Saída AC (ATS &rarr; Solar)
            </button>

            <button
              type="button"
              disabled={isTestingEcoFlow || !ecoflowAccessKey || !ecoflowSerialNumber}
              onClick={() => handleTestControl("ECOFLOW_OFF")}
              className="py-3 px-4 rounded-xl font-semibold text-xs bg-rose-950/60 hover:bg-rose-900/80 text-rose-200 border border-rose-800/60 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Power className="w-4 h-4 text-rose-400" />
              Desligar Saída AC (ATS &rarr; Rede)
            </button>
          </div>

          {testFeedback && (
            <div
              className={`p-4 rounded-xl border space-y-2 text-xs font-mono transition-all ${
                testFeedback.isSuccess
                  ? "bg-slate-950/90 border-emerald-500/40 text-emerald-300"
                  : "bg-slate-950/90 border-rose-500/40 text-rose-300"
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                {testFeedback.isSuccess ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                )}
                <span>{testFeedback.summary}</span>
              </div>
              <div className="text-slate-300 pl-6 border-l-2 border-slate-700/60 mt-2 space-y-1">
                <div>&bull; EcoFlow: {testFeedback.ecoflowMessage}</div>
                {testFeedback.batteryPercentage !== undefined && (
                  <div>&bull; Nível de Bateria: {testFeedback.batteryPercentage}%</div>
                )}
                {testFeedback.solarWatts !== undefined && (
                  <div>&bull; Potência Solar: {testFeedback.solarWatts}W</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
