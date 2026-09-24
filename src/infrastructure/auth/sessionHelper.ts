import type { NextApiRequest, NextApiResponse } from "next";
import { AuthenticationTokenService } from "../../domain/services/AuthenticationTokenService";
import { UserSessionToken } from "../../domain/values/UserSessionToken";
import { UserIdentity } from "../../domain/models/UserIdentity";

export const SESSION_COOKIE_NAME = "wattflow_session";

export function getAuthenticationTokenService(): AuthenticationTokenService {
  const secret = process.env.AUTH_SECRET || "wattflow_secure_authentication_secret_key_32chars";
  return new AuthenticationTokenService(secret);
}

export function extractUserFromRequest(request: NextApiRequest): UserIdentity | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const parsedCookies = parseCookiesFromHeader(cookieHeader);
  const rawCookieToken = parsedCookies[SESSION_COOKIE_NAME];
  if (!rawCookieToken) {
    return null;
  }

  const tokenValue = new UserSessionToken(rawCookieToken);
  const service = getAuthenticationTokenService();
  return service.verifySessionToken(tokenValue);
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
    cookiesMap[key] = decodeURIComponent(rawValue);
  }

  return cookiesMap;
}
