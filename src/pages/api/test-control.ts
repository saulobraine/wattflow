import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";
import { AccessKey } from "../../domain/values/AccessKey";
import { AccessSecret } from "../../domain/values/AccessSecret";
import { DeviceSerialNumber } from "../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../domain/models/EcoFlowCredentials";
import { EcoFlowHttpClient } from "../../infrastructure/http/EcoFlowHttpClient";
import { EcoFlowTestUseCase, EcoFlowTestResult } from "../../application/EcoFlowTestUseCase";
import { resolveEcoFlowEndpointRegion } from "../../infrastructure/security/ecoflowAllowlist";
import { isUnchangedOrMaskedSecret } from "../../infrastructure/security/encryptionHelper";
import { decryptAndMigrateConfigurationSecrets } from "../../infrastructure/security/secretMigrationHelper";
import {
  checkCooldown,
  checkRateLimit,
  extractClientIp,
  sendRateLimitExceeded,
} from "../../infrastructure/security/rateLimiter";

const ONE_MINUTE_MS = 60 * 1000;
const AC_SWITCH_COOLDOWN_MS = 10 * 1000;
const MAX_TEST_CONTROL_PER_IP = 30;
const MAX_TEST_CONTROL_PER_USER = 20;

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
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize POST.",
    });
    return;
  }

  const clientIp = extractClientIp(request);
  const ipLimit = checkRateLimit(`testctrl:ip:${clientIp}`, MAX_TEST_CONTROL_PER_IP, ONE_MINUTE_MS);
  if (!ipLimit.allowed) {
    sendRateLimitExceeded(response, ipLimit.retryAfterSeconds);
    return;
  }

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno na configuração de autenticação do servidor.";
    response.status(500).json({
      success: false,
      message: authMessage,
    });
    return;
  }

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

  const userLimit = checkRateLimit(
    `testctrl:user:${extractedUserId}`,
    MAX_TEST_CONTROL_PER_USER,
    ONE_MINUTE_MS
  );
  if (!userLimit.allowed) {
    sendRateLimitExceeded(response, userLimit.retryAfterSeconds);
    return;
  }

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

  if (body.ecoflowEndpointRegion !== undefined && typeof body.ecoflowEndpointRegion !== "string") {
    response.status(400).json({
      success: false,
      message:
        "Região de endpoint EcoFlow inválida. Utilize apenas https://api.ecoflow.com ou https://api-e.ecoflow.com.",
    });
    return;
  }

  const savedConfiguration = await prisma.userConfiguration.findUnique({
    where: { userId: extractedUserId },
  });

  const effectiveEcoFlowKey =
    (typeof body.ecoflowAccessKey === "string" ? body.ecoflowAccessKey.trim() : "") ||
    savedConfiguration?.ecoflowAccessKey ||
    "";

  let effectiveEcoFlowSecret = "";
  try {
    if (isUnchangedOrMaskedSecret(body.ecoflowAccessSecret)) {
      const decryptedSecrets = await decryptAndMigrateConfigurationSecrets(
        prisma,
        savedConfiguration
      );
      effectiveEcoFlowSecret = decryptedSecrets.ecoflowAccessSecret;
    } else {
      effectiveEcoFlowSecret = (body.ecoflowAccessSecret as string).trim();
    }
  } catch (cryptoError: unknown) {
    const detail =
      cryptoError instanceof Error
        ? cryptoError.message
        : "Falha ao decifrar credenciais EcoFlow armazenadas.";
    response.status(500).json({
      success: false,
      message: detail,
    });
    return;
  }

  const effectiveEcoFlowSerial =
    (typeof body.ecoflowSerialNumber === "string" ? body.ecoflowSerialNumber.trim() : "") ||
    savedConfiguration?.ecoflowSerialNumber ||
    "";

  const candidateRegion =
    typeof body.ecoflowEndpointRegion === "string" && body.ecoflowEndpointRegion !== ""
      ? body.ecoflowEndpointRegion
      : savedConfiguration?.ecoflowEndpointRegion;

  let effectiveEcoFlowRegion: string;
  try {
    effectiveEcoFlowRegion = resolveEcoFlowEndpointRegion(candidateRegion);
  } catch {
    response.status(400).json({
      success: false,
      message:
        "Região de endpoint EcoFlow inválida. Utilize apenas https://api.ecoflow.com ou https://api-e.ecoflow.com.",
    });
    return;
  }

  const hasCompleteEcoFlow = effectiveEcoFlowKey && effectiveEcoFlowSecret && effectiveEcoFlowSerial;

  if (!hasCompleteEcoFlow) {
    response.status(400).json({
      success: false,
      message: "Credenciais incompletas. Preencha todos os campos da EcoFlow para realizar o teste.",
    });
    return;
  }

  const isPhysicalAcToggle = actionTarget === "ECOFLOW_ON" || actionTarget === "ECOFLOW_OFF";
  if (isPhysicalAcToggle) {
    const normalizedSerialForCooldown = effectiveEcoFlowSerial.trim().toUpperCase();
    const cooldownResult = checkCooldown(
      `testctrl:ac-cooldown:${extractedUserId}:${normalizedSerialForCooldown}`,
      AC_SWITCH_COOLDOWN_MS
    );
    if (!cooldownResult.allowed) {
      sendRateLimitExceeded(
        response,
        cooldownResult.retryAfterSeconds,
        `Aguarde ${cooldownResult.retryAfterSeconds}s entre comutações físicas da saída AC/ATS.`
      );
      return;
    }
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
