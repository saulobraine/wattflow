import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import {
  generateBase32Secret,
  verifyTotpCode,
  buildOtpAuthUrl,
} from "../../../infrastructure/auth/totpHelper";
import { HashedPassword } from "../../../domain/values/HashedPassword";
import { RawPassword } from "../../../domain/values/RawPassword";

interface TwoFactorResponseBody {
  success: boolean;
  message: string;
  data?: {
    secret?: string;
    otpauthUrl?: string;
    twoFactorEnabled?: boolean;
  };
}

export default async function handleTwoFactor(
  request: NextApiRequest,
  response: NextApiResponse<TwoFactorResponseBody>
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

  const { action, secret, token, currentPassword } = request.body || {};

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

    if (action === "SETUP") {
      const generatedSecret = generateBase32Secret(20);
      const otpauthUrl = buildOtpAuthUrl(user.email, generatedSecret);

      response.status(200).json({
        success: true,
        message: "Segredo TOTP gerado com sucesso.",
        data: {
          secret: generatedSecret,
          otpauthUrl,
          twoFactorEnabled: user.twoFactorEnabled,
        },
      });
      return;
    }

    if (action === "VERIFY_AND_ENABLE") {
      if (!secret || !token) {
        response.status(400).json({
          success: false,
          message: "O segredo e o código de verificação de 6 dígitos são obrigatórios.",
        });
        return;
      }

      const isValidToken = verifyTotpCode(String(secret), String(token));
      if (!isValidToken) {
        response.status(400).json({
          success: false,
          message: "Código de autenticação incorreto ou expirado. Verifique o relógio do seu dispositivo.",
        });
        return;
      }

      await prisma.user.update({
        where: { id: extractedUserId },
        data: {
          twoFactorEnabled: true,
          twoFactorSecret: String(secret),
        },
      });

      response.status(200).json({
        success: true,
        message: "Autenticação em Duas Etapas (2FA) ativada com sucesso!",
        data: {
          twoFactorEnabled: true,
        },
      });
      return;
    }

    if (action === "DISABLE") {
      if (!currentPassword) {
        response.status(400).json({
          success: false,
          message: "A senha atual é obrigatória para desativar o 2FA.",
        });
        return;
      }

      const currentHashed = new HashedPassword(user.passwordHash);
      let rawCandidate: RawPassword;
      try {
        rawCandidate = new RawPassword(String(currentPassword));
      } catch {
        response.status(400).json({
          success: false,
          message: "Senha atual incorreta.",
        });
        return;
      }

      if (!currentHashed.matchesRawPassword(rawCandidate)) {
        response.status(400).json({
          success: false,
          message: "Senha atual incorreta.",
        });
        return;
      }

      await prisma.user.update({
        where: { id: extractedUserId },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
        },
      });

      response.status(200).json({
        success: true,
        message: "Autenticação em Duas Etapas (2FA) desativada.",
        data: {
          twoFactorEnabled: false,
        },
      });
      return;
    }

    response.status(400).json({
      success: false,
      message: "Ação de 2FA inválida.",
    });
  } catch (error) {
    console.error("Erro no processamento de 2FA:", error);
    response.status(500).json({
      success: false,
      message: "Erro interno no servidor de 2FA.",
    });
  }
}
