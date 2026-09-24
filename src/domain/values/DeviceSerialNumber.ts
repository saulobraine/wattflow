/**
 * Objeto de Valor representando o número de série da estação EcoFlow.
 * Respeita Object Calisthenics:
 * - Sem abreviação (DeviceSerialNumber em vez de DeviceSN)
 * - Encapsula string
 * - Apenas 1 variável de instância
 * - Sem uso de else
 */
export class DeviceSerialNumber {
  private readonly rawSerialNumber: string;

  constructor(serialNumberCandidate: string) {
    const trimmedSerialNumber = serialNumberCandidate.trim();
    if (trimmedSerialNumber.length === 0) {
      throw new Error("O número de série da EcoFlow não pode ser vazio.");
    }
    this.rawSerialNumber = trimmedSerialNumber;
  }

  public transferSerialNumber(receiver: (serialNumberString: string) => void): void {
    receiver(this.rawSerialNumber);
  }
}
