/**
 * Objeto de Valor representando a potência de geração solar instantânea em Watts.
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - Tell, Don't Ask
 * - Nomes sem abreviação
 */
export class SolarGenerationWatts {
  private readonly wattsValue: number;

  constructor(watts: number) {
    const isNegative = watts < 0;
    if (isNegative) {
      this.wattsValue = 0;
      return;
    }
    this.wattsValue = Math.round(watts);
  }

  public isGenerating(): boolean {
    return this.wattsValue > 0;
  }

  public isGreaterThan(otherWatts: SolarGenerationWatts): boolean {
    let otherNumeric = 0;
    otherWatts.transferNumericWatts((value: number) => {
      otherNumeric = value;
    });
    return this.wattsValue > otherNumeric;
  }

  public transferNumericWatts(receiver: (watts: number) => void): void {
    receiver(this.wattsValue);
  }
}
