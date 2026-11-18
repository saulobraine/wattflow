import { createHmac, timingSafeEqual } from "node:crypto";
import { UserIdentity } from "../models/UserIdentity";
import { UserEmail } from "../values/UserEmail";
import { UserSessionToken } from "../values/UserSessionToken";

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
    if (!secretKey || secretKey.trim().length < 32) {
      throw new Error("O segredo de autenticação deve possuir no mínimo 32 caracteres.");
    }
    this.secretKey = secretKey;
  }

  public createSessionToken(
    userId: string,
    email: string,
    validityDays = 7,
    tokenVersion = 0
  ): UserSessionToken {
    const normalizedVersion = Number.isInteger(tokenVersion) && tokenVersion >= 0 ? tokenVersion : 0;
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
    const normalizedVersion = Number.isInteger(tokenVersion) && tokenVersion >= 0 ? tokenVersion : 0;
    const expiresAt = Date.now() + ttlMilliseconds;
    return this.signPayload({
      userId,
      email,
      scope: "2fa_challenge",
      tokenVersion: normalizedVersion,
      expiresAt,
    });
  }

  public verifySessionToken(
    sessionToken: UserSessionToken,
    expectedTokenVersion?: number
  ): UserIdentity | null {
    let rawToken = "";
    sessionToken.transferToken((token: string) => {
      rawToken = token;
    });

    return this.verifyScopedToken(rawToken, "session", expectedTokenVersion);
  }

  public verifyTwoFactorChallengeToken(
    rawChallengeToken: string,
    expectedTokenVersion?: number
  ): UserIdentity | null {
    if (typeof rawChallengeToken !== "string" || rawChallengeToken.trim().length === 0) {
      return null;
    }

    return this.verifyScopedToken(rawChallengeToken.trim(), "2fa_challenge", expectedTokenVersion);
  }

  private signPayload(payload: RawTokenPayload): string {
    const payloadJson = JSON.stringify(payload);
    const bufferPayload = Buffer.from(payloadJson, "utf8");
    const base64Payload = bufferPayload.toString("base64url");
    const signature = this.calculateHmac(base64Payload);
    return `${base64Payload}.${signature}`;
  }

  private verifyScopedToken(
    rawToken: string,
    requiredScope: TokenScope,
    expectedTokenVersion?: number
  ): UserIdentity | null {
    const tokenParts = rawToken.split(".");
    if (tokenParts.length !== 2) {
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

    if (signatureBuffer.length !== expectedBuffer.length) {
      return null;
    }

    const isSignatureValid = timingSafeEqual(signatureBuffer, expectedBuffer);
    if (!isSignatureValid) {
      return null;
    }

    let parsedPayload: RawTokenPayload;
    try {
      const decodedBuffer = Buffer.from(base64Payload, "base64url");
      const payloadJson = decodedBuffer.toString("utf8");
      parsedPayload = JSON.parse(payloadJson) as RawTokenPayload;
    } catch {
      return null;
    }

    if (!parsedPayload || parsedPayload.scope !== requiredScope) {
      return null;
    }

    const payloadVersion = parsedPayload.tokenVersion;
    if (typeof payloadVersion !== "number" || !Number.isInteger(payloadVersion) || payloadVersion < 0) {
      return null;
    }

    if (expectedTokenVersion !== undefined && payloadVersion !== expectedTokenVersion) {
      return null;
    }

    if (typeof parsedPayload.expiresAt !== "number" || Date.now() > parsedPayload.expiresAt) {
      return null;
    }

    try {
      const emailValue = new UserEmail(parsedPayload.email);
      return new UserIdentity(parsedPayload.userId, emailValue, payloadVersion);
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
