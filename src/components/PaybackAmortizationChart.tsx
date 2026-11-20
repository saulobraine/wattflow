import React, { useEffect, useState, useMemo } from "react";
import {
  TrendingUp,
  Wallet,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Sparkles,
  ArrowRight,
  Flame,
} from "lucide-react";
import { TransitionLink } from "./TransitionLink";
import type { PaybackAnalysisResponse } from "../domain/services/PaybackCalculatorService";

export interface PaybackAmortizationChartProps {
  className?: string;
  refreshIntervalMs?: number;
}

interface HoveredPointInfo {
  x: number;
  y: number;
  label: string;
  accumulatedSavingsBrl: number;
  capexThresholdBrl: number;
  isProjected: boolean;
  percentage: number;
}

interface BreakEvenCoords {
  x: number;
  y: number;
  label: string;
}

interface ChartGeometry {
  svgW: number;
  svgH: number;
  padX: number;
  padTop: number;
  padBottom: number;
  capexY: number;
  historicalPath: string;
  historicalArea: string;
  projectedPath: string;
  breakEvenCoords: BreakEvenCoords | null;
  points: PaybackAnalysisResponse["amortizationCurvePoints"];
  getX: (index: number) => number;
  getY: (val: number) => number;
  maxVal: number;
}

export function PaybackAmortizationChart({
  className = "",
  refreshIntervalMs = 60000,
}: PaybackAmortizationChartProps) {
  const [data, setData] = useState<PaybackAnalysisResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hoveredPoint, setHoveredPoint] = useState<HoveredPointInfo | null>(null);

  const fetchPayback = async () => {
    try {
      const res = await fetch("/api/finance/payback");
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setData(json.data);
      }
    } catch {
      // Retém silencioso
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPayback();
    const interval = setInterval(fetchPayback, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [refreshIntervalMs]);

  // Cálculos de Geometria do Gráfico SVG
  const chartGeometry = useMemo<ChartGeometry | null>(() => {
    if (!data || !data.amortizationCurvePoints || data.amortizationCurvePoints.length === 0) {
      return null;
    }

    const points = data.amortizationCurvePoints;
    const capex = data.totalCapexBrl;
    const maxVal = Math.max(
      capex * 1.25,
      ...points.map((p) => p.accumulatedSavingsBrl),
      100
    );

    const svgW = 1000;
    const svgH = 260;
    const padX = 45;
    const padTop = 25;
    const padBottom = 30;
    const chartW = svgW - padX * 2;
    const chartH = svgH - padTop - padBottom;
    const yZero = svgH - padBottom;

    const getX = (index: number) =>
      padX + (points.length > 1 ? (index / (points.length - 1)) * chartW : chartW / 2);

    const getY = (val: number) => {
      const clamped = Math.max(0, Math.min(val, maxVal));
      return yZero - (clamped / maxVal) * chartH;
    };

    // Linha de CAPEX
    const capexY = getY(capex);

    // Separar pontos históricos e projetados
    const historicalPoints: Array<{ x: number; y: number; index: number }> = [];
    const projectedPoints: Array<{ x: number; y: number; index: number }> = [];

    // Encontrar ponto de Break-Even
    let breakEvenIndex = -1;
    let breakEvenCoords: { x: number; y: number; label: string } | null = null;

    points.forEach((p, i) => {
      const x = getX(i);
      const y = getY(p.accumulatedSavingsBrl);

      if (!p.isProjected) {
        historicalPoints.push({ x, y, index: i });
      } else {
        // Se for o primeiro ponto projetado, conecta com o último histórico
        if (projectedPoints.length === 0 && historicalPoints.length > 0) {
          projectedPoints.push(historicalPoints[historicalPoints.length - 1]);
        }
        projectedPoints.push({ x, y, index: i });
      }

      // Marcador do primeiro ponto que cruza ou atinge o CAPEX
      if (p.accumulatedSavingsBrl >= capex && breakEvenIndex === -1) {
        breakEvenIndex = i;
        breakEvenCoords = { x, y, label: p.label };
      }
    });

    const historicalPath = historicalPoints
      .map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(" ");

    const projectedPath = projectedPoints
      .map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(" ");

    // Área sob a curva real
    const historicalArea =
      historicalPoints.length > 0
        ? `${historicalPath} L ${historicalPoints[historicalPoints.length - 1].x.toFixed(1)} ${yZero} L ${historicalPoints[0].x.toFixed(1)} ${yZero} Z`
        : "";

    return {
      svgW,
      svgH,
      padX,
      padTop,
      padBottom,
      capexY,
      historicalPath,
      historicalArea,
      projectedPath,
      breakEvenCoords,
      points,
      getX,
      getY,
      maxVal,
    };
  }, [data]);

  if (isLoading) {
    return (
      <div
        className={`animate-pulse p-6 rounded-2xl bg-slate-900 border border-slate-800 h-96 w-full ${className}`}
        role="status"
        aria-label="Carregando curva de amortização do CAPEX solar"
      >
        <div className="h-6 bg-slate-800 rounded w-1/3 mb-4" />
        <div className="h-4 bg-slate-800 rounded w-1/2 mb-8" />
        <div className="h-56 bg-slate-800/60 rounded-xl" />
      </div>
    );
  }

  // ==============================================================
  // ESTADO NÃO CONFIGURADO
  // ==============================================================
  if (!data || !data.isConfigured || data.totalCapexBrl <= 0) {
    return (
      <section
        id="curva-payback"
        aria-label="Curva de Amortização & Payback Solar"
        className={`animate-card interactive-card p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl ${className}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <TrendingUp className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-100">
                Curva de Amortização &amp; Payback Solar
              </h3>
              <p className="text-xs text-slate-400">
                Cadastre o investimento total (CAPEX) para visualizar a trajetória até o Break-Even
              </p>
            </div>
          </div>
          <TransitionLink
            href="/settings"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shrink-0"
          >
            <span>Configurar CAPEX em Ajustes</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </TransitionLink>
        </div>

        <div className="py-12 text-center text-xs text-slate-400 space-y-2">
          <Wallet className="w-8 h-8 text-slate-600 mx-auto" aria-hidden="true" />
          <p>Nenhum valor de investimento inicial cadastrado.</p>
          <p className="text-slate-500">
            Informe o custo da sua estação EcoFlow e painéis solares para desbloquear a curva de amortização.
          </p>
        </div>
      </section>
    );
  }

  // ==============================================================
  // ESTADO ATIVO: GRÁFICO E TABELA EXECUTIVA
  // ==============================================================
  const isBreakEven = data.isBreakEvenAchieved;

  return (
    <section
      id="curva-payback"
      aria-label="Curva de Amortização & Payback Solar"
      className={`animate-card interactive-card p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6 ${className}`}
    >
      {/* 1. Topo: Título, Subtítulo e Badges Executivos */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            <h3 className="font-bold text-lg text-slate-100">
              Curva de Amortização &amp; Payback Solar
            </h3>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 uppercase">
              CAPEX vs Retorno
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Trajetória de amortização do capital investido e cruzamento no ponto de equilíbrio (Break-Even)
          </p>
        </div>

        {/* Resumo Rápido em Badges */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <span className="px-3 py-1 rounded-full bg-slate-950 border border-slate-800 text-slate-300">
            Investimento: <strong className="text-slate-100">R$ {data.totalCapexBrl.toFixed(2)}</strong>
          </span>
          <span className="px-3 py-1 rounded-full bg-slate-950 border border-slate-800 text-emerald-400">
            Amortizado: <strong>R$ {data.amortizedAmountBrl.toFixed(2)}</strong> ({data.amortizationPercentage.toFixed(1)}%)
          </span>
          {isBreakEven ? (
            <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold animate-pulse">
              🎉 Sistema 100% Quitado
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
              Break-Even: ~{data.discountedPayback.remainingYearsEstimate} anos
            </span>
          )}
        </div>
      </div>

      {/* 2. Legenda do Gráfico Multi-Série */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/80 border border-slate-800/80 p-3.5 rounded-xl text-xs font-mono">
        <div className="flex flex-wrap items-center gap-4">
          {/* Linha CAPEX */}
          <div className="flex items-center gap-2">
            <span className="w-4 h-0.5 bg-rose-400/80 border-t border-rose-400" />
            <span className="text-rose-300">Linha de Investimento (CAPEX)</span>
          </div>

          {/* Linha Real */}
          <div className="flex items-center gap-2">
            <span className="w-4 h-1 bg-emerald-500 rounded-full shadow-sm shadow-emerald-500/50" />
            <span className="text-emerald-300 font-bold">Economia Real Acumulada</span>
          </div>

          {/* Linha Projetada */}
          <div className="flex items-center gap-2">
            <span className="w-4 h-1 border-t-2 border-dashed border-cyan-400" />
            <span className="text-cyan-300">Projeção Futura (Inflação 6.5% a.a.)</span>
          </div>

          {/* Marcador Break-Even */}
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-white ring-2 ring-amber-400/50" />
            <span className="text-amber-300">Ponto de Break-Even</span>
          </div>
        </div>

        <span className="text-[11px] text-slate-500">
          Passe o mouse ou toque para inspecionar os meses
        </span>
      </div>

      {/* 3. Área SVG da Curva de Amortização */}
      {chartGeometry && (
        <div className="relative h-72 sm:h-80 w-full pt-4 pb-2 px-1">
          <svg
            className="w-full h-full overflow-visible"
            viewBox={`0 0 ${chartGeometry.svgW} ${chartGeometry.svgH}`}
            preserveAspectRatio="none"
          >
            <defs>
              {/* Gradiente da Área Real */}
              <linearGradient id="paybackAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
              </linearGradient>

              {/* Filtro de Brilho Neon */}
              <filter id="paybackGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Linha de Referência do CAPEX (Horizontal) */}
            <line
              x1={chartGeometry.padX}
              y1={chartGeometry.capexY}
              x2={chartGeometry.svgW - chartGeometry.padX}
              y2={chartGeometry.capexY}
              stroke="#f43f5e"
              strokeWidth="2"
              strokeDasharray="4 4"
              opacity="0.8"
            />
            <text
              x={chartGeometry.padX + 8}
              y={chartGeometry.capexY - 6}
              fill="#f43f5e"
              fontSize="11"
              fontFamily="monospace"
              fontWeight="bold"
            >
              CAPEX: R$ {data.totalCapexBrl.toFixed(2)}
            </text>

            {/* Área Sombreada da Economia Real */}
            {chartGeometry.historicalArea && (
              <path
                d={chartGeometry.historicalArea}
                fill="url(#paybackAreaGrad)"
                className="transition-all duration-700 ease-out"
              />
            )}

            {/* Linha Contínua da Economia Real */}
            {chartGeometry.historicalPath && (
              <path
                d={chartGeometry.historicalPath}
                fill="none"
                stroke="#10b981"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#paybackGlow)"
                className="transition-all duration-700 ease-out"
              />
            )}

            {/* Linha Tracejada da Projeção Futura */}
            {chartGeometry.projectedPath && (
              <path
                d={chartGeometry.projectedPath}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.5"
                strokeDasharray="6 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
            )}

            {/* Marcador no Ponto de Break-Even */}
            {chartGeometry.breakEvenCoords && (
              <g
                transform={`translate(${chartGeometry.breakEvenCoords.x}, ${chartGeometry.breakEvenCoords.y})`}
                className="animate-bounce"
              >
                <circle r="7" fill="#f59e0b" stroke="#ffffff" strokeWidth="2.5" />
                <circle r="12" fill="none" stroke="#f59e0b" strokeWidth="1.5" opacity="0.6" />
                <text
                  x="0"
                  y="-16"
                  textAnchor="middle"
                  fill="#fcd34d"
                  fontSize="11"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  Break-Even ({chartGeometry.breakEvenCoords.label})
                </text>
              </g>
            )}

            {/* Ponto Hovered Ativo */}
            {hoveredPoint && (
              <g transform={`translate(${hoveredPoint.x}, ${hoveredPoint.y})`}>
                <line
                  x1="0"
                  y1={-hoveredPoint.y + chartGeometry.padTop}
                  x2="0"
                  y2={chartGeometry.svgH - chartGeometry.padBottom - hoveredPoint.y}
                  stroke="#94a3b8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  opacity="0.5"
                />
                <circle
                  r="6"
                  fill={hoveredPoint.isProjected ? "#38bdf8" : "#10b981"}
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              </g>
            )}

            {/* Regiões Invisíveis para Interação de Toque/Hover */}
            {chartGeometry.points.map((p, idx) => {
              const x = chartGeometry.getX(idx);
              const y = chartGeometry.getY(p.accumulatedSavingsBrl);
              const pctAmort = Math.min(100, (p.accumulatedSavingsBrl / data.totalCapexBrl) * 100);
              const colWidth = chartGeometry.svgW / chartGeometry.points.length;

              return (
                <rect
                  key={p.monthIndex}
                  x={x - colWidth / 2}
                  y={0}
                  width={colWidth}
                  height={chartGeometry.svgH}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() =>
                    setHoveredPoint({
                      x,
                      y,
                      label: p.label,
                      accumulatedSavingsBrl: p.accumulatedSavingsBrl,
                      capexThresholdBrl: p.capexThresholdBrl,
                      isProjected: p.isProjected,
                      percentage: pctAmort,
                    })
                  }
                  onTouchStart={() =>
                    setHoveredPoint({
                      x,
                      y,
                      label: p.label,
                      accumulatedSavingsBrl: p.accumulatedSavingsBrl,
                      capexThresholdBrl: p.capexThresholdBrl,
                      isProjected: p.isProjected,
                      percentage: pctAmort,
                    })
                  }
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              );
            })}
          </svg>

          {/* Tooltip Flutuante Interativo */}
          {hoveredPoint && (
            <div
              className="absolute z-10 p-3 rounded-xl bg-slate-950 border border-slate-800 shadow-2xl pointer-events-none text-xs font-mono space-y-1 transition-all"
              style={{
                left: `${Math.max(10, Math.min(85, (hoveredPoint.x / chartGeometry.svgW) * 100))}%`,
                top: "10%",
                transform: "translateX(-50%)",
              }}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1">
                <span className="font-bold text-slate-200">{hoveredPoint.label}</span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    hoveredPoint.isProjected
                      ? "bg-sky-500/20 text-sky-300"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  {hoveredPoint.isProjected ? "Projetado" : "Realizado"}
                </span>
              </div>
              <div className="text-slate-300">
                Economia:{" "}
                <strong className="text-emerald-400">
                  R$ {hoveredPoint.accumulatedSavingsBrl.toFixed(2)}
                </strong>
              </div>
              <div className="text-slate-400 text-[11px]">
                Amortização:{" "}
                <strong className="text-slate-200">{hoveredPoint.percentage.toFixed(1)}%</strong> do
                CAPEX
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Grid Sintético de Projeção da Vida Útil (10 Anos LiFePO4) */}
      <div className="space-y-3 pt-2 border-t border-slate-800/80">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span>Projeção Financeira de Vida Útil (10 Anos LiFePO4 / ~3.000 Ciclos)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Economia Bruta */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase">Economia Bruta (10 Anos)</span>
            <div className="my-1.5">
              <div className="text-xl font-extrabold font-mono text-slate-100">
                R$ {data.tenYearProjection.lifetimeGrossSavingsBrl.toFixed(2)}
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Energia evitada da rede
              </span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              Com inflação tarifária ANEEL
            </span>
          </div>

          {/* Card 2: Lucro Líquido Acumulado */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase">Lucro Líquido Real</span>
            <div className="my-1.5">
              <div className="text-xl font-extrabold font-mono text-emerald-400">
                +R$ {data.tenYearProjection.lifetimeNetProfitBrl.toFixed(2)}
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Economia (-) CAPEX pago
              </span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              Retorno financeiro puro
            </span>
          </div>

          {/* Card 3: ROI Vitalício */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase">ROI Acumulado (10 Anos)</span>
            <div className="my-1.5">
              <div className="text-xl font-extrabold font-mono text-cyan-300">
                {data.tenYearProjection.lifetimeRoiPercentage.toFixed(0)}% ROI
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Retorno sobre o capital
              </span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              Supera aplicações tradicionais
            </span>
          </div>

          {/* Card 4: Payback Simples vs Descontado */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase">Tempo de Retorno</span>
            <div className="my-1.5">
              <div className="text-sm font-extrabold font-mono text-amber-300">
                {data.discountedPayback.remainingYearsEstimate} anos (Descontado)
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                {data.simplePayback.remainingYearsEstimate} anos (Simples)
              </span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              Inflação média: {data.discountedPayback.annualEnergyInflationRate}% a.a.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
