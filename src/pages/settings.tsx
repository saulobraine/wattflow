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
  ShieldAlert,
  X,
  DollarSign,
  BatteryCharging,
  Clock,
  FileText,
  CloudSun,
  Thermometer,
  MapPin,
  Flame,
  BellRing,
  AlertTriangle,
  SunMedium,
  Layers,
  Plus,
  Trash2,
  Laptop,
  Tv,
  Wifi,
  Lightbulb,
  Sliders,
  Refrigerator,
  AirVent,
} from "lucide-react";
import type { ApplianceItem } from "./api/appliances";

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

  // Estados de Saúde Operacional da ATS (Chave de Transferência Automática)
  const [atsLifespanCycles, setAtsLifespanCycles] = useState<number>(10000);
  const [atsCurrentCycles, setAtsCurrentCycles] = useState<number>(0);
  const [atsLastSwitchedAt, setAtsLastSwitchedAt] = useState<string | null>(null);

  // Estados da Suíte de Inteligência Operacional (Economia, Bateria e Relatórios)
  const [energyCostPerKwh, setEnergyCostPerKwh] = useState<number>(0.92);
  const [currencySymbol, setCurrencySymbol] = useState<string>("R$");
  const [batteryCapacityWh, setBatteryCapacityWh] = useState<number>(2048);
  const [isDailyReportActive, setIsDailyReportActive] = useState<boolean>(true);
  const [dailyReportTime, setDailyReportTime] = useState<string>("21:00");

  // Estados da Etapa 2: Previsão Solar, Histerese Adaptativa & Segurança Térmica BMS
  const [isAdaptiveHysteresisActive, setIsAdaptiveHysteresisActive] = useState<boolean>(false);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [minAdaptiveThreshold, setMinAdaptiveThreshold] = useState<number>(20);
  const [maxAdaptiveThreshold, setMaxAdaptiveThreshold] = useState<number>(50);
  const [isDetectingLocation, setIsDetectingLocation] = useState<boolean>(false);
  const [locationFeedback, setLocationFeedback] = useState<string | null>(null);

  const [thermalWarningThreshold, setThermalWarningThreshold] = useState<number>(45.0);
  const [thermalShutdownThreshold, setThermalShutdownThreshold] = useState<number>(50.0);

  // Estados da Etapa 3: Tarifas Dinâmicas (Tarifa Branca ANEEL) & Alertas Críticos Multi-Canal
  const [isDynamicTariffActive, setIsDynamicTariffActive] = useState<boolean>(false);
  const [peakTariffPerKwh, setPeakTariffPerKwh] = useState<number>(1.85);
  const [intermediateTariffPerKwh, setIntermediateTariffPerKwh] = useState<number>(1.15);
  const [offPeakTariffPerKwh, setOffPeakTariffPerKwh] = useState<number>(0.65);
  const [peakStartTime, setPeakStartTime] = useState<string>("17:30");
  const [peakEndTime, setPeakEndTime] = useState<string>("20:30");
  const [intermediateStartTime1, setIntermediateStartTime1] = useState<string>("16:30");
  const [intermediateEndTime1, setIntermediateEndTime1] = useState<string>("17:30");
  const [intermediateStartTime2, setIntermediateStartTime2] = useState<string>("20:30");
  const [intermediateEndTime2, setIntermediateEndTime2] = useState<string>("21:30");
  const [peakReserveThreshold, setPeakReserveThreshold] = useState<number>(15);

  const [inverterMaxWatts, setInverterMaxWatts] = useState<number>(2400);
  const [isAlertOnBlackout, setIsAlertOnBlackout] = useState<boolean>(true);
  const [isAlertOnGridRestore, setIsAlertOnGridRestore] = useState<boolean>(true);
  const [isAlertOnOverload, setIsAlertOnOverload] = useState<boolean>(true);
  const [isAlertOnThermalRisk, setIsAlertOnThermalRisk] = useState<boolean>(true);
  const [isAlertOnAtsFailure, setIsAlertOnAtsFailure] = useState<boolean>(true);
  const [alertCooldownMinutes, setAlertCooldownMinutes] = useState<number>(10);

  // Estados da Etapa 4: Solar Smart Charging (Recarga AC) & Gestão de Cargas
  const [isSmartChargingActive, setIsSmartChargingActive] = useState<boolean>(false);
  const [minAcChargingWatts, setMinAcChargingWatts] = useState<number>(200);
  const [maxAcChargingWatts, setMaxAcChargingWatts] = useState<number>(1200);
  const [currentAcChargingWatts, setCurrentAcChargingWatts] = useState<number>(400);
  const [chargeOnlyOffPeak, setChargeOnlyOffPeak] = useState<boolean>(true);
  const [cloudyPrechargeActive, setCloudyPrechargeActive] = useState<boolean>(true);
  const [lastSmartChargeAdjustAt, setLastSmartChargeAdjustAt] = useState<string | null>(null);

  // Estados de Gerenciamento de Aparelhos (CRUD /api/appliances)
  const [appliancesList, setAppliancesList] = useState<ApplianceItem[]>([]);
  const [isLoadingAppliances, setIsLoadingAppliances] = useState<boolean>(false);
  const [newApplianceName, setNewApplianceName] = useState<string>("");
  const [newApplianceCategory, setNewApplianceCategory] = useState<string>("ESSENTIAL");
  const [newApplianceWatts, setNewApplianceWatts] = useState<number>(100);
  const [newApplianceIcon, setNewApplianceIcon] = useState<string>("Zap");
  const [applianceActionFeedback, setApplianceActionFeedback] = useState<string | null>(null);
  const [isCreatingAppliance, setIsCreatingAppliance] = useState<boolean>(false);
  const [deletingApplianceId, setDeletingApplianceId] = useState<string | null>(null);

  const handleDetectLocation = () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setLocationFeedback("Geolocalização não é suportada por este navegador.");
      return;
    }
    setIsDetectingLocation(true);
    setLocationFeedback(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = parseFloat(position.coords.latitude.toFixed(4));
        const lon = parseFloat(position.coords.longitude.toFixed(4));
        setLatitude(lat);
        setLongitude(lon);
        setLocationFeedback(`Coordenadas obtidas: ${lat}, ${lon}`);
        setIsDetectingLocation(false);
      },
      (error) => {
        let msg = "Não foi possível obter a localização.";
        if (error.code === error.PERMISSION_DENIED) {
          msg = "Permissão de localização negada pelo navegador.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          msg = "Informação de localização indisponível.";
        } else if (error.code === error.TIMEOUT) {
          msg = "Tempo limite esgotado ao buscar localização.";
        }
        setLocationFeedback(msg);
        setIsDetectingLocation(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

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

  // Indicadores de segredos já configurados e versões mascaradas retornadas pelo GET
  const [hasEcoflowAccessSecret, setHasEcoflowAccessSecret] = useState(false);
  const [ecoflowAccessSecretMasked, setEcoflowAccessSecretMasked] = useState("");
  const [hasTelegramBotToken, setHasTelegramBotToken] = useState(false);
  const [telegramBotTokenMasked, setTelegramBotTokenMasked] = useState("");
  const [hasWhatsappApiKey, setHasWhatsappApiKey] = useState(false);
  const [whatsappApiKeyMasked, setWhatsappApiKeyMasked] = useState("");

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
        setAtsLifespanCycles(
          typeof json.data.atsLifespanCycles === "number" ? json.data.atsLifespanCycles : 10000
        );
        setAtsCurrentCycles(
          typeof json.data.atsCurrentCycles === "number" ? json.data.atsCurrentCycles : 0
        );
        setAtsLastSwitchedAt(json.data.atsLastSwitchedAt || null);
        setEnergyCostPerKwh(
          typeof json.data.energyCostPerKwh === "number" ? json.data.energyCostPerKwh : 0.92
        );
        setCurrencySymbol(json.data.currencySymbol || "R$");
        setBatteryCapacityWh(
          typeof json.data.batteryCapacityWh === "number" ? json.data.batteryCapacityWh : 2048
        );
        setIsDailyReportActive(json.data.isDailyReportActive ?? true);
        setDailyReportTime(json.data.dailyReportTime || "21:00");
        setIsAdaptiveHysteresisActive(Boolean(json.data.isAdaptiveHysteresisActive));
        setLatitude(typeof json.data.latitude === "number" ? json.data.latitude : null);
        setLongitude(typeof json.data.longitude === "number" ? json.data.longitude : null);
        setMinAdaptiveThreshold(
          typeof json.data.minAdaptiveThreshold === "number" ? json.data.minAdaptiveThreshold : 20
        );
        setMaxAdaptiveThreshold(
          typeof json.data.maxAdaptiveThreshold === "number" ? json.data.maxAdaptiveThreshold : 50
        );
        setThermalWarningThreshold(
          typeof json.data.thermalWarningThreshold === "number" ? json.data.thermalWarningThreshold : 45.0
        );
        setThermalShutdownThreshold(
          typeof json.data.thermalShutdownThreshold === "number" ? json.data.thermalShutdownThreshold : 50.0
        );
        setIsDynamicTariffActive(Boolean(json.data.isDynamicTariffActive));
        setPeakTariffPerKwh(
          typeof json.data.peakTariffPerKwh === "number" ? json.data.peakTariffPerKwh : 1.85
        );
        setIntermediateTariffPerKwh(
          typeof json.data.intermediateTariffPerKwh === "number" ? json.data.intermediateTariffPerKwh : 1.15
        );
        setOffPeakTariffPerKwh(
          typeof json.data.offPeakTariffPerKwh === "number" ? json.data.offPeakTariffPerKwh : 0.65
        );
        setPeakStartTime(json.data.peakStartTime || "17:30");
        setPeakEndTime(json.data.peakEndTime || "20:30");
        setIntermediateStartTime1(json.data.intermediateStartTime1 || "16:30");
        setIntermediateEndTime1(json.data.intermediateEndTime1 || "17:30");
        setIntermediateStartTime2(json.data.intermediateStartTime2 || "20:30");
        setIntermediateEndTime2(json.data.intermediateEndTime2 || "21:30");
        setPeakReserveThreshold(
          typeof json.data.peakReserveThreshold === "number" ? json.data.peakReserveThreshold : 15
        );
        setInverterMaxWatts(
          typeof json.data.inverterMaxWatts === "number" ? json.data.inverterMaxWatts : 2400
        );
        setIsAlertOnBlackout(json.data.isAlertOnBlackout ?? true);
        setIsAlertOnGridRestore(json.data.isAlertOnGridRestore ?? true);
        setIsAlertOnOverload(json.data.isAlertOnOverload ?? true);
        setIsAlertOnThermalRisk(json.data.isAlertOnThermalRisk ?? true);
        setIsAlertOnAtsFailure(json.data.isAlertOnAtsFailure ?? true);
        setAlertCooldownMinutes(
          typeof json.data.alertCooldownMinutes === "number" ? json.data.alertCooldownMinutes : 10
        );
        setIsSmartChargingActive(Boolean(json.data.isSmartChargingActive));
        setMinAcChargingWatts(
          typeof json.data.minAcChargingWatts === "number" ? json.data.minAcChargingWatts : 200
        );
        setMaxAcChargingWatts(
          typeof json.data.maxAcChargingWatts === "number" ? json.data.maxAcChargingWatts : 1200
        );
        setCurrentAcChargingWatts(
          typeof json.data.currentAcChargingWatts === "number" ? json.data.currentAcChargingWatts : 400
        );
        setChargeOnlyOffPeak(json.data.chargeOnlyOffPeak ?? true);
        setCloudyPrechargeActive(json.data.cloudyPrechargeActive ?? true);
        setLastSmartChargeAdjustAt(json.data.lastSmartChargeAdjustAt || null);
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

  const loadAppliances = async () => {
    setIsLoadingAppliances(true);
    try {
      const response = await fetch("/api/appliances");
      const json = await response.json();
      if (json.success && json.data) {
        setAppliancesList(json.data.appliances || []);
      }
    } catch (err) {
      console.error("Erro ao carregar aparelhos:", err);
    } finally {
      setIsLoadingAppliances(false);
    }
  };

  const handleCreateAppliance = async (e: FormEvent) => {
    e.preventDefault();
    if (!newApplianceName.trim() || newApplianceWatts <= 0) {
      setApplianceActionFeedback("Informe um nome e potência em Watts válidos.");
      return;
    }
    setIsCreatingAppliance(true);
    setApplianceActionFeedback(null);
    try {
      const response = await fetch("/api/appliances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newApplianceName.trim(),
          category: newApplianceCategory,
          averageWatts: Number(newApplianceWatts),
          icon: newApplianceIcon || "Zap",
          isActiveInSimulation: false,
        }),
      });
      const json = await response.json();
      if (json.success) {
        setNewApplianceName("");
        setNewApplianceWatts(100);
        setApplianceActionFeedback("Aparelho cadastrado com sucesso!");
        await loadAppliances();
      } else {
        setApplianceActionFeedback(json.message || "Erro ao cadastrar aparelho.");
      }
    } catch {
      setApplianceActionFeedback("Falha na comunicação com o servidor.");
    } finally {
      setIsCreatingAppliance(false);
    }
  };

  const handleDeleteAppliance = async (id: string) => {
    setDeletingApplianceId(id);
    setApplianceActionFeedback(null);
    try {
      const response = await fetch(`/api/appliances?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await response.json();
      if (json.success) {
        setAppliancesList((prev) => prev.filter((a) => a.id !== id));
        setApplianceActionFeedback("Aparelho excluído com sucesso.");
      } else {
        setApplianceActionFeedback(json.message || "Erro ao excluir aparelho.");
      }
    } catch {
      setApplianceActionFeedback("Falha ao comunicar com o servidor.");
    } finally {
      setDeletingApplianceId(null);
    }
  };

  useEffect(() => {
    loadSettings();
    loadAppliances();
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
          atsLifespanCycles: Number(atsLifespanCycles),
          atsCurrentCycles: Number(atsCurrentCycles),
          energyCostPerKwh: Number(energyCostPerKwh),
          currencySymbol,
          batteryCapacityWh: Number(batteryCapacityWh),
          isDailyReportActive,
          dailyReportTime,
          latitude: latitude !== null ? Number(latitude) : null,
          longitude: longitude !== null ? Number(longitude) : null,
          isAdaptiveHysteresisActive,
          minAdaptiveThreshold: Number(minAdaptiveThreshold),
          maxAdaptiveThreshold: Number(maxAdaptiveThreshold),
          thermalWarningThreshold: Number(thermalWarningThreshold),
          thermalShutdownThreshold: Number(thermalShutdownThreshold),
          isDynamicTariffActive,
          peakTariffPerKwh: Number(peakTariffPerKwh),
          intermediateTariffPerKwh: Number(intermediateTariffPerKwh),
          offPeakTariffPerKwh: Number(offPeakTariffPerKwh),
          peakStartTime,
          peakEndTime,
          intermediateStartTime1,
          intermediateEndTime1,
          intermediateStartTime2,
          intermediateEndTime2,
          peakReserveThreshold: Number(peakReserveThreshold),
          inverterMaxWatts: Number(inverterMaxWatts),
          isAlertOnBlackout,
          isAlertOnGridRestore,
          isAlertOnOverload,
          isAlertOnThermalRisk,
          isAlertOnAtsFailure,
          alertCooldownMinutes: Number(alertCooldownMinutes),
          isSmartChargingActive,
          minAcChargingWatts: Number(minAcChargingWatts),
          maxAcChargingWatts: Number(maxAcChargingWatts),
          chargeOnlyOffPeak,
          cloudyPrechargeActive,
        }),
      });

      const json = await response.json();
      if (json.success) {
        setFeedback({ type: "success", message: "Credenciais e configurações salvas com sucesso!" });
        await loadSettings();
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
          <div className="animate-card stagger-2 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
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
                <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-2">
                  <label htmlFor="ecoflow-secret-key-input" className="text-xs font-semibold text-slate-300">
                    Secret Key
                  </label>
                  {hasEcoflowAccessSecret && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" aria-hidden="true" />
                      Configurada ({ecoflowAccessSecretMasked || "••••••••"})
                    </span>
                  )}
                </div>
                <input
                  id="ecoflow-secret-key-input"
                  type="password"
                  required={!hasEcoflowAccessSecret}
                  autoComplete="new-password"
                  placeholder={
                    hasEcoflowAccessSecret
                      ? `${ecoflowAccessSecretMasked || "••••••••"} (deixe em branco para manter)`
                      : "Ex: sk_live_..."
                  }
                  value={ecoflowAccessSecret}
                  onChange={(e) => setEcoflowAccessSecret(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                />
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
          <div className="animate-card stagger-3 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
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

              <label htmlFor="notifications-active-checkbox" className="flex items-center gap-2 cursor-pointer group self-start sm:self-auto">
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
            <div className="space-y-4 p-4 sm:p-5 rounded-xl bg-slate-950 border border-sky-900/30 transition-all hover:border-sky-850">
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
                  <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-2">
                    <label htmlFor="telegram-token-input" className="text-xs font-semibold text-slate-300">
                      Telegram Bot Token
                    </label>
                    {hasTelegramBotToken && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/30">
                        <ShieldCheck className="w-3 h-3 text-sky-400" aria-hidden="true" />
                        Configurado ({telegramBotTokenMasked || "••••••••"})
                      </span>
                    )}
                  </div>
                  <input
                    id="telegram-token-input"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      hasTelegramBotToken
                        ? `${telegramBotTokenMasked || "••••••••"} (deixe em branco para manter)`
                        : "Ex: 123456789:ABCdefGhIJKlmNoPQRstuVWxyz"
                    }
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-sky-500 font-mono transition-colors"
                  />
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
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-sky-500 font-mono transition-colors"
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
                  disabled={isTestingTelegram || (!telegramBotToken && !hasTelegramBotToken) || !telegramChatId}
                  onClick={handleTestTelegram}
                  aria-label="Testar envio de notificação no Telegram"
                  className="w-full sm:w-auto py-2.5 px-4 min-h-[44px] rounded-xl font-semibold text-xs bg-sky-950 hover:bg-sky-900/90 active:scale-95 text-sky-200 border border-sky-700/60 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
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
            <div className="space-y-4 p-4 sm:p-5 rounded-xl bg-slate-950 border border-emerald-900/30 transition-all hover:border-emerald-850">
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
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-2">
                    <label htmlFor="whatsapp-api-key-input" className="text-xs font-semibold text-slate-300">
                      API Key CallMeBot
                    </label>
                    {hasWhatsappApiKey && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" aria-hidden="true" />
                        Configurada ({whatsappApiKeyMasked || "••••••••"})
                      </span>
                    )}
                  </div>
                  <input
                    id="whatsapp-api-key-input"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      hasWhatsappApiKey
                        ? `${whatsappApiKeyMasked || "••••••••"} (deixe em branco para manter)`
                        : "Ex: 1234567"
                    }
                    value={whatsappApiKey}
                    onChange={(e) => setWhatsappApiKey(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
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
                  disabled={isTestingWhatsApp || !whatsappPhoneNumber || (!whatsappApiKey && !hasWhatsappApiKey)}
                  onClick={handleTestWhatsApp}
                  aria-label="Testar envio de notificação no WhatsApp"
                  className="w-full sm:w-auto py-2.5 px-4 min-h-[44px] rounded-xl font-semibold text-xs bg-emerald-950 hover:bg-emerald-900/90 active:scale-95 text-emerald-200 border border-emerald-700/60 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
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

          {/* 3. Chave de Transferência Automática (ATS) - Parâmetros & Vida Útil */}
          <div className="animate-card stagger-4 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <ArrowLeftRight className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">
                    3. Chave de Transferência Automática (ATS) - Parâmetros &amp; Vida Útil
                  </h2>
                  <p className="text-xs text-slate-400">
                    Controle de desgaste mecânico, calibração de ciclos e estimativa de longevidade operacional
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full bg-slate-950 text-slate-300 border border-slate-800 self-start sm:self-auto">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                1 comutação = 1 ciclo
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs text-slate-300 leading-relaxed flex items-start gap-2.5">
              <Activity className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-slate-400">
                Cada comutação física (seja automática pelo orquestrador ou manual via painel de testes) consome exatamente <strong className="text-slate-200">1 ciclo mecânico</strong> da ATS. Configure abaixo os limites nominais e calibre o contador caso a chave já esteja em uso ou seja substituída.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="ats-lifespan-cycles-input" className="text-xs font-semibold text-slate-300">
                    Vida Útil Nominal (Ciclos)
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">Padrão: 10.000</span>
                </div>
                <input
                  id="ats-lifespan-cycles-input"
                  type="number"
                  min={100}
                  max={1000000}
                  step={1}
                  required
                  placeholder="10000"
                  value={atsLifespanCycles}
                  onChange={(e) => setAtsLifespanCycles(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                />
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Segundo o fabricante, a chave ATS suporta 10.000 ciclos mecânicos de comutação.
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-2">
                  <label htmlFor="ats-current-cycles-input" className="text-xs font-semibold text-slate-300">
                    Ciclos já Realizados (Calibração)
                  </label>
                  {atsLastSwitchedAt && (
                    <span className="text-[10px] font-mono text-slate-400">
                      Última: {new Date(atsLastSwitchedAt).toLocaleString("pt-BR")}
                    </span>
                  )}
                </div>
                <input
                  id="ats-current-cycles-input"
                  type="number"
                  min={0}
                  max={atsLifespanCycles || 1000000}
                  step={1}
                  required
                  placeholder="0"
                  value={atsCurrentCycles}
                  onChange={(e) => setAtsCurrentCycles(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                />
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Permite ajustar o contador caso a ATS já estivesse em uso ou seja substituída.
                </span>
              </div>
            </div>
          </div>

          {/* 4. Parâmetros Econômicos & Tarifa de Energia */}
          <div className="animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <DollarSign className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">
                    4. Parâmetros Econômicos &amp; Tarifa de Energia
                  </h2>
                  <p className="text-xs text-slate-400">
                    Base tarifária da distribuidora para cálculo de economia real obtida com energia solar e bateria
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full bg-slate-950 text-emerald-400 border border-emerald-900/50 self-start sm:self-auto">
                <Zap className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                {currencySymbol} / kWh
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="energy-cost-input" className="text-xs font-semibold text-slate-300">
                    Tarifa de Energia ({currencySymbol}/kWh)
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">Ex: 0.92</span>
                </div>
                <input
                  id="energy-cost-input"
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.01}
                  required
                  placeholder="0.92"
                  value={energyCostPerKwh}
                  onChange={(e) => setEnergyCostPerKwh(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                />
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Valor cobrado pela sua distribuidora por cada kWh consumido (incluindo impostos e bandeiras).
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="currency-symbol-input" className="text-xs font-semibold text-slate-300">
                    Símbolo Monetário
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">Padrão: R$</span>
                </div>
                <div className="flex gap-2">
                  <input
                    id="currency-symbol-input"
                    type="text"
                    maxLength={5}
                    required
                    placeholder="R$"
                    value={currencySymbol}
                    onChange={(e) => setCurrencySymbol(e.target.value.trim() || "R$")}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                  />
                  <div className="flex gap-1 shrink-0">
                    {["R$", "$", "€"].map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => setCurrencySymbol(sym)}
                        className={`px-3 py-2 text-xs font-mono font-bold rounded-xl border transition-colors ${
                          currencySymbol === sym
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50"
                            : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
                        }`}
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Símbolo exibido nos cards executivos de economia financeira e relatórios.
                </span>
              </div>
            </div>
          </div>

          {/* 5. Capacidade da Bateria & Autonomia */}
          <div className="animate-card stagger-6 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
                  <BatteryCharging className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">
                    5. Capacidade da Bateria &amp; Autonomia
                  </h2>
                  <p className="text-xs text-slate-400">
                    Capacidade nominal total do banco de baterias para cálculo preditivo de tempo de autonomia restante
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full bg-slate-950 text-sky-300 border border-sky-900/50 self-start sm:self-auto">
                <Zap className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                {batteryCapacityWh.toLocaleString("pt-BR")} Wh
              </span>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="battery-capacity-input" className="text-xs font-semibold text-slate-300">
                    Capacidade Nominal Total (Wh)
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">EcoFlow + Baterias Extras</span>
                </div>
                <input
                  id="battery-capacity-input"
                  type="number"
                  min={100}
                  max={50000}
                  step={1}
                  required
                  placeholder="2048"
                  value={batteryCapacityWh}
                  onChange={(e) => setBatteryCapacityWh(Math.max(100, parseInt(e.target.value, 10) || 100))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-sky-500 font-mono transition-colors"
                />
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Capacidade combinada em Watt-hora. Se possuir baterias extras conectadas à estação, some a capacidade de todas.
                </span>
              </div>

              {/* Presets Rápidos EcoFlow */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-400 block">
                  Modelos e Presets Comuns EcoFlow:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { label: "RIVER 2 Pro", wh: 768, desc: "768 Wh (Base)" },
                    { label: "DELTA 2", wh: 1024, desc: "1.024 Wh (Base)" },
                    { label: "DELTA 2 Max", wh: 2048, desc: "2.048 Wh (Base)" },
                    { label: "DELTA Pro", wh: 3600, desc: "3.600 Wh (Base)" },
                  ].map((preset) => (
                    <button
                      key={preset.wh}
                      type="button"
                      onClick={() => setBatteryCapacityWh(preset.wh)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        batteryCapacityWh === preset.wh
                          ? "bg-sky-950/80 border-sky-500/70 text-sky-200 shadow-sm shadow-sky-950"
                          : "bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold">{preset.label}</span>
                        {batteryCapacityWh === preset.wh && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-slate-400 block">{preset.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 6. Relatório Executivo Noturno (WhatsApp) */}
          <div className="animate-card stagger-6 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <FileText className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">
                    6. Relatório Executivo Noturno (WhatsApp)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Disparo automático do balanço diário consolidado com geração solar, ciclos da ATS e economia em {currencySymbol}
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer self-start sm:self-auto">
                <input
                  type="checkbox"
                  checked={isDailyReportActive}
                  onChange={(e) => setIsDailyReportActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                <span className="text-xs font-semibold text-slate-300">
                  {isDailyReportActive ? "Ativado" : "Desativado"}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="daily-report-time-input" className="text-xs font-semibold text-slate-300">
                    Horário de Disparo Diário
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">Padrão: 21:00</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  <input
                    id="daily-report-time-input"
                    type="time"
                    required
                    value={dailyReportTime}
                    disabled={!isDailyReportActive}
                    onChange={(e) => setDailyReportTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors disabled:opacity-40"
                  />
                </div>
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Horário local em que o relatório executivo formatado é enviado para o seu WhatsApp configurado.
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-slate-400 space-y-1">
                <span className="font-semibold text-slate-200 block">Conteúdo do Relatório:</span>
                <p>• Balanço de Geração Solar Diária (kWh e economia em {currencySymbol})</p>
                <p>• Comutações e desgaste mecânico da chave ATS no dia</p>
                <p>• Autonomia preditiva e status operacional da bateria</p>
              </div>
            </div>
          </div>

          {/* 7. Previsão Solar & Histerese Adaptativa */}
          <div className="animate-card stagger-6 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <CloudSun className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">
                    7. Previsão Solar &amp; Histerese Adaptativa
                  </h2>
                  <p className="text-xs text-slate-400">
                    Ajuste dinâmico da reserva da bateria conforme a irradiância solar diária prevista via Open-Meteo
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer self-start sm:self-auto">
                <input
                  type="checkbox"
                  checked={isAdaptiveHysteresisActive}
                  onChange={(e) => setIsAdaptiveHysteresisActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                <span className="text-xs font-semibold text-slate-300">
                  {isAdaptiveHysteresisActive ? "Ativado" : "Desativado"}
                </span>
              </label>
            </div>

            {/* Subseção de Coordenadas Geográficas (Open-Meteo) */}
            <div className="space-y-3 p-4 sm:p-5 rounded-xl bg-slate-950 border border-slate-800/80">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  <span className="text-sm font-bold text-slate-200">Localização Geográfica da Instalação</span>
                </div>
                <button
                  type="button"
                  disabled={isDetectingLocation}
                  onClick={handleDetectLocation}
                  className="px-3.5 py-2.5 min-h-[44px] rounded-xl bg-slate-900 hover:bg-slate-850 active:scale-95 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isDetectingLocation ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" aria-hidden="true" />
                  ) : (
                    <MapPin className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  )}
                  {isDetectingLocation ? "Detectando GPS..." : "Obter Localização Atual"}
                </button>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                As coordenadas são necessárias para consultar gratuitamente a irradiância solar (MJ/m²) na API Open-Meteo sem chave de API.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="latitude-input" className="text-xs font-semibold text-slate-300">
                    Latitude
                  </label>
                  <input
                    id="latitude-input"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    placeholder="Ex: -23.5505 (São Paulo)"
                    value={latitude !== null ? latitude : ""}
                    onChange={(e) => setLatitude(e.target.value === "" ? null : parseFloat(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="longitude-input" className="text-xs font-semibold text-slate-300">
                    Longitude
                  </label>
                  <input
                    id="longitude-input"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    placeholder="Ex: -46.6333 (São Paulo)"
                    value={longitude !== null ? longitude : ""}
                    onChange={(e) => setLongitude(e.target.value === "" ? null : parseFloat(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>

              {locationFeedback && (
                <div className="text-xs font-mono text-amber-300 bg-amber-950/40 border border-amber-800/40 p-2.5 rounded-lg flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                  <span>{locationFeedback}</span>
                </div>
              )}
            </div>

            {/* Sliders de Histerese Adaptativa */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
              {/* Slider 1: Mínimo Adaptativo (Dias Ensolarados) */}
              <div className="space-y-2 p-4 rounded-xl bg-slate-950 border border-slate-800/80">
                <div className="flex items-center justify-between">
                  <label htmlFor="min-adaptive-threshold" className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    Corte Mínimo (Dia Ensolarado)
                  </label>
                  <span className="text-sm font-extrabold font-mono text-emerald-400 px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800/60">
                    {minAdaptiveThreshold}%
                  </span>
                </div>
                <input
                  id="min-adaptive-threshold"
                  type="range"
                  min={10}
                  max={50}
                  step={1}
                  value={minAdaptiveThreshold}
                  onChange={(e) => setMinAdaptiveThreshold(parseInt(e.target.value, 10))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Limite estendido em dias de Sol Pleno (≥ 18 MJ/m²). Permite descarregar mais a bateria porque a reposição matinal é garantida.
                </span>
              </div>

              {/* Slider 2: Máximo Adaptativo (Dias Nublados / Chuva) */}
              <div className="space-y-2 p-4 rounded-xl bg-slate-950 border border-slate-800/80">
                <div className="flex items-center justify-between">
                  <label htmlFor="max-adaptive-threshold" className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    Corte Máximo (Dia Chuvoso / Nublado)
                  </label>
                  <span className="text-sm font-extrabold font-mono text-sky-400 px-2 py-0.5 rounded bg-sky-950 border border-sky-800/60">
                    {maxAdaptiveThreshold}%
                  </span>
                </div>
                <input
                  id="max-adaptive-threshold"
                  type="range"
                  min={30}
                  max={80}
                  step={1}
                  value={maxAdaptiveThreshold}
                  onChange={(e) => setMaxAdaptiveThreshold(parseInt(e.target.value, 10))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Reserva conservadora retida na bateria em dias com baixa captação solar (&lt; 12 MJ/m²), prevenindo falta de energia.
                </span>
              </div>
            </div>

            {/* Infográfico / Régua de Decisão Adaptativa */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2.5">
              <span className="text-xs font-bold text-slate-300 block uppercase tracking-wider">
                Lógica da Modulação Adaptativa Diária:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="font-bold text-slate-300 block mb-0.5">🌧️ Chuva (&lt; 12 MJ/m²)</span>
                  <span className="text-slate-400 text-[11px] block">
                    Corte sobe para <strong>{maxAdaptiveThreshold}%</strong> preservando autonomia.
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="font-bold text-amber-300 block mb-0.5">🌤️ Parcial (12 a 18 MJ/m²)</span>
                  <span className="text-slate-400 text-[11px] block">
                    Corte interpolado proporcional entre <strong>{minAdaptiveThreshold}%</strong> e <strong>{maxAdaptiveThreshold}%</strong>.
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="font-bold text-emerald-300 block mb-0.5">☀️ Sol Pleno (≥ 18 MJ/m²)</span>
                  <span className="text-slate-400 text-[11px] block">
                    Corte desce para <strong>{minAdaptiveThreshold}%</strong> para máxima economia financeira.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 8. Monitoramento Térmico & BMS da Bateria */}
          <div className="animate-card stagger-6 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                  <Thermometer className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">
                    8. Monitoramento Térmico &amp; BMS da Bateria
                  </h2>
                  <p className="text-xs text-slate-400">
                    Proteção de células LiFePO4 contra sobreaquecimento, estresse térmico e descontinuidade
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full bg-slate-950 text-rose-300 border border-rose-900/50 self-start sm:self-auto">
                <Flame className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
                BMS Shield 24/7
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="thermal-warning-input" className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    Alerta Térmico Preventivo (°C)
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">Padrão: 45.0°C</span>
                </div>
                <input
                  id="thermal-warning-input"
                  type="number"
                  step="0.5"
                  min={30}
                  max={60}
                  required
                  placeholder="45.0"
                  value={thermalWarningThreshold}
                  onChange={(e) => setThermalWarningThreshold(parseFloat(e.target.value) || 45.0)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-amber-500 font-mono transition-colors"
                />
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Dispara notificação push/WhatsApp alertando que a temperatura das células está elevada.
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="thermal-shutdown-input" className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    Corte de Emergência AC (°C)
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">Padrão: 50.0°C</span>
                </div>
                <input
                  id="thermal-shutdown-input"
                  type="number"
                  step="0.5"
                  min={40}
                  max={65}
                  required
                  placeholder="50.0"
                  value={thermalShutdownThreshold}
                  onChange={(e) => setThermalShutdownThreshold(parseFloat(e.target.value) || 50.0)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base sm:text-sm text-slate-200 focus:outline-none focus:border-rose-500 font-mono transition-colors"
                />
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Desliga imediatamente o inversor AC e comuta para a rede da concessionária para cessar o estresse da bateria.
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-rose-950/40 text-xs text-slate-400 space-y-1 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
              <p>
                <strong className="text-slate-200">Histerese Térmica de Segurança:</strong> Após um corte preventivo de emergência, a saída AC só será reativada pelo orquestrador quando a temperatura das células descer pelo menos 8°C abaixo do limiar de corte, resguardando a vida útil e a estabilidade química da bateria.
              </p>
            </div>
          </div>

          {/* 9. Tarifas Dinâmicas & Horário de Ponta (Tarifa Branca) */}
          <div className="animate-card stagger-6 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <Zap className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">
                    9. Tarifas Dinâmicas &amp; Horário de Ponta (Tarifa Branca ANEEL)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Maximização da economia e descarregamento agressivo da bateria durante o horário mais caro do dia
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer self-start sm:self-auto">
                <input
                  type="checkbox"
                  checked={isDynamicTariffActive}
                  onChange={(e) => setIsDynamicTariffActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                <span className="text-xs font-semibold text-slate-300">
                  {isDynamicTariffActive ? "Tarifa Branca Ativa" : "Desativado"}
                </span>
              </label>
            </div>

            {/* Grid dos 3 Níveis Tarifários */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-950 border border-rose-950/40">
                <div className="flex items-center justify-between">
                  <label htmlFor="peak-tariff-input" className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    Ponta ({currencySymbol}/kWh)
                  </label>
                  <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/60">
                    Cara
                  </span>
                </div>
                <input
                  id="peak-tariff-input"
                  type="number"
                  step="0.01"
                  min={0.01}
                  required
                  disabled={!isDynamicTariffActive}
                  value={peakTariffPerKwh}
                  onChange={(e) => setPeakTariffPerKwh(parseFloat(e.target.value) || 1.85)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-rose-500 transition-colors disabled:opacity-40"
                />
                <span className="text-[10px] text-slate-400 block leading-tight">
                  Horário de maior custo da distribuidora (descarrega bateria).
                </span>
              </div>

              <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-950 border border-amber-950/40">
                <div className="flex items-center justify-between">
                  <label htmlFor="intermediate-tariff-input" className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    Intermediária ({currencySymbol}/kWh)
                  </label>
                  <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/60">
                    Média
                  </span>
                </div>
                <input
                  id="intermediate-tariff-input"
                  type="number"
                  step="0.01"
                  min={0.01}
                  required
                  disabled={!isDynamicTariffActive}
                  value={intermediateTariffPerKwh}
                  onChange={(e) => setIntermediateTariffPerKwh(parseFloat(e.target.value) || 1.15)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-40"
                />
                <span className="text-[10px] text-slate-400 block leading-tight">
                  1h antes e 1h depois da ponta (custo intermediário).
                </span>
              </div>

              <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-950 border border-emerald-950/40">
                <div className="flex items-center justify-between">
                  <label htmlFor="offpeak-tariff-input" className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    Fora de Ponta ({currencySymbol}/kWh)
                  </label>
                  <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                    Barata
                  </span>
                </div>
                <input
                  id="offpeak-tariff-input"
                  type="number"
                  step="0.01"
                  min={0.01}
                  required
                  disabled={!isDynamicTariffActive}
                  value={offPeakTariffPerKwh}
                  onChange={(e) => setOffPeakTariffPerKwh(parseFloat(e.target.value) || 0.65)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-40"
                />
                <span className="text-[10px] text-slate-400 block leading-tight">
                  Madrugada, manhã e fins de semana (custo reduzido).
                </span>
              </div>
            </div>

            {/* Grade de Janelas de Horários ANEEL */}
            <div className="space-y-3 p-4 rounded-xl bg-slate-950 border border-slate-800/80">
              <span className="text-xs font-bold text-slate-300 block uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                Janelas de Horários Oficiais (Segunda a Sexta)
              </span>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-400 block">
                    Horário de Ponta (Início - Fim)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      value={peakStartTime}
                      disabled={!isDynamicTariffActive}
                      onChange={(e) => setPeakStartTime(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-40"
                    />
                    <span className="text-slate-500 text-xs">às</span>
                    <input
                      type="time"
                      value={peakEndTime}
                      disabled={!isDynamicTariffActive}
                      onChange={(e) => setPeakEndTime(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-40"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-400 block">
                    Intermediário 1 (Pré-Ponta)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      value={intermediateStartTime1}
                      disabled={!isDynamicTariffActive}
                      onChange={(e) => setIntermediateStartTime1(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-40"
                    />
                    <span className="text-slate-500 text-xs">às</span>
                    <input
                      type="time"
                      value={intermediateEndTime1}
                      disabled={!isDynamicTariffActive}
                      onChange={(e) => setIntermediateEndTime1(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-40"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-400 block">
                    Intermediário 2 (Pós-Ponta)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      value={intermediateStartTime2}
                      disabled={!isDynamicTariffActive}
                      onChange={(e) => setIntermediateStartTime2(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-40"
                    />
                    <span className="text-slate-500 text-xs">às</span>
                    <input
                      type="time"
                      value={intermediateEndTime2}
                      disabled={!isDynamicTariffActive}
                      onChange={(e) => setIntermediateEndTime2(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-40"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Slider de Reserva da Ponta */}
            <div className="space-y-2 p-4 rounded-xl bg-slate-950 border border-slate-800/80">
              <div className="flex items-center justify-between">
                <label htmlFor="peak-reserve-threshold" className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Corte Agressivo no Horário de Ponta
                </label>
                <span className="text-sm font-extrabold font-mono text-rose-400 px-2 py-0.5 rounded bg-rose-950 border border-rose-800/60">
                  {peakReserveThreshold}%
                </span>
              </div>
              <input
                id="peak-reserve-threshold"
                type="range"
                min={10}
                max={30}
                step={1}
                disabled={!isDynamicTariffActive}
                value={peakReserveThreshold}
                onChange={(e) => setPeakReserveThreshold(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500 disabled:opacity-40"
              />
              <span className="text-[11px] text-slate-400 block leading-tight">
                Permite que a bateria descarregue até {peakReserveThreshold}% exclusivamente durante o Horário de Ponta para blindar a residência contra a tarifa cara da rede elétrica.
              </span>
            </div>
          </div>

          {/* 10. Alertas Críticos em Tempo Real & Inversor */}
          <div className="animate-card stagger-6 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                  <BellRing className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">
                    10. Alertas Críticos em Tempo Real &amp; Inversor
                  </h2>
                  <p className="text-xs text-slate-400">
                    Disparo instantâneo nos canais ativos (WhatsApp e Telegram) com proteção anti-flood inteligente
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full bg-slate-950 text-rose-300 border border-rose-900/50 self-start sm:self-auto">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                Anti-Flood Ativo
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="inverter-max-watts-input" className="text-xs font-semibold text-slate-300">
                    Potência Máxima do Inversor (Watts)
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">Padrão: 2.400 W</span>
                </div>
                <input
                  id="inverter-max-watts-input"
                  type="number"
                  min={500}
                  max={10000}
                  step={50}
                  required
                  placeholder="2400"
                  value={inverterMaxWatts}
                  onChange={(e) => setInverterMaxWatts(parseInt(e.target.value, 10) || 2400)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-rose-500 font-mono transition-colors"
                />
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Potência contínua máxima da saída AC da estação EcoFlow para cálculo de % de sobrecarga.
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="alert-cooldown-input" className="text-xs font-semibold text-slate-300">
                    Janela Anti-Flood de Cooldown (Minutos)
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">Padrão: 10 min</span>
                </div>
                <input
                  id="alert-cooldown-input"
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  required
                  placeholder="10"
                  value={alertCooldownMinutes}
                  onChange={(e) => setAlertCooldownMinutes(parseInt(e.target.value, 10) || 10)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-amber-500 font-mono transition-colors"
                />
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Intervalo mínimo entre notificações do mesmo tipo para evitar excesso de mensagens.
                </span>
              </div>
            </div>

            {/* Toggles de Eventos Críticos Monitorados */}
            <div className="space-y-3 pt-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                Gatilhos de Notificação Imediata:
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    id: "alert-blackout",
                    label: "Queda da Rede Elétrica (Blackout)",
                    desc: "Avisa assim que a concessionária interrompe o fornecimento",
                    checked: isAlertOnBlackout,
                    onChange: setIsAlertOnBlackout,
                  },
                  {
                    id: "alert-grid-restore",
                    label: "Restauração da Rede Concessionária",
                    desc: "Notifica quando a energia da rua volta à estabilidade",
                    checked: isAlertOnGridRestore,
                    onChange: setIsAlertOnGridRestore,
                  },
                  {
                    id: "alert-overload",
                    label: "Sobrecarga do Inversor (≥ 90%)",
                    desc: "Alerta quando a carga residencial se aproxima do limite nominal",
                    checked: isAlertOnOverload,
                    onChange: setIsAlertOnOverload,
                  },
                  {
                    id: "alert-thermal",
                    label: "Risco Térmico das Células",
                    desc: "Avisa ao atingir o limiar preventivo de temperatura",
                    checked: isAlertOnThermalRisk,
                    onChange: setIsAlertOnThermalRisk,
                  },
                  {
                    id: "alert-ats",
                    label: "Anomalia na Comutação ATS",
                    desc: "Notifica em caso de falha física ou inconsistência mecânica",
                    checked: isAlertOnAtsFailure,
                    onChange: setIsAlertOnAtsFailure,
                  },
                ].map((item) => (
                  <label
                    key={item.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-start gap-3 cursor-pointer hover:border-slate-700 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) => item.onChange(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-rose-500"
                    />
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-200 block">{item.label}</span>
                      <span className="text-[11px] text-slate-400 block leading-tight">{item.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 11. Solar Smart Charging & Modulação de Recarga AC (Feature 3.2) */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <SunMedium className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    11. Solar Smart Charging &amp; Modulação de Recarga AC
                  </h3>
                  <p className="text-xs text-slate-400">
                    Ajuste dinâmico da velocidade de carregamento AC com bloqueio no pico e pré-recarga econômica
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
                  className="w-5 h-5 rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-amber-500"
                />
              </label>
            </div>

            <div className={`space-y-6 transition-opacity duration-200 ${isSmartChargingActive ? "opacity-100" : "opacity-60"}`}>
              {/* Sliders de Potência Mínima e Máxima de Recarga AC */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 1. Potência Mínima */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <label htmlFor="min-ac-watts" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                      Potência Mínima de Recarga AC
                    </label>
                    <span className="text-xs font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                      {minAcChargingWatts} W
                    </span>
                  </div>

                  <input
                    id="min-ac-watts"
                    type="range"
                    min={200}
                    max={600}
                    step={50}
                    value={minAcChargingWatts}
                    onChange={(e) => setMinAcChargingWatts(Number(e.target.value))}
                    disabled={!isSmartChargingActive}
                    className="w-full accent-amber-500 cursor-pointer disabled:cursor-not-allowed"
                  />

                  <div className="flex justify-between text-[10px] font-mono text-slate-500">
                    <span>200 W (Suave)</span>
                    <span>400 W (Padrão)</span>
                    <span>600 W (Rápido)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                    Taxa econômica de manutenção usada em horários neutros ou pré-recarga noturna.
                  </p>
                </div>

                {/* 2. Potência Máxima */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <label htmlFor="max-ac-watts" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      Potência Máxima de Recarga AC
                    </label>
                    <span className="text-xs font-mono font-bold text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                      {maxAcChargingWatts} W
                    </span>
                  </div>

                  <input
                    id="max-ac-watts"
                    type="range"
                    min={600}
                    max={2400}
                    step={100}
                    value={maxAcChargingWatts}
                    onChange={(e) => setMaxAcChargingWatts(Number(e.target.value))}
                    disabled={!isSmartChargingActive}
                    className="w-full accent-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                  />

                  <div className="flex justify-between text-[10px] font-mono text-slate-500">
                    <span>600 W</span>
                    <span>1.200 W (Padrão)</span>
                    <span>2.400 W (Turbo)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                    Limite máximo da tomada acionado pelo Modo Tempestade ou absorção rápida de excedente.
                  </p>
                </div>
              </div>

              {/* Toggles de Bloqueio no Pico e Pré-Recarga de Chuva */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex items-start gap-3 cursor-pointer hover:border-slate-700 transition-colors">
                  <input
                    type="checkbox"
                    checked={chargeOnlyOffPeak}
                    onChange={(e) => setChargeOnlyOffPeak(e.target.checked)}
                    disabled={!isSmartChargingActive}
                    className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-amber-500"
                  />
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-slate-200 block">
                      Bloquear Recarga AC no Horário de Ponta
                    </span>
                    <span className="text-[11px] text-slate-400 block leading-relaxed">
                      Evita recarregar a bateria na tomada durante o horário de ponta da Tarifa Branca ANEEL (R$ 1,85+/kWh).
                    </span>
                  </div>
                </label>

                <label className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex items-start gap-3 cursor-pointer hover:border-slate-700 transition-colors">
                  <input
                    type="checkbox"
                    checked={cloudyPrechargeActive}
                    onChange={(e) => setCloudyPrechargeActive(e.target.checked)}
                    disabled={!isSmartChargingActive}
                    className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-sky-500"
                  />
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-slate-200 block">
                      Pré-Recarga Noturna em Caso de Chuva
                    </span>
                    <span className="text-[11px] text-slate-400 block leading-relaxed">
                      Na madrugada (02:00 - 05:00), se a previsão do dia for de chuva/nublado, recarrega suavemente na tarifa econômica até 85%.
                    </span>
                  </div>
                </label>
              </div>

              {/* Nota Técnica de Precedência */}
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/70 text-[11px] text-slate-400 space-y-1 font-mono">
                <span className="text-slate-300 font-semibold block">Regra de Precedência do Sistema:</span>
                <p>
                  1. <strong className="text-amber-300">Modo Tempestade:</strong> Força recarga máxima imediata ({maxAcChargingWatts}W) ignorando tarifas.
                </p>
                <p>
                  2. <strong className="text-rose-300">Horário de Ponta:</strong> Reduz potência AC para {minAcChargingWatts}W ou 0W para blindagem financeira.
                </p>
              </div>
            </div>
          </div>

          {/* 12. Gerenciador de Aparelhos & Cargas Residenciais (Feature 2.3) */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Layers className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    12. Gerenciador de Aparelhos &amp; Cargas Residenciais
                  </h3>
                  <p className="text-xs text-slate-400">
                    Cadastre e organize aparelhos para alimentar o Simulador de Autonomia durante blecautes
                  </p>
                </div>
              </div>

              <span className="text-xs font-mono font-semibold text-emerald-300 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/30">
                {appliancesList.length} aparelhos cadastrados
              </span>
            </div>

            {/* Formulário para Cadastrar Novo Aparelho */}
            <div className="p-4 sm:p-5 rounded-xl bg-slate-950 border border-slate-800/90 space-y-4">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                <h4 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider">
                  Adicionar Novo Aparelho
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                {/* Nome */}
                <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                  <label htmlFor="new-appliance-name" className="text-slate-400 font-medium block">
                    Nome do Aparelho
                  </label>
                  <input
                    id="new-appliance-name"
                    type="text"
                    placeholder="Ex: Micro-ondas, Freezer..."
                    value={newApplianceName}
                    onChange={(e) => setNewApplianceName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Potência Média (Watts) */}
                <div className="space-y-1">
                  <label htmlFor="new-appliance-watts" className="text-slate-400 font-medium block">
                    Potência Média (Watts)
                  </label>
                  <input
                    id="new-appliance-watts"
                    type="number"
                    min={5}
                    max={10000}
                    placeholder="Ex: 120"
                    value={newApplianceWatts}
                    onChange={(e) => setNewApplianceWatts(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                {/* Categoria */}
                <div className="space-y-1">
                  <label htmlFor="new-appliance-category" className="text-slate-400 font-medium block">
                    Categoria
                  </label>
                  <select
                    id="new-appliance-category"
                    value={newApplianceCategory}
                    onChange={(e) => setNewApplianceCategory(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="ESSENTIAL">Essencial (Crítico)</option>
                    <option value="COMFORT">Conforto</option>
                    <option value="HEAVY">Carga Pesada</option>
                    <option value="CUSTOM">Personalizado</option>
                  </select>
                </div>

                {/* Ícone */}
                <div className="space-y-1">
                  <label htmlFor="new-appliance-icon" className="text-slate-400 font-medium block">
                    Ícone Representativo
                  </label>
                  <select
                    id="new-appliance-icon"
                    value={newApplianceIcon}
                    onChange={(e) => setNewApplianceIcon(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="Zap">Raio / Elétrico (Zap)</option>
                    <option value="Refrigerator">Geladeira (Refrigerator)</option>
                    <option value="Wifi">Roteador / Wi-Fi</option>
                    <option value="Laptop">Notebook / Computador</option>
                    <option value="Tv">Smart TV / Telão</option>
                    <option value="AirVent">Ar-Condicionado / Climatizador</option>
                    <option value="Lightbulb">Iluminação / Lâmpada</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                {applianceActionFeedback && (
                  <span className="text-xs font-mono text-emerald-400 animate-fade-in">
                    {applianceActionFeedback}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCreateAppliance}
                  disabled={isCreatingAppliance || !newApplianceName.trim()}
                  className="sm:ml-auto px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-emerald-950"
                >
                  {isCreatingAppliance ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {isCreatingAppliance ? "Cadastrando..." : "Cadastrar Aparelho"}
                </button>
              </div>
            </div>

            {/* Lista dos Aparelhos Cadastrados */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Aparelhos Atuais ({appliancesList.length})
              </h4>

              {isLoadingAppliances ? (
                <div className="p-8 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  Carregando lista de aparelhos...
                </div>
              ) : appliancesList.length === 0 ? (
                <div className="p-6 rounded-xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-500">
                  Nenhum aparelho cadastrado ainda. O auto-seed será aplicado na primeira consulta.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {appliancesList.map((appliance) => {
                    const isDeleting = deletingApplianceId === appliance.id;
                    const catTheme =
                      appliance.category === "ESSENTIAL"
                        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                        : appliance.category === "HEAVY"
                        ? "bg-rose-500/10 text-rose-300 border-rose-500/30"
                        : appliance.category === "COMFORT"
                        ? "bg-sky-500/10 text-sky-300 border-sky-500/30"
                        : "bg-purple-500/10 text-purple-300 border-purple-500/30";

                    return (
                      <div
                        key={appliance.id}
                        className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-3 group hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="p-2 rounded-lg bg-slate-900 text-emerald-400 border border-slate-800 shrink-0">
                            {appliance.icon === "Refrigerator" && <Refrigerator className="w-4 h-4" />}
                            {appliance.icon === "Wifi" && <Wifi className="w-4 h-4" />}
                            {appliance.icon === "Laptop" && <Laptop className="w-4 h-4" />}
                            {appliance.icon === "Tv" && <Tv className="w-4 h-4" />}
                            {appliance.icon === "AirVent" && <AirVent className="w-4 h-4" />}
                            {appliance.icon === "Lightbulb" && <Lightbulb className="w-4 h-4" />}
                            {appliance.icon !== "Refrigerator" &&
                              appliance.icon !== "Wifi" &&
                              appliance.icon !== "Laptop" &&
                              appliance.icon !== "Tv" &&
                              appliance.icon !== "AirVent" &&
                              appliance.icon !== "Lightbulb" && <Zap className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs font-semibold text-slate-100 block truncate">
                              {appliance.name}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[11px] font-mono font-bold text-amber-300">
                                {appliance.averageWatts} W
                              </span>
                              <span className={`text-[9px] font-semibold px-1.5 py-0.2 rounded border ${catTheme}`}>
                                {appliance.category}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteAppliance(appliance.id)}
                          disabled={isDeleting}
                          aria-label={`Excluir aparelho ${appliance.name}`}
                          className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-all cursor-pointer shrink-0 disabled:opacity-40"
                        >
                          {isDeleting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving || isLoading}
              className="w-full sm:w-auto py-3 px-8 min-h-[44px] rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all duration-150 shadow-lg shadow-emerald-950 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
              {isSaving ? "Salvando..." : "Salvar Configurações"}
            </button>
          </div>
        </form>

        {/* Painel de Validação e Teste do Acionamento AC */}
        <section
          aria-label="Painel de Testes e Validação Direta"
          className="animate-card stagger-5 interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5"
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              type="button"
              disabled={isTestingEcoFlow || !ecoflowAccessKey || (!ecoflowAccessSecret && !hasEcoflowAccessSecret) || !ecoflowSerialNumber}
              onClick={() => requestConfirmation("ECOFLOW_TELEMETRY")}
              aria-label="Solicitar teste de leitura de telemetria da EcoFlow"
              className="py-3 px-4 min-h-[44px] rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <Activity className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              Testar Telemetria (SOC)
            </button>

            <button
              type="button"
              disabled={isTestingEcoFlow || !ecoflowAccessKey || (!ecoflowAccessSecret && !hasEcoflowAccessSecret) || !ecoflowSerialNumber}
              onClick={() => requestConfirmation("ECOFLOW_ON")}
              aria-label="Solicitar teste para ligar saída AC e comutar ATS para bateria"
              className="py-3 px-4 min-h-[44px] rounded-xl font-semibold text-xs bg-emerald-950/60 hover:bg-emerald-900/80 active:scale-95 text-emerald-200 border border-emerald-800/60 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <Zap className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              Ligar Saída AC (ATS &rarr; Solar)
            </button>

            <button
              type="button"
              disabled={isTestingEcoFlow || !ecoflowAccessKey || (!ecoflowAccessSecret && !hasEcoflowAccessSecret) || !ecoflowSerialNumber}
              onClick={() => requestConfirmation("ECOFLOW_OFF")}
              aria-label="Solicitar teste para desligar saída AC e comutar ATS para rede"
              className="py-3 px-4 min-h-[44px] rounded-xl font-semibold text-xs bg-rose-950/60 hover:bg-rose-900/80 active:scale-95 text-rose-200 border border-rose-800/60 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
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
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400 font-mono tracking-wider text-center uppercase transition-colors"
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 active:scale-95 transition-all cursor-pointer text-center flex items-center justify-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={confirmationInput.trim().toUpperCase() !== confirmationModal.expectedWord}
                onClick={executeConfirmedAction}
                aria-label={`Confirmar e executar ${confirmationModal.actionTitle}`}
                className={`w-full sm:w-auto px-5 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer ${confirmationModal.confirmButtonColor}`}
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
