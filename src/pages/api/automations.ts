import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { PercentageValue } from "../../domain/values/PercentageValue";
import { AutomationThresholdPair } from "../../domain/models/AutomationThresholdPair";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
} from "../../infrastructure/auth/sessionHelper";
import { automationsPostBodySchema } from "../../infrastructure/security/apiSchemas";
import { EcoFlowMqttStreamService } from "../../infrastructure/services/EcoFlowMqttStreamService";

interface AutomationsResponseBody {
  success: boolean;
  message: string;
  data?: {
    turnOnThreshold: number;
    turnOffThreshold: number;
    isAutomationActive: boolean;
    deviceMaxChargeSoc?: number | null;
    deviceMinDsgSoc?: number | null;
  };
}

export default async function handleAutomations(
  request: NextApiRequest,
  response: NextApiResponse<AutomationsResponseBody>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

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
      message: "Não autenticado. Por favor, faça login para acessar as automações.",
    });
    return;
  }

  if (request.method === "POST") {
    if (!enforceCsrfProtection(request, response)) {
      return;
    }
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  if (request.method === "GET") {
    const config = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
    });

    const liveTelemetry = EcoFlowMqttStreamService.getInstance().getLatestTelemetry(extractedUserId);
    const deviceMaxChargeSoc = liveTelemetry?.deviceMaxChargeSoc ?? null;
    const deviceMinDsgSoc = liveTelemetry?.deviceMinDsgSoc ?? null;

    if (!config) {
      response.status(200).json({
        success: true,
        message: "Configuração padrão retornada.",
        data: {
          turnOnThreshold: 90,
          turnOffThreshold: 30,
          isAutomationActive: true,
          deviceMaxChargeSoc,
          deviceMinDsgSoc,
        },
      });
      return;
    }

    response.status(200).json({
      success: true,
      message: "Configuração de automação obtida.",
      data: {
        turnOnThreshold: config.turnOnThreshold,
        turnOffThreshold: config.turnOffThreshold,
        isAutomationActive: config.isAutomationActive,
        deviceMaxChargeSoc,
        deviceMinDsgSoc,
      },
    });
    return;
  }

  if (request.method === "POST") {
    const parsedBody = automationsPostBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      const issueMessage = parsedBody.error.issues[0]?.message || "Validação inválida.";
      response.status(400).json({
        success: false,
        message: issueMessage,
      });
      return;
    }

    const { turnOnThreshold, turnOffThreshold, isAutomationActive } = parsedBody.data;

    try {
      const turnOnPercentage = new PercentageValue(turnOnThreshold);
      const turnOffPercentage = new PercentageValue(turnOffThreshold);
      new AutomationThresholdPair(turnOnPercentage, turnOffPercentage);
    } catch (domainValidationError: unknown) {
      const message =
        domainValidationError instanceof Error
          ? domainValidationError.message
          : "Validação inválida.";
      response.status(400).json({
        success: false,
        message,
      });
      return;
    }

    await prisma.userConfiguration.upsert({
      where: { userId: extractedUserId },
      update: {
        turnOnThreshold,
        turnOffThreshold,
        isAutomationActive,
      },
      create: {
        userId: extractedUserId,
        turnOnThreshold,
        turnOffThreshold,
        isAutomationActive,
      },
    });

    response.status(200).json({
      success: true,
      message: "Gatilhos de automação atualizados com sucesso!",
    });
    return;
  }

  response.setHeader("Allow", ["GET", "POST"]);
  response.status(405).json({
    success: false,
    message: "Método HTTP não permitido.",
  });
}
