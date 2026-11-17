/**
 * Objeto de Valor representando a ação de controle da EcoFlow para comutação da Chave de Transferência Automática (ATS).
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
   * Ativa a saída AC da EcoFlow. A Chave de Transferência Automática (ATS)
   * detecta a tensão do inversor e comuta automaticamente as cargas para a EcoFlow (Solar/Bateria).
   */
  public static enableEcoFlowAc(): DesiredDeviceAction {
    return new DesiredDeviceAction("ENABLE_ECOFLOW_AC");
  }

  /**
   * Bateria baixa (atingiu o limite inferior):
   * Desativa a saída AC da EcoFlow. A Chave de Transferência Automática (ATS)
   * detecta a queda do inversor e comuta instantaneamente as cargas de volta para a rede da concessionária.
   */
  public static disableEcoFlowAc(): DesiredDeviceAction {
    return new DesiredDeviceAction("DISABLE_ECOFLOW_AC");
  }

  /**
   * Bateria na faixa intermediária:
   * Mantém o estado atual sem chaveamento desnecessário (histerese).
   */
  public static holdCurrentState(): DesiredDeviceAction {
    return new DesiredDeviceAction("HOLD_CURRENT_STATE");
  }

  // Compatibilidade com logs históricos
  public isBatteryHighDischarge(): boolean {
    return this.actionName === "ENABLE_ECOFLOW_AC" || this.actionName === "BATTERY_HIGH_DISCHARGE";
  }

  public isBatteryLowRecharge(): boolean {
    return this.actionName === "DISABLE_ECOFLOW_AC" || this.actionName === "BATTERY_LOW_RECHARGE";
  }

  public isEnableEcoFlowAc(): boolean {
    return this.actionName === "ENABLE_ECOFLOW_AC" || this.actionName === "BATTERY_HIGH_DISCHARGE";
  }

  public isDisableEcoFlowAc(): boolean {
    return this.actionName === "DISABLE_ECOFLOW_AC" || this.actionName === "BATTERY_LOW_RECHARGE";
  }

  public requiresAction(): boolean {
    return this.actionName !== "HOLD_CURRENT_STATE";
  }

  public transferActionName(receiver: (name: string) => void): void {
    receiver(this.actionName);
  }
}
