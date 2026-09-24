import { EcoFlowCredentials } from "./EcoFlowCredentials";
import { TuyaCredentials } from "./TuyaCredentials";

/**
 * Agrupamento de credenciais do sistema BYOK (Tuya e EcoFlow).
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Sem a palavra-chave else
 */
export class CredentialsBundle {
  private readonly tuyaCredentials: TuyaCredentials;
  private readonly ecoflowCredentials: EcoFlowCredentials;

  constructor(
    tuyaCredentials: TuyaCredentials,
    ecoflowCredentials: EcoFlowCredentials
  ) {
    this.tuyaCredentials = tuyaCredentials;
    this.ecoflowCredentials = ecoflowCredentials;
  }

  public provideTuyaCredentials(receiver: (credentials: TuyaCredentials) => void): void {
    receiver(this.tuyaCredentials);
  }

  public provideEcoFlowCredentials(receiver: (credentials: EcoFlowCredentials) => void): void {
    receiver(this.ecoflowCredentials);
  }
}
