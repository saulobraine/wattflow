export interface PaybackAnalysisResponse {
  isConfigured: boolean;
  totalCapexBrl: number;
  installationDateIso: string;
  daysInOperation: number;
  totalAccumulatedSavingsBrl: number;
  amortizedAmountBrl: number;
  remainingBalanceBrl: number;
  amortizationPercentage: number;
  accumulatedRoiPercentage: number;
  isBreakEvenAchieved: boolean;
  actualBreakEvenDateIso: string | null;
  dailyAverageSavingsBrl: number;
  monthlyProjectedSavingsBrl: number;
  annualProjectedSavingsBrl: number;
  simplePayback: {
    estimatedBreakEvenDateIso: string | null;
    remainingDaysEstimate: number;
    remainingMonthsEstimate: number;
    remainingYearsEstimate: number;
  };
  discountedPayback: {
    annualEnergyInflationRate: number;
    estimatedBreakEvenDateIso: string | null;
    remainingYearsEstimate: number;
  };
  tenYearProjection: {
    lifetimeGrossSavingsBrl: number;
    lifetimeNetProfitBrl: number;
    lifetimeRoiPercentage: number;
  };
  amortizationCurvePoints: Array<{
    monthIndex: number;
    label: string;
    dateIso: string;
    capexThresholdBrl: number;
    accumulatedSavingsBrl: number;
    isProjected: boolean;
  }>;
}

const MONTH_NAMES_SHORT_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

/**
 * Serviço de domínio puro para cálculo de Retorno sobre Investimento (Payback Solar),
 * amortização do CAPEX, break-even e projeções financeiras plurianuais com inflação ANEEL.
 */
export class PaybackCalculatorService {
  private static instance: PaybackCalculatorService | null = null;

  public static getInstance(): PaybackCalculatorService {
    if (!PaybackCalculatorService.instance) {
      PaybackCalculatorService.instance = new PaybackCalculatorService();
    }
    return PaybackCalculatorService.instance;
  }

  /**
   * Consolida métricas de amortização, break-even e projeções financeiras.
   */
  public calculate(params: {
    totalCapexBrl: number;
    installationDate?: Date | string | null;
    totalAccumulatedSavingsBrl: number;
    annualEnergyInflationRate?: number;
    targetPaybackYears?: number;
    now?: Date;
  }): PaybackAnalysisResponse {
    const now = params.now ?? new Date();
    const totalCapexBrl = Math.max(0, Number(params.totalCapexBrl ?? 0));
    const totalAccumulatedSavingsBrl = Math.max(0, Number(params.totalAccumulatedSavingsBrl ?? 0));
    const annualEnergyInflationRate = Math.max(0, Number(params.annualEnergyInflationRate ?? 6.5));

    let parsedInstallationDate = now;
    if (params.installationDate) {
      const parsed =
        params.installationDate instanceof Date
          ? params.installationDate
          : new Date(params.installationDate);
      if (!isNaN(parsed.getTime())) {
        parsedInstallationDate = parsed;
      }
    }

    // Se o CAPEX não estiver configurado ou for zero
    if (totalCapexBrl <= 0) {
      return {
        isConfigured: false,
        totalCapexBrl: 0,
        installationDateIso: parsedInstallationDate.toISOString(),
        daysInOperation: 0,
        totalAccumulatedSavingsBrl: Number(totalAccumulatedSavingsBrl.toFixed(2)),
        amortizedAmountBrl: 0,
        remainingBalanceBrl: 0,
        amortizationPercentage: 0,
        accumulatedRoiPercentage: 0,
        isBreakEvenAchieved: false,
        actualBreakEvenDateIso: null,
        dailyAverageSavingsBrl: 0,
        monthlyProjectedSavingsBrl: 0,
        annualProjectedSavingsBrl: 0,
        simplePayback: {
          estimatedBreakEvenDateIso: null,
          remainingDaysEstimate: 0,
          remainingMonthsEstimate: 0,
          remainingYearsEstimate: 0,
        },
        discountedPayback: {
          annualEnergyInflationRate,
          estimatedBreakEvenDateIso: null,
          remainingYearsEstimate: 0,
        },
        tenYearProjection: {
          lifetimeGrossSavingsBrl: 0,
          lifetimeNetProfitBrl: 0,
          lifetimeRoiPercentage: 0,
        },
        amortizationCurvePoints: [],
      };
    }

    const elapsedMs = Math.max(0, now.getTime() - parsedInstallationDate.getTime());
    const daysInOperation = Math.max(1, Math.floor(elapsedMs / (1000 * 60 * 60 * 24)));

    const dailyVelocity = totalAccumulatedSavingsBrl / daysInOperation;
    const dailyAverageSavingsBrl = Number(dailyVelocity.toFixed(2));
    const monthlyProjectedSavingsBrl = Number((dailyVelocity * 30.4375).toFixed(2));
    const annualProjectedSavingsBrl = Number((dailyVelocity * 365.25).toFixed(2));

    const amortizedAmountBrl = Number(Math.min(totalCapexBrl, totalAccumulatedSavingsBrl).toFixed(2));
    const remainingBalanceBrl = Number(Math.max(0, totalCapexBrl - totalAccumulatedSavingsBrl).toFixed(2));

    const amortizationPercentage = Number(Math.min(100, (amortizedAmountBrl / totalCapexBrl) * 100).toFixed(1));
    const accumulatedRoiPercentage = Number(
      (((totalAccumulatedSavingsBrl - totalCapexBrl) / totalCapexBrl) * 100).toFixed(1)
    );

    const isBreakEvenAchieved = remainingBalanceBrl === 0;

    let actualBreakEvenDateIso: string | null = null;
    if (isBreakEvenAchieved) {
      if (dailyVelocity > 0) {
        const daysToCapex = Math.round(totalCapexBrl / dailyVelocity);
        const calcBreakEvenDate = new Date(parsedInstallationDate.getTime() + daysToCapex * 86400000);
        actualBreakEvenDateIso = (calcBreakEvenDate <= now ? calcBreakEvenDate : now).toISOString();
      } else {
        actualBreakEvenDateIso = now.toISOString();
      }
    }

    // Payback Simples
    let simpleEstDateIso: string | null = null;
    let simpleDays = 0;
    let simpleMonths = 0;
    let simpleYears = 0;

    if (isBreakEvenAchieved) {
      simpleEstDateIso = actualBreakEvenDateIso;
    } else if (dailyVelocity > 0) {
      simpleDays = Math.ceil(remainingBalanceBrl / dailyVelocity);
      simpleMonths = Number((simpleDays / 30.4375).toFixed(1));
      simpleYears = Number((simpleDays / 365.25).toFixed(1));
      const estDate = new Date(now.getTime() + simpleDays * 86400000);
      simpleEstDateIso = estDate.toISOString();
    }

    // Payback Descontado (com inflação tarifária anual ANEEL)
    let discountedEstDateIso: string | null = null;
    let discountedYears = 0;

    if (isBreakEvenAchieved) {
      discountedEstDateIso = actualBreakEvenDateIso;
    } else if (dailyVelocity > 0) {
      let accumulatedFuture = 0;
      let monthCounter = 0;
      const MAX_MONTHS = 600; // 50 anos limite de convergência

      while (accumulatedFuture < remainingBalanceBrl && monthCounter < MAX_MONTHS) {
        monthCounter += 1;
        const yearOffset = Math.floor((monthCounter - 1) / 12);
        const adjustedMonthly = monthlyProjectedSavingsBrl * Math.pow(1 + annualEnergyInflationRate / 100, yearOffset);
        accumulatedFuture += adjustedMonthly;
      }

      discountedYears = Number((monthCounter / 12).toFixed(1));
      const estDiscDate = new Date(now.getTime() + monthCounter * 30.4375 * 86400000);
      discountedEstDateIso = estDiscDate.toISOString();
    }

    // Projeção de 10 Anos (Lifetime LiFePO4)
    let lifetimeGross = 0;
    for (let year = 1; year <= 10; year++) {
      const yearSavings = annualProjectedSavingsBrl * Math.pow(1 + annualEnergyInflationRate / 100, year - 1);
      lifetimeGross += yearSavings;
    }

    const lifetimeGrossSavingsBrl = Number(lifetimeGross.toFixed(2));
    const lifetimeNetProfitBrl = Number((lifetimeGross - totalCapexBrl).toFixed(2));
    const lifetimeRoiPercentage = Number(((lifetimeNetProfitBrl / totalCapexBrl) * 100).toFixed(1));

    // Curva Temporal de Amortização
    const curvePoints = this.generateAmortizationCurve({
      installationDate: parsedInstallationDate,
      now,
      totalCapexBrl,
      totalAccumulatedSavingsBrl,
      dailyVelocity,
      annualEnergyInflationRate,
      isBreakEvenAchieved,
    });

    return {
      isConfigured: true,
      totalCapexBrl: Number(totalCapexBrl.toFixed(2)),
      installationDateIso: parsedInstallationDate.toISOString(),
      daysInOperation,
      totalAccumulatedSavingsBrl: Number(totalAccumulatedSavingsBrl.toFixed(2)),
      amortizedAmountBrl,
      remainingBalanceBrl,
      amortizationPercentage,
      accumulatedRoiPercentage,
      isBreakEvenAchieved,
      actualBreakEvenDateIso,
      dailyAverageSavingsBrl,
      monthlyProjectedSavingsBrl,
      annualProjectedSavingsBrl,
      simplePayback: {
        estimatedBreakEvenDateIso: simpleEstDateIso,
        remainingDaysEstimate: simpleDays,
        remainingMonthsEstimate: simpleMonths,
        remainingYearsEstimate: simpleYears,
      },
      discountedPayback: {
        annualEnergyInflationRate,
        estimatedBreakEvenDateIso: discountedEstDateIso,
        remainingYearsEstimate: discountedYears,
      },
      tenYearProjection: {
        lifetimeGrossSavingsBrl,
        lifetimeNetProfitBrl,
        lifetimeRoiPercentage,
      },
      amortizationCurvePoints: curvePoints,
    };
  }

  private generateAmortizationCurve(params: {
    installationDate: Date;
    now: Date;
    totalCapexBrl: number;
    totalAccumulatedSavingsBrl: number;
    dailyVelocity: number;
    annualEnergyInflationRate: number;
    isBreakEvenAchieved: boolean;
  }): Array<{
    monthIndex: number;
    label: string;
    dateIso: string;
    capexThresholdBrl: number;
    accumulatedSavingsBrl: number;
    isProjected: boolean;
  }> {
    const {
      installationDate,
      now,
      totalCapexBrl,
      totalAccumulatedSavingsBrl,
      dailyVelocity,
      annualEnergyInflationRate,
    } = params;

    const points: Array<{
      monthIndex: number;
      label: string;
      dateIso: string;
      capexThresholdBrl: number;
      accumulatedSavingsBrl: number;
      isProjected: boolean;
    }> = [];

    const instYear = installationDate.getFullYear();
    const instMonth = installationDate.getMonth();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth();

    const historicalMonthsCount = Math.max(1, (nowYear - instYear) * 12 + (nowMonth - instMonth));
    const projectedFutureMonths = 36; // 3 anos projetados
    const totalMonths = Math.min(120, historicalMonthsCount + projectedFutureMonths);

    let runningSavings = 0;
    const historicalIncrementPerMonth = totalAccumulatedSavingsBrl / historicalMonthsCount;

    for (let m = 0; m <= totalMonths; m++) {
      const pointDate = new Date(instYear, instMonth + m, 1);
      const isProjected = pointDate > now;

      if (!isProjected) {
        runningSavings = Math.min(totalAccumulatedSavingsBrl, m * historicalIncrementPerMonth);
      } else {
        const futureMonthIndex = m - historicalMonthsCount;
        const yearOffset = Math.floor(futureMonthIndex / 12);
        const adjustedMonthly =
          dailyVelocity * 30.4375 * Math.pow(1 + annualEnergyInflationRate / 100, yearOffset);
        runningSavings += adjustedMonthly;
      }

      const shortMonth = MONTH_NAMES_SHORT_PT[pointDate.getMonth()] ?? "Mês";
      const yearTwoDigits = String(pointDate.getFullYear()).slice(-2);
      const label = `${shortMonth}/${yearTwoDigits}`;

      points.push({
        monthIndex: m,
        label,
        dateIso: pointDate.toISOString(),
        capexThresholdBrl: Number(totalCapexBrl.toFixed(2)),
        accumulatedSavingsBrl: Number(runningSavings.toFixed(2)),
        isProjected,
      });

      // Se já passou do break-even em pelo menos 12 meses futuros, finaliza a curva
      if (isProjected && runningSavings >= totalCapexBrl * 1.5 && m >= historicalMonthsCount + 12) {
        break;
      }
    }

    return points;
  }
}
