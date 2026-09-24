import { AccessKey } from "../values/AccessKey";
import { AccessSecret } from "../values/AccessSecret";
import { SignatureDigest } from "../values/SignatureDigest";

/**
 * Credenciais da API da Tuya Cloud OpenAPI.
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Tell, Don't Ask: calcula a assinatura diretamente através do segredo
 */
export class TuyaCredentials {
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
