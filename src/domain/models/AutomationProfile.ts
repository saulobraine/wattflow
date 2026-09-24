import { AutomationThresholdPair } from "./AutomationThresholdPair";
import { DevicePair } from "./DevicePair";

/**
 * Perfil de automação contendo os limites e o par de dispositivos.
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Sem uso de else
 */
export class AutomationProfile {
  private readonly devicePair: DevicePair;
  private readonly thresholdPair: AutomationThresholdPair;

  constructor(
    devicePair: DevicePair,
    thresholdPair: AutomationThresholdPair
  ) {
    this.devicePair = devicePair;
    this.thresholdPair = thresholdPair;
  }

  public provideDevicePair(receiver: (devicePair: DevicePair) => void): void {
    receiver(this.devicePair);
  }

  public provideThresholdPair(receiver: (thresholdPair: AutomationThresholdPair) => void): void {
    receiver(this.thresholdPair);
  }
}
