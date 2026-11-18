import { createHmac, timingSafeEqual } from "node:crypto";
import { UserIdentity } from "../models/UserIdentity";
import { UserEmail } from "../values/UserEmail";
import { UserSessionToken } from "../values/UserSessionToken";

export const DEFAULT_SESSION_VALIDITY_DAYS = 30;

export interface InspectedSessionToken {
  identity: UserIdentity;
  expiresAt: number;
}

type TokenScope = "session" | "2fa_challenge";

interface RawTokenPayload {
  userId: string;
  email: string;
  scope: TokenScope;
  tokenVersion: number;
  expiresAt: number;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Serviço de geração e validação de tokens criptográficos (HMAC-SHA256)
 * com separação estrita de escopo ("session" vs "2fa_challenge") e controle de revogação via tokenVersion.
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - 1 ponto por linha
 * - Sem a palavra-chave else
 */
export class AuthenticationTokenService {
  private readonly secretKey: string;

  constructor(secretKey: string) {
    if (!secretKey) {
      throw new Error("O segredo de autenticação deve possuir no mínimo 32 caracteres.");
    }
    const trimmedSecret = secretKey.trim();
    if (trimmedSecret.length < 32) {
      throw new Error("O segredo de autenticação deve possuir no mínimo 32 caracteres.");
    }
    this.secretKey = secretKey;
  }

  public createSessionToken(
    userId: string,
    email: string,
    validityDays = DEFAULT_SESSION_VALIDITY_DAYS,
    tokenVersion = 0
  ): UserSessionToken {
    const isIntegerVersion = Number.isInteger(tokenVersion);
    const isValidVersion = isIntegerVersion && tokenVersion >= 0;
    const normalizedVersion = isValidVersion ? tokenVersion : 0;
    const expiresAt = Date.now() + validityDays * 24 * 60 * 60 * 1000;
    const serializedToken = this.signPayload({
      userId,
      email,
      scope: "session",
      tokenVersion: normalizedVersion,
      expiresAt,
    });
    return new UserSessionToken(serializedToken);
  }

  public createTwoFactorChallengeToken(
    userId: string,
    email: string,
    ttlMilliseconds = FIVE_MINUTES_MS,
    tokenVersion = 0
  ): string {
    const isIntegerVersion = Number.isInteger(tokenVersion);
    const isValidVersion = isIntegerVersion && tokenVersion >= 0;
    const normalizedVersion = isValidVersion ? tokenVersion : 0;
    const expiresAt = Date.now() + ttlMilliseconds;
    return this.signPayload({
      userId,
      email,
      scope: "2fa_challenge",
      tokenVersion: normalizedVersion,
      expiresAt,
    });
  }

  public inspectSessionToken(
    sessionToken: UserSessionToken,
    expectedTokenVersion?: number
  ): InspectedSessionToken | null {
    let rawToken = "";
    sessionToken.transferToken((token: string) => {
      rawToken = token;
    });

    return this.inspectScopedToken(rawToken, "session", expectedTokenVersion);
  }

  public verifySessionToken(
    sessionToken: UserSessionToken,
    expectedTokenVersion?: number
  ): UserIdentity | null {
    const inspected = this.inspectSessionToken(sessionToken, expectedTokenVersion);
    if (!inspected) {
      return null;
    }
    return inspected.identity;
  }

  public verifyTwoFactorChallengeToken(
    rawChallengeToken: string,
    expectedTokenVersion?: number
  ): UserIdentity | null {
    if (typeof rawChallengeToken !== "string") {
      return null;
    }

    const trimmedChallenge = rawChallengeToken.trim();
    if (trimmedChallenge.length === 0) {
      return null;
    }

    const inspected = this.inspectScopedToken(
      trimmedChallenge,
      "2fa_challenge",
      expectedTokenVersion
    );
    if (!inspected) {
      return null;
    }
    return inspected.identity;
  }

  private signPayload(payload: RawTokenPayload): string {
    const payloadJson = JSON.stringify(payload);
    const bufferPayload = Buffer.from(payloadJson, "utf8");
    const base64Payload = bufferPayload.toString("base64url");
    const signature = this.calculateHmac(base64Payload);
    return `${base64Payload}.${signature}`;
  }

  private inspectScopedToken(
    rawToken: string,
    requiredScope: TokenScope,
    expectedTokenVersion?: number
  ): InspectedSessionToken | null {
    const tokenParts = rawToken.split(".");
    const partsCount = tokenParts.length;
    if (partsCount !== 2) {
      return null;
    }

    const base64Payload = tokenParts[0];
    const signature = tokenParts[1];
    if (!base64Payload || !signature) {
      return null;
    }

    const expectedSignature = this.calculateHmac(base64Payload);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    const signatureLength = signatureBuffer.length;
    const expectedLength = expectedBuffer.length;

    if (signatureLength !== expectedLength) {
      return null;
    }

    const isSignatureValid = timingSafeEqual(signatureBuffer, expectedBuffer);
    if (!isSignatureValid) {
      return null;
    }

    const parsedPayload = this.parseRawTokenPayload(base64Payload);
    if (!parsedPayload) {
      return null;
    }

    return this.validateTokenClaims(parsedPayload, requiredScope, expectedTokenVersion);
  }

  private parseRawTokenPayload(base64Payload: string): RawTokenPayload | null {
    try {
      const decodedBuffer = Buffer.from(base64Payload, "base64url");
      const payloadJson = decodedBuffer.toString("utf8");
      const rawParsed: unknown = JSON.parse(payloadJson);
      const isArrayPayload = Array.isArray(rawParsed);
      if (typeof rawParsed !== "object" || rawParsed === null || isArrayPayload) {
        return null;
      }
      return rawParsed as RawTokenPayload;
    } catch {
      return null;
    }
  }

  private validateTokenClaims(
    parsedPayload: RawTokenPayload,
    requiredScope: TokenScope,
    expectedTokenVersion?: number
  ): InspectedSessionToken | null {
    const payloadScope = parsedPayload.scope;
    const payloadUserId = parsedPayload.userId;
    const payloadEmail = parsedPayload.email;

    if (payloadScope !== requiredScope || typeof payloadUserId !== "string") {
      return null;
    }

    const trimmedUserId = payloadUserId.trim();
    if (trimmedUserId.length === 0 || typeof payloadEmail !== "string") {
      return null;
    }

    const payloadVersion = parsedPayload.tokenVersion;
    const isIntegerVersion = Number.isInteger(payloadVersion);
    if (typeof payloadVersion !== "number" || !isIntegerVersion || payloadVersion < 0) {
      return null;
    }

    if (expectedTokenVersion !== undefined && payloadVersion !== expectedTokenVersion) {
      return null;
    }

    const payloadExpiresAt = parsedPayload.expiresAt;
    const currentTimestamp = Date.now();
    if (typeof payloadExpiresAt !== "number" || currentTimestamp > payloadExpiresAt) {
      return null;
    }

    try {
      const emailValue = new UserEmail(payloadEmail);
      const identity = new UserIdentity(payloadUserId, emailValue, payloadVersion);
      return {
        identity,
        expiresAt: payloadExpiresAt,
      };
    } catch {
      return null;
    }
  }

  private calculateHmac(content: string): string {
    const hmac = createHmac("sha256", this.secretKey);
    hmac.update(content, "utf8");
    const digest = hmac.digest("base64url");
    return digest;
  }
}
