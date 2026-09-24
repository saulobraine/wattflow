/**
 * Objeto de Valor representando uma porcentagem entre 0 e 100.
 * Respeita Object Calisthenics:
 * - Encapsula tipo primitivo number
 * - Apenas 1 variável de instância
 * - Sem getters/setters (Tell, Don't Ask)
 * - Sem a palavra-chave else
 */
export class PercentageValue {
  private readonly numericValue: number;

  constructor(candidateValue: number) {
    if (Number.isNaN(candidateValue)) {
      throw new Error("O valor percentual não pode ser NaN.");
    }
    if (candidateValue < 0) {
      throw new Error("O valor percentual não pode ser inferior a zero.");
    }
    if (candidateValue > 100) {
      throw new Error("O valor percentual não pode ser superior a cem.");
    }
    this.numericValue = Math.round(candidateValue);
  }

  public isGreaterThanOrEqualTo(otherPercentage: PercentageValue): boolean {
    let comparisonResult = false;
    otherPercentage.transferNumericValue((otherValue: number) => {
      comparisonResult = this.numericValue >= otherValue;
    });
    return comparisonResult;
  }

  public isLessThanOrEqualTo(otherPercentage: PercentageValue): boolean {
    let comparisonResult = false;
    otherPercentage.transferNumericValue((otherValue: number) => {
      comparisonResult = this.numericValue <= otherValue;
    });
    return comparisonResult;
  }

  public transferNumericValue(receiver: (value: number) => void): void {
    receiver(this.numericValue);
  }
}
