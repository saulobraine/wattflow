import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import {
  getAuthenticationTokenService,
  setSessionCookie,
} from "../../../infrastructure/auth/sessionHelper";
import { verifyTotpCode } from "../../../infrastructure/auth/totpHelper";
import { decryptAndMigrateUserTotpSecret } from "../../../infrastructure/security/secretMigrationHelper";

interface LoginTwoFactorRequestBody {
  challengeToken?: unknown;
  token?: unknown;
  code?: unknown;
}

interface LoginTwoFactorResponseBody {
  success: boolean;
  message: string;
  user?: {
    id: string;
    email: string;
    fullName?: string | null;
  };
}

export default async function handleLoginTwoFactor(
  request: NextApiRequest,
  response: NextApiResponse<LoginTwoFactorResponseBody>
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

  let tokenService: ReturnType<typeof getAuthenticationTokenService>;
  try {
    tokenService = getAuthenticationTokenService();
  } catch (authConfigError: unknown) {
    const errorMessage =
      authConfigError instanceof Error
        ? authConfigError.message
        : "Erro interno de configuração de autenticação.";
    response.status(500).json({
      success: false,
      message: errorMessage,
    });
    return;
  }

  const body = (request.body ?? {}) as LoginTwoFactorRequestBody;
  const rawChallengeToken = typeof body.challengeToken === "string" ? body.challengeToken.trim() : "";
  const rawTotpCode =
    typeof body.token === "string"
      ? body.token.trim()
      : typeof body.code === "string"
        ? body.code.trim()
        : "";

  if (!rawChallengeToken || !/^\d{6}$/.test(rawTotpCode)) {
    response.status(400).json({
      success: false,
      message: "O challengeToken e o código TOTP de 6 dígitos são obrigatórios.",
    });
    return;
  }

  const challengeIdentity = tokenService.verifyTwoFactorChallengeToken(rawChallengeToken);
  if (!challengeIdentity) {
    response.status(401).json({
      success: false,
      message: "Desafio 2FA inválido ou expirado. Realize o login novamente.",
    });
    return;
  }

  let userId = "";
  challengeIdentity.provideIdentity((extractedId) => {
    userId = extractedId;
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    response.status(401).json({
      success: false,
      message: "Autenticação em duas etapas não está ativa ou configurada para esta conta.",
    });
    return;
  }

  let plainTotpSecret: string;
  try {
    plainTotpSecret = await decryptAndMigrateUserTotpSecret(
      prisma,
      user.id,
      "twoFactorSecret",
      user.twoFactorSecret
    );
  } catch (cryptoError: unknown) {
    const detail =
      cryptoError instanceof Error
        ? cryptoError.message
        : "Falha ao decifrar segredo 2FA no servidor.";
    response.status(500).json({
      success: false,
      message: detail,
    });
    return;
  }

  let isCodeValid = false;
  try {
    isCodeValid = verifyTotpCode(plainTotpSecret, rawTotpCode);
  } catch (totpError: unknown) {
    const detail =
      totpError instanceof Error ? totpError.message : "Segredo TOTP armazenado inválido.";
    response.status(500).json({
      success: false,
      message: detail,
    });
    return;
  }

  if (!isCodeValid) {
    response.status(401).json({
      success: false,
      message: "Código de autenticação incorreto ou expirado.",
    });
    return;
  }

  const sessionToken = tokenService.createSessionToken(user.id, user.email);
  setSessionCookie(response, sessionToken);

  response.status(200).json({
    success: true,
    message: "Autenticação em duas etapas concluída com sucesso.",
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    },
  });
}
