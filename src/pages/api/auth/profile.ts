import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "64kb",
    },
  },
};
import { prisma } from "../../../infrastructure/database/prismaClient";
import { DEFAULT_SESSION_VALIDITY_DAYS } from "../../../domain/services/AuthenticationTokenService";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
  getAuthenticationTokenService,
  PERSISTENT_SESSION_MAX_AGE_SECONDS,
  setSessionCookie,
} from "../../../infrastructure/auth/sessionHelper";
import { UserEmail } from "../../../domain/values/UserEmail";
import { HashedPassword } from "../../../domain/values/HashedPassword";
import {
  checkRateLimit,
  extractClientIp,
  sendRateLimitExceeded,
} from "../../../infrastructure/security/rateLimiter";
import { profilePatchBodySchema } from "../../../infrastructure/security/apiSchemas";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const MAX_EMAIL_CHANGE_PER_USER = 5;

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

  if (request.method === "PATCH") {
    if (!enforceCsrfProtection(request, response)) {
      return;
    }
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
    const parsedBody = profilePatchBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      const issueMessage = parsedBody.error.issues[0]?.message || "Dados de perfil inválidos.";
      response.status(400).json({
        success: false,
        message: issueMessage,
      });
      return;
    }

    const { email, fullName, currentPassword } = parsedBody.data;

    try {
      const currentUser = await prisma.user.findUnique({
        where: { id: extractedUserId },
      });

      if (!currentUser) {
        response.status(404).json({
          success: false,
          message: "Usuário não encontrado.",
        });
        return;
      }

      const dataToUpdate: {
        email?: string;
        fullName?: string | null;
        tokenVersion?: { increment: number };
      } = {};
      let isEmailChanging = false;

      if (fullName !== undefined) {
        dataToUpdate.fullName = typeof fullName === "string" ? fullName : null;
      }

      if (email !== undefined) {
        let validatedEmail = "";
        try {
          const userEmail = new UserEmail(email);
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

        if (validatedEmail !== currentUser.email) {
          const clientIp = extractClientIp(request);
          const rateCheck = checkRateLimit(
            `profile-email:${extractedUserId}:${clientIp}`,
            MAX_EMAIL_CHANGE_PER_USER,
            FIFTEEN_MINUTES_MS
          );
          if (!rateCheck.allowed) {
            sendRateLimitExceeded(response, rateCheck.retryAfterSeconds);
            return;
          }

          if (typeof currentPassword !== "string" || currentPassword.length === 0) {
            response.status(400).json({
              success: false,
              message: "A senha atual é obrigatória para alterar o endereço de e-mail.",
            });
            return;
          }

          const currentHashed = new HashedPassword(currentUser.passwordHash);
          const isPasswordValid = await currentHashed.matchesPlaintextCandidate(currentPassword);
          if (!isPasswordValid) {
            response.status(401).json({
              success: false,
              message: "Senha atual incorreta.",
            });
            return;
          }

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
          dataToUpdate.tokenVersion = { increment: 1 };
          isEmailChanging = true;
        }
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

      if (isEmailChanging) {
        const nextTokenVersion = updatedUser.tokenVersion ?? (currentUser.tokenVersion ?? 0) + 1;
        const tokenService = getAuthenticationTokenService();
        const rotatedSessionToken = tokenService.createSessionToken(
          updatedUser.id,
          updatedUser.email,
          DEFAULT_SESSION_VALIDITY_DAYS,
          nextTokenVersion
        );
        setSessionCookie(response, rotatedSessionToken, PERSISTENT_SESSION_MAX_AGE_SECONDS);
      }

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
