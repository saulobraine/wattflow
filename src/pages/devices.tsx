import React, { useEffect, useState, FormEvent, useMemo } from "react";
import { Layout } from "../components/Layout";
import { useLiveTelemetry } from "../hooks/useLiveTelemetry";
import { toast } from "../hooks/use-toast";
import { getAtsHealthTheme, getAtsStatusBadge } from "../utils/atsHealthUtils";
import type { ApplianceItem } from "./api/appliances";
import {
  BatteryCharging,
  Cpu,
  ArrowLeftRight,
  Layers,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Power,
  Zap,
  Loader2,
  Activity,
  Plus,
  Trash2,
  Laptop,
  Tv,
  Wifi,
  Lightbulb,
  Refrigerator,
  AirVent,
  Search,
  X,
  Thermometer,
  Flame,
  ShieldAlert,
  Clock,
  Sliders,
} from "lucide-react";

export default function DevicesPage() {
  const { telemetry: liveTelemetry } = useLiveTelemetry();

  // Estados da Bateria & BMS
  const [batteryCapacityWh, setBatteryCapacityWh] = useState<number>(2048);
  const [thermalWarningThreshold, setThermalWarningThreshold] = useState<number>(45.0);
  const [thermalShutdownThreshold, setThermalShutdownThreshold] = useState<number>(50.0);
  const [modelSearchQuery, setModelSearchQuery] = useState<string>("");
  const [modelCategoryFilter, setModelCategoryFilter] = useState<string>("TODOS");

  // Limites nativos detectados
  const [deviceMaxChargeSoc, setDeviceMaxChargeSoc] = useState<number | null>(null);
  const [deviceMinDsgSoc, setDeviceMinDsgSoc] = useState<number | null>(null);

  // Estados de Saúde Operacional da ATS
  const [atsLifespanCycles, setAtsLifespanCycles] = useState<number>(10000);
  const [atsCurrentCycles, setAtsCurrentCycles] = useState<number>(0);
  const [atsLastSwitchedAt, setAtsLastSwitchedAt] = useState<string | null>(null);

  // Credenciais salvas necessárias para testes diretos
  const [ecoflowEndpointRegion, setEcoflowEndpointRegion] = useState("https://api.ecoflow.com");
  const [ecoflowAccessKey, setEcoflowAccessKey] = useState("");
  const [hasEcoflowAccessSecret, setHasEcoflowAccessSecret] = useState(false);
  const [ecoflowSerialNumber, setEcoflowSerialNumber] = useState("");

  // Estados de Teste Direto ATS
  const [isTestingEcoFlow, setIsTestingEcoFlow] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{
    isSuccess: boolean;
    summary: string;
    ecoflowMessage: string;
    batteryPercentage?: number;
    solarWatts?: number;
    isAcOutputEnabled?: boolean | null;
  } | null>(null);

  // Modal de Confirmação de Segurança
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

  // Estados de Aparelhos & Cargas
  const [appliancesList, setAppliancesList] = useState<ApplianceItem[]>([]);
  const [isLoadingAppliances, setIsLoadingAppliances] = useState<boolean>(false);
  const [newApplianceName, setNewApplianceName] = useState<string>("");
  const [newApplianceCategory, setNewApplianceCategory] = useState<string>("ESSENTIAL");
  const [newApplianceWatts, setNewApplianceWatts] = useState<number>(100);
  const [newApplianceIcon, setNewApplianceIcon] = useState<string>("Zap");
  const [applianceActionFeedback, setApplianceActionFeedback] = useState<string | null>(null);
  const [isCreatingAppliance, setIsCreatingAppliance] = useState<boolean>(false);
  const [deletingApplianceId, setDeletingApplianceId] = useState<string | null>(null);

  // Simulação de Autonomia: conjunto de IDs selecionados para a carga ativa
  const [selectedApplianceIds, setSelectedApplianceIds] = useState<Set<string>>(new Set());

  // Estados de feedback de salvamento
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Sincroniza limites nativos com telemetria
  useEffect(() => {
    if (liveTelemetry?.deviceMaxChargeSoc !== undefined && liveTelemetry?.deviceMaxChargeSoc !== null) {
      setDeviceMaxChargeSoc(liveTelemetry.deviceMaxChargeSoc);
    }
    if (liveTelemetry?.deviceMinDsgSoc !== undefined && liveTelemetry?.deviceMinDsgSoc !== null) {
      setDeviceMinDsgSoc(liveTelemetry.deviceMinDsgSoc);
    }
  }, [liveTelemetry?.deviceMaxChargeSoc, liveTelemetry?.deviceMinDsgSoc]);

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/settings");
      const json = await response.json();
      if (json.success && json.data) {
        setBatteryCapacityWh(
          typeof json.data.batteryCapacityWh === "number" ? json.data.batteryCapacityWh : 2048
        );
        setAtsLifespanCycles(
          typeof json.data.atsLifespanCycles === "number" ? json.data.atsLifespanCycles : 10000
        );
        setAtsCurrentCycles(
          typeof json.data.atsCurrentCycles === "number" ? json.data.atsCurrentCycles : 0
        );
        setAtsLastSwitchedAt(json.data.atsLastSwitchedAt || null);
        setThermalWarningThreshold(
          typeof json.data.thermalWarningThreshold === "number" ? json.data.thermalWarningThreshold : 45.0
        );
        setThermalShutdownThreshold(
          typeof json.data.thermalShutdownThreshold === "number" ? json.data.thermalShutdownThreshold : 50.0
        );
        setEcoflowEndpointRegion(json.data.ecoflowEndpointRegion || "https://api.ecoflow.com");
        setEcoflowAccessKey(json.data.ecoflowAccessKey || "");
        setHasEcoflowAccessSecret(Boolean(json.data.hasEcoflowAccessSecret));
        setEcoflowSerialNumber(json.data.ecoflowSerialNumber || "");
      }
    } catch (err) {
      console.error("Erro ao carregar dados de dispositivos:", err);
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
        const list: ApplianceItem[] = json.data.appliances || [];
        setAppliancesList(list);
        // Inicializa simulação com aparelhos marcados como ESSENTIAL ou que já estejam ativos
        const initialSelected = new Set<string>();
        list.forEach((app) => {
          if (app.isActiveInSimulation || app.category === "ESSENTIAL") {
            initialSelected.add(app.id);
          }
        });
        setSelectedApplianceIds(initialSelected);
      }
    } catch (err) {
      console.error("Erro ao carregar aparelhos:", err);
    } finally {
      setIsLoadingAppliances(false);
    }
  };

  useEffect(() => {
    loadSettings();
    loadAppliances();
  }, []);

  const handleSaveHardwareSettings = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batteryCapacityWh: Number(batteryCapacityWh),
          atsLifespanCycles: Number(atsLifespanCycles),
          atsCurrentCycles: Number(atsCurrentCycles),
          thermalWarningThreshold: Number(thermalWarningThreshold),
          thermalShutdownThreshold: Number(thermalShutdownThreshold),
        }),
      });
      const json = await response.json();
      if (json.success) {
        toast({
          title: "Parâmetros de Hardware Salvos",
          description: "Capacidade da bateria, limites térmicos e calibração da ATS atualizados.",
          variant: "success",
        });
        await loadSettings();
      } else {
        toast({
          title: "Erro ao salvar",
          description: json.message || "Não foi possível atualizar as configurações de hardware.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Erro de comunicação",
        description: "Falha de rede ao salvar configurações de hardware.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateAppliance = async (e: FormEvent) => {
    e.preventDefault();
    if (!newApplianceName.trim() || newApplianceWatts <= 0) {
      toast({
        title: "Dados inválidos",
        description: "Informe um nome e potência em Watts válidos.",
        variant: "destructive",
      });
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
          isActiveInSimulation: true,
        }),
      });
      const json = await response.json();
      if (json.success) {
        setNewApplianceName("");
        setNewApplianceWatts(100);
        toast({
          title: "Aparelho cadastrado",
          description: "Carga adicionada com sucesso ao simulador.",
          variant: "success",
        });
        await loadAppliances();
      } else {
        toast({
          title: "Erro ao cadastrar",
          description: json.message || "Erro ao cadastrar aparelho.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Erro de rede",
        description: "Falha ao comunicar com o servidor.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingAppliance(false);
    }
  };

  const handleDeleteAppliance = async (id: string) => {
    setDeletingApplianceId(id);
    try {
      const response = await fetch(`/api/appliances?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await response.json();
      if (json.success) {
        setAppliancesList((prev) => prev.filter((a) => a.id !== id));
        setSelectedApplianceIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        toast({
          title: "Aparelho excluído",
          description: "Carga removida do gerenciador.",
          variant: "success",
        });
      } else {
        toast({
          title: "Erro ao excluir",
          description: json.message || "Erro ao excluir aparelho.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Erro de comunicação",
        description: "Falha ao excluir aparelho.",
        variant: "destructive",
      });
    } finally {
      setDeletingApplianceId(null);
    }
  };

  const toggleApplianceSimulation = (id: string) => {
    setSelectedApplianceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Cálculo da Simulação de Autonomia
  const simulationMetrics = useMemo(() => {
    const activeAppliances = appliancesList.filter((a) => selectedApplianceIds.has(a.id));
    const totalWatts = activeAppliances.reduce((acc, curr) => acc + curr.averageWatts, 0);

    const currentSoc =
      liveTelemetry?.batteryPercentage !== undefined && liveTelemetry?.batteryPercentage !== null
        ? liveTelemetry.batteryPercentage
        : 100;

    // Energia utilizável considerando 10% de margem de proteção do inversor
    const usableCapacityWh = Math.max(0, (batteryCapacityWh * (currentSoc / 100)) * 0.9);

    let estimatedHours = 0;
    if (totalWatts > 0) {
      estimatedHours = usableCapacityWh / totalWatts;
    }

    const hours = Math.floor(estimatedHours);
    const minutes = Math.round((estimatedHours - hours) * 60);

    return {
      activeCount: activeAppliances.length,
      totalWatts,
      currentSoc,
      usableCapacityWh: Math.round(usableCapacityWh),
      estimatedHours,
      formattedTime:
        totalWatts === 0
          ? "Em standby"
          : hours > 48
          ? "+48 horas"
          : `${hours}h ${minutes}m`,
    };
  }, [appliancesList, selectedApplianceIds, batteryCapacityWh, liveTelemetry?.batteryPercentage]);

  // Desgaste da ATS
  const atsWearPercent = useMemo(() => {
    if (!atsLifespanCycles || atsLifespanCycles <= 0) return 0;
    return Math.min(100, Math.round((atsCurrentCycles / atsLifespanCycles) * 100));
  }, [atsCurrentCycles, atsLifespanCycles]);

  const atsHealthTheme = useMemo(() => {
    const remainingPct = Math.max(0, 100 - atsWearPercent);
    return getAtsHealthTheme(remainingPct);
  }, [atsWearPercent]);

  const atsStatusBadge = useMemo(() => {
    const remainingPct = Math.max(0, 100 - atsWearPercent);
    if (remainingPct >= 80) return getAtsStatusBadge("EXCELLENT");
    if (remainingPct >= 50) return getAtsStatusBadge("GOOD");
    if (remainingPct >= 20) return getAtsStatusBadge("ATTENTION");
    return getAtsStatusBadge("CRITICAL");
  }, [atsWearPercent]);

  // Ações de Teste ATS
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
          "Esta ação ativará a saída AC da sua estação EcoFlow. A Chave de Transferência Automática (ATS) comutará fisicamente o circuito para a bateria.",
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
          "Esta ação desligará a saída AC da EcoFlow. A ATS comutará fisicamente o circuito para a rede da concessionária.",
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
        "Esta ação requisitará leitura imediata à API da EcoFlow para validar a comunicação e o estado das baterias.",
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
        toast({
          title: json.data.isSuccess ? "Comutação executada" : "Falha na comutação",
          description: json.data.summaryMessage,
          variant: json.data.isSuccess ? "success" : "destructive",
        });
        if (actionTarget !== "ECOFLOW_TELEMETRY" && json.data.isSuccess) {
          // Incrementa contador de ciclos localmente
          setAtsCurrentCycles((prev) => prev + 1);
          setAtsLastSwitchedAt(new Date().toISOString());
        }
      } else {
        const summary = json.message || "Falha na execução do teste.";
        setTestFeedback({
          isSuccess: false,
          summary,
          ecoflowMessage: "Verifique credenciais e conexão de rede.",
        });
        toast({ title: "Erro no teste", description: summary, variant: "destructive" });
      }
    } catch {
      const summary = "Erro ao comunicar com a rota de testes.";
      setTestFeedback({
        isSuccess: false,
        summary,
        ecoflowMessage: "Falha de rede local.",
      });
      toast({ title: "Erro de rede", description: summary, variant: "destructive" });
    } finally {
      setIsTestingEcoFlow(false);
    }
  };

  const batteryTemp =
    liveTelemetry?.batteryTempCelsius ?? liveTelemetry?.batteryTemperature ?? null;
  const batterySoh = liveTelemetry?.batterySoh ?? null;
  const batteryCycles = liveTelemetry?.batteryCycles ?? null;

  return (
    <Layout title="Hardware & Dispositivos">
      <div className="space-y-6">
        {/* Banner Informativo Superior */}
        <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 shadow-xl flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
            <Cpu className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2">
              Central de Hardware &amp; Dispositivos Físicos
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                EcoFlow + ATS Tomzn + Cargas
              </span>
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Monitore a integridade físico-química da bateria LiFePO4, acompanhe o desgaste mecânico da Chave de Transferência Automática (ATS) e simule a autonomia da sua residência sob demanda.
            </p>
          </div>
        </div>

        {/* ============================================================ */}
        {/* CARD 1: Saúde da Bateria & BMS */}
        {/* ============================================================ */}
        <section
          aria-label="Saúde da Bateria e BMS"
          className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <BatteryCharging className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                  Saúde da Bateria &amp; BMS (LiFePO4)
                  {batterySoh !== null && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                      SOH {batterySoh}%
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-400">
                  Estado de saúde química (SOH), contagem de ciclos, temperatura das células e limites nativos
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1 rounded-full bg-slate-950 text-emerald-300 border border-slate-800">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Química LiFePO4
              </span>
            </div>
          </div>

          {/* Grid de Métricas Principais de Hardware */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* SOH */}
            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                Saúde (SOH)
              </span>
              <div className="text-lg sm:text-xl font-bold font-mono text-emerald-400">
                {batterySoh !== null ? `${batterySoh}%` : "100% (Estimado)"}
              </div>
              <span className="text-[10px] text-slate-500 block">Capacidade retida</span>
            </div>

            {/* Ciclos Realizados */}
            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                Ciclos da Bateria
              </span>
              <div className="text-lg sm:text-xl font-bold font-mono text-cyan-400">
                {batteryCycles !== null ? batteryCycles : "3.000+"}
              </div>
              <span className="text-[10px] text-slate-500 block">Vida nominal estimada</span>
            </div>

            {/* Temperatura das Células */}
            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5 text-amber-400" />
                Temperatura Atual
              </span>
              <div className="text-lg sm:text-xl font-bold font-mono text-amber-400">
                {batteryTemp !== null ? `${batteryTemp.toFixed(1)}°C` : "26.5°C"}
              </div>
              <span className="text-[10px] text-slate-500 block">Zona de operação segura</span>
            </div>

            {/* Capacidade Nominal Total */}
            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-sky-400" />
                Capacidade Total
              </span>
              <div className="text-lg sm:text-xl font-bold font-mono text-sky-400">
                {batteryCapacityWh.toLocaleString("pt-BR")} Wh
              </div>
              <span className="text-[10px] text-slate-500 block">Banco de baterias</span>
            </div>
          </div>

          {/* Limites Operacionais Nativos Detectados no App EcoFlow */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Limites Nativos da Estação EcoFlow
                </span>
                {deviceMaxChargeSoc !== null ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    Sincronizado via App
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold bg-slate-800 text-slate-400 border border-slate-700">
                    Aguardando Telemetria
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-300 block">Teto de Carga (App EcoFlow)</span>
                  <span className="text-[11px] text-slate-500">Comuta ATS ao atingir o limite</span>
                </div>
                <span className="font-mono font-bold text-sm text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded border border-emerald-500/20">
                  {deviceMaxChargeSoc !== null ? `${deviceMaxChargeSoc}%` : "100% (Padrão)"}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-300 block">Piso de Descarga (BMS Seguro)</span>
                  <span className="text-[11px] text-slate-500">Corte preventivo do inversor</span>
                </div>
                <span className="font-mono font-bold text-sm text-sky-400 bg-sky-500/10 px-2.5 py-1 rounded border border-sky-500/20">
                  {deviceMinDsgSoc !== null ? `${deviceMinDsgSoc}%` : "0% (Padrão)"}
                </span>
              </div>
            </div>
          </div>

          {/* Configuração de Limites Térmicos & Capacidade Nominal */}
          <div className="space-y-4 pt-2 border-t border-slate-800">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Parâmetros de Proteção Térmica &amp; Capacidade
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="battery-capacity-input" className="text-xs font-semibold text-slate-300 block">
                  Capacidade Nominal (Wh)
                </label>
                <input
                  id="battery-capacity-input"
                  type="number"
                  min={100}
                  max={50000}
                  value={batteryCapacityWh}
                  onChange={(e) => setBatteryCapacityWh(Math.max(100, parseInt(e.target.value, 10) || 100))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="thermal-warning-input" className="text-xs font-semibold text-slate-300 block">
                  Alerta Térmico Preventivo (°C)
                </label>
                <input
                  id="thermal-warning-input"
                  type="number"
                  step="0.5"
                  min={30}
                  max={60}
                  value={thermalWarningThreshold}
                  onChange={(e) => setThermalWarningThreshold(parseFloat(e.target.value) || 45.0)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="thermal-shutdown-input" className="text-xs font-semibold text-slate-300 block">
                  Corte de Emergência AC (°C)
                </label>
                <input
                  id="thermal-shutdown-input"
                  type="number"
                  step="0.5"
                  min={40}
                  max={65}
                  value={thermalShutdownThreshold}
                  onChange={(e) => setThermalShutdownThreshold(parseFloat(e.target.value) || 50.0)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            {/* Presets Rápidos de Estações EcoFlow */}
            <div className="space-y-2 pt-2">
              <span className="text-[11px] font-semibold text-slate-400 block">
                Presets de Modelos EcoFlow Homologados:
              </span>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {[
                  { label: "RIVER 2 Pro", wh: 768 },
                  { label: "DELTA 2", wh: 1024 },
                  { label: "DELTA 2 Max", wh: 2048 },
                  { label: "DELTA 2 Max + 1x Extra", wh: 4096 },
                  { label: "DELTA Pro", wh: 3600 },
                  { label: "DELTA Pro 3", wh: 4096 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setBatteryCapacityWh(preset.wh)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-all ${
                      batteryCapacityWh === preset.wh
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50 font-bold"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    {preset.label} ({preset.wh}Wh)
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleSaveHardwareSettings}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-md shadow-emerald-950"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Salvar Parâmetros da Bateria
              </button>
            </div>
          </div>
        </section>

        {/* ============================================================ */}
        {/* CARD 2: Chave de Transferência Automática (ATS) */}
        {/* ============================================================ */}
        <section
          aria-label="Chave de Transferência Automática ATS"
          className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <ArrowLeftRight className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                  Chave de Transferência Automática (ATS)
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${atsStatusBadge.classes}`}>
                    {atsStatusBadge.label}
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Desgaste de contatos elétricos, contagem de comutações e teste seguro de relés
                </p>
              </div>
            </div>

            <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-950 text-slate-300 border border-slate-800 self-start sm:self-auto">
              1 comutação = 1 ciclo mecânico
            </span>
          </div>

          {/* Barra de Desgaste e Saúde dos Relés */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
              <span className="font-semibold text-slate-300">
                Desgaste Mecânico Estimado dos Contatos:
              </span>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-slate-400">
                  {atsCurrentCycles.toLocaleString("pt-BR")} de {atsLifespanCycles.toLocaleString("pt-BR")} ciclos
                </span>
                <span className={`font-bold ${atsHealthTheme.text}`}>
                  ({atsWearPercent}% gasto)
                </span>
              </div>
            </div>

            {/* Barra de Progresso */}
            <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden relative">
              <div
                className={`h-full transition-all duration-500 rounded-full bg-gradient-to-r ${atsHealthTheme.barGradient}`}
                style={{ width: `${Math.min(100, Math.max(2, 100 - atsWearPercent))}%` }}
                role="progressbar"
                aria-valuenow={100 - atsWearPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 font-mono">
              <span>0% (Desgaste Nulo)</span>
              {atsLastSwitchedAt && (
                <span className="text-slate-400">
                  Última Comutação: {new Date(atsLastSwitchedAt).toLocaleString("pt-BR")}
                </span>
              )}
              <span>100% (Substituição)</span>
            </div>
          </div>

          {/* Calibração de Ciclos ATS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="ats-lifespan-input" className="text-xs font-semibold text-slate-300 block">
                Vida Útil Nominal do Relé (Ciclos)
              </label>
              <input
                id="ats-lifespan-input"
                type="number"
                min={100}
                max={1000000}
                value={atsLifespanCycles}
                onChange={(e) => setAtsLifespanCycles(Math.max(100, parseInt(e.target.value, 10) || 100))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[11px] text-slate-500 block">Padrão da Chave Tomzn: 10.000 comutações</span>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ats-current-input" className="text-xs font-semibold text-slate-300 block">
                Ciclos já Realizados (Calibração)
              </label>
              <input
                id="ats-current-input"
                type="number"
                min={0}
                max={atsLifespanCycles}
                value={atsCurrentCycles}
                onChange={(e) => setAtsCurrentCycles(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[11px] text-slate-500 block">Permite zerar ou calibrar em caso de troca</span>
            </div>
          </div>

          {/* Teste Seguro de Comutação Física ATS */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <Power className="w-4 h-4 text-amber-400" />
                <h4 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider">
                  Painel de Teste de Comutação Segura
                </h4>
              </div>
              {isTestingEcoFlow && (
                <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5 animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Comutando...
                </span>
              )}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Dispare comutações de teste controladas para verificar o acionamento físico dos relés da sua ATS. Operação protegida com diálogo de confirmação obrigatória.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={isTestingEcoFlow || !ecoflowAccessKey}
                onClick={() => requestConfirmation("ECOFLOW_TELEMETRY")}
                className="py-2.5 px-3 min-h-[44px] rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
              >
                <Activity className="w-4 h-4 text-cyan-400" />
                Testar Telemetria (SOC)
              </button>

              <button
                type="button"
                disabled={isTestingEcoFlow || !ecoflowAccessKey}
                onClick={() => requestConfirmation("ECOFLOW_ON")}
                className="py-2.5 px-3 min-h-[44px] rounded-xl font-semibold text-xs bg-emerald-950/60 hover:bg-emerald-900/80 active:scale-95 text-emerald-200 border border-emerald-800/60 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
              >
                <Zap className="w-4 h-4 text-emerald-400" />
                Ligar Saída AC (ATS &rarr; Solar)
              </button>

              <button
                type="button"
                disabled={isTestingEcoFlow || !ecoflowAccessKey}
                onClick={() => requestConfirmation("ECOFLOW_OFF")}
                className="py-2.5 px-3 min-h-[44px] rounded-xl font-semibold text-xs bg-rose-950/60 hover:bg-rose-900/80 active:scale-95 text-rose-200 border border-rose-800/60 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
              >
                <Power className="w-4 h-4 text-rose-400" />
                Desligar Saída AC (ATS &rarr; Rede)
              </button>
            </div>

            {testFeedback && (
              <div
                role="alert"
                className={`p-3 rounded-xl border text-xs font-mono space-y-1 ${
                  testFeedback.isSuccess
                    ? "bg-slate-900 border-emerald-500/40 text-emerald-300"
                    : "bg-slate-900 border-rose-500/40 text-rose-300"
                }`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  {testFeedback.isSuccess ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
                  {testFeedback.summary}
                </div>
                <div className="text-slate-400 pl-5">
                  • {testFeedback.ecoflowMessage}
                  {testFeedback.batteryPercentage !== undefined && ` | SOC: ${testFeedback.batteryPercentage}%`}
                  {testFeedback.solarWatts !== undefined && ` | Solar: ${testFeedback.solarWatts}W`}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ============================================================ */}
        {/* CARD 3: Gerenciador de Aparelhos & Cargas */}
        {/* ============================================================ */}
        <section
          aria-label="Gerenciador de Aparelhos e Cargas"
          className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Layers className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                  Gerenciador de Aparelhos &amp; Cargas
                  <span className="text-xs font-mono font-semibold text-emerald-300 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                    {appliancesList.length} cadastrados
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Cadastre eletrodomésticos e simule a autonomia real da bateria durante blecautes
                </p>
              </div>
            </div>

            <span className="text-xs font-mono text-slate-400 self-start sm:self-auto">
              Simulação Dinâmica 24/7
            </span>
          </div>

          {/* Bloco de Simulação de Autonomia por Carga Ativa */}
          <div className="p-4 sm:p-5 rounded-xl bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 border border-emerald-500/30 shadow-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400 animate-pulse" />
                <h4 className="text-xs sm:text-sm font-bold text-emerald-300 uppercase tracking-wider">
                  Simulação de Autonomia por Carga Ativa
                </h4>
              </div>
              <span className="text-xs font-mono text-slate-400">
                SOC Atual: <strong className="text-emerald-400">{simulationMetrics.currentSoc}%</strong> | Capacidade: <strong className="text-sky-400">{batteryCapacityWh} Wh</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Cargas Selecionadas</span>
                <span className="text-lg font-bold font-mono text-slate-100">
                  {simulationMetrics.activeCount} aparelhos
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Potência Combinada</span>
                <span className="text-lg font-bold font-mono text-amber-400">
                  {simulationMetrics.totalWatts} W
                </span>
              </div>

              <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/40">
                <span className="text-[11px] text-emerald-300 block">Autonomia Estimada</span>
                <span className="text-lg font-bold font-mono text-emerald-400">
                  {simulationMetrics.formattedTime}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 text-center">
              💡 Clique nos aparelhos abaixo para ativar ou desativar cada carga na simulação em tempo real.
            </p>
          </div>

          {/* Formulário de Cadastro de Novo Aparelho */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 space-y-4">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs sm:text-sm font-bold text-slate-200 uppercase tracking-wider">
                Cadastrar Novo Aparelho
              </h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="space-y-1">
                <label htmlFor="new-appliance-name" className="text-slate-400 font-medium block">
                  Nome do Aparelho
                </label>
                <input
                  id="new-appliance-name"
                  type="text"
                  placeholder="Ex: Geladeira Frost Free"
                  value={newApplianceName}
                  onChange={(e) => setNewApplianceName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="new-appliance-watts" className="text-slate-400 font-medium block">
                  Potência Média (Watts)
                </label>
                <input
                  id="new-appliance-watts"
                  type="number"
                  min={5}
                  max={10000}
                  value={newApplianceWatts}
                  onChange={(e) => setNewApplianceWatts(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="new-appliance-cat" className="text-slate-400 font-medium block">
                  Categoria
                </label>
                <select
                  id="new-appliance-cat"
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
                  <option value="AirVent">Ar-Condicionado</option>
                  <option value="Lightbulb">Iluminação / Lâmpada</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCreateAppliance}
                disabled={isCreatingAppliance || !newApplianceName.trim()}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isCreatingAppliance ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Cadastrar Carga
              </button>
            </div>
          </div>

          {/* Grade de Aparelhos Cadastrados com Toggle de Simulação */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Aparelhos Cadastrados ({appliancesList.length})
            </h4>

            {isLoadingAppliances ? (
              <div className="p-8 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                Carregando lista de aparelhos...
              </div>
            ) : appliancesList.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-500">
                Nenhum aparelho cadastrado ainda.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {appliancesList.map((appliance) => {
                  const isSelected = selectedApplianceIds.has(appliance.id);
                  const isDeleting = deletingApplianceId === appliance.id;

                  return (
                    <div
                      key={appliance.id}
                      onClick={() => toggleApplianceSimulation(appliance.id)}
                      className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all ${
                        isSelected
                          ? "bg-slate-900 border-emerald-500/50 shadow-sm shadow-emerald-950"
                          : "bg-slate-950/60 border-slate-800 opacity-60 hover:opacity-100"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`p-2 rounded-lg border shrink-0 ${
                            isSelected
                              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                              : "bg-slate-900 border-slate-800 text-slate-500"
                          }`}
                        >
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
                            <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded border bg-slate-900 text-slate-400 border-slate-800">
                              {appliance.category}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                            isSelected
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                              : "bg-slate-800 text-slate-500 border-slate-700"
                          }`}
                        >
                          {isSelected ? "Ativo" : "Off"}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAppliance(appliance.id);
                          }}
                          disabled={isDeleting}
                          aria-label={`Excluir ${appliance.name}`}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-all"
                        >
                          {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Modal de Confirmação Explícita de Segurança */}
      {confirmationModal && (
        <div
          role="dialog"
          aria-modal="true"
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
                  <h3 className="text-base font-bold text-slate-100">Confirmação de Segurança</h3>
                  <p className="text-xs text-amber-400/90 font-medium">{confirmationModal.actionTitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-slate-300 leading-relaxed">
              <p>{confirmationModal.warningText}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="modal-devices-confirm" className="text-xs text-slate-300 block">
                Digite exatamente{" "}
                <span className="font-mono font-bold text-amber-300 px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/40">
                  {confirmationModal.expectedWord}
                </span>{" "}
                abaixo para autorizar:
              </label>
              <input
                id="modal-devices-confirm"
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
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 min-h-[44px] text-base sm:text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400 font-mono tracking-wider text-center uppercase"
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 active:scale-95 transition-all cursor-pointer text-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={confirmationInput.trim().toUpperCase() !== confirmationModal.expectedWord}
                onClick={executeConfirmedAction}
                className={`w-full sm:w-auto px-5 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer ${confirmationModal.confirmButtonColor}`}
              >
                <Zap className="w-4 h-4" />
                Confirmar e Executar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
