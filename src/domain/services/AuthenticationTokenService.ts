import { createHmac, timingSafeEqual } from "node:crypto";
import { UserIdentity } from "../models/UserIdentity";
import { UserEmail } from "../values/UserEmail";
import { UserSessionToken } from "../values/UserSessionToken";

interface RawTokenPayload {
  userId: string;
  email: string;
  expiresAt: number;
}

/**
 * Serviço de geração e validação de tokens de sessão criptográficos (HMAC-SHA256).
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - 1 ponto por linha
 * - Sem a palavra-chave else
 */
export class AuthenticationTokenService {
  private readonly secretKey: string;

  constructor(secretKey: string) {
    if (secretKey.length < 16) {
      throw new Error("O segredo de autenticação deve possuir no mínimo 16 caracteres.");
    }
    this.secretKey = secretKey;
  }

  public createSessionToken(userId: string, email: string, validityDays = 7): UserSessionToken {
    const expiresAt = Date.now() + validityDays * 24 * 60 * 60 * 1000;
    const payload: RawTokenPayload = { userId, email, expiresAt };
    const payloadJson = JSON.stringify(payload);
    const base64Payload = Buffer.from(payloadJson).toString("base64url");

    const signature = this.calculateHmac(base64Payload);
    const serializedToken = `${base64Payload}.${signature}`;
    return new UserSessionToken(serializedToken);
  }

  public verifySessionToken(sessionToken: UserSessionToken): UserIdentity | null {
    let rawToken = "";
    sessionToken.transferToken((token: string) => {
      rawToken = token;
    });

    const tokenParts = rawToken.split(".");
    if (tokenParts.length !== 2) {
      return null;
    }

    const base64Payload = tokenParts[0];
    const signature = tokenParts[1];

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

    const payloadJson = Buffer.from(base64Payload, "base64url").toString("utf8");
    const parsedPayload = JSON.parse(payloadJson) as RawTokenPayload;

    const isExpired = Date.now() > parsedPayload.expiresAt;
    if (isExpired) {
      return null;
    }

    const emailValue = new UserEmail(parsedPayload.email);
    return new UserIdentity(parsedPayload.userId, emailValue);
  }

  private calculateHmac(content: string): string {
    const hmac = createHmac("sha256", this.secretKey);
    hmac.update(content, "utf8");
    const digest = hmac.digest("base64url");
    return digest;
  }
}
