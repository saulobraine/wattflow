import { DeviceIdentifier } from "../values/DeviceIdentifier";
import { DeviceSerialNumber } from "../values/DeviceSerialNumber";

/**
 * Par de dispositivos configurados para o fluxo de orquestração.
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Sem a palavra-chave else
 * - Tell, Don't Ask
 */
export class DevicePair {
  private readonly tuyaDeviceIdentifier: DeviceIdentifier;
  private readonly ecoflowSerialNumber: DeviceSerialNumber;

  constructor(
    tuyaDeviceIdentifier: DeviceIdentifier,
    ecoflowSerialNumber: DeviceSerialNumber
  ) {
    this.tuyaDeviceIdentifier = tuyaDeviceIdentifier;
    this.ecoflowSerialNumber = ecoflowSerialNumber;
  }

  public provideTuyaIdentifier(receiver: (identifier: string) => void): void {
    this.tuyaDeviceIdentifier.transferIdentifier(receiver);
  }

  public provideEcoFlowSerialNumber(receiver: (serialNumber: string) => void): void {
    this.ecoflowSerialNumber.transferSerialNumber(receiver);
  }
}
