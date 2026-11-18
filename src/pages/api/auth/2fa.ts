import type { NextApiRequest, NextApiResponse } from "next";
import QRCode from "qrcode";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import {
  generateBase32Secret,
  verifyTotpCode,
  buildOtpAuthUrl,
} from "../../../infrastructure/auth/totpHelper";
import { encryptSecret } from "../../../infrastructure/security/encryptionHelper";
import { decryptAndMigrateUserTotpSecret } from "../../../infrastructure/security/secretMigrationHelper";
import { HashedPassword } from "../../../domain/values/HashedPassword";
import { RawPassword } from "../../../domain/values/RawPassword";

interface TwoFactorResponseBody {
  success: boolean;
  message: string;
  data?: {
    secret?: string;
    otpauthUrl?: string;
    qrCodeDataUrl?: string;
    twoFactorEnabled?: boolean;
  };
}

function verifyUserPassword(passwordHash: string, candidatePassword: unknown): boolean {
  if (typeof candidatePassword !== "string" || candidatePassword.length === 0) {
    return false;
  }
  const currentHashed = new HashedPassword(passwordHash);
  try {
    const rawCandidate = new RawPassword(candidatePassword);
    return currentHashed.matchesRawPassword(rawCandidate);
  } catch {
    return false;
  }
}

export default async function handleTwoFactor(
  request: NextApiRequest,
  response: NextApiResponse<TwoFactorResponseBody>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido.",
    });
    return;
  }

  let sessionUser: ReturnType<typeof extractUserFromRequest> = null;
  try {
    sessionUser = extractUserFromRequest(request);
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

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const body = (request.body ?? {}) as Record<string, unknown>;
  const { action, secret, token, currentPassword } = body;

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
      if (user.twoFactorEnabled) {
        response.status(409).json({
          success: false,
          message: "A autenticação em duas etapas já está ativa. Desative-a antes de configurar um novo segredo.",
        });
        return;
      }

      const generatedSecret = generateBase32Secret(20);
      const encryptedPendingSecret = encryptSecret(generatedSecret);

      await prisma.user.update({
        where: { id: extractedUserId },
        data: {
          pendingTwoFactorSecret: encryptedPendingSecret,
        },
      });

      const otpauthUrl = buildOtpAuthUrl(user.email, generatedSecret);
      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 256,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });

      response.status(200).json({
        success: true,
        message: "Segredo TOTP gerado com sucesso.",
        data: {
          secret: generatedSecret,
          otpauthUrl,
          qrCodeDataUrl,
          twoFactorEnabled: false,
        },
      });
      return;
    }

    if (action === "VERIFY_AND_ENABLE") {
      if (user.twoFactorEnabled) {
        response.status(409).json({
          success: false,
          message: "A autenticação em duas etapas já está ativa.",
        });
        return;
      }

      if (secret !== undefined) {
        response.status(400).json({
          success: false,
          message: "O parâmetro 'secret' não é aceito; utilize o segredo pendente gerado no SETUP.",
        });
        return;
      }

      if (typeof currentPassword !== "string" || currentPassword.length === 0) {
        response.status(400).json({
          success: false,
          message: "A senha atual é obrigatória para ativar o 2FA.",
        });
        return;
      }

      if (!verifyUserPassword(user.passwordHash, currentPassword)) {
        response.status(401).json({
          success: false,
          message: "Senha atual incorreta.",
        });
        return;
      }

      if (!user.pendingTwoFactorSecret) {
        response.status(400).json({
          success: false,
          message: "Nenhuma configuração pendente de 2FA encontrada. Execute o SETUP primeiro.",
        });
        return;
      }

      if (typeof token !== "string" || token.trim().length === 0) {
        response.status(400).json({
          success: false,
          message: "O código de verificação de 6 dígitos é obrigatório.",
        });
        return;
      }

      const plainPendingSecret = await decryptAndMigrateUserTotpSecret(
        prisma,
        extractedUserId,
        "pendingTwoFactorSecret",
        user.pendingTwoFactorSecret
      );
      const isValidToken = verifyTotpCode(plainPendingSecret, token);
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
          twoFactorSecret: encryptSecret(plainPendingSecret),
          pendingTwoFactorSecret: null,
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
      if (typeof currentPassword !== "string" || currentPassword.length === 0) {
        response.status(400).json({
          success: false,
          message: "A senha atual é obrigatória para desativar o 2FA.",
        });
        return;
      }

      if (!verifyUserPassword(user.passwordHash, currentPassword)) {
        response.status(401).json({
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
          pendingTwoFactorSecret: null,
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
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Erro interno no servidor de 2FA.";
    response.status(500).json({
      success: false,
      message: detail,
    });
  }
}
