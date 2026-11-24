import React, { useEffect, useState } from "react";
import {
  TrendingUp,
  Wallet,
  CheckCircle2,
  Clock,
  ArrowRight,
  ShieldCheck,
  Zap,
  Sparkles,
  HelpCircle,
} from "lucide-react";
import { TransitionLink } from "./TransitionLink";
import { formatCurrency } from "../utils/currencyFormatter";
import type { PaybackAnalysisResponse } from "../domain/services/PaybackCalculatorService";

export interface PaybackSummaryWidgetProps {
  className?: string;
  initialData?: PaybackAnalysisResponse | null;
  refreshIntervalMs?: number;
}

export function PaybackSummaryWidget({
  className = "",
  initialData = null,
  refreshIntervalMs = 60000,
}: PaybackSummaryWidgetProps) {
  const [data, setData] = useState<PaybackAnalysisResponse | null>(initialData);
  const [isLoading, setIsLoading] = useState<boolean>(!initialData);

  const fetchPayback = async () => {
    try {
      const res = await fetch("/api/finance/payback");
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setData(json.data);
      }
    } catch {
      // Retém gracioso
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!initialData) {
      fetchPayback();
    }
    const interval = setInterval(fetchPayback, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [initialData, refreshIntervalMs]);

  if (isLoading) {
    return (
      <div
        className={`animate-pulse rounded-2xl bg-slate-900 border border-slate-800 p-4 sm:p-6 h-64 w-full shadow-xl ${className}`}
        role="status"
        aria-label="Carregando análise de payback e amortização solar"
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800" />
            <div className="space-y-2">
              <div className="h-4 bg-slate-800 rounded w-48" />
              <div className="h-3 bg-slate-800 rounded w-32" />
            </div>
          </div>
          <div className="h-6 bg-slate-800 rounded-full w-28" />
        </div>
        <div className="mt-5 space-y-3">
          <div className="h-3 bg-slate-800 rounded-full w-full" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <div className="h-20 bg-slate-800 rounded-xl" />
            <div className="h-20 bg-slate-800 rounded-xl" />
            <div className="h-20 bg-slate-800 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // ==============================================================
  // ESTADO NÃO CONFIGURADO (Call-to-Action elegante)
  // ==============================================================
  if (!data || !data.isConfigured || data.totalCapexBrl <= 0) {
    return (
      <section
        role="region"
        aria-label="Módulo de Retorno sobre Investimento Solar (Não configurado)"
        className={`animate-card interactive-card p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/20 border border-slate-800 hover:border-emerald-500/30 shadow-xl transition-all ${className}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 shadow-md shadow-emerald-950/30">
              <Wallet className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-100">
                  Retorno sobre Investimento (Payback Solar)
                </h2>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 uppercase">
                  Novo
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 max-w-xl leading-relaxed">
                Cadastre o valor do investimento da sua estação EcoFlow e painéis solares para acompanhar o progresso diário de amortização, a data prevista de Break-Even e o lucro projetado ao longo de 10 anos.
              </p>
            </div>
          </div>

          <TransitionLink
            href="/settings"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 transition-all shadow-lg shadow-emerald-950 cursor-pointer shrink-0"
          >
            <span>Configurar Investimento (CAPEX)</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </TransitionLink>
        </div>
      </section>
    );
  }

  // ==============================================================
  // ESTADO CONFIGURADO COM MÉTRICAS ATIVAS
  // ==============================================================
  const pct = Math.min(100, Math.max(0, data.amortizationPercentage));
  const isBreakEven = data.isBreakEvenAchieved;

  // Formatação de data estimada
  let breakEvenDateFormatted = "Calculando...";
  if (data.actualBreakEvenDateIso) {
    const d = new Date(data.actualBreakEvenDateIso);
    breakEvenDateFormatted = d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
  } else if (data.discountedPayback?.estimatedBreakEvenDateIso) {
    const d = new Date(data.discountedPayback.estimatedBreakEvenDateIso);
    breakEvenDateFormatted = d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
  } else if (data.simplePayback?.estimatedBreakEvenDateIso) {
    const d = new Date(data.simplePayback.estimatedBreakEvenDateIso);
    breakEvenDateFormatted = d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
  }

  return (
    <section
      role="region"
      aria-label="Resumo do Retorno sobre Investimento Solar e Amortização do CAPEX"
      className={`animate-card interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5 flex flex-col justify-between ${className}`}
    >
      {/* 1. Cabeçalho com Título e Badge de Break-Even */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 shadow-md shadow-emerald-950/30">
            <TrendingUp className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
              Retorno sobre Investimento (Payback Solar)
            </h2>
            <p className="text-xs text-slate-400">
              Amortização do CAPEX por Microgeração Fotovoltaica EcoFlow
            </p>
          </div>
        </div>

        {/* Badge de Break-Even */}
        <div className="flex items-center gap-2">
          {isBreakEven ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm animate-pulse">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              <span>🎉 Break-Even Atingido (Quitado)</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-slate-950 text-slate-300 border border-slate-800 shadow-sm">
              <Clock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              <span>
                Break-Even em ~{data.discountedPayback?.remainingYearsEstimate ?? data.simplePayback.remainingYearsEstimate} anos ({breakEvenDateFormatted})
              </span>
            </span>
          )}
        </div>
      </div>

      {/* 2. Barra Volumétrica de Amortização */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold font-mono text-emerald-400 tracking-tight">
              {pct.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-400 font-medium">Amortizado</span>
          </div>

          <span className="text-xs font-mono text-slate-400">
            <strong className="text-emerald-300">{formatCurrency(data.amortizedAmountBrl)}</strong> de{" "}
            {formatCurrency(data.totalCapexBrl)}
          </span>
        </div>

        <div
          className="w-full bg-slate-950 rounded-full h-3.5 p-0.5 border border-slate-800 overflow-hidden relative"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progresso de amortização do CAPEX: ${pct.toFixed(1)}%`}
        >
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-out ${
              isBreakEven
                ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-300 animate-pulse"
                : "bg-gradient-to-r from-emerald-500 to-teal-400"
            }`}
            style={{ width: `${Math.max(3, pct)}%` }}
          />
        </div>
      </div>

      {/* 3. Grade com 3 Pilares Principais (Investimento, Saldo Restante e Ritmo Mensal) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
        {/* Pilar 1: Investimento Total */}
        <div className="p-3 sm:p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Investimento (CAPEX)
          </span>
          <div className="my-1.5">
            <div className="text-lg sm:text-xl font-extrabold font-mono text-slate-100">
              {formatCurrency(data.totalCapexBrl)}
            </div>
            <span className="text-[11px] text-slate-500 font-mono">
              {data.daysInOperation} dias em operação
            </span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            ROI Atual: {data.accumulatedRoiPercentage.toFixed(1)}%
          </span>
        </div>

        {/* Pilar 2: Saldo Restante */}
        <div className="p-3 sm:p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Saldo Restante
          </span>
          <div className="my-1.5">
            <div
              className={`text-lg sm:text-xl font-extrabold font-mono ${
                isBreakEven ? "text-emerald-400" : "text-amber-300"
              }`}
            >
              {formatCurrency(data.remainingBalanceBrl)}
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              {isBreakEven
                ? "100% Amortizado"
                : `Faltam ${(100 - pct).toFixed(1)}%`}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            {isBreakEven ? "Lucro líquido puro ativo" : "Em recuperação de capital"}
          </span>
        </div>

        {/* Pilar 3: Ritmo Mensal de Economia */}
        <div className="p-3 sm:p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Ritmo de Economia
          </span>
          <div className="my-1.5">
            <div className="text-lg sm:text-xl font-extrabold font-mono text-emerald-400">
              {formatCurrency(data.monthlyProjectedSavingsBrl)}
              <span className="text-xs font-normal text-slate-400">/mês</span>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              ~{formatCurrency(data.dailyAverageSavingsBrl)}/dia
            </span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            ~{formatCurrency(data.annualProjectedSavingsBrl)}/ano
          </span>
        </div>
      </div>

      {/* 4. Rodapé Executivo: Projeção LiFePO4 em 10 Anos & Link de Estatísticas */}
      <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <div className="text-slate-300">
            <span>Projeção de Lucro Líquido (10 anos LiFePO4): </span>
            <strong className="text-emerald-300 font-mono font-bold">
              {data.tenYearProjection.lifetimeNetProfitBrl >= 0
                ? `+${formatCurrency(data.tenYearProjection.lifetimeNetProfitBrl)}`
                : formatCurrency(data.tenYearProjection.lifetimeNetProfitBrl)}
            </strong>{" "}
            <span className="text-[11px] text-slate-400 font-mono">
              ({data.tenYearProjection.lifetimeRoiPercentage.toFixed(0)}% ROI)
            </span>
          </div>
        </div>

        <TransitionLink
          href="/statistics#curva-payback"
          className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 transition-colors self-end sm:self-auto min-h-[36px]"
        >
          <span>Ver Curva de Amortização</span>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </TransitionLink>
      </div>
    </section>
  );
}
