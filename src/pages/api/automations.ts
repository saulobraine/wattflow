import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { PercentageValue } from "../../domain/values/PercentageValue";
import { AutomationThresholdPair } from "../../domain/models/AutomationThresholdPair";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";

interface AutomationsResponseBody {
  success: boolean;
  message: string;
  data?: {
    turnOnThreshold: number;
    turnOffThreshold: number;
    isAutomationActive: boolean;
  };
}

export default async function handleAutomations(
  request: NextApiRequest,
  response: NextApiResponse<AutomationsResponseBody>
): Promise<void> {
  const sessionUser = extractUserFromRequest(request);
  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Por favor, faça login para acessar as automações.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  if (request.method === "GET") {
    const config = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
    });

    if (!config) {
      response.status(200).json({
        success: true,
        message: "Configuração padrão retornada.",
        data: {
          turnOnThreshold: 90,
          turnOffThreshold: 30,
          isAutomationActive: true,
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
      },
    });
    return;
  }

  if (request.method === "POST") {
    const { turnOnThreshold, turnOffThreshold, isAutomationActive } = request.body;

    try {
      const turnOnPercentage = new PercentageValue(Number(turnOnThreshold));
      const turnOffPercentage = new PercentageValue(Number(turnOffThreshold));
      new AutomationThresholdPair(turnOnPercentage, turnOffPercentage);
    } catch (domainValidationError: unknown) {
      const message = domainValidationError instanceof Error ? domainValidationError.message : "Validação inválida.";
      response.status(400).json({
        success: false,
        message: message,
      });
      return;
    }

    await prisma.userConfiguration.upsert({
      where: { userId: extractedUserId },
      update: {
        turnOnThreshold: Number(turnOnThreshold),
        turnOffThreshold: Number(turnOffThreshold),
        isAutomationActive: Boolean(isAutomationActive),
      },
      create: {
        userId: extractedUserId,
        turnOnThreshold: Number(turnOnThreshold),
        turnOffThreshold: Number(turnOffThreshold),
        isAutomationActive: Boolean(isAutomationActive),
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
