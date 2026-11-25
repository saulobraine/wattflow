import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  X,
  FileSpreadsheet,
  Printer,
  Download,
  Calendar,
  Sun,
  DollarSign,
  Layers,
  ShieldCheck,
  Flame,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
} from "lucide-react";
import type {
  ReportPeriod,
  ConsolidatedReport,
  ReportExecutiveSummary,
} from "../domain/services/AnalyticalReportService";
import { formatCurrency } from "../utils/currencyFormatter";
import { toast } from "../hooks/use-toast";

export interface ReportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPeriod?: ReportPeriod;
}

export function ReportExportModal({
  isOpen,
  onClose,
  defaultPeriod = "30d",
}: ReportExportModalProps) {
  const [period, setPeriod] = useState<ReportPeriod>(defaultPeriod);
  const [delimiter, setDelimiter] = useState<";" | ",">(";");

  // Datas para período personalizado (padrão últimos 7 dias)
  const todayStr = new Date().toISOString().split("T")[0];
  const sevenDaysAgoStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const [startDate, setStartDate] = useState<string>(sevenDaysAgoStr);
  const [endDate, setEndDate] = useState<string>(todayStr);

  // Estados de Preview e Ações
  const [previewData, setPreviewData] = useState<ConsolidatedReport | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  // 1. Bloqueio de Scroll do Body e Fechamento com Esc
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // 2. Carregamento do Preview Dinâmico
  const fetchPreview = useCallback(async () => {
    if (!isOpen) return;

    // Se for customizado e datas forem inválidas, não dispara
    if (period === "custom") {
      if (!startDate || !endDate) return;
      if (new Date(startDate) > new Date(endDate)) {
        setPreviewError("A data de início deve ser anterior ou igual à data de término.");
        return;
      }
    }

    setIsPreviewLoading(true);
    setPreviewError(null);
    setFeedback(null);

    try {
      const params = new URLSearchParams({
        format: "json",
        period,
        delimiter,
      });

      if (period === "custom") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }

      const res = await fetch(`/api/reports/export?${params.toString()}`);
      const json = await res.json();

      if (res.ok && json.success && json.data) {
        setPreviewData(json.data);
      } else {
        setPreviewError(json.message || "Erro ao carregar pré-visualização do relatório.");
      }
    } catch {
      setPreviewError("Falha na comunicação com o servidor ao gerar prévia.");
    } finally {
      setIsPreviewLoading(false);
    }
  }, [isOpen, period, delimiter, startDate, endDate]);

  useEffect(() => {
    if (isOpen) {
      fetchPreview();
    }
  }, [isOpen, fetchPreview]);

  if (!isOpen) return null;

  // 3. Montagem da URL de Ação
  const buildActionUrl = (format: "csv" | "pdf") => {
    const params = new URLSearchParams({
      format,
      period,
      delimiter,
    });
    if (period === "custom") {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    return `/api/reports/export?${params.toString()}`;
  };

  // 4. Disparo do Download CSV
  const handleExportCsv = async () => {
    setIsExportingCsv(true);
    setFeedback(null);

    try {
      const url = buildActionUrl("csv");
      const res = await fetch(url);

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message || "Erro no download do CSV");
      }

      const blob = await res.blob();
      const filename =
        res.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/)?.[1] ||
        `wattflow-relatorio-${period}.csv`;

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      const successMessage = "Arquivo CSV baixado com sucesso!";
      setFeedback({
        type: "success",
        message: successMessage,
      });
      toast({
        title: "Exportação concluída",
        description: successMessage,
        variant: "success",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao exportar CSV.";
      setFeedback({ type: "error", message: msg });
      toast({
        title: "Erro na exportação",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsExportingCsv(false);
    }
  };

  // 5. Visualização e Impressão do PDF Executivo
  const handlePrintPdf = () => {
    const url = buildActionUrl("pdf");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const summary: ReportExecutiveSummary | undefined = previewData?.summary;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-export-modal-title"
      aria-describedby="report-export-modal-desc"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-scale-up"
      >
        {/* ==============================================================
            CABEÇALHO DO MODAL
            ============================================================== */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-800 shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="report-export-modal-title"
                className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2"
              >
                Módulo de Relatórios Analíticos &amp; Exportação
              </h2>
              <p id="report-export-modal-desc" className="text-xs text-slate-400">
                Consolidação executiva de geração solar, tarifas, comutações da ATS e saúde do BMS
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal de exportação"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* ==============================================================
            CORPO DO MODAL (ROLÁVEL)
            ============================================================== */}
        <div className="p-4 sm:p-6 space-y-6 overflow-y-auto">
          {/* Seletor de Período em Botões Táteis */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              Período de Análise
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(
                [
                  { id: "24h", label: "Últimas 24h" },
                  { id: "7d", label: "Últimos 7 dias" },
                  { id: "30d", label: "Últimos 30 dias" },
                  { id: "month", label: "Este Mês" },
                  { id: "custom", label: "Personalizado" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPeriod(item.id)}
                  className={`min-h-[44px] px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center justify-center text-center ${
                    period === item.id
                      ? "bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-950"
                      : "bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Seletores de Data Personalizada (quando ativo) */}
          {period === "custom" && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-3 animate-fade-in">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                <Calendar className="w-4 h-4" aria-hidden="true" />
                <span>Definir Intervalo de Datas (Horário de Brasília)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="modal-start-date" className="text-[11px] font-medium text-slate-400">
                    Data Inicial:
                  </label>
                  <input
                    id="modal-start-date"
                    type="date"
                    value={startDate}
                    max={endDate || todayStr}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="modal-end-date" className="text-[11px] font-medium text-slate-400">
                    Data Final:
                  </label>
                  <input
                    id="modal-end-date"
                    type="date"
                    value={endDate}
                    min={startDate}
                    max={todayStr}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Opções de Formato & Delimitador CSV */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/60 text-xs">
            <span className="text-slate-300 font-medium flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              Separador do arquivo CSV:
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDelimiter(";")}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg font-mono text-xs font-semibold border transition-all cursor-pointer ${
                  delimiter === ";"
                    ? "bg-slate-800 text-emerald-400 border-emerald-500/50 shadow-sm"
                    : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                Ponto e vírgula (;) — Excel BR
              </button>
              <button
                type="button"
                onClick={() => setDelimiter(",")}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg font-mono text-xs font-semibold border transition-all cursor-pointer ${
                  delimiter === ","
                    ? "bg-slate-800 text-emerald-400 border-emerald-500/50 shadow-sm"
                    : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                Vírgula (,) — Internacional
              </button>
            </div>
          </div>

          {/* ==============================================================
              PREVIEW DOS KPIS EXECUTIVOS
              ============================================================== */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                Prévia Consolidada ({summary?.periodLabel || "Calculando..."})
              </span>
              {previewData?.dataPoints && (
                <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {previewData.dataPoints.length} registros processados
                </span>
              )}
            </div>

            {previewError && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5"
              >
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{previewError}</span>
              </div>
            )}

            {isPreviewLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-28 rounded-xl bg-slate-950 border border-slate-800/80 animate-pulse p-4 space-y-2"
                  >
                    <div className="h-4 bg-slate-800 rounded w-2/3" />
                    <div className="h-6 bg-slate-700 rounded w-1/2" />
                    <div className="h-3 bg-slate-800 rounded w-4/5" />
                  </div>
                ))}
              </div>
            ) : summary ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in">
                {/* KPI 1: Geração Solar */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">Geração Solar</span>
                    <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  </div>
                  <div className="my-1.5">
                    <div className="text-xl sm:text-2xl font-extrabold font-mono text-amber-300">
                      {summary.totalSolarGeneratedKwh.toFixed(2)} kWh
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Pico: {summary.peakSolarWatts} W
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Média: {summary.averageDailySolarKwh.toFixed(2)} kWh/dia
                  </span>
                </div>

                {/* KPI 2: Economia Financeira */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">Economia Total</span>
                    <DollarSign className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  </div>
                  <div className="my-1.5">
                    <div className="text-xl sm:text-2xl font-extrabold font-mono text-emerald-400">
                      {formatCurrency(summary.totalEstimatedSavingsBrl)}
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Ponta: {formatCurrency(summary.peakPeriodSavingsBrl)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Arbitragem Tarifa Branca
                  </span>
                </div>

                {/* KPI 3: Duty Cycle ATS */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">Duty Cycle ATS</span>
                    <Layers className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                  </div>
                  <div className="my-1.5">
                    <div className="text-xl sm:text-2xl font-extrabold font-mono text-cyan-300">
                      {summary.atsOperationMetrics.batteryDutyCyclePercentage.toFixed(0)}% Bat.
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {summary.atsOperationMetrics.gridDutyCyclePercentage.toFixed(0)}% Rede Concess.
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {summary.atsOperationMetrics.totalAtsSwitchesCount} comutações ATS
                  </span>
                </div>

                {/* KPI 4: Saúde LiFePO4 & Térmica */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">Saúde LiFePO4</span>
                    <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  </div>
                  <div className="my-1.5">
                    <div className="text-xl sm:text-2xl font-extrabold font-mono text-slate-100">
                      {summary.bmsHealthSummary.currentSohPercentage ?? 100}% SOH
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Máx: {summary.bmsHealthSummary.maxTempCelsius.toFixed(1)}°C
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {summary.bmsHealthSummary.thermalThrottlingEventsCount} throttles • {summary.bmsHealthSummary.thermalCutoffEventsCount} cortes
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-400">
                Selecione um período com histórico para visualizar os indicadores executivos.
              </div>
            )}
          </div>

          {/* Feedback de Operação */}
          {feedback && (
            <div
              role="alert"
              className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs animate-fade-in ${
                feedback.type === "success"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-300"
              }`}
            >
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden="true" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}
        </div>

        {/* ==============================================================
            RODAPÉ COM BOTÕES DE AÇÃO
            ============================================================== */}
        <div className="p-4 sm:p-6 border-t border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
          >
            Fechar
          </button>

          <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full sm:w-auto">
            {/* Botão Exportar CSV */}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={isExportingCsv || isPreviewLoading}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-750 text-emerald-400 border border-emerald-500/40 active:scale-95 transition-all shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isExportingCsv ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" aria-hidden="true" />
              ) : (
                <Download className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              )}
              <span>{isExportingCsv ? "Gerando CSV..." : "Exportar Planilha (CSV)"}</span>
            </button>

            {/* Botão Imprimir / Salvar PDF Executivo */}
            <button
              type="button"
              onClick={handlePrintPdf}
              disabled={isPreviewLoading}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 transition-all shadow-lg shadow-emerald-950 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Printer className="w-4 h-4 text-white" aria-hidden="true" />
              <span>Imprimir / Salvar PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
