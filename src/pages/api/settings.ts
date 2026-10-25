import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";

interface SettingsResponseBody {
  success: boolean;
  message: string;
  data?: {
    ecoflowEndpointRegion: string;
    ecoflowAccessKey: string;
    ecoflowAccessSecretMasked: string;
    ecoflowSerialNumber: string;
  };
}

export default async function handleSettings(
  request: NextApiRequest,
  response: NextApiResponse<SettingsResponseBody>
): Promise<void> {
  const sessionUser = extractUserFromRequest(request);
  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Por favor, faça login para acessar as configurações.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  if (request.method === "GET") {
    const existing = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
    });

    if (!existing) {
      response.status(200).json({
        success: true,
        message: "Nenhuma configuração cadastrada.",
      });
      return;
    }

    const maskSecret = (secret: string) =>
      secret.length > 6 ? `${secret.substring(0, 3)}••••••••${secret.slice(-3)}` : "••••••••";

    response.status(200).json({
      success: true,
      message: "Configurações carregadas com sucesso.",
      data: {
        ecoflowEndpointRegion: existing.ecoflowEndpointRegion,
        ecoflowAccessKey: existing.ecoflowAccessKey,
        ecoflowAccessSecretMasked: maskSecret(existing.ecoflowAccessSecret),
        ecoflowSerialNumber: existing.ecoflowSerialNumber,
      },
    });
    return;
  }

  if (request.method === "POST") {
    const {
      ecoflowEndpointRegion,
      ecoflowAccessKey,
      ecoflowAccessSecret,
      ecoflowSerialNumber,
    } = request.body;

    if (!ecoflowAccessKey || !ecoflowAccessSecret || !ecoflowSerialNumber) {
      response.status(400).json({
        success: false,
        message: "Access Key, Secret Key e Serial Number da EcoFlow são obrigatórios.",
      });
      return;
    }

    const isMaskedSecret = (value?: string) => !value || value.includes("••••");

    const existingConfig = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
    });

    const finalSecret = isMaskedSecret(ecoflowAccessSecret)
      ? existingConfig?.ecoflowAccessSecret || ""
      : ecoflowAccessSecret.trim();

    await prisma.userConfiguration.upsert({
      where: { userId: extractedUserId },
      update: {
        ecoflowEndpointRegion: ecoflowEndpointRegion || "https://api.ecoflow.com",
        ecoflowAccessKey: ecoflowAccessKey.trim(),
        ecoflowAccessSecret: finalSecret,
        ecoflowSerialNumber: ecoflowSerialNumber.trim(),
      },
      create: {
        userId: extractedUserId,
        ecoflowEndpointRegion: ecoflowEndpointRegion || "https://api.ecoflow.com",
        ecoflowAccessKey: ecoflowAccessKey.trim(),
        ecoflowAccessSecret: finalSecret,
        ecoflowSerialNumber: ecoflowSerialNumber.trim(),
      },
    });

    response.status(200).json({
      success: true,
      message: "Credenciais da EcoFlow salvas com sucesso!",
    });
    return;
  }

  response.setHeader("Allow", ["GET", "POST"]);
  response.status(405).json({
    success: false,
    message: "Método HTTP não permitido.",
  });
}
