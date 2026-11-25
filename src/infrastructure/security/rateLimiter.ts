import type { NextApiRequest, NextApiResponse } from "next";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAtMs: number;
}

interface WindowBucket {
  count: number;
  resetAtMs: number;
}

const rateLimitStore = new Map<string, WindowBucket>();
const cooldownStore = new Map<string, number>();

const MAX_STORE_ENTRIES = 10_000;
const TRUSTED_LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function pruneExpiredEntries(nowMs: number): void {
  if (rateLimitStore.size >= MAX_STORE_ENTRIES) {
    for (const [key, bucket] of rateLimitStore.entries()) {
      if (nowMs >= bucket.resetAtMs) {
        rateLimitStore.delete(key);
      }
    }

    while (rateLimitStore.size >= MAX_STORE_ENTRIES) {
      const oldestKey = rateLimitStore.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      rateLimitStore.delete(oldestKey);
    }
  }

  if (cooldownStore.size >= MAX_STORE_ENTRIES) {
    for (const [key, expiresAtMs] of cooldownStore.entries()) {
      if (nowMs >= expiresAtMs) {
        cooldownStore.delete(key);
      }
    }

    while (cooldownStore.size >= MAX_STORE_ENTRIES) {
      const oldestKey = cooldownStore.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      cooldownStore.delete(oldestKey);
    }
  }
}

function isDockerBridgeOrPrivateIp(ip: string): boolean {
  let normalized = ip;
  if (normalized.startsWith("::ffff:")) {
    normalized = normalized.slice(7);
  }

  // 10.0.0.0/8 (10.0.0.0 a 10.255.255.255)
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) {
    const parts = normalized.split(".").map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }

  // 172.16.0.0/12 (172.16.0.0 a 172.31.255.255 - sub-redes Docker bridge padrão)
  if (/^172\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) {
    const parts = normalized.split(".").map(Number);
    if (parts.length === 4 && parts.every((p) => p >= 0 && p <= 255)) {
      return parts[1] >= 16 && parts[1] <= 31;
    }
  }

  return false;
}

/**
 * Extrai o endereço IP do cliente de forma segura.
 * Só confia em headers X-Forwarded-For / X-Real-IP quando a conexão vem de proxy reverso loopback,
 * sub-redes Docker bridge (172.16.0.0/12 e 10.0.0.0/8) ou quando TRUST_PROXY === "true", ou em teste sem socket.
 */
export function extractClientIp(request: NextApiRequest): string {
  const socketIp = request.socket?.remoteAddress?.trim();
  const isTrustedHop =
    !socketIp ||
    TRUSTED_LOOPBACK_IPS.has(socketIp) ||
    isDockerBridgeOrPrivateIp(socketIp) ||
    process.env.TRUST_PROXY === "true";

  if (isTrustedHop) {
    const realIpHeader = request.headers?.["x-real-ip"];
    const realIp = Array.isArray(realIpHeader) ? realIpHeader[0] : realIpHeader;
    if (typeof realIp === "string" && realIp.trim().length > 0) {
      return realIp.trim();
    }

    const forwardedHeader = request.headers?.["x-forwarded-for"];
    const forwardedRaw = Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader;
    if (typeof forwardedRaw === "string" && forwardedRaw.trim().length > 0) {
      const firstHop = forwardedRaw.split(",")[0]?.trim();
      if (firstHop) {
        return firstHop;
      }
    }
  }

  return socketIp || "127.0.0.1";
}

/**
 * Avalia e incrementa contador de rate limit por janela fixa.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const nowMs = Date.now();
  pruneExpiredEntries(nowMs);

  const existing = rateLimitStore.get(key);
  if (!existing || nowMs >= existing.resetAtMs) {
    const resetAtMs = nowMs + windowMs;
    rateLimitStore.set(key, { count: 1, resetAtMs });
    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - 1),
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
      resetAtMs,
    };
  }

  if (existing.count >= maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      resetAtMs: existing.resetAtMs,
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, maxRequests - existing.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000));

  return {
    allowed: true,
    remaining,
    retryAfterSeconds,
    resetAtMs: existing.resetAtMs,
  };
}

/**
 * Avalia e registra cooldown mínimo entre execuções consecutivas (ex.: chaveamento físico AC/ATS).
 */
export function checkCooldown(key: string, cooldownMs: number): RateLimitResult {
  const nowMs = Date.now();
  pruneExpiredEntries(nowMs);

  const expiresAtMs = cooldownStore.get(key);
  if (expiresAtMs !== undefined && nowMs < expiresAtMs) {
    const retryAfterSeconds = Math.max(1, Math.ceil((expiresAtMs - nowMs) / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      resetAtMs: expiresAtMs,
    };
  }

  const nextExpiresAtMs = nowMs + cooldownMs;
  cooldownStore.set(key, nextExpiresAtMs);
  return {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil(cooldownMs / 1000)),
    resetAtMs: nextExpiresAtMs,
  };
}

/**
 * Envia resposta HTTP 429 padronizada com header Retry-After.
 */
export function sendRateLimitExceeded(
  response: NextApiResponse,
  retryAfterSeconds: number,
  message = "Muitas tentativas em curto intervalo. Aguarde antes de tentar novamente."
): void {
  response.setHeader("Retry-After", String(retryAfterSeconds));
  response.status(429).json({
    success: false,
    message,
  });
}

/**
 * Utilitário para controle de intervenção manual da saída AC / ATS (cooldown de sobrescrita).
 * Quando o usuário liga ou desliga a saída AC manualmente, a automação em background
 * não deve desfazer imediatamente a vontade do usuário (janela padrão: 5 minutos / 300.000 ms).
 */
const manualAcOverrideStore = new Map<string, number>();
export const DEFAULT_MANUAL_AC_OVERRIDE_WINDOW_MS = 300_000;

export function registerManualAcOverride(
  userId: string,
  windowMs = DEFAULT_MANUAL_AC_OVERRIDE_WINDOW_MS
): void {
  const normalized = typeof userId === "string" ? userId.trim() : "";
  if (!normalized) {
    return;
  }
  const expiresAtMs = Date.now() + windowMs;
  manualAcOverrideStore.set(normalized, expiresAtMs);
}

export function isManualAcOverrideActive(
  userId: string,
  _windowMs?: number
): boolean {
  const normalized = typeof userId === "string" ? userId.trim() : "";
  if (!normalized) {
    return false;
  }
  const expiresAtMs = manualAcOverrideStore.get(normalized);
  if (expiresAtMs === undefined) {
    return false;
  }
  const nowMs = Date.now();
  if (nowMs >= expiresAtMs) {
    manualAcOverrideStore.delete(normalized);
    return false;
  }
  return true;
}

export function resetManualAcOverrideState(): void {
  manualAcOverrideStore.clear();
}

/**
 * Utilitário para limpeza determinística de estado em suítes de testes automatizados.
 */
export function resetRateLimiterState(): void {
  rateLimitStore.clear();
  cooldownStore.clear();
  manualAcOverrideStore.clear();
}
