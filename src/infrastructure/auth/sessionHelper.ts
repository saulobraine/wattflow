import type { NextApiRequest, NextApiResponse } from "next";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../database/prismaClient";
import { AuthenticationTokenService } from "../../domain/services/AuthenticationTokenService";
import { UserSessionToken } from "../../domain/values/UserSessionToken";
import { UserIdentity } from "../../domain/models/UserIdentity";
import { UserEmail } from "../../domain/values/UserEmail";

export const SESSION_COOKIE_NAME = "wattflow_session";
export const PERSISTENT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SHORT_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
export const SLIDING_REFRESH_THRESHOLD_MS = 29 * 24 * 60 * 60 * 1000;

export interface ExtractedSessionMeta {
  identity: UserIdentity;
  expiresAt: number;
  tokenVersion: number;
}

const MIN_AUTH_SECRET_LENGTH = 32;
const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

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
 * Valida proteção contra CSRF em requisições mutáveis autenticadas por cookie:
 * - Exige correspondência exata entre Origin (ou Referer como fallback) e Host.
 * - Rejeita requisições cross-site sinalizadas via Sec-Fetch-Site ou sem cabeçalho de origem.
 */
export function validateCsrfOrigin(request: NextApiRequest): boolean {
  const method = (request.method || "GET").toUpperCase();
  if (SAFE_HTTP_METHODS.has(method)) {
    return true;
  }

  const headers = request.headers ?? {};
  const rawSecFetchSite = headers["sec-fetch-site"];
  const secFetchSite = Array.isArray(rawSecFetchSite) ? rawSecFetchSite[0] : rawSecFetchSite;
  if (
    typeof secFetchSite === "string" &&
    secFetchSite.trim().length > 0 &&
    secFetchSite.trim().toLowerCase() !== "same-origin" &&
    secFetchSite.trim().toLowerCase() !== "none"
  ) {
    return false;
  }

  const expectedHost = resolveExpectedHost(request);
  if (!expectedHost) {
    return false;
  }

  const rawOrigin = headers.origin;
  const originHeader = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  if (typeof originHeader === "string" && originHeader.trim().length > 0) {
    const extractedOriginHost = extractHostFromUrlHeader(originHeader.trim());
    return extractedOriginHost !== null && extractedOriginHost === expectedHost;
  }

  const rawReferer = headers.referer;
  const refererHeader = Array.isArray(rawReferer) ? rawReferer[0] : rawReferer;
  if (typeof refererHeader === "string" && refererHeader.trim().length > 0) {
    const extractedRefererHost = extractHostFromUrlHeader(refererHeader.trim());
    return extractedRefererHost !== null && extractedRefererHost === expectedHost;
  }

  return false;
}

export function enforceCsrfProtection(
  request: NextApiRequest,
  response: NextApiResponse
): boolean {
  if (validateCsrfOrigin(request)) {
    return true;
  }

  response.status(403).json({
    success: false,
    message: "Requisição bloqueada por proteção CSRF (Origin/Host inválido ou ausente).",
  });
  return false;
}

function resolveExpectedHost(request: NextApiRequest): string | null {
  const headers = request.headers ?? {};
  const socketIp = request.socket?.remoteAddress?.trim();
  const isTrustedProxy =
    Boolean(socketIp && LOOPBACK_IPS.has(socketIp)) || process.env.TRUST_PROXY === "true";

  if (isTrustedProxy) {
    const rawForwardedHost = headers["x-forwarded-host"];
    const forwardedHost = Array.isArray(rawForwardedHost)
      ? rawForwardedHost[0]
      : rawForwardedHost;
    if (typeof forwardedHost === "string" && forwardedHost.trim().length > 0) {
      const firstHost = forwardedHost.split(",")[0]?.trim().toLowerCase();
      if (firstHost) {
        return firstHost;
      }
    }
  }

  const rawHost = headers.host;
  const hostHeader = Array.isArray(rawHost) ? rawHost[0] : rawHost;
  if (typeof hostHeader === "string" && hostHeader.trim().length > 0) {
    return hostHeader.trim().toLowerCase();
  }

  return null;
}

function extractHostFromUrlHeader(rawUrl: string): string | null {
  if (rawUrl === "null") {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Extrai e valida a sessão e seus metadados (identidade, expiração e tokenVersion) a partir do cookie HTTP-Only,
 * verificando integridade HMAC, escopo "session", expiração e revogação via tokenVersion no banco.
 */
export async function extractSessionWithMetaFromRequest(
  request: NextApiRequest,
  databaseClient: PrismaClient = prisma
): Promise<ExtractedSessionMeta | null> {
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
  const inspectedToken = service.inspectSessionToken(tokenValue);
  if (!inspectedToken) {
    return null;
  }

  let tokenUserId = "";
  let tokenVersionFromCookie = 0;
  inspectedToken.identity.provideIdentity((userId, _email, tokenVersion) => {
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
    const currentIdentity = new UserIdentity(persistedUser.id, currentEmail, currentDbTokenVersion);
    return {
      identity: currentIdentity,
      expiresAt: inspectedToken.expiresAt,
      tokenVersion: currentDbTokenVersion,
    };
  } catch {
    return null;
  }
}

/**
 * Extrai e valida a identidade do usuário a partir do cookie de sessão HTTP-Only.
 */
export async function extractUserFromRequest(
  request: NextApiRequest,
  databaseClient: PrismaClient = prisma
): Promise<UserIdentity | null> {
  const sessionMeta = await extractSessionWithMetaFromRequest(request, databaseClient);
  if (!sessionMeta) {
    return null;
  }
  return sessionMeta.identity;
}

export function setSessionCookie(
  response: NextApiResponse,
  sessionToken: UserSessionToken,
  maxAgeSeconds = PERSISTENT_SESSION_MAX_AGE_SECONDS
): void {
  let tokenString = "";
  sessionToken.transferToken((token) => {
    tokenString = token;
  });

  const isProduction = process.env.NODE_ENV === "production";
  const secureFlag = isProduction ? "; Secure" : "";
  const expiresUtc = new Date(Date.now() + maxAgeSeconds * 1000).toUTCString();

  const cookieHeaderValue = `${SESSION_COOKIE_NAME}=${encodeURIComponent(tokenString)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Expires=${expiresUtc}${secureFlag}`;
  response.setHeader("Set-Cookie", cookieHeaderValue);
}

export function clearSessionCookie(response: NextApiResponse): void {
  const isProduction = process.env.NODE_ENV === "production";
  const secureFlag = isProduction ? "; Secure" : "";

  const cookieHeaderValue = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`;
  response.setHeader("Set-Cookie", cookieHeaderValue);
}

export function parseCookiesFromHeader(cookieHeader: string): Record<string, string> {
  const cookiesMap: Record<string, string> = {};
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) {
    return cookiesMap;
  }

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
      // Ignora cookie com percent-encoding malformado sem lançar URIError (SEC-11)
      continue;
    }
  }

  return cookiesMap;
}
