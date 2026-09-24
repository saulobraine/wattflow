import { PercentageValue } from "./PercentageValue";

/**
 * Objeto de Valor representando o nível de bateria da EcoFlow.
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância (PercentageValue)
 * - Comportamento Tell, Don't Ask
 * - Sem a palavra-chave else
 */
export class BatteryLevel {
  private readonly percentage: PercentageValue;

  constructor(rawBatteryPercentage: number) {
    this.percentage = new PercentageValue(rawBatteryPercentage);
  }

  public isSufficientToTurnOn(threshold: PercentageValue): boolean {
    return this.percentage.isGreaterThanOrEqualTo(threshold);
  }

  public isDepletedToTurnOff(threshold: PercentageValue): boolean {
    return this.percentage.isLessThanOrEqualTo(threshold);
  }

  public transferBatteryPercentage(receiver: (percentageNumber: number) => void): void {
    this.percentage.transferNumericValue(receiver);
  }
}
