import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";

interface SettingsResponseBody {
  success: boolean;
  message: string;
  data?: {
    tuyaAccessId: string;
    tuyaAccessSecretMasked: string;
    tuyaDeviceId: string;
    tuyaEndpointRegion: string;
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
        tuyaAccessId: existing.tuyaAccessId,
        tuyaAccessSecretMasked: maskSecret(existing.tuyaAccessSecret),
        tuyaDeviceId: existing.tuyaDeviceId,
        tuyaEndpointRegion: existing.tuyaEndpointRegion,
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
      tuyaAccessId,
      tuyaAccessSecret,
      tuyaDeviceId,
      tuyaEndpointRegion,
      ecoflowEndpointRegion,
      ecoflowAccessKey,
      ecoflowAccessSecret,
      ecoflowSerialNumber,
    } = request.body;

    if (!tuyaAccessId || !tuyaAccessSecret || !tuyaDeviceId || !ecoflowAccessKey || !ecoflowAccessSecret || !ecoflowSerialNumber) {
      response.status(400).json({
        success: false,
        message: "Todos os campos de credenciais são obrigatórios.",
      });
      return;
    }

    await prisma.userConfiguration.upsert({
      where: { userId: extractedUserId },
      update: {
        tuyaAccessId,
        tuyaAccessSecret,
        tuyaDeviceId,
        tuyaEndpointRegion: tuyaEndpointRegion || "https://openapi.tuyaus.com",
        ecoflowEndpointRegion: ecoflowEndpointRegion || "https://api.ecoflow.com",
        ecoflowAccessKey,
        ecoflowAccessSecret,
        ecoflowSerialNumber,
      },
      create: {
        userId: extractedUserId,
        tuyaAccessId,
        tuyaAccessSecret,
        tuyaDeviceId,
        tuyaEndpointRegion: tuyaEndpointRegion || "https://openapi.tuyaus.com",
        ecoflowEndpointRegion: ecoflowEndpointRegion || "https://api.ecoflow.com",
        ecoflowAccessKey,
        ecoflowAccessSecret,
        ecoflowSerialNumber,
        turnOnThreshold: 90,
        turnOffThreshold: 30,
        isAutomationActive: true,
      },
    });

    response.status(200).json({
      success: true,
      message: "Credenciais salvas com sucesso!",
    });
    return;
  }

  response.setHeader("Allow", ["GET", "POST"]);
  response.status(405).json({
    success: false,
    message: "Método HTTP não permitido.",
  });
}
