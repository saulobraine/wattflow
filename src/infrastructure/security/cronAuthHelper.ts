import { createHash, timingSafeEqual } from "node:crypto";
import type { NextApiRequest } from "next";

export const MIN_CRON_SECRET_LENGTH = 32;

/**
 * Compara dois segredos em tempo constante utilizando digest SHA-256 de tamanho fixo (32 bytes),
 * evitando vazamento de comprimento ou conteúdo por canal lateral de tempo.
 */
export function constantTimeSecretEquals(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Extrai token do Cron exclusivamente de headers HTTP (Authorization: Bearer <token> ou x-cron-token).
 * Query strings (?token=...) são intencionalmente ignoradas por segurança (SEC-12).
 */
export function extractCronTokenFromHeaders(request: NextApiRequest): string | null {
  const authHeader = request.headers?.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice("Bearer ".length).trim();
    if (bearerToken.length > 0) {
      return bearerToken;
    }
  }

  const rawCronHeader = request.headers?.["x-cron-token"];
  const cronHeader = Array.isArray(rawCronHeader) ? rawCronHeader[0] : rawCronHeader;
  if (typeof cronHeader === "string" && cronHeader.trim().length > 0) {
    return cronHeader.trim();
  }

  return null;
}

export function verifyCronRequestAuthorization(
  request: NextApiRequest,
  configuredSecret: string | undefined = process.env.CRON_SECRET || process.env.CRON_SECRET_TOKEN
): { hasValidSecretConfigured: boolean; isAuthorized: boolean } {
  const hasValidSecretConfigured = Boolean(
    typeof configuredSecret === "string" &&
      configuredSecret.trim().length >= MIN_CRON_SECRET_LENGTH
  );

  if (!hasValidSecretConfigured || !configuredSecret) {
    return { hasValidSecretConfigured: false, isAuthorized: false };
  }

  const providedToken = extractCronTokenFromHeaders(request);
  if (!providedToken) {
    return { hasValidSecretConfigured: true, isAuthorized: false };
  }

  const isAuthorized = constantTimeSecretEquals(providedToken, configuredSecret);
  return { hasValidSecretConfigured: true, isAuthorized };
}
