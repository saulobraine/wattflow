import type { NextApiRequest, NextApiResponse } from "next";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../database/prismaClient";
import { AuthenticationTokenService } from "../../domain/services/AuthenticationTokenService";
import { UserSessionToken } from "../../domain/values/UserSessionToken";
import { UserIdentity } from "../../domain/models/UserIdentity";
import { UserEmail } from "../../domain/values/UserEmail";

export const SESSION_COOKIE_NAME = "wattflow_session";

const MIN_AUTH_SECRET_LENGTH = 32;

export function getAuthenticationTokenService(): AuthenticationTokenService {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.trim().length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(
      `Variável de ambiente AUTH_SECRET obrigatória ausente ou com menos de ${MIN_AUTH_SECRET_LENGTH} caracteres.`
    );
  }
  return new AuthenticationTokenService(secret);
}

/**
 * Extrai e valida a identidade do usuário a partir do cookie de sessão HTTP-Only,
 * verificando integridade HMAC, escopo "session", expiração e revogação via tokenVersion no banco.
 */
export async function extractUserFromRequest(
  request: NextApiRequest,
  databaseClient: PrismaClient = prisma
): Promise<UserIdentity | null> {
  const cookieHeader = request.headers?.cookie;
  if (!cookieHeader) {
    return null;
  }

  const parsedCookies = parseCookiesFromHeader(cookieHeader);
  const rawCookieToken = parsedCookies[SESSION_COOKIE_NAME];
  if (!rawCookieToken) {
    return null;
  }

  const service = getAuthenticationTokenService();
  const tokenValue = new UserSessionToken(rawCookieToken);
  const verifiedTokenIdentity = service.verifySessionToken(tokenValue);
  if (!verifiedTokenIdentity) {
    return null;
  }

  let tokenUserId = "";
  let tokenVersionFromCookie = 0;
  verifiedTokenIdentity.provideIdentity((userId, _email, tokenVersion) => {
    tokenUserId = userId;
    tokenVersionFromCookie = tokenVersion;
  });

  const persistedUser = await databaseClient.user.findUnique({
    where: { id: tokenUserId },
    select: {
      id: true,
      email: true,
      tokenVersion: true,
    },
  });

  if (!persistedUser) {
    return null;
  }

  const currentDbTokenVersion = persistedUser.tokenVersion ?? 0;
  if (currentDbTokenVersion !== tokenVersionFromCookie) {
    return null;
  }

  try {
    const currentEmail = new UserEmail(persistedUser.email);
    return new UserIdentity(persistedUser.id, currentEmail, currentDbTokenVersion);
  } catch {
    return null;
  }
}

export function setSessionCookie(
  response: NextApiResponse,
  sessionToken: UserSessionToken
): void {
  let tokenString = "";
  sessionToken.transferToken((token) => {
    tokenString = token;
  });

  const isProduction = process.env.NODE_ENV === "production";
  const secureFlag = isProduction ? "; Secure" : "";
  const maxAgeSeconds = 7 * 24 * 60 * 60;

  const cookieHeaderValue = `${SESSION_COOKIE_NAME}=${encodeURIComponent(tokenString)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureFlag}`;
  response.setHeader("Set-Cookie", cookieHeaderValue);
}

export function clearSessionCookie(response: NextApiResponse): void {
  const isProduction = process.env.NODE_ENV === "production";
  const secureFlag = isProduction ? "; Secure" : "";

  const cookieHeaderValue = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
  response.setHeader("Set-Cookie", cookieHeaderValue);
}

function parseCookiesFromHeader(cookieHeader: string): Record<string, string> {
  const cookiesMap: Record<string, string> = {};
  const cookieEntries = cookieHeader.split(";");

  for (const entry of cookieEntries) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = entry.slice(0, separatorIndex).trim();
    const rawValue = entry.slice(separatorIndex + 1).trim();
    try {
      cookiesMap[key] = decodeURIComponent(rawValue);
    } catch {
      continue;
    }
  }

  return cookiesMap;
}
