import { TuyaCommand } from "./TuyaCommand";

interface CommandPayloadItem {
  code: string;
  value: boolean;
}

/**
 * Coleção de Primeira Classe para comandos da Tuya.
 * Respeita Object Calisthenics:
 * - Regra 4: Coleção de primeira classe (apenas o array encapsulado)
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - 1 ponto por linha
 */
export class TuyaCommandCollection {
  private readonly commandList: TuyaCommand[];

  constructor(commandList: TuyaCommand[]) {
    this.commandList = [...commandList];
  }

  public static singleCommand(command: TuyaCommand): TuyaCommandCollection {
    const list = [command];
    return new TuyaCommandCollection(list);
  }

  public hasCommands(): boolean {
    return this.commandList.length > 0;
  }

  public exportAsPayloadArray(receiver: (payloads: CommandPayloadItem[]) => void): void {
    const results: CommandPayloadItem[] = [];

    for (const currentCommand of this.commandList) {
      currentCommand.exportPayload((code: string, value: boolean) => {
        const item: CommandPayloadItem = { code, value };
        results.push(item);
      });
    }

    receiver(results);
  }
}
