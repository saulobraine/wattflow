import { DeviceSerialNumber } from "../values/DeviceSerialNumber";

/**
 * Representação do dispositivo EcoFlow configurado para a automação com a Chave de Transferência Automática.
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - Tell, Don't Ask
 */
export class DevicePair {
  private readonly ecoflowSerialNumber: DeviceSerialNumber;

  constructor(ecoflowSerialNumber: DeviceSerialNumber) {
    this.ecoflowSerialNumber = ecoflowSerialNumber;
  }

  public provideEcoFlowSerialNumber(receiver: (serialNumber: string) => void): void {
    this.ecoflowSerialNumber.transferSerialNumber(receiver);
  }
}
