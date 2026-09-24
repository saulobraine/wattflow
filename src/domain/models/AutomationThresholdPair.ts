import { BatteryLevel } from "../values/BatteryLevel";
import { DesiredDeviceAction } from "../values/DesiredDeviceAction";
import { PercentageValue } from "../values/PercentageValue";

/**
 * Entidade de Domínio representando os limites de carga configurados pelo usuário.
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Sem uso de else (early returns)
 * - Tell, Don't Ask (decide a ação coordenada com base na bateria)
 * - Nomes sem abreviação
 */
export class AutomationThresholdPair {
  private readonly upperThreshold: PercentageValue;
  private readonly lowerThreshold: PercentageValue;

  constructor(upperPercentage: PercentageValue, lowerPercentage: PercentageValue) {
    const isInvalidRange = lowerPercentage.isGreaterThanOrEqualTo(upperPercentage);
    if (isInvalidRange) {
      throw new Error("O limite mínimo de bateria deve ser pelo menos 1% menor que o limite máximo.");
    }
    this.upperThreshold = upperPercentage;
    this.lowerThreshold = lowerPercentage;
  }

  public evaluateBattery(batteryLevel: BatteryLevel): DesiredDeviceAction {
    const isBatteryFull = batteryLevel.isSufficientToTurnOn(this.upperThreshold);
    if (isBatteryFull) {
      return DesiredDeviceAction.batteryHighDischarge();
    }

    const isBatteryDepleted = batteryLevel.isDepletedToTurnOff(this.lowerThreshold);
    if (isBatteryDepleted) {
      return DesiredDeviceAction.batteryLowRecharge();
    }

    return DesiredDeviceAction.holdCurrentState();
  }

  public transferThresholds(receiver: (upper: number, lower: number) => void): void {
    let upperNumber = 0;
    let lowerNumber = 0;

    this.upperThreshold.transferNumericValue((value: number) => {
      upperNumber = value;
    });

    this.lowerThreshold.transferNumericValue((value: number) => {
      lowerNumber = value;
    });

    receiver(upperNumber, lowerNumber);
  }
}
