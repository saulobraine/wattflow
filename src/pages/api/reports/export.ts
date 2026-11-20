import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import { reportsExportQuerySchema } from "../../../infrastructure/security/apiSchemas";
import {
  AnalyticalReportService,
  type ReportPeriod,
  type ReportFormat,
} from "../../../domain/services/AnalyticalReportService";

export default async function handleReportsExport(
  request: NextApiRequest,
  response: NextApiResponse
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", ["GET"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido.",
    });
    return;
  }

  response.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno de configuração de autenticação.";
    response.status(500).json({
      success: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Por favor, faça login para acessar os relatórios analíticos.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const queryValidation = reportsExportQuerySchema.safeParse(request.query);
  if (!queryValidation.success) {
    response.status(400).json({
      success: false,
      message:
        queryValidation.error.issues[0]?.message ?? "Parâmetros de relatório inválidos.",
    });
    return;
  }

  const { format, period, startDate: queryStart, endDate: queryEnd, delimiter } = queryValidation.data;

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

    const reportService = AnalyticalReportService.getInstance();
    const { startDate, endDate, periodLabel } = reportService.resolveDateRange(
      period as ReportPeriod,
      queryStart,
      queryEnd
    );

    const logs = await prisma.syncExecutionLog.findMany({
      where: {
        userConfigurationId: configuration.id,
        executedAt: {
          gte: startDate,
          lte: endDate,
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

    const report = reportService.consolidateReport({
      logs,
      config: configuration,
      period: period as ReportPeriod,
      startDate,
      endDate,
      periodLabel,
    });

    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    if (format === "csv") {
      const csvContent = reportService.generateCsv(report, {
        delimiter: delimiter as ";" | ",",
      });
      const filename = `wattflow-relatorio-${period}-${dateFormatted}.csv`;

      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      response.status(200).send(csvContent);
      return;
    }

    if (format === "pdf") {
      const htmlContent = reportService.generatePrintableHtml(report, "WattFlow");
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader(
        "Content-Disposition",
        `inline; filename="wattflow-relatorio-${period}-${dateFormatted}.html"`
      );
      response.status(200).send(htmlContent);
      return;
    }

    // Default: format === "json"
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.status(200).json({
      success: true,
      data: report,
    });
  } catch (error: unknown) {
    console.error("[Reports Export API] Erro ao consolidar relatório analítico:", error);
    const message =
      error instanceof Error ? error.message : "Erro interno ao processar relatório analítico.";
    response.status(500).json({
      success: false,
      message,
    });
  }
}
