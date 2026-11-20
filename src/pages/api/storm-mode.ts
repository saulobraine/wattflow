import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
} from "../../infrastructure/auth/sessionHelper";
import { stormModePostBodySchema } from "../../infrastructure/security/apiSchemas";
import { AccessKey } from "../../domain/values/AccessKey";
import { AccessSecret } from "../../domain/values/AccessSecret";
import { DeviceSerialNumber } from "../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../domain/models/EcoFlowCredentials";
import { EcoFlowHttpClient } from "../../infrastructure/http/EcoFlowHttpClient";
import { resolveEcoFlowEndpointRegion } from "../../infrastructure/security/ecoflowAllowlist";
import { decryptAndMigrateConfigurationSecrets } from "../../infrastructure/security/secretMigrationHelper";

interface StormModeApiResponse {
  success: boolean;
  message: string;
  data?: {
    isStormModeActive: boolean;
    acSwitchedToGrid?: boolean;
  };
}

export default async function handleStormMode(
  request: NextApiRequest,
  response: NextApiResponse<StormModeApiResponse>
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
      message: "Não autenticado. Faça login para alterar o Modo Tempestade.",
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

  const parsedBody = stormModePostBodySchema.safeParse(request.body ?? {});
  if (!parsedBody.success) {
    const issueMessage =
      parsedBody.error.issues[0]?.message || "Dados de Modo Tempestade inválidos.";
    response.status(400).json({
      success: false,
      message: issueMessage,
    });
    return;
  }

  const { isStormModeActive } = parsedBody.data;

  try {
    const updated = await prisma.userConfiguration.upsert({
      where: { userId: extractedUserId },
      update: { isStormModeActive },
      create: { userId: extractedUserId, isStormModeActive },
    });

    let acSwitchedToGrid = false;
    if (isStormModeActive && updated.ecoflowAccessKey && updated.ecoflowSerialNumber) {
      try {
        const decryptedSecrets = await decryptAndMigrateConfigurationSecrets(prisma, updated);
        if (decryptedSecrets.ecoflowAccessSecret) {
          const ecoflowKey = new AccessKey(updated.ecoflowAccessKey);
          const ecoflowSecret = new AccessSecret(decryptedSecrets.ecoflowAccessSecret);
          const ecoflowCredentials = new EcoFlowCredentials(ecoflowKey, ecoflowSecret);
          const ecoflowDevice = new DeviceSerialNumber(updated.ecoflowSerialNumber);
          const endpoint = resolveEcoFlowEndpointRegion(updated.ecoflowEndpointRegion);
          const client = new EcoFlowHttpClient(ecoflowCredentials, endpoint);

          const telemetry = await client.fetchDeviceTelemetry(ecoflowDevice);
          if (telemetry.isAcOutputEnabled === true) {
            await client.setAcOutputState(ecoflowDevice, false);
            await prisma.userConfiguration.update({
              where: { id: updated.id },
              data: {
                atsCurrentCycles: { increment: 1 },
                atsLastSwitchedAt: new Date(),
              },
            });
            acSwitchedToGrid = true;
          }
        }
      } catch (deviceError) {
        console.warn("[StormMode API] Não foi possível verificar/comutar AC imediatamente:", deviceError);
      }
    }

    const message = isStormModeActive
      ? "Modo Tempestade ATIVADO: Cargas direcionadas para a Concessionária. Bateria preservada em 100% de reserva."
      : "Modo Tempestade DESATIVADO: Automação normal restaurada com histerese ativa.";

    response.status(200).json({
      success: true,
      message,
      data: {
        isStormModeActive,
        acSwitchedToGrid,
      },
    });
  } catch (error) {
    console.error("[StormMode API] Erro ao atualizar Modo Tempestade:", error);
    response.status(500).json({
      success: false,
      message: "Erro interno ao atualizar Modo Tempestade.",
    });
  }
}
