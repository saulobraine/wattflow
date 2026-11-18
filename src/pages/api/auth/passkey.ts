import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "node:crypto";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";

interface PasskeyResponseBody {
  success: boolean;
  message: string;
  data?: {
    challenge?: string;
    userId?: string;
    userEmail?: string;
    userName?: string;
    passkeys?: Array<{
      id: string;
      name: string;
      createdAt: string;
      lastUsedAt: string | null;
    }>;
  };
}

export default async function handlePasskey(
  request: NextApiRequest,
  response: NextApiResponse<PasskeyResponseBody>
): Promise<void> {
  const sessionUser = extractUserFromRequest(request);
  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Usuário não autenticado.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const user = await prisma.user.findUnique({
    where: { id: extractedUserId },
    include: {
      passkeys: {
        select: { id: true, name: true, createdAt: true, lastUsedAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!user) {
    response.status(404).json({
      success: false,
      message: "Usuário não encontrado.",
    });
    return;
  }

  if (request.method === "GET") {
    response.status(200).json({
      success: true,
      message: "Lista de passkeys carregada.",
      data: {
        passkeys: user.passkeys.map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: p.createdAt.toISOString(),
          lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
        })),
      },
    });
    return;
  }

  if (request.method === "POST") {
    const { action, credentialId, publicKey, name, transports } = request.body || {};

    if (action === "CHALLENGE") {
      const challengeBuffer = randomBytes(32);
      const challengeBase64 = challengeBuffer.toString("base64url");

      response.status(200).json({
        success: true,
        message: "Desafio de registro WebAuthn gerado.",
        data: {
          challenge: challengeBase64,
          userId: user.id,
          userEmail: user.email,
          userName: user.fullName || user.email,
        },
      });
      return;
    }

    if (action === "REGISTER") {
      if (!credentialId || !publicKey) {
        response.status(400).json({
          success: false,
          message: "Dados da chave de acesso (ID e chave pública) são obrigatórios.",
        });
        return;
      }

      const passkeyName = (name && String(name).trim()) || "Passkey " + (user.passkeys.length + 1);

      try {
        await prisma.userPasskey.create({
          data: {
            userId: user.id,
            name: passkeyName,
            credentialId: String(credentialId),
            publicKey: String(publicKey),
            transports: transports ? JSON.stringify(transports) : null,
          },
        });

        const updatedPasskeys = await prisma.userPasskey.findMany({
          where: { userId: user.id },
          select: { id: true, name: true, createdAt: true, lastUsedAt: true },
          orderBy: { createdAt: "desc" },
        });

        response.status(201).json({
          success: true,
          message: `Passkey "${passkeyName}" registrada com sucesso!`,
          data: {
            passkeys: updatedPasskeys.map((p) => ({
              id: p.id,
              name: p.name,
              createdAt: p.createdAt.toISOString(),
              lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
            })),
          },
        });
        return;
      } catch (err: unknown) {
        console.error("Erro ao registrar passkey:", err);
        response.status(409).json({
          success: false,
          message: "Esta chave de acesso já está registrada.",
        });
        return;
      }
    }

    if (action === "DELETE") {
      const { passkeyId } = request.body || {};
      if (!passkeyId) {
        response.status(400).json({
          success: false,
          message: "ID da passkey é obrigatório para remoção.",
        });
        return;
      }

      await prisma.userPasskey.deleteMany({
        where: {
          id: String(passkeyId),
          userId: user.id,
        },
      });

      const remainingPasskeys = await prisma.userPasskey.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, createdAt: true, lastUsedAt: true },
        orderBy: { createdAt: "desc" },
      });

      response.status(200).json({
        success: true,
        message: "Passkey removida com sucesso.",
        data: {
          passkeys: remainingPasskeys.map((p) => ({
            id: p.id,
            name: p.name,
            createdAt: p.createdAt.toISOString(),
            lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
          })),
        },
      });
      return;
    }

    response.status(400).json({
      success: false,
      message: "Ação de passkey não reconhecida.",
    });
    return;
  }

  response.setHeader("Allow", ["GET", "POST"]);
  response.status(405).json({
    success: false,
    message: "Método HTTP não permitido.",
  });
}
