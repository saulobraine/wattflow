import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
} from "../../infrastructure/auth/sessionHelper";
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
import { testControlPostBodySchema } from "../../infrastructure/security/apiSchemas";

const ONE_MINUTE_MS = 60 * 1000;
const AC_SWITCH_COOLDOWN_MS = 10 * 1000;
const MAX_TEST_CONTROL_PER_IP = 30;
const MAX_TEST_CONTROL_PER_USER = 20;

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

  if (!enforceCsrfProtection(request, response)) {
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

  const parsedBody = testControlPostBodySchema.safeParse(request.body ?? {});
  if (!parsedBody.success) {
    const issueMessage =
      parsedBody.error.issues[0]?.message ||
      "Ação de teste inválida. Escolha ECOFLOW_ON, ECOFLOW_OFF ou ECOFLOW_TELEMETRY.";
    response.status(400).json({
      success: false,
      message: issueMessage,
    });
    return;
  }

  const body = parsedBody.data;
  const { actionTarget } = body;

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
    console.error("[TestControl API] Falha ao decifrar credenciais EcoFlow:", cryptoError);
    response.status(500).json({
      success: false,
      message: "Erro interno ao carregar credenciais EcoFlow armazenadas.",
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

  try {
    const ecoflowKey = new AccessKey(effectiveEcoFlowKey);
    const ecoflowSecret = new AccessSecret(effectiveEcoFlowSecret);
    const ecoflowCredentials = new EcoFlowCredentials(ecoflowKey, ecoflowSecret);
    const ecoflowDevice = new DeviceSerialNumber(effectiveEcoFlowSerial);
    const ecoflowClient = new EcoFlowHttpClient(ecoflowCredentials, effectiveEcoFlowRegion);

    const testUseCase = new EcoFlowTestUseCase();
    let result: EcoFlowTestResult;

    if (actionTarget === "ECOFLOW_TELEMETRY") {
      result = await testUseCase.executeTestTelemetry(ecoflowClient, ecoflowDevice);
    } else if (actionTarget === "ECOFLOW_ON") {
      result = await testUseCase.executeTestAc(ecoflowClient, ecoflowDevice, true);
    } else {
      result = await testUseCase.executeTestAc(ecoflowClient, ecoflowDevice, false);
    }

    if (isPhysicalAcToggle && result.isSuccess && savedConfiguration?.id) {
      await prisma.userConfiguration.update({
        where: { id: savedConfiguration.id },
        data: {
          atsCurrentCycles: { increment: 1 },
          atsLastSwitchedAt: new Date(),
        },
      });
    }

    response.status(200).json({
      success: result.isSuccess,
      message: result.summaryMessage,
      data: result,
    });
  } catch (caughtError: unknown) {
    console.error("[TestControl API] Erro interno durante execução de teste:", caughtError);
    response.status(500).json({
      success: false,
      message: "Erro interno ao executar o comando de teste no dispositivo.",
    });
  }
}
