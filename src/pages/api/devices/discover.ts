import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
} from "../../../infrastructure/auth/sessionHelper";
import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import {
  EcoFlowHttpClient,
  EcoFlowBoundDevice,
} from "../../../infrastructure/http/EcoFlowHttpClient";
import { resolveEcoFlowEndpointRegion } from "../../../infrastructure/security/ecoflowAllowlist";
import { isUnchangedOrMaskedSecret } from "../../../infrastructure/security/encryptionHelper";
import { decryptAndMigrateConfigurationSecrets } from "../../../infrastructure/security/secretMigrationHelper";
import {
  checkRateLimit,
  extractClientIp,
  sendRateLimitExceeded,
} from "../../../infrastructure/security/rateLimiter";

const ONE_MINUTE_MS = 60 * 1000;
const MAX_DISCOVER_PER_IP = 30;
const MAX_DISCOVER_PER_USER = 20;

export interface DiscoverDevicesApiResponse {
  success: boolean;
  message?: string;
  devices?: EcoFlowBoundDevice[];
  count?: number;
}

export default async function handleDiscoverDevices(
  request: NextApiRequest,
  response: NextApiResponse<DiscoverDevicesApiResponse>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");

  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize POST.",
    });
    return;
  }

  const clientIp = extractClientIp(request);
  const ipLimit = checkRateLimit(`discover:ip:${clientIp}`, MAX_DISCOVER_PER_IP, ONE_MINUTE_MS);
  if (!ipLimit.allowed) {
    sendRateLimitExceeded(response, ipLimit.retryAfterSeconds);
    return;
  }

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error ? authError.message : "Erro interno de autenticação.";
    response.status(500).json({
      success: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Por favor, realize login.",
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
    `discover:user:${extractedUserId}`,
    MAX_DISCOVER_PER_USER,
    ONE_MINUTE_MS
  );
  if (!userLimit.allowed) {
    sendRateLimitExceeded(response, userLimit.retryAfterSeconds);
    return;
  }

  try {
    const body = (request.body && typeof request.body === "object" ? request.body : {}) as Record<
      string,
      unknown
    >;

    const savedConfiguration = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
    });

    const rawInputKey =
      typeof body.accessKey === "string"
        ? body.accessKey.trim()
        : typeof body.ecoflowAccessKey === "string"
        ? body.ecoflowAccessKey.trim()
        : "";

    const rawInputSecret =
      typeof body.accessSecret === "string"
        ? (body.accessSecret as string)
        : typeof body.ecoflowAccessSecret === "string"
        ? (body.ecoflowAccessSecret as string)
        : "";

    const effectiveAccessKey =
      rawInputKey.length > 0 ? rawInputKey : savedConfiguration?.ecoflowAccessKey.trim() ?? "";

    let effectiveAccessSecret = "";
    if (rawInputSecret.length > 0 && !isUnchangedOrMaskedSecret(rawInputSecret)) {
      effectiveAccessSecret = rawInputSecret.trim();
    } else if (savedConfiguration) {
      try {
        const decryptedSecrets = await decryptAndMigrateConfigurationSecrets(
          prisma,
          savedConfiguration
        );
        effectiveAccessSecret = decryptedSecrets.ecoflowAccessSecret;
      } catch (cryptoErr) {
        console.warn("[DiscoverDevices API] Falha ao decifrar secret armazenado:", cryptoErr);
      }
    }

    if (!effectiveAccessKey || !effectiveAccessSecret) {
      response.status(400).json({
        success: false,
        message:
          "Credenciais da EcoFlow (Access Key e Secret Key) ausentes. Preencha os campos ou salve a configuração antes de buscar.",
      });
      return;
    }

    const requestedEndpoint =
      typeof body.baseUrl === "string"
        ? body.baseUrl
        : typeof body.endpointRegion === "string"
        ? body.endpointRegion
        : savedConfiguration?.ecoflowEndpointRegion ?? "https://api.ecoflow.com";

    const resolvedBaseUrl = resolveEcoFlowEndpointRegion(requestedEndpoint);

    const credentials = new EcoFlowCredentials(
      new AccessKey(effectiveAccessKey),
      new AccessSecret(effectiveAccessSecret)
    );

    const client = new EcoFlowHttpClient(credentials, resolvedBaseUrl);
    const discoveryResult = await client.fetchBoundDevices();

    if (!discoveryResult.isSuccessful) {
      response.status(400).json({
        success: false,
        message:
          discoveryResult.errorMessage ??
          "Falha ao consultar a lista de dispositivos pareados na EcoFlow.",
        devices: [],
        count: 0,
      });
      return;
    }

    response.status(200).json({
      success: true,
      message: `${discoveryResult.devices.length} dispositivo(s) encontrado(s) na conta EcoFlow.`,
      devices: discoveryResult.devices,
      count: discoveryResult.devices.length,
    });
  } catch (error: unknown) {
    console.error("[DiscoverDevices API] Erro ao buscar dispositivos:", error);
    const message = error instanceof Error ? error.message : "Erro interno ao processar a busca de dispositivos.";
    response.status(500).json({
      success: false,
      message,
    });
  }
}
