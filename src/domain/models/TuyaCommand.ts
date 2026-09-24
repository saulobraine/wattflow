import { DeviceCommandCode } from "../values/DeviceCommandCode";
import { SwitchState } from "../values/SwitchState";

/**
 * Entidade de Domínio representando um comando a ser enviado para a Tuya.
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Sem a palavra-chave else
 * - Sem getters ou setters (Tell, Don't Ask)
 */
export class TuyaCommand {
  private readonly commandCode: DeviceCommandCode;
  private readonly targetState: SwitchState;

  constructor(commandCode: DeviceCommandCode, targetState: SwitchState) {
    this.commandCode = commandCode;
    this.targetState = targetState;
  }

  public static createTurnOn(commandCode: DeviceCommandCode): TuyaCommand {
    const activeState = SwitchState.activate();
    return new TuyaCommand(commandCode, activeState);
  }

  public static createTurnOff(commandCode: DeviceCommandCode): TuyaCommand {
    const inactiveState = SwitchState.deactivate();
    return new TuyaCommand(commandCode, inactiveState);
  }

  public exportPayload(receiver: (code: string, value: boolean) => void): void {
    let extractedCode = "";
    let extractedValue = false;

    this.commandCode.transferCode((codeString: string) => {
      extractedCode = codeString;
    });

    this.targetState.transferState((booleanValue: boolean) => {
      extractedValue = booleanValue;
    });

    receiver(extractedCode, extractedValue);
  }
}
