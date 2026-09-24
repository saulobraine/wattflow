/**
 * Objeto de Valor representando uma chave pública de acesso (Client ID / Access Key).
 * Respeita Object Calisthenics:
 * - Encapsula string
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 */
export class AccessKey {
  private readonly rawKey: string;

  constructor(keyCandidate: string) {
    const trimmedKey = keyCandidate.trim();
    if (trimmedKey.length === 0) {
      throw new Error("A chave de acesso não pode ser vazia.");
    }
    this.rawKey = trimmedKey;
  }

  public transferKey(receiver: (keyString: string) => void): void {
    receiver(this.rawKey);
  }
}
