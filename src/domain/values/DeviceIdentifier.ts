/**
 * Objeto de Valor representando o identificador de um dispositivo Tuya.
 * Respeita Object Calisthenics:
 * - Encapsula string primitiva
 * - Nomes sem abreviação
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 */
export class DeviceIdentifier {
  private readonly rawIdentifier: string;

  constructor(identifierCandidate: string) {
    const trimmedIdentifier = identifierCandidate.trim();
    if (trimmedIdentifier.length === 0) {
      throw new Error("O identificador do dispositivo Tuya não pode ser vazio.");
    }
    this.rawIdentifier = trimmedIdentifier;
  }

  public transferIdentifier(receiver: (identifierString: string) => void): void {
    receiver(this.rawIdentifier);
  }

  public matches(otherIdentifier: DeviceIdentifier): boolean {
    let hasMatched = false;
    otherIdentifier.transferIdentifier((otherString: string) => {
      hasMatched = this.rawIdentifier === otherString;
    });
    return hasMatched;
  }
}
