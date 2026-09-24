/**
 * Objeto de Valor representando o estado de um interruptor ou tomada inteligente.
 * Respeita Object Calisthenics:
 * - Encapsula boolean
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 */
export class SwitchState {
  private readonly isActivated: boolean;

  constructor(isActivated: boolean) {
    this.isActivated = isActivated;
  }

  public static activate(): SwitchState {
    return new SwitchState(true);
  }

  public static deactivate(): SwitchState {
    return new SwitchState(false);
  }

  public isTurnedOn(): boolean {
    return this.isActivated;
  }

  public transferState(receiver: (isActivated: boolean) => void): void {
    receiver(this.isActivated);
  }
}
