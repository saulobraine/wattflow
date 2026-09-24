import { createHmac } from "node:crypto";

/**
 * Objeto de Valor representando o segredo de API (Secret Key).
 * Respeita Object Calisthenics:
 * - Encapsula o segredo sensível
 * - Aplica Tell, Don't Ask (calcula HMAC diretamente no objeto)
 * - 1 ponto por linha
 * - Apenas 1 variável de instância
 */
export class AccessSecret {
  private readonly rawSecret: string;

  constructor(secretCandidate: string) {
    const trimmedSecret = secretCandidate.trim();
    if (trimmedSecret.length === 0) {
      throw new Error("O segredo de acesso não pode ser vazio.");
    }
    this.rawSecret = trimmedSecret;
  }

  public calculateHmacSha256(contentToSign: string): string {
    const hmacInstance = createHmac("sha256", this.rawSecret);
    hmacInstance.update(contentToSign, "utf8");
    const digestHex = hmacInstance.digest("hex");
    return digestHex;
  }

  public transferSecret(receiver: (secretString: string) => void): void {
    receiver(this.rawSecret);
  }
}
