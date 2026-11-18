import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
} from "../../../infrastructure/auth/sessionHelper";
import { passkeyPostBodySchema } from "../../../infrastructure/security/apiSchemas";

interface PasskeyResponseBody {
  success: boolean;
  message: string;
  data?: {
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
  response.setHeader("Cache-Control", "no-store");

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno de configuração de autenticação.";
    response.status(500).json({
      success: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Usuário não autenticado.",
    });
    return;
  }

  if (request.method === "POST") {
    if (!enforceCsrfProtection(request, response)) {
      return;
    }
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
    const parsedBody = passkeyPostBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      const issueMessage =
        parsedBody.error.issues[0]?.message || "Ação de passkey não reconhecida.";
      response.status(400).json({
        success: false,
        message: issueMessage,
      });
      return;
    }

    const { action, passkeyId } = parsedBody.data;

    if (action === "DELETE") {
      if (!passkeyId) {
        response.status(400).json({
          success: false,
          message: "ID da passkey é obrigatório para remoção.",
        });
        return;
      }

      await prisma.userPasskey.deleteMany({
        where: {
          id: passkeyId,
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

    response.status(501).json({
      success: false,
      message:
        "Registro e desafio de Passkeys (WebAuthn/FIDO2) estão desabilitados até a implementação da verificação criptográfica completa no servidor.",
    });
    return;
  }

  response.setHeader("Allow", ["GET", "POST"]);
  response.status(405).json({
    success: false,
    message: "Método HTTP não permitido.",
  });
}
