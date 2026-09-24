import { createHash } from "node:crypto";
import { SignatureDigest } from "../values/SignatureDigest";
import { TuyaCredentials } from "../models/TuyaCredentials";

/**
 * Calculador de assinatura HMAC-SHA256 para a Tuya Cloud OpenAPI (padrão v2.0).
 * Respeita Object Calisthenics:
 * - 0 variáveis de instância (pura computação de domínio)
 * - 1 ponto por linha
 * - Sem a palavra-chave else
 * - Sem abreviações
 */
export class TuyaSignatureCalculator {
  public calculateBodyHash(rawBodyText: string): string {
    const hashInstance = createHash("sha256");
    hashInstance.update(rawBodyText, "utf8");
    const hexDigest = hashInstance.digest("hex");
    return hexDigest;
  }

  public buildStringToSign(
    httpMethod: string,
    bodyHash: string,
    requestPathWithQuery: string
  ): string {
    const uppercaseMethod = httpMethod.toUpperCase();
    const headersString = "";
    const stringToSign = `${uppercaseMethod}\n${bodyHash}\n${headersString}\n${requestPathWithQuery}`;
    return stringToSign;
  }

  public calculateTokenSignature(
    credentials: TuyaCredentials,
    timestampString: string,
    stringToSign: string
  ): SignatureDigest {
    let accessKeyString = "";
    credentials.provideAccessKey((keyText: string) => {
      accessKeyString = keyText;
    });

    const concatenatedPayload = `${accessKeyString}${timestampString}${stringToSign}`;
    const signatureDigest = credentials.calculateSignature(concatenatedPayload);
    return signatureDigest;
  }

  public calculateRequestSignature(
    credentials: TuyaCredentials,
    accessToken: string,
    timestampString: string,
    stringToSign: string
  ): SignatureDigest {
    let accessKeyString = "";
    credentials.provideAccessKey((keyText: string) => {
      accessKeyString = keyText;
    });

    const concatenatedPayload = `${accessKeyString}${accessToken}${timestampString}${stringToSign}`;
    const signatureDigest = credentials.calculateSignature(concatenatedPayload);
    return signatureDigest;
  }
}
