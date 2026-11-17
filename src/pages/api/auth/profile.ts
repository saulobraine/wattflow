import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import { UserEmail } from "../../../domain/values/UserEmail";

interface ProfileResponseBody {
  success: boolean;
  message: string;
  data?: {
    id: string;
    email: string;
    fullName: string | null;
    twoFactorEnabled: boolean;
    createdAt: string;
    passkeysCount: number;
    passkeys: Array<{
      id: string;
      name: string;
      createdAt: string;
      lastUsedAt: string | null;
    }>;
  };
}

export default async function handleProfile(
  request: NextApiRequest,
  response: NextApiResponse<ProfileResponseBody>
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

  if (request.method === "GET") {
    try {
      const user = await prisma.user.findUnique({
        where: { id: extractedUserId },
        include: {
          passkeys: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              lastUsedAt: true,
            },
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

      response.status(200).json({
        success: true,
        message: "Dados de perfil carregados.",
        data: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          twoFactorEnabled: user.twoFactorEnabled,
          createdAt: user.createdAt.toISOString(),
          passkeysCount: user.passkeys.length,
          passkeys: user.passkeys.map((p) => ({
            id: p.id,
            name: p.name,
            createdAt: p.createdAt.toISOString(),
            lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
          })),
        },
      });
      return;
    } catch (error) {
      console.error("Erro ao obter perfil:", error);
      response.status(500).json({
        success: false,
        message: "Erro interno ao carregar perfil.",
      });
      return;
    }
  }

  if (request.method === "PATCH") {
    const { email, fullName } = request.body || {};

    try {
      const dataToUpdate: { email?: string; fullName?: string | null } = {};

      if (fullName !== undefined) {
        dataToUpdate.fullName = typeof fullName === "string" ? fullName.trim() : null;
      }

      if (email !== undefined) {
        let validatedEmail = "";
        try {
          const userEmail = new UserEmail(String(email));
          userEmail.transferEmail((e) => {
            validatedEmail = e;
          });
        } catch {
          response.status(400).json({
            success: false,
            message: "Formato de e-mail inválido.",
          });
          return;
        }

        // Verifica se o novo e-mail já pertence a outro usuário
        const existingWithEmail = await prisma.user.findUnique({
          where: { email: validatedEmail },
        });

        if (existingWithEmail && existingWithEmail.id !== extractedUserId) {
          response.status(409).json({
            success: false,
            message: "Este endereço de e-mail já está em uso por outra conta.",
          });
          return;
        }

        dataToUpdate.email = validatedEmail;
      }

      const updatedUser = await prisma.user.update({
        where: { id: extractedUserId },
        data: dataToUpdate,
        include: {
          passkeys: {
            select: { id: true, name: true, createdAt: true, lastUsedAt: true },
          },
        },
      });

      response.status(200).json({
        success: true,
        message: "Perfil atualizado com sucesso!",
        data: {
          id: updatedUser.id,
          email: updatedUser.email,
          fullName: updatedUser.fullName,
          twoFactorEnabled: updatedUser.twoFactorEnabled,
          createdAt: updatedUser.createdAt.toISOString(),
          passkeysCount: updatedUser.passkeys.length,
          passkeys: updatedUser.passkeys.map((p) => ({
            id: p.id,
            name: p.name,
            createdAt: p.createdAt.toISOString(),
            lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
          })),
        },
      });
      return;
    } catch (error) {
      console.error("Erro ao atualizar perfil:", error);
      response.status(500).json({
        success: false,
        message: "Erro interno ao atualizar dados do perfil.",
      });
      return;
    }
  }

  response.setHeader("Allow", ["GET", "PATCH"]);
  response.status(405).json({
    success: false,
    message: "Método HTTP não permitido.",
  });
}
