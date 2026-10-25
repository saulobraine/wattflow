import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";
import { AccessKey } from "../../domain/values/AccessKey";
import { AccessSecret } from "../../domain/values/AccessSecret";
import { DeviceSerialNumber } from "../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../domain/models/EcoFlowCredentials";
import { EcoFlowHttpClient } from "../../infrastructure/http/EcoFlowHttpClient";
import { EcoFlowTestUseCase, EcoFlowTestResult } from "../../application/EcoFlowTestUseCase";

interface TestControlRequestBody {
  actionTarget: "ECOFLOW_ON" | "ECOFLOW_OFF" | "ECOFLOW_TELEMETRY";
  ecoflowEndpointRegion?: string;
  ecoflowAccessKey?: string;
  ecoflowAccessSecret?: string;
  ecoflowSerialNumber?: string;
}

interface TestControlApiResponse {
  success: boolean;
  message: string;
  data?: EcoFlowTestResult;
}

export default async function handleTestControl(
  request: NextApiRequest,
  response: NextApiResponse<TestControlApiResponse>
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize POST.",
    });
    return;
  }

  const sessionUser = extractUserFromRequest(request);
  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Faça login para testar os dispositivos.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const body = (request.body ?? {}) as TestControlRequestBody;
  const { actionTarget } = body;

  const validTargets = ["ECOFLOW_ON", "ECOFLOW_OFF", "ECOFLOW_TELEMETRY"];
  if (!validTargets.includes(actionTarget)) {
    response.status(400).json({
      success: false,
      message: "Ação de teste inválida. Escolha ECOFLOW_ON, ECOFLOW_OFF ou ECOFLOW_TELEMETRY.",
    });
    return;
  }

  const savedConfiguration = await prisma.userConfiguration.findUnique({
    where: { userId: extractedUserId },
  });

  const isMaskedSecret = (value?: string) => !value || value.includes("••••");

  const effectiveEcoFlowKey = body.ecoflowAccessKey?.trim() || savedConfiguration?.ecoflowAccessKey || "";
  const effectiveEcoFlowSecret = isMaskedSecret(body.ecoflowAccessSecret)
    ? savedConfiguration?.ecoflowAccessSecret || ""
    : body.ecoflowAccessSecret?.trim() || "";
  const effectiveEcoFlowSerial = body.ecoflowSerialNumber?.trim() || savedConfiguration?.ecoflowSerialNumber || "";
  const effectiveEcoFlowRegion =
    body.ecoflowEndpointRegion?.trim() || savedConfiguration?.ecoflowEndpointRegion || "https://api.ecoflow.com";

  const hasCompleteEcoFlow = effectiveEcoFlowKey && effectiveEcoFlowSecret && effectiveEcoFlowSerial;

  if (!hasCompleteEcoFlow) {
    response.status(400).json({
      success: false,
      message: "Credenciais incompletas. Preencha todos os campos da EcoFlow para realizar o teste.",
    });
    return;
  }

  const ecoflowKey = new AccessKey(effectiveEcoFlowKey);
  const ecoflowSecret = new AccessSecret(effectiveEcoFlowSecret);
  const ecoflowCredentials = new EcoFlowCredentials(ecoflowKey, ecoflowSecret);
  const ecoflowDevice = new DeviceSerialNumber(effectiveEcoFlowSerial);
  const ecoflowClient = new EcoFlowHttpClient(ecoflowCredentials, effectiveEcoFlowRegion);

  const testUseCase = new EcoFlowTestUseCase();

  try {
    let result: EcoFlowTestResult;

    if (actionTarget === "ECOFLOW_TELEMETRY") {
      result = await testUseCase.executeTestTelemetry(ecoflowClient, ecoflowDevice);
    } else if (actionTarget === "ECOFLOW_ON") {
      result = await testUseCase.executeTestAc(ecoflowClient, ecoflowDevice, true);
    } else {
      result = await testUseCase.executeTestAc(ecoflowClient, ecoflowDevice, false);
    }

    response.status(200).json({
      success: result.isSuccess,
      message: result.summaryMessage,
      data: result,
    });
  } catch (caughtError: unknown) {
    const errorDetails =
      caughtError instanceof Error ? caughtError.message : "Erro desconhecido durante o teste da EcoFlow.";

    response.status(500).json({
      success: false,
      message: errorDetails,
    });
  }
}
