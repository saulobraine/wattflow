/**
 * Objeto de Valor representando a ação coordenada de dispositivos.
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - Comportamento Tell, Don't Ask
 * - Nomes sem abreviação
 */
export class DesiredDeviceAction {
  private readonly actionName: string;

  private constructor(actionName: string) {
    this.actionName = actionName;
  }

  /**
   * Bateria alta (atingiu o limite superior):
   * Desliga a tomada Tuya (corta recarga da rede) e ativa a saída AC da EcoFlow.
   */
  public static batteryHighDischarge(): DesiredDeviceAction {
    return new DesiredDeviceAction("BATTERY_HIGH_DISCHARGE");
  }

  /**
   * Bateria baixa (atingiu o limite inferior):
   * Liga a tomada Tuya (inicia recarga na rede) e desativa a saída AC da EcoFlow.
   */
  public static batteryLowRecharge(): DesiredDeviceAction {
    return new DesiredDeviceAction("BATTERY_LOW_RECHARGE");
  }

  /**
   * Bateria na faixa intermediária:
   * Mantém o estado atual sem chaveamento desnecessário (histerese).
   */
  public static holdCurrentState(): DesiredDeviceAction {
    return new DesiredDeviceAction("HOLD_CURRENT_STATE");
  }

  public isBatteryHighDischarge(): boolean {
    return this.actionName === "BATTERY_HIGH_DISCHARGE";
  }

  public isBatteryLowRecharge(): boolean {
    return this.actionName === "BATTERY_LOW_RECHARGE";
  }

  public requiresAction(): boolean {
    return this.actionName !== "HOLD_CURRENT_STATE";
  }

  public transferActionName(receiver: (name: string) => void): void {
    receiver(this.actionName);
  }
}
