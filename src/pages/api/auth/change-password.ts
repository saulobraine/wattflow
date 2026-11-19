import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { DEFAULT_SESSION_VALIDITY_DAYS } from "../../../domain/services/AuthenticationTokenService";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
  getAuthenticationTokenService,
  PERSISTENT_SESSION_MAX_AGE_SECONDS,
  setSessionCookie,
} from "../../../infrastructure/auth/sessionHelper";
import { RawPassword } from "../../../domain/values/RawPassword";
import { HashedPassword } from "../../../domain/values/HashedPassword";
import {
  checkRateLimit,
  extractClientIp,
  sendRateLimitExceeded,
} from "../../../infrastructure/security/rateLimiter";
import { changePasswordBodySchema } from "../../../infrastructure/security/apiSchemas";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const MAX_CHANGE_PASSWORD_PER_IP = 10;
const MAX_CHANGE_PASSWORD_PER_USER = 5;

interface ChangePasswordResponseBody {
  success: boolean;
  message: string;
}

export default async function handleChangePassword(
  request: NextApiRequest,
  response: NextApiResponse<ChangePasswordResponseBody>
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

  const clientIp = extractClientIp(request);
  const ipLimit = checkRateLimit(
    `chgpass:ip:${clientIp}`,
    MAX_CHANGE_PASSWORD_PER_IP,
    FIFTEEN_MINUTES_MS
  );
  if (!ipLimit.allowed) {
    sendRateLimitExceeded(response, ipLimit.retryAfterSeconds);
    return;
  }

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

  if (!enforceCsrfProtection(request, response)) {
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const userLimit = checkRateLimit(
    `chgpass:user:${extractedUserId}`,
    MAX_CHANGE_PASSWORD_PER_USER,
    FIFTEEN_MINUTES_MS
  );
  if (!userLimit.allowed) {
    sendRateLimitExceeded(response, userLimit.retryAfterSeconds);
    return;
  }

  const parsedBody = changePasswordBodySchema.safeParse(request.body ?? {});
  if (!parsedBody.success) {
    const issueMessage =
      parsedBody.error.issues[0]?.message || "A senha atual e a nova senha são obrigatórias.";
    response.status(400).json({
      success: false,
      message: issueMessage,
    });
    return;
  }

  const { currentPassword, newPassword } = parsedBody.data;

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
    const isCurrentValid = await currentHashed.matchesPlaintextCandidate(currentPassword);
    if (!isCurrentValid) {
      response.status(400).json({
        success: false,
        message: "A senha atual digitada está incorreta.",
      });
      return;
    }

    let rawNewPassword: RawPassword;
    try {
      rawNewPassword = new RawPassword(newPassword);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Nova senha inválida.";
      response.status(400).json({
        success: false,
        message: msg,
      });
      return;
    }

    const newHashedPassword = await rawNewPassword.generateHashedRepresentation();
    let newHashString = "";
    newHashedPassword.transferHash((h) => {
      newHashString = h;
    });

    const updatedUser = await prisma.user.update({
      where: { id: extractedUserId },
      data: {
        passwordHash: newHashString,
        tokenVersion: { increment: 1 },
      },
    });

    const nextTokenVersion = updatedUser?.tokenVersion ?? (user.tokenVersion ?? 0) + 1;
    const tokenService = getAuthenticationTokenService();
    const rotatedSessionToken = tokenService.createSessionToken(
      user.id,
      user.email,
      DEFAULT_SESSION_VALIDITY_DAYS,
      nextTokenVersion
    );
    setSessionCookie(response, rotatedSessionToken, PERSISTENT_SESSION_MAX_AGE_SECONDS);

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
