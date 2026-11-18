import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { DEFAULT_SESSION_VALIDITY_DAYS } from "../../../domain/services/AuthenticationTokenService";
import {
  extractSessionWithMetaFromRequest,
  getAuthenticationTokenService,
  PERSISTENT_SESSION_MAX_AGE_SECONDS,
  setSessionCookie,
  SHORT_SESSION_MAX_AGE_SECONDS,
  SLIDING_REFRESH_THRESHOLD_MS,
} from "../../../infrastructure/auth/sessionHelper";

interface MeResponseBody {
  isAuthenticated: boolean;
  message?: string;
  user?: {
    id: string;
    email: string;
    fullName?: string | null;
  };
}

export default async function handleMe(
  request: NextApiRequest,
  response: NextApiResponse<MeResponseBody>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  let sessionMeta: Awaited<ReturnType<typeof extractSessionWithMetaFromRequest>> = null;
  try {
    sessionMeta = await extractSessionWithMetaFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno de configuração de autenticação.";
    response.status(500).json({
      isAuthenticated: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionMeta) {
    response.status(200).json({ isAuthenticated: false });
    return;
  }

  let extractedUserId = "";
  sessionMeta.identity.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const user = await prisma.user.findUnique({
    where: { id: extractedUserId },
    select: {
      id: true,
      email: true,
      fullName: true,
    },
  });

  if (!user) {
    response.status(200).json({ isAuthenticated: false });
    return;
  }

  const remainingMs = sessionMeta.expiresAt - Date.now();
  if (
    remainingMs > SHORT_SESSION_MAX_AGE_SECONDS * 1000 &&
    remainingMs < SLIDING_REFRESH_THRESHOLD_MS
  ) {
    const refreshedToken = getAuthenticationTokenService().createSessionToken(
      user.id,
      user.email,
      DEFAULT_SESSION_VALIDITY_DAYS,
      sessionMeta.tokenVersion
    );
    setSessionCookie(response, refreshedToken, PERSISTENT_SESSION_MAX_AGE_SECONDS);
  }

  response.status(200).json({
    isAuthenticated: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    },
  });
}
