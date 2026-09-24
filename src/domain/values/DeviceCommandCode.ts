/**
 * Objeto de Valor representando o código de instrução da Tuya (ex: "switch_1" ou "switch").
 * Respeita Object Calisthenics:
 * - Encapsula string
 * - Apenas 1 variável de instância
 * - Sem abreviações
 */
export class DeviceCommandCode {
  private readonly commandCode: string;

  constructor(commandCandidate: string) {
    const trimmedCode = commandCandidate.trim();
    if (trimmedCode.length === 0) {
      throw new Error("O código de comando não pode ser vazio.");
    }
    this.commandCode = trimmedCode;
  }

  public static standardSwitch(): DeviceCommandCode {
    return new DeviceCommandCode("switch_1");
  }

  public transferCode(receiver: (commandCode: string) => void): void {
    receiver(this.commandCode);
  }
}
