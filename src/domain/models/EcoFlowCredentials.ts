import { AccessKey } from "../values/AccessKey";
import { AccessSecret } from "../values/AccessSecret";
import { SignatureDigest } from "../values/SignatureDigest";

/**
 * Credenciais da API da EcoFlow Open API.
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Sem a palavra-chave else
 * - Tell, Don't Ask
 */
export class EcoFlowCredentials {
  private readonly accessKey: AccessKey;
  private readonly accessSecret: AccessSecret;

  constructor(accessKey: AccessKey, accessSecret: AccessSecret) {
    this.accessKey = accessKey;
    this.accessSecret = accessSecret;
  }

  public calculateSignature(contentToSign: string): SignatureDigest {
    const rawDigest = this.accessSecret.calculateHmacSha256(contentToSign);
    return new SignatureDigest(rawDigest);
  }

  public provideAccessKey(receiver: (keyString: string) => void): void {
    this.accessKey.transferKey(receiver);
  }
}
