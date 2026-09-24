import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";
import { AccessKey } from "../../domain/values/AccessKey";
import { AccessSecret } from "../../domain/values/AccessSecret";
import { DeviceIdentifier } from "../../domain/values/DeviceIdentifier";
import { DeviceSerialNumber } from "../../domain/values/DeviceSerialNumber";
import { TuyaCredentials } from "../../domain/models/TuyaCredentials";
import { EcoFlowCredentials } from "../../domain/models/EcoFlowCredentials";
import { TuyaHttpClient } from "../../infrastructure/http/TuyaHttpClient";
import { EcoFlowHttpClient } from "../../infrastructure/http/EcoFlowHttpClient";
import { DeviceTestInterlockUseCase, DeviceTestResult } from "../../application/DeviceTestInterlockUseCase";

interface TestControlRequestBody {
  actionTarget: "TUYA_ON" | "TUYA_OFF" | "ECOFLOW_ON" | "ECOFLOW_OFF";
  tuyaAccessId?: string;
  tuyaAccessSecret?: string;
  tuyaDeviceId?: string;
  tuyaEndpointRegion?: string;
  ecoflowEndpointRegion?: string;
  ecoflowAccessKey?: string;
  ecoflowAccessSecret?: string;
  ecoflowSerialNumber?: string;
}

interface TestControlApiResponse {
  success: boolean;
  message: string;
  data?: DeviceTestResult;
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

  const validTargets = ["TUYA_ON", "TUYA_OFF", "ECOFLOW_ON", "ECOFLOW_OFF"];
  if (!validTargets.includes(actionTarget)) {
    response.status(400).json({
      success: false,
      message: "Ação de teste inválida. Escolha TUYA_ON, TUYA_OFF, ECOFLOW_ON ou ECOFLOW_OFF.",
    });
    return;
  }

  const savedConfiguration = await prisma.userConfiguration.findUnique({
    where: { userId: extractedUserId },
  });

  const isMaskedSecret = (value?: string) => !value || value.includes("••••");

  const effectiveTuyaId = body.tuyaAccessId?.trim() || savedConfiguration?.tuyaAccessId || "";
  const effectiveTuyaSecret = isMaskedSecret(body.tuyaAccessSecret)
    ? savedConfiguration?.tuyaAccessSecret || ""
    : body.tuyaAccessSecret?.trim() || "";
  const effectiveTuyaDevice = body.tuyaDeviceId?.trim() || savedConfiguration?.tuyaDeviceId || "";
  const effectiveTuyaRegion =
    body.tuyaEndpointRegion?.trim() || savedConfiguration?.tuyaEndpointRegion || "https://openapi.tuyaus.com";

  const effectiveEcoFlowKey = body.ecoflowAccessKey?.trim() || savedConfiguration?.ecoflowAccessKey || "";
  const effectiveEcoFlowSecret = isMaskedSecret(body.ecoflowAccessSecret)
    ? savedConfiguration?.ecoflowAccessSecret || ""
    : body.ecoflowAccessSecret?.trim() || "";
  const effectiveEcoFlowSerial = body.ecoflowSerialNumber?.trim() || savedConfiguration?.ecoflowSerialNumber || "";
  const effectiveEcoFlowRegion =
    body.ecoflowEndpointRegion?.trim() || savedConfiguration?.ecoflowEndpointRegion || "https://api.ecoflow.com";

  const hasCompleteTuya = effectiveTuyaId && effectiveTuyaSecret && effectiveTuyaDevice;
  const hasCompleteEcoFlow = effectiveEcoFlowKey && effectiveEcoFlowSecret && effectiveEcoFlowSerial;

  if (!hasCompleteTuya || !hasCompleteEcoFlow) {
    response.status(400).json({
      success: false,
      message: "Credenciais incompletas. Preencha todos os campos da Tuya e EcoFlow para realizar o teste.",
    });
    return;
  }

  try {
    const tuyaCredentials = new TuyaCredentials(
      new AccessKey(effectiveTuyaId),
      new AccessSecret(effectiveTuyaSecret)
    );
    const ecoflowCredentials = new EcoFlowCredentials(
      new AccessKey(effectiveEcoFlowKey),
      new AccessSecret(effectiveEcoFlowSecret)
    );

    const tuyaDevice = new DeviceIdentifier(effectiveTuyaDevice);
    const ecoflowDevice = new DeviceSerialNumber(effectiveEcoFlowSerial);

    const tuyaClient = new TuyaHttpClient(tuyaCredentials, effectiveTuyaRegion);
    const ecoflowClient = new EcoFlowHttpClient(ecoflowCredentials, effectiveEcoFlowRegion);
    const useCase = new DeviceTestInterlockUseCase();

    let testResult: DeviceTestResult;

    if (actionTarget === "TUYA_ON") {
      testResult = await useCase.executeTuyaOn(tuyaClient, tuyaDevice, ecoflowClient, ecoflowDevice);
    } else if (actionTarget === "TUYA_OFF") {
      testResult = await useCase.executeTuyaOff(tuyaClient, tuyaDevice, ecoflowClient, ecoflowDevice);
    } else if (actionTarget === "ECOFLOW_ON") {
      testResult = await useCase.executeEcoFlowOn(tuyaClient, tuyaDevice, ecoflowClient, ecoflowDevice);
    } else {
      testResult = await useCase.executeEcoFlowOff(tuyaClient, tuyaDevice, ecoflowClient, ecoflowDevice);
    }

    response.status(200).json({
      success: testResult.isSuccess,
      message: testResult.summaryMessage,
      data: testResult,
    });
  } catch (caughtError) {
    const errorDetail = caughtError instanceof Error ? caughtError.message : "Erro desconhecido no teste.";
    response.status(500).json({
      success: false,
      message: errorDetail,
    });
  }
}
