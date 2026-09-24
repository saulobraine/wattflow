import { AutomationProfile } from "./AutomationProfile";
import { CredentialsBundle } from "./CredentialsBundle";

/**
 * Agregado principal da configuração de orquestração do usuário.
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância (CredentialsBundle e AutomationProfile)
 * - Comportamento via Tell, Don't Ask
 */
export class OrchestratorConfiguration {
  private readonly credentialsBundle: CredentialsBundle;
  private readonly automationProfile: AutomationProfile;

  constructor(
    credentialsBundle: CredentialsBundle,
    automationProfile: AutomationProfile
  ) {
    this.credentialsBundle = credentialsBundle;
    this.automationProfile = automationProfile;
  }

  public provideCredentialsBundle(receiver: (bundle: CredentialsBundle) => void): void {
    receiver(this.credentialsBundle);
  }

  public provideAutomationProfile(receiver: (profile: AutomationProfile) => void): void {
    receiver(this.automationProfile);
  }
}
