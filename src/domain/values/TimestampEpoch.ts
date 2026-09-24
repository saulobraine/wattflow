/**
 * Objeto de Valor representando um timestamp Unix em milissegundos.
 * Respeita Object Calisthenics:
 * - Encapsula número primitivo
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 */
export class TimestampEpoch {
  private readonly millisecondsValue: number;

  constructor(epochMilliseconds: number) {
    if (epochMilliseconds <= 0) {
      throw new Error("O timestamp deve ser um número positivo.");
    }
    this.millisecondsValue = epochMilliseconds;
  }

  public static now(): TimestampEpoch {
    const currentMilliseconds = Date.now();
    return new TimestampEpoch(currentMilliseconds);
  }

  public transferAsString(receiver: (epochString: string) => void): void {
    const formattedString = this.millisecondsValue.toString();
    receiver(formattedString);
  }

  public transferNumericValue(receiver: (numericValue: number) => void): void {
    receiver(this.millisecondsValue);
  }
}
