import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
} from "../../../infrastructure/auth/sessionHelper";
import { paybackPostBodySchema } from "../../../infrastructure/security/apiSchemas";
import { PaybackCalculatorService, type PaybackAnalysisResponse } from "../../../domain/services/PaybackCalculatorService";
import { AnalyticalReportService } from "../../../domain/services/AnalyticalReportService";

export interface PaybackApiResponse {
  success: boolean;
  message?: string;
  data?: PaybackAnalysisResponse;
}

export default async function handlePayback(
  request: NextApiRequest,
  response: NextApiResponse<PaybackApiResponse>
): Promise<void> {
  response.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");

  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("Allow", ["GET", "POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido.",
    });
    return;
  }

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno de autenticação.";
    response.status(500).json({
      success: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Por favor, faça login para acessar a análise de payback.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  if (request.method === "POST") {
    if (!enforceCsrfProtection(request, response)) {
      return;
    }

    const parsed = paybackPostBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const issueMessage =
        parsed.error.issues[0]?.message ?? "Parâmetros de investimento inválidos.";
      response.status(400).json({
        success: false,
        message: issueMessage,
      });
      return;
    }

    const {
      totalCapexBrl,
      installationDate,
      annualEnergyInflationRate,
      targetPaybackYears,
      capexNotes,
    } = parsed.data;

    try {
      const resolvedDate = installationDate ? new Date(installationDate) : new Date();

      await prisma.userConfiguration.upsert({
        where: { userId: extractedUserId },
        update: {
          totalCapexBrl,
          installationDate: resolvedDate,
          ...(annualEnergyInflationRate !== undefined ? { annualEnergyInflationRate } : {}),
          ...(targetPaybackYears !== undefined ? { targetPaybackYears } : {}),
          ...(capexNotes !== undefined ? { capexNotes: capexNotes ? capexNotes.trim() : null } : {}),
        },
        create: {
          userId: extractedUserId,
          totalCapexBrl,
          installationDate: resolvedDate,
          annualEnergyInflationRate: annualEnergyInflationRate ?? 6.5,
          targetPaybackYears: targetPaybackYears ?? 3.0,
          capexNotes: capexNotes ? capexNotes.trim() : null,
        },
      });
    } catch (saveError: unknown) {
      console.error("[Payback API] Erro ao salvar configurações de CAPEX:", saveError);
      response.status(500).json({
        success: false,
        message: "Erro interno ao salvar configurações de CAPEX.",
      });
      return;
    }
  }

  try {
    const configuration = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
    });

    if (!configuration) {
      response.status(404).json({
        success: false,
        message: "Configuração do usuário não encontrada.",
      });
      return;
    }

    const now = new Date();
    const installationDate = configuration.installationDate ?? now;

    // Busca histórico de logs desde a data de instalação para consolidar a economia real acumulada
    const logs = await prisma.syncExecutionLog.findMany({
      where: {
        userConfigurationId: configuration.id,
        executedAt: {
          gte: installationDate,
          lte: now,
        },
      },
      select: {
        executedAt: true,
        solarInputWatts: true,
        outputWatts: true,
        batteryPercentage: true,
        actionTriggered: true,
        executionDetails: true,
        batteryTempCelsius: true,
        batterySoh: true,
        batteryCycles: true,
      },
      orderBy: { executedAt: "asc" },
      take: 50000,
    });

    const reportService = AnalyticalReportService.getInstance();
    const consolidated = reportService.consolidateReport({
      logs,
      config: configuration,
      period: "custom",
      startDate: installationDate,
      endDate: now,
    });

    const totalAccumulatedSavingsBrl = consolidated.summary.totalEstimatedSavingsBrl;

    const paybackService = PaybackCalculatorService.getInstance();
    const paybackData = paybackService.calculate({
      totalCapexBrl: configuration.totalCapexBrl ?? 0.0,
      installationDate: configuration.installationDate,
      totalAccumulatedSavingsBrl,
      annualEnergyInflationRate: configuration.annualEnergyInflationRate ?? 6.5,
      targetPaybackYears: configuration.targetPaybackYears ?? 3.0,
      now,
    });

    response.status(200).json({
      success: true,
      data: paybackData,
    });
  } catch (error: unknown) {
    console.error("[Payback API] Erro ao calcular retorno sobre investimento:", error);
    const message =
      error instanceof Error ? error.message : "Erro interno ao calcular análise de payback.";
    response.status(500).json({
      success: false,
      message,
    });
  }
}
