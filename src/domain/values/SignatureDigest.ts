/**
 * Objeto de Valor representando o digest criptográfico (assinatura HMAC-SHA256).
 * Respeita Object Calisthenics:
 * - Encapsula string
 * - Apenas 1 variável de instância
 * - Sem abreviação
 */
export class SignatureDigest {
  private readonly digestHex: string;

  constructor(digestCandidate: string) {
    const trimmedDigest = digestCandidate.trim();
    if (trimmedDigest.length === 0) {
      throw new Error("O hash de assinatura não pode ser vazio.");
    }
    this.digestHex = trimmedDigest;
  }

  public transferDigest(receiver: (digestString: string) => void): void {
    receiver(this.digestHex);
  }

  public transferUpperCase(receiver: (upperCaseDigest: string) => void): void {
    const upperCaseString = this.digestHex.toUpperCase();
    receiver(upperCaseString);
  }
}
