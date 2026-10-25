import { EcoFlowCredentials } from "./EcoFlowCredentials";

/**
 * Agrupamento de credenciais do sistema BYOK (EcoFlow).
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 */
export class CredentialsBundle {
  private readonly ecoflowCredentials: EcoFlowCredentials;

  constructor(ecoflowCredentials: EcoFlowCredentials) {
    this.ecoflowCredentials = ecoflowCredentials;
  }

  public provideEcoFlowCredentials(receiver: (credentials: EcoFlowCredentials) => void): void {
    receiver(this.ecoflowCredentials);
  }
}
