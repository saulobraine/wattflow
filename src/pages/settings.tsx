import React, { useEffect, useState, FormEvent } from "react";
import { Layout } from "../components/Layout";
import { toast } from "../hooks/use-toast";
import {
  KeyRound,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Zap,
  Loader2,
  Bell,
  MessageSquare,
  Send,
  DollarSign,
  Clock,
  TrendingUp,
  Wallet,
  Search,
  Radio,
  FileText,
  AlertTriangle,
  BellRing,
} from "lucide-react";

export default function SettingsPage() {
  // Credenciais EcoFlow Open API
  const [ecoflowEndpointRegion, setEcoflowEndpointRegion] = useState("https://api.ecoflow.com");
  const [ecoflowAccessKey, setEcoflowAccessKey] = useState("");
  const [ecoflowAccessSecret, setEcoflowAccessSecret] = useState("");
  const [ecoflowSerialNumber, setEcoflowSerialNumber] = useState("");

  interface DiscoveredDeviceItem {
    sn: string;
    deviceName: string;
    productName: string;
    online: number;
  }

  const [isDiscoveringDevices, setIsDiscoveringDevices] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDeviceItem[]>([]);
  const [activeDetectedBadge, setActiveDetectedBadge] = useState<{
    productName: string;
    online: number;
  } | null>(null);
  const [discoveryMessage, setDiscoveryMessage] = useState<{
    isSuccess: boolean;
    text: string;
  } | null>(null);

  // Canais de Notificação
  const [isNotificationActive, setIsNotificationActive] = useState(true);
  const [isWebPushActive, setIsWebPushActive] = useState(true);
  const [isPushSupported, setIsPushSupported] = useState(true);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isSubscribingPush, setIsSubscribingPush] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{
    isSuccess: boolean;
    message: string;
  } | null>(null);

  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState("");
  const [whatsappApiKey, setWhatsappApiKey] = useState("");

  // Relatório Executivo Noturno
  const [isDailyReportActive, setIsDailyReportActive] = useState<boolean>(true);
  const [dailyReportTime, setDailyReportTime] = useState<string>("21:00");

  // Alertas Críticos Multi-Canal
  const [isAlertOnBlackout, setIsAlertOnBlackout] = useState<boolean>(true);
  const [isAlertOnGridRestore, setIsAlertOnGridRestore] = useState<boolean>(true);
  const [isAlertOnOverload, setIsAlertOnOverload] = useState<boolean>(true);
  const [isAlertOnThermalRisk, setIsAlertOnThermalRisk] = useState<boolean>(true);
  const [isAlertOnAtsFailure, setIsAlertOnAtsFailure] = useState<boolean>(true);
  const [alertCooldownMinutes, setAlertCooldownMinutes] = useState<number>(10);

  // Parâmetros Econômicos & Tarifa
  const [energyCostPerKwh, setEnergyCostPerKwh] = useState<number>(0.92);
  const [currencySymbol, setCurrencySymbol] = useState<string>("R$");
  const [peakTariffPerKwh, setPeakTariffPerKwh] = useState<number>(1.85);
  const [intermediateTariffPerKwh, setIntermediateTariffPerKwh] = useState<number>(1.15);
  const [offPeakTariffPerKwh, setOffPeakTariffPerKwh] = useState<number>(0.65);

  // Retorno sobre Investimento (Payback Solar & CAPEX)
  const [totalCapexBrl, setTotalCapexBrl] = useState<number>(0.0);
  const [installationDate, setInstallationDate] = useState<string>("");
  const [annualEnergyInflationRate, setAnnualEnergyInflationRate] = useState<number>(6.5);
  const [targetPaybackYears, setTargetPaybackYears] = useState<number>(3.0);
  const [capexNotes, setCapexNotes] = useState<string>("");

  // Estados de controle e feedback
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Testes de canais
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

  // Segredos mascarados
  const [hasEcoflowAccessSecret, setHasEcoflowAccessSecret] = useState(false);
  const [ecoflowAccessSecretMasked, setEcoflowAccessSecretMasked] = useState("");
  const [hasTelegramBotToken, setHasTelegramBotToken] = useState(false);
  const [telegramBotTokenMasked, setTelegramBotTokenMasked] = useState("");
  const [hasWhatsappApiKey, setHasWhatsappApiKey] = useState(false);
  const [whatsappApiKeyMasked, setWhatsappApiKeyMasked] = useState("");

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/settings");
      const json = await response.json();
      if (!response.ok || !json.success) {
        setFeedback({
          type: "error",
          message: json.message || "Erro ao carregar configurações do servidor.",
        });
        return;
      }
      if (json.data) {
        setEcoflowEndpointRegion(json.data.ecoflowEndpointRegion || "https://api.ecoflow.com");
        setEcoflowAccessKey(json.data.ecoflowAccessKey || "");
        setHasEcoflowAccessSecret(Boolean(json.data.hasEcoflowAccessSecret));
        setEcoflowAccessSecretMasked(json.data.ecoflowAccessSecretMasked || "");
        setEcoflowAccessSecret("");
        setEcoflowSerialNumber(json.data.ecoflowSerialNumber || "");

        setHasTelegramBotToken(Boolean(json.data.hasTelegramBotToken));
        setTelegramBotTokenMasked(json.data.telegramBotTokenMasked || "");
        setTelegramBotToken("");
        setTelegramChatId(json.data.telegramChatId || "");

        setWhatsappPhoneNumber(json.data.whatsappPhoneNumber || "");
        setHasWhatsappApiKey(Boolean(json.data.hasWhatsappApiKey));
        setWhatsappApiKeyMasked(json.data.whatsappApiKeyMasked || "");
        setWhatsappApiKey("");

        setIsNotificationActive(json.data.isNotificationActive ?? true);
        setIsWebPushActive(json.data.isWebPushActive ?? true);
        setIsDailyReportActive(json.data.isDailyReportActive ?? true);
        setDailyReportTime(json.data.dailyReportTime || "21:00");

        setIsAlertOnBlackout(json.data.isAlertOnBlackout ?? true);
        setIsAlertOnGridRestore(json.data.isAlertOnGridRestore ?? true);
        setIsAlertOnOverload(json.data.isAlertOnOverload ?? true);
        setIsAlertOnThermalRisk(json.data.isAlertOnThermalRisk ?? true);
        setIsAlertOnAtsFailure(json.data.isAlertOnAtsFailure ?? true);
        setAlertCooldownMinutes(
          typeof json.data.alertCooldownMinutes === "number" ? json.data.alertCooldownMinutes : 10
        );

        setEnergyCostPerKwh(
          typeof json.data.energyCostPerKwh === "number" ? json.data.energyCostPerKwh : 0.92
        );
        setCurrencySymbol(json.data.currencySymbol || "R$");
        setPeakTariffPerKwh(
          typeof json.data.peakTariffPerKwh === "number" ? json.data.peakTariffPerKwh : 1.85
        );
        setIntermediateTariffPerKwh(
          typeof json.data.intermediateTariffPerKwh === "number" ? json.data.intermediateTariffPerKwh : 1.15
        );
        setOffPeakTariffPerKwh(
          typeof json.data.offPeakTariffPerKwh === "number" ? json.data.offPeakTariffPerKwh : 0.65
        );

        setTotalCapexBrl(
          typeof json.data.totalCapexBrl === "number" ? json.data.totalCapexBrl : 0.0
        );
        setInstallationDate(
          json.data.installationDate ? json.data.installationDate.split("T")[0] : ""
        );
        setAnnualEnergyInflationRate(
          typeof json.data.annualEnergyInflationRate === "number"
            ? json.data.annualEnergyInflationRate
            : 6.5
        );
        setTargetPaybackYears(
          typeof json.data.targetPaybackYears === "number" ? json.data.targetPaybackYears : 3.0
        );
        setCapexNotes(json.data.capexNotes || "");
      }
    } catch (err) {
      console.error("Erro ao carregar configurações:", err);
      setFeedback({
        type: "error",
        message: "Falha de comunicação ao carregar as configurações salvas.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    if (typeof window !== "undefined") {
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      setIsPushSupported(supported);
      if (supported) {
        setPushPermission(Notification.permission);
      } else {
        setPushPermission("unsupported");
      }
    }
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
          isWebPushActive,
          isDailyReportActive,
          dailyReportTime,
          isAlertOnBlackout,
          isAlertOnGridRestore,
          isAlertOnOverload,
          isAlertOnThermalRisk,
          isAlertOnAtsFailure,
          alertCooldownMinutes: Number(alertCooldownMinutes),
          energyCostPerKwh: Number(energyCostPerKwh),
          currencySymbol,
          peakTariffPerKwh: Number(peakTariffPerKwh),
          intermediateTariffPerKwh: Number(intermediateTariffPerKwh),
          offPeakTariffPerKwh: Number(offPeakTariffPerKwh),
          totalCapexBrl: Number(totalCapexBrl),
          installationDate: installationDate || undefined,
          annualEnergyInflationRate: Number(annualEnergyInflationRate),
          targetPaybackYears: Number(targetPaybackYears),
          capexNotes: capexNotes || undefined,
        }),
      });

      const json = await response.json();
      if (json.success) {
        const message = "Configurações e credenciais salvas com sucesso!";
        setFeedback({ type: "success", message });
        toast({ title: "Configurações salvas", description: message, variant: "success" });
        await loadSettings();
      } else {
        const message = json.message || "Erro ao salvar credenciais.";
        setFeedback({ type: "error", message });
        toast({ title: "Erro ao salvar", description: message, variant: "destructive" });
      }
    } catch {
      const message = "Falha na comunicação com o servidor.";
      setFeedback({ type: "error", message });
      toast({ title: "Erro de comunicação", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscoverDevices = async () => {
    setIsDiscoveringDevices(true);
    setDiscoveryMessage(null);
    try {
      const response = await fetch("/api/ecoflow/discover-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointRegion: ecoflowEndpointRegion,
          accessKey: ecoflowAccessKey,
          accessSecret: ecoflowAccessSecret,
        }),
      });
      const json = await response.json();
      if (json.success && json.data) {
        const devices: DiscoveredDeviceItem[] = json.data.devices || [];
        setDiscoveredDevices(devices);
        if (devices.length > 0) {
          const first = devices[0];
          setEcoflowSerialNumber(first.sn);
          setActiveDetectedBadge({
            productName: first.productName || first.deviceName || "Estação EcoFlow",
            online: first.online,
          });
          const text = `Sucesso! Localizado(s) ${devices.length} dispositivo(s). Selecionado: ${first.deviceName || first.productName} (${first.sn}).`;
          setDiscoveryMessage({ isSuccess: true, text });
          toast({ title: "Dispositivo Localizado", description: text, variant: "success" });
        } else {
          setDiscoveryMessage({
            isSuccess: false,
            text: "Nenhum dispositivo encontrado vinculado a esta conta EcoFlow Developer.",
          });
        }
      } else {
        setDiscoveryMessage({
          isSuccess: false,
          text: json.message || "Falha na descoberta de dispositivos. Verifique suas chaves Open API.",
        });
      }
    } catch {
      setDiscoveryMessage({
        isSuccess: false,
        text: "Erro de rede ao consultar dispositivos EcoFlow.",
      });
    } finally {
      setIsDiscoveringDevices(false);
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
      const message = json.message || "Resposta do teste Telegram recebida.";
      setTelegramFeedback({ isSuccess: json.success, message });
      toast({
        title: json.success ? "Teste Telegram enviado" : "Falha no teste Telegram",
        description: message,
        variant: json.success ? "success" : "destructive",
      });
    } catch {
      const message = "Erro de rede ao disparar teste para o Telegram.";
      setTelegramFeedback({ isSuccess: false, message });
      toast({ title: "Erro de rede", description: message, variant: "destructive" });
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
      const message = json.message || "Resposta do teste WhatsApp recebida.";
      setWhatsappFeedback({ isSuccess: json.success, message });
      toast({
        title: json.success ? "Teste WhatsApp enviado" : "Falha no teste WhatsApp",
        description: message,
        variant: json.success ? "success" : "destructive",
      });
    } catch {
      const message = "Erro de rede ao disparar teste para o WhatsApp.";
      setWhatsappFeedback({ isSuccess: false, message });
      toast({ title: "Erro de rede", description: message, variant: "destructive" });
    } finally {
      setIsTestingWhatsApp(false);
    }
  };

  const handleSubscribePush = async () => {
    if (!isPushSupported || typeof window === "undefined") {
      toast({
        title: "Não suportado",
        description: "Seu navegador não suporta notificações Web Push nativas.",
        variant: "destructive",
      });
      return;
    }
    setIsSubscribingPush(true);
    setPushFeedback(null);
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== "granted") {
        const msg =
          permission === "denied"
            ? "Permissão bloqueada no navegador. Habilite notificações nas configurações do site."
            : "Permissão de notificações não concedida.";
        setPushFeedback({ isSuccess: false, message: msg });
        toast({ title: "Push não concedido", description: msg, variant: "destructive" });
        return;
      }

      const keyResponse = await fetch("/api/push/public-key");
      const keyContentType = keyResponse.headers.get("content-type") || "";
      let keyJson: any = null;
      if (keyContentType.includes("application/json")) {
        keyJson = await keyResponse.json();
      } else {
        const errText = await keyResponse.text();
        throw new Error(`Resposta inesperada do servidor (${keyResponse.status}): ${errText.slice(0, 80)}`);
      }

      if (!keyResponse.ok || !keyJson?.publicKey) {
        throw new Error(keyJson?.message || "Chave pública VAPID não configurada.");
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        const padding = "=".repeat((4 - (keyJson.publicKey.length % 4)) % 4);
        const base64 = (keyJson.publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          outputArray[i] = rawData.charCodeAt(i);
        }
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: outputArray,
        });
      }

      const saveResponse = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(subscription),
      });

      const saveContentType = saveResponse.headers.get("content-type") || "";
      let saveJson: any = null;
      if (saveContentType.includes("application/json")) {
        saveJson = await saveResponse.json();
      } else {
        const errText = await saveResponse.text();
        throw new Error(`Falha na comunicação com o servidor (${saveResponse.status}): ${errText.slice(0, 80)}`);
      }

      if (saveResponse.ok && saveJson?.success) {
        setPushFeedback({
          isSuccess: true,
          message: "Notificações Web Push ativadas com sucesso neste dispositivo!",
        });
        toast({
          title: "Web Push Conectado",
          description: "Alertas de comutação ATS ativos no navegador.",
          variant: "success",
        });
      } else {
        throw new Error(saveJson?.message || "Erro ao salvar inscrição no servidor.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao assinar Web Push.";
      setPushFeedback({ isSuccess: false, message: msg });
      toast({ title: "Falha no Web Push", description: msg, variant: "destructive" });
    } finally {
      setIsSubscribingPush(false);
    }
  };

  const handleTestPush = async () => {
    setIsTestingPush(true);
    setPushFeedback(null);
    try {
      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          title: "WattFlow - Teste de Notificação",
          message: "Notificação de teste recebida com sucesso! O canal Web Push está ativo.",
        }),
      });

      const contentType = response.headers.get("content-type") || "";
      let json: any = null;
      if (contentType.includes("application/json")) {
        json = await response.json();
      } else {
        const errText = await response.text();
        throw new Error(`Servidor retornou resposta inesperada (${response.status}): ${errText.slice(0, 80)}`);
      }

      if (response.ok && json?.success) {
        setPushFeedback({ isSuccess: true, message: json?.message || "Notificação de teste disparada com sucesso!" });
        toast({
          title: "Push Enviado",
          description: "Verifique se o alerta chegou na central de notificações.",
          variant: "success",
        });
      } else {
        throw new Error(json?.message || "Erro ao disparar notificação.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao testar push.";
      setPushFeedback({ isSuccess: false, message: msg });
      toast({ title: "Erro no Push", description: msg, variant: "destructive" });
    } finally {
      setIsTestingPush(false);
    }
  };

  return (
    <Layout title="Configurações do Sistema">
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

        {/* Banner Informativo */}
        <section
          aria-label="Sobre as configurações do sistema"
          className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3 shadow-lg"
        >
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-xs text-slate-300 space-y-1">
            <span className="font-semibold text-slate-100 text-sm block">
              Credenciais, Mensageria &amp; Parâmetros Econômicos
            </span>
            <p className="text-slate-400">
              Configure as chaves da EcoFlow Open API, os canais de alerta imediato (Telegram, WhatsApp e Web Push) e as tarifas de energia para cálculo do balanço financeiro e retorno do investimento (CAPEX).
            </p>
          </div>
        </section>

        <form onSubmit={handleSubmit} noValidate className="space-y-4 md:space-y-6">
          {/* ============================================================ */}
          {/* 1. EcoFlow Developer Open API */}
          {/* ============================================================ */}
          <div className="p-3 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <KeyRound className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">1. EcoFlow Developer Open API</h2>
                  <p className="text-xs text-slate-400">
                    Credenciais de acesso para leitura de telemetria e comutação física via MQTT/REST
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDiscoverDevices}
                disabled={isDiscoveringDevices || !ecoflowAccessKey}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 self-start sm:self-auto"
              >
                {isDiscoveringDevices ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                {isDiscoveringDevices ? "Buscando..." : "Buscar Dispositivos na Conta"}
              </button>
            </div>

            {discoveryMessage && (
              <div
                className={`p-3 rounded-xl border text-xs font-mono ${
                  discoveryMessage.isSuccess
                    ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                    : "bg-rose-950/40 border-rose-500/40 text-rose-300"
                }`}
              >
                {discoveryMessage.text}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="ecoflow-region-select" className="text-xs font-semibold text-slate-300 block">
                  Região do Endpoint da API
                </label>
                <select
                  id="ecoflow-region-select"
                  value={ecoflowEndpointRegion}
                  onChange={(e) => setEcoflowEndpointRegion(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="https://api.ecoflow.com">Global / Brasil (api.ecoflow.com)</option>
                  <option value="https://api-e.ecoflow.com">Europa (api-e.ecoflow.com)</option>
                  <option value="https://api-a.ecoflow.com">América do Norte (api-a.ecoflow.com)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="ecoflow-sn-input" className="text-xs font-semibold text-slate-300 block">
                  Número de Série da Estação (SN)
                </label>
                <input
                  id="ecoflow-sn-input"
                  type="text"
                  placeholder="Ex: R331ZEB..."
                  value={ecoflowSerialNumber}
                  onChange={(e) => setEcoflowSerialNumber(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono uppercase"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="ecoflow-ak-input" className="text-xs font-semibold text-slate-300 block">
                  Access Key (Chave de Acesso)
                </label>
                <input
                  id="ecoflow-ak-input"
                  type="text"
                  placeholder="AK..."
                  value={ecoflowAccessKey}
                  onChange={(e) => setEcoflowAccessKey(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="ecoflow-sk-input" className="text-xs font-semibold text-slate-300 block">
                    Access Secret (Chave Secreta)
                  </label>
                  {hasEcoflowAccessSecret && (
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                      Cifrado (AES-256)
                    </span>
                  )}
                </div>
                <input
                  id="ecoflow-sk-input"
                  type="password"
                  placeholder={hasEcoflowAccessSecret ? ecoflowAccessSecretMasked || "••••••••••••••••" : "SK..."}
                  value={ecoflowAccessSecret}
                  onChange={(e) => setEcoflowAccessSecret(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* 2. Canais de Notificação (Web Push, Telegram, WhatsApp) */}
          {/* ============================================================ */}
          <div className="p-3 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Bell className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">2. Canais de Notificação</h2>
                  <p className="text-xs text-slate-400">
                    Alertas instantâneos de comutação ATS, riscos térmicos e blecautes
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer self-start sm:self-auto">
                <span className="text-xs font-semibold text-slate-300">
                  {isNotificationActive ? "Notificações Ativas" : "Notificações Desativadas"}
                </span>
                <input
                  type="checkbox"
                  checked={isNotificationActive}
                  onChange={(e) => setIsNotificationActive(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-500 bg-slate-950 border-slate-700"
                />
              </label>
            </div>

            {/* Web Push */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Notificações Web Push (PWA / Navegador)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSubscribePush}
                    disabled={isSubscribingPush}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isSubscribingPush ? "Ativando..." : "Ativar neste Navegador"}
                  </button>
                  <button
                    type="button"
                    onClick={handleTestPush}
                    disabled={isTestingPush}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isTestingPush ? "Disparando..." : "Testar Push"}
                  </button>
                </div>
              </div>
              {pushFeedback && (
                <div
                  className={`p-2.5 rounded-lg text-xs font-mono ${
                    pushFeedback.isSuccess
                      ? "bg-emerald-950/40 text-emerald-300 border border-emerald-500/30"
                      : "bg-rose-950/40 text-rose-300 border border-rose-500/30"
                  }`}
                >
                  {pushFeedback.message}
                </div>
              )}
            </div>

            {/* Telegram & WhatsApp */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Telegram */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5 text-sky-400" />
                    Telegram Bot
                  </span>
                  <button
                    type="button"
                    onClick={handleTestTelegram}
                    disabled={isTestingTelegram}
                    className="px-2.5 py-1 rounded text-xs font-semibold bg-sky-950 text-sky-300 border border-sky-800 hover:bg-sky-900 cursor-pointer disabled:opacity-50"
                  >
                    {isTestingTelegram ? "Enviando..." : "Testar"}
                  </button>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Bot Token</label>
                    <input
                      type="password"
                      placeholder={hasTelegramBotToken ? telegramBotTokenMasked || "••••••••" : "123456:ABC-DEF..."}
                      value={telegramBotToken}
                      onChange={(e) => setTelegramBotToken(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Chat ID</label>
                    <input
                      type="text"
                      placeholder="Ex: -100123456789"
                      value={telegramChatId}
                      onChange={(e) => setTelegramChatId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono"
                    />
                  </div>
                </div>
                {telegramFeedback && (
                  <span className="text-[11px] font-mono text-sky-300 block">
                    {telegramFeedback.message}
                  </span>
                )}
              </div>

              {/* WhatsApp */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                    WhatsApp (CallMeBot)
                  </span>
                  <button
                    type="button"
                    onClick={handleTestWhatsApp}
                    disabled={isTestingWhatsApp}
                    className="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900 cursor-pointer disabled:opacity-50"
                  >
                    {isTestingWhatsApp ? "Enviando..." : "Testar"}
                  </button>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Número de Telefone</label>
                    <input
                      type="text"
                      placeholder="+5511999999999"
                      value={whatsappPhoneNumber}
                      onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">API Key CallMeBot</label>
                    <input
                      type="password"
                      placeholder={hasWhatsappApiKey ? whatsappApiKeyMasked || "••••••••" : "Chave da API"}
                      value={whatsappApiKey}
                      onChange={(e) => setWhatsappApiKey(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono"
                    />
                  </div>
                </div>
                {whatsappFeedback && (
                  <span className="text-[11px] font-mono text-emerald-300 block">
                    {whatsappFeedback.message}
                  </span>
                )}
              </div>
            </div>

            {/* Relatório Executivo Noturno */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Relatório Executivo Noturno (WhatsApp)
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-slate-400">Ativar Relatório Diário</span>
                  <input
                    type="checkbox"
                    checked={isDailyReportActive}
                    onChange={(e) => setIsDailyReportActive(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700"
                  />
                </label>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <label className="text-slate-400">Horário de Disparo:</label>
                <input
                  type="time"
                  value={dailyReportTime}
                  onChange={(e) => setDailyReportTime(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1 text-slate-200 font-mono"
                />
              </div>
            </div>

            {/* Alertas Críticos em Tempo Real */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Gatilhos de Notificação Imediata
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={isAlertOnBlackout}
                    onChange={(e) => setIsAlertOnBlackout(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-500 bg-slate-950 border-slate-700"
                  />
                  <span className="text-slate-300">Queda de Rede / Blecaute</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={isAlertOnGridRestore}
                    onChange={(e) => setIsAlertOnGridRestore(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-500 bg-slate-950 border-slate-700"
                  />
                  <span className="text-slate-300">Restauração da Rede</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={isAlertOnOverload}
                    onChange={(e) => setIsAlertOnOverload(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-500 bg-slate-950 border-slate-700"
                  />
                  <span className="text-slate-300">Sobrecarga de Saída AC</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={isAlertOnThermalRisk}
                    onChange={(e) => setIsAlertOnThermalRisk(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-500 bg-slate-950 border-slate-700"
                  />
                  <span className="text-slate-300">Risco Térmico BMS</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={isAlertOnAtsFailure}
                    onChange={(e) => setIsAlertOnAtsFailure(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-500 bg-slate-950 border-slate-700"
                  />
                  <span className="text-slate-300">Anomalia na Comutação ATS</span>
                </label>
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* 3. Parâmetros Econômicos, Tarifas & CAPEX */}
          {/* ============================================================ */}
          <div className="p-3 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <DollarSign className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-100">3. Parâmetros Econômicos &amp; CAPEX</h2>
                <p className="text-xs text-slate-400">
                  Custo do kWh, tarifas horárias da concessionária e cálculo de Retorno sobre Investimento (Payback)
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300 block">Tarifa Padrão / Fora Ponta ({currencySymbol}/kWh)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  value={energyCostPerKwh}
                  onChange={(e) => setEnergyCostPerKwh(parseFloat(e.target.value) || 0.92)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300 block">Tarifa no Horário de Ponta ({currencySymbol}/kWh)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  value={peakTariffPerKwh}
                  onChange={(e) => setPeakTariffPerKwh(parseFloat(e.target.value) || 1.85)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300 block">Símbolo da Moeda</label>
                <input
                  type="text"
                  value={currencySymbol}
                  onChange={(e) => setCurrencySymbol(e.target.value || "R$")}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 font-mono"
                />
              </div>
            </div>

            {/* Bloco de CAPEX e Payback */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider">
                  Investimento Total em Hardware (CAPEX)
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-400 block">Custo Total dos Equipamentos ({currencySymbol})</label>
                  <input
                    type="number"
                    step="50"
                    min="0"
                    value={totalCapexBrl}
                    onChange={(e) => setTotalCapexBrl(parseFloat(e.target.value) || 0)}
                    placeholder="Ex: 12500"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-400 block">Data de Instalação</label>
                  <input
                    type="date"
                    value={installationDate}
                    onChange={(e) => setInstallationDate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-400 block">Meta de Payback (Anos)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={targetPaybackYears}
                    onChange={(e) => setTargetPaybackYears(parseFloat(e.target.value) || 3.0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                <label className="text-slate-400 block">Notas dos Equipamentos Instalados</label>
                <input
                  type="text"
                  placeholder="Ex: EcoFlow DELTA 2 Max + Chave ATS Tomzn 63A + 2x Painéis 400W"
                  value={capexNotes}
                  onChange={(e) => setCapexNotes(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200"
                />
              </div>
            </div>
          </div>

          {/* Botão de Envio Principal */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-3 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-lg shadow-emerald-950"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {isSaving ? "Salvando Configurações..." : "Salvar Configurações"}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
