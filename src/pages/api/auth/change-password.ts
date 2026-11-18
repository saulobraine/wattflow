import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import { RawPassword } from "../../../domain/values/RawPassword";
import { HashedPassword } from "../../../domain/values/HashedPassword";

interface ChangePasswordResponseBody {
  success: boolean;
  message: string;
}

export default async function handleChangePassword(
  request: NextApiRequest,
  response: NextApiResponse<ChangePasswordResponseBody>
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido.",
    });
    return;
  }

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

  const { currentPassword, newPassword } = request.body || {};

  if (!currentPassword || !newPassword) {
    response.status(400).json({
      success: false,
      message: "A senha atual e a nova senha são obrigatórias.",
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: extractedUserId },
    });

    if (!user) {
      response.status(404).json({
        success: false,
        message: "Usuário não encontrado.",
      });
      return;
    }

    const currentHashed = new HashedPassword(user.passwordHash);
    let candidateRawCurrent: RawPassword;

    try {
      candidateRawCurrent = new RawPassword(String(currentPassword));
    } catch {
      response.status(400).json({
        success: false,
        message: "Senha atual incorreta.",
      });
      return;
    }

    if (!currentHashed.matchesRawPassword(candidateRawCurrent)) {
      response.status(400).json({
        success: false,
        message: "A senha atual digitada está incorreta.",
      });
      return;
    }

    let rawNewPassword: RawPassword;
    try {
      rawNewPassword = new RawPassword(String(newPassword));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Nova senha inválida.";
      response.status(400).json({
        success: false,
        message: msg,
      });
      return;
    }

    const newHashedPassword = rawNewPassword.generateHashedRepresentation();
    let newHashString = "";
    newHashedPassword.transferHash((h) => {
      newHashString = h;
    });

    await prisma.user.update({
      where: { id: extractedUserId },
      data: {
        passwordHash: newHashString,
      },
    });

    response.status(200).json({
      success: true,
      message: "Senha alterada com sucesso!",
    });
    return;
  } catch (error) {
    console.error("Erro ao alterar senha:", error);
    response.status(500).json({
      success: false,
      message: "Erro interno ao processar a alteração da senha.",
    });
  }
}
