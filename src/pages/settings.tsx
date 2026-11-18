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
  Eye,
  EyeOff,
  ShieldAlert,
  X,
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

  // Estados de visualização do olho (mostrar/ocultar segredos)
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [showWhatsappApiKey, setShowWhatsappApiKey] = useState(false);
  const [showEcoflowSecret, setShowEcoflowSecret] = useState(false);

  // Estados para o Modal de Confirmação com animação de entrada e saída
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean;
    actionTarget: "ECOFLOW_ON" | "ECOFLOW_OFF" | "ECOFLOW_TELEMETRY";
    actionTitle: string;
    expectedWord: string;
    warningText: string;
    confirmButtonColor: string;
  } | null>(null);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [isClosingModal, setIsClosingModal] = useState(false);

  const closeModal = () => {
    setIsClosingModal(true);
    setTimeout(() => {
      setConfirmationModal(null);
      setIsClosingModal(false);
      setConfirmationInput("");
    }, 180);
  };

  const requestConfirmation = (actionTarget: "ECOFLOW_ON" | "ECOFLOW_OFF" | "ECOFLOW_TELEMETRY") => {
    setConfirmationInput("");
    setIsClosingModal(false);
    if (actionTarget === "ECOFLOW_ON") {
      setConfirmationModal({
        isOpen: true,
        actionTarget: "ECOFLOW_ON",
        actionTitle: "Ligar Saída AC (ATS → Solar / Bateria)",
        expectedWord: "LIGAR",
        warningText:
          "Esta ação ativará a saída AC da sua estação EcoFlow. A Chave de Transferência Automática (ATS) comutará fisicamente o circuito da sua residência para a energia solar/bateria.",
        confirmButtonColor: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950",
      });
      return;
    }

    if (actionTarget === "ECOFLOW_OFF") {
      setConfirmationModal({
        isOpen: true,
        actionTarget: "ECOFLOW_OFF",
        actionTitle: "Desligar Saída AC (ATS → Concessionária / Rede)",
        expectedWord: "DESLIGAR",
        warningText:
          "Esta ação desligará a saída AC da sua estação EcoFlow. A Chave de Transferência Automática (ATS) comutará fisicamente o circuito da sua residência de volta para a rede da concessionária.",
        confirmButtonColor: "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950",
      });
      return;
    }

    setConfirmationModal({
      isOpen: true,
      actionTarget: "ECOFLOW_TELEMETRY",
      actionTitle: "Consultar Telemetria EcoFlow (SOC & Solar)",
      expectedWord: "TELEMETRIA",
      warningText:
        "Esta ação enviará uma requisição de leitura direta à API da EcoFlow para verificar bateria, potência solar e status operacional.",
      confirmButtonColor: "bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-950",
    });
  };

  const executeConfirmedAction = () => {
    if (!confirmationModal) return;
    const isMatch = confirmationInput.trim().toUpperCase() === confirmationModal.expectedWord;
    if (!isMatch) return;

    const target = confirmationModal.actionTarget;
    closeModal();
    handleTestControl(target);
  };

  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        const json = await response.json();
        if (json.success && json.data) {
          setEcoflowEndpointRegion(json.data.ecoflowEndpointRegion || "https://api.ecoflow.com");
          setEcoflowAccessKey(json.data.ecoflowAccessKey || "");
          setEcoflowAccessSecret(json.data.ecoflowAccessSecret || json.data.ecoflowAccessSecretMasked || "");
          setEcoflowSerialNumber(json.data.ecoflowSerialNumber || "");
          setTelegramBotToken(json.data.telegramBotToken || json.data.telegramBotTokenMasked || "");
          setTelegramChatId(json.data.telegramChatId || "");
          setWhatsappPhoneNumber(json.data.whatsappPhoneNumber || "");
          setWhatsappApiKey(json.data.whatsappApiKey || json.data.whatsappApiKeyMasked || "");
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
      <div className="space-y-8">
        {/* Banner Informativo sobre a Chave de Transferência Automática (ATS) */}
        <section
          aria-label="Sobre a automação EcoFlow e Chave ATS"
          className="animate-card stagger-1 interactive-card p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3 shadow-lg"
        >
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
            <ArrowLeftRight className="w-5 h-5 animate-float" aria-hidden="true" />
          </div>
          <div className="text-xs text-slate-300 space-y-1">
            <span className="font-semibold text-slate-100 text-sm block">
              Automação EcoFlow + Chave de Transferência Automática (ATS)
            </span>
            <p className="text-slate-400">
              O WattFlow comuta a saída AC da sua estação <strong>EcoFlow</strong>. Quando a saída AC é ativada, a chave ATS transfere as cargas para solar/bateria. Ao desligar a saída AC, a ATS transfere para a concessionária. As notificações informam instantaneamente sobre cada comutação via Telegram ou WhatsApp.
            </p>
          </div>
        </section>

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

        {/* Formulário Principal */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 1. EcoFlow Developer Open API */}
          <div className="animate-card stagger-2 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Cpu className="w-5 h-5" aria-hidden="true" />
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
                <label htmlFor="ecoflow-endpoint-select" className="text-xs font-semibold text-slate-300">
                  Região do Endpoint
                </label>
                <select
                  id="ecoflow-endpoint-select"
                  value={ecoflowEndpointRegion}
                  onChange={(e) => setEcoflowEndpointRegion(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                >
                  <option value="https://api.ecoflow.com">Global / Américas (api.ecoflow.com)</option>
                  <option value="https://api-e.ecoflow.com">Europa (api-e.ecoflow.com)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="ecoflow-access-key-input" className="text-xs font-semibold text-slate-300">
                  Access Key
                </label>
                <input
                  id="ecoflow-access-key-input"
                  type="text"
                  required
                  placeholder="Ex: ak_live_..."
                  value={ecoflowAccessKey}
                  onChange={(e) => setEcoflowAccessKey(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="ecoflow-secret-key-input" className="text-xs font-semibold text-slate-300">
                  Secret Key
                </label>
                <div className="relative">
                  <input
                    id="ecoflow-secret-key-input"
                    type={showEcoflowSecret ? "text" : "password"}
                    required
                    placeholder="Ex: sk_live_..."
                    value={ecoflowAccessSecret}
                    onChange={(e) => setEcoflowAccessSecret(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-11 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEcoflowSecret((prev) => !prev)}
                    title={showEcoflowSecret ? "Ocultar Secret Key" : "Visualizar Secret Key"}
                    aria-label={showEcoflowSecret ? "Ocultar Secret Key da EcoFlow" : "Visualizar Secret Key da EcoFlow"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-slate-900/80 transition-colors active:scale-90 cursor-pointer"
                  >
                    {showEcoflowSecret ? (
                      <EyeOff className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4 text-slate-400" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label htmlFor="ecoflow-sn-input" className="text-xs font-semibold text-slate-300">
                  Número de Série da Estação (SN)
                </label>
                <input
                  id="ecoflow-sn-input"
                  type="text"
                  required
                  placeholder="Ex: R331Z..."
                  value={ecoflowSerialNumber}
                  onChange={(e) => setEcoflowSerialNumber(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                />
                <span className="text-[11px] text-slate-400 block">
                  Compatível com River 2, River 2 Max/Pro, Delta 2, Delta 2 Max, Delta Pro.
                </span>
              </div>
            </div>
          </div>

          {/* 2. Notificações Telegram & WhatsApp (Separados) */}
          <div className="animate-card stagger-3 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                  <Bell className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">Notificações Instantâneas (Telegram &amp; WhatsApp)</h2>
                  <p className="text-xs text-slate-400">
                    Testes de envio independentes e alertas automáticos na comutação da chave ATS
                  </p>
                </div>
              </div>

              <label htmlFor="notifications-active-checkbox" className="flex items-center gap-2 cursor-pointer group">
                <span className="text-xs font-semibold text-slate-300 group-hover:text-cyan-300 transition-colors">
                  Notificações Ativas
                </span>
                <input
                  id="notifications-active-checkbox"
                  type="checkbox"
                  checked={isNotificationActive}
                  onChange={(e) => setIsNotificationActive(e.target.checked)}
                  className="w-5 h-5 accent-cyan-500 rounded cursor-pointer transition-transform active:scale-90"
                />
              </label>
            </div>

            {/* Subseção Telegram com Botão de Teste Próprio */}
            <div className="space-y-4 p-5 rounded-xl bg-slate-950 border border-sky-900/30 transition-all hover:border-sky-850">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4 text-sky-400" aria-hidden="true" />
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
                  <label htmlFor="telegram-token-input" className="text-xs font-semibold text-slate-300">
                    Telegram Bot Token
                  </label>
                  <div className="relative">
                    <input
                      id="telegram-token-input"
                      type={showTelegramToken ? "text" : "password"}
                      placeholder="Ex: 123456789:ABCdefGhIJKlmNoPQRstuVWxyz"
                      value={telegramBotToken}
                      onChange={(e) => setTelegramBotToken(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-4 pr-11 py-2.5 text-base sm:text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTelegramToken((prev) => !prev)}
                      title={showTelegramToken ? "Ocultar Bot Token" : "Visualizar Bot Token salvo"}
                      aria-label={showTelegramToken ? "Ocultar Bot Token do Telegram" : "Visualizar Bot Token do Telegram"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800/80 transition-colors active:scale-90 cursor-pointer"
                    >
                      {showTelegramToken ? (
                        <EyeOff className="w-4 h-4 text-sky-400" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4 text-slate-400" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="telegram-chat-id-input" className="text-xs font-semibold text-slate-300">
                    Chat ID do Telegram
                  </label>
                  <input
                    id="telegram-chat-id-input"
                    type="text"
                    placeholder="Ex: 987654321 ou -100123456"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono transition-colors"
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
                  aria-label="Testar envio de notificação no Telegram"
                  className="w-full sm:w-auto py-2 px-4 rounded-xl font-semibold text-xs bg-sky-950 hover:bg-sky-900/90 active:scale-95 text-sky-200 border border-sky-700/60 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isTestingTelegram ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" aria-hidden="true" />
                  ) : (
                    <Send className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                  )}
                  {isTestingTelegram ? "Enviando para Telegram..." : "Testar Envio Telegram"}
                </button>
              </div>

              {telegramFeedback && (
                <div
                  role="alert"
                  aria-live="polite"
                  className={`animate-alert p-3 rounded-xl border text-xs font-mono flex items-center gap-2 shadow-sm ${
                    telegramFeedback.isSuccess
                      ? "bg-slate-900 border-sky-500/40 text-sky-300"
                      : "bg-slate-900 border-rose-500/40 text-rose-300"
                  }`}
                >
                  {telegramFeedback.isSuccess ? (
                    <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                  )}
                  <span>{telegramFeedback.message}</span>
                </div>
              )}
            </div>

            {/* Subseção WhatsApp com Botão de Teste Próprio */}
            <div className="space-y-4 p-5 rounded-xl bg-slate-950 border border-emerald-900/30 transition-all hover:border-emerald-850">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-400" aria-hidden="true" />
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
                  <label htmlFor="whatsapp-number-input" className="text-xs font-semibold text-slate-300">
                    Número de WhatsApp (DDI + DDD)
                  </label>
                  <input
                    id="whatsapp-number-input"
                    type="text"
                    placeholder="Ex: +5511999999999"
                    value={whatsappPhoneNumber}
                    onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="whatsapp-api-key-input" className="text-xs font-semibold text-slate-300">
                    API Key CallMeBot
                  </label>
                  <div className="relative">
                    <input
                      id="whatsapp-api-key-input"
                      type={showWhatsappApiKey ? "text" : "password"}
                      placeholder="Ex: 1234567"
                      value={whatsappApiKey}
                      onChange={(e) => setWhatsappApiKey(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-4 pr-11 py-2.5 text-base sm:text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowWhatsappApiKey((prev) => !prev)}
                      title={showWhatsappApiKey ? "Ocultar API Key" : "Visualizar API Key salva"}
                      aria-label={showWhatsappApiKey ? "Ocultar API Key do CallMeBot" : "Visualizar API Key do CallMeBot"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-slate-800/80 transition-colors active:scale-90 cursor-pointer"
                    >
                      {showWhatsappApiKey ? (
                        <EyeOff className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4 text-slate-400" aria-hidden="true" />
                      )}
                    </button>
                  </div>
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
                  aria-label="Testar envio de notificação no WhatsApp"
                  className="w-full sm:w-auto py-2 px-4 rounded-xl font-semibold text-xs bg-emerald-950 hover:bg-emerald-900/90 active:scale-95 text-emerald-200 border border-emerald-700/60 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isTestingWhatsApp ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" aria-hidden="true" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  )}
                  {isTestingWhatsApp ? "Enviando para WhatsApp..." : "Testar Envio WhatsApp"}
                </button>
              </div>

              {whatsappFeedback && (
                <div
                  role="alert"
                  aria-live="polite"
                  className={`animate-alert p-3 rounded-xl border text-xs font-mono flex items-center gap-2 shadow-sm ${
                    whatsappFeedback.isSuccess
                      ? "bg-slate-900 border-emerald-500/40 text-emerald-300"
                      : "bg-slate-900 border-rose-500/40 text-rose-300"
                  }`}
                >
                  {whatsappFeedback.isSuccess ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
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
              className="py-3 px-8 rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all duration-150 shadow-lg shadow-emerald-950 disabled:opacity-50 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
              {isSaving ? "Salvando..." : "Salvar Configurações"}
            </button>
          </div>
        </form>

        {/* Painel de Validação e Teste do Acionamento AC */}
        <section
          aria-label="Painel de Testes e Validação Direta"
          className="animate-card stagger-4 interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                <Power className="w-5 h-5" aria-hidden="true" />
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
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                Testando...
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              disabled={isTestingEcoFlow || !ecoflowAccessKey || !ecoflowSerialNumber}
              onClick={() => requestConfirmation("ECOFLOW_TELEMETRY")}
              aria-label="Solicitar teste de leitura de telemetria da EcoFlow"
              className="py-3 px-4 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <Activity className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              Testar Telemetria (SOC)
            </button>

            <button
              type="button"
              disabled={isTestingEcoFlow || !ecoflowAccessKey || !ecoflowSerialNumber}
              onClick={() => requestConfirmation("ECOFLOW_ON")}
              aria-label="Solicitar teste para ligar saída AC e comutar ATS para bateria"
              className="py-3 px-4 rounded-xl font-semibold text-xs bg-emerald-950/60 hover:bg-emerald-900/80 active:scale-95 text-emerald-200 border border-emerald-800/60 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <Zap className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              Ligar Saída AC (ATS &rarr; Solar)
            </button>

            <button
              type="button"
              disabled={isTestingEcoFlow || !ecoflowAccessKey || !ecoflowSerialNumber}
              onClick={() => requestConfirmation("ECOFLOW_OFF")}
              aria-label="Solicitar teste para desligar saída AC e comutar ATS para rede"
              className="py-3 px-4 rounded-xl font-semibold text-xs bg-rose-950/60 hover:bg-rose-900/80 active:scale-95 text-rose-200 border border-rose-800/60 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <Power className="w-4 h-4 text-rose-400" aria-hidden="true" />
              Desligar Saída AC (ATS &rarr; Rede)
            </button>
          </div>

          {testFeedback && (
            <div
              role="alert"
              aria-live="polite"
              className={`animate-alert p-4 rounded-xl border space-y-2 text-xs font-mono transition-all duration-200 ${
                testFeedback.isSuccess
                  ? "bg-slate-950/90 border-emerald-500/40 text-emerald-300 shadow-md shadow-emerald-950/20"
                  : "bg-slate-950/90 border-rose-500/40 text-rose-300 shadow-md shadow-rose-950/20"
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                {testFeedback.isSuccess ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                )}
                <span>{testFeedback.summary}</span>
              </div>
              <div className="text-slate-300 pl-6 border-l-2 border-slate-700/60 mt-2 space-y-1">
                <div>• EcoFlow: {testFeedback.ecoflowMessage}</div>
                {testFeedback.batteryPercentage !== undefined && (
                  <div>• Nível de Bateria: {testFeedback.batteryPercentage}%</div>
                )}
                {testFeedback.solarWatts !== undefined && (
                  <div>• Potência Solar: {testFeedback.solarWatts}W</div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Modal de Confirmação Explícita com Digitação Obrigatória e Animações Fluídas de Entrada/Saída */}
      {confirmationModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="security-modal-title"
          aria-describedby="security-modal-desc"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
          className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm ${
            isClosingModal ? "animate-backdrop-out" : "animate-backdrop-in"
          }`}
        >
          <div
            className={`w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-2xl shadow-black/90 space-y-5 ${
              isClosingModal ? "animate-modal-out" : "animate-modal-in"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
                  <ShieldAlert className="w-6 h-6 animate-pulse" aria-hidden="true" />
                </div>
                <div>
                  <h3 id="security-modal-title" className="text-base font-bold text-slate-100">
                    Confirmação de Segurança
                  </h3>
                  <p className="text-xs text-amber-400/90 font-medium">{confirmationModal.actionTitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Fechar janela de confirmação"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all active:scale-90 cursor-pointer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div
              id="security-modal-desc"
              className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-slate-300 leading-relaxed"
            >
              <p>{confirmationModal.warningText}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="modal-confirmation-input" className="text-xs text-slate-300 block">
                Para autorizar esta operação, digite exatamente{" "}
                <span className="font-mono font-bold text-amber-300 px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/40">
                  {confirmationModal.expectedWord}
                </span>{" "}
                abaixo:
              </label>
              <input
                id="modal-confirmation-input"
                type="text"
                autoFocus
                placeholder={`Digite ${confirmationModal.expectedWord}`}
                value={confirmationInput}
                onChange={(e) => setConfirmationInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && confirmationInput.trim().toUpperCase() === confirmationModal.expectedWord) {
                    e.preventDefault();
                    executeConfirmedAction();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeModal();
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400 font-mono tracking-wider text-center uppercase transition-colors"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={confirmationInput.trim().toUpperCase() !== confirmationModal.expectedWord}
                onClick={executeConfirmedAction}
                aria-label={`Confirmar e executar ${confirmationModal.actionTitle}`}
                className={`px-5 py-2.5 rounded-xl text-xs font-semibold active:scale-95 transition-all shadow-md flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer ${confirmationModal.confirmButtonColor}`}
              >
                <Zap className="w-4 h-4" aria-hidden="true" />
                Confirmar e Executar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
