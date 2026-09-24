import { UserEmail } from "../values/UserEmail";

/**
 * Entidade de Domínio representando a identidade autenticada do usuário.
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Sem a palavra-chave else
 * - Tell, Don't Ask
 */
export class UserIdentity {
  private readonly userIdentifier: string;
  private readonly userEmail: UserEmail;

  constructor(userIdentifier: string, userEmail: UserEmail) {
    this.userIdentifier = userIdentifier;
    this.userEmail = userEmail;
  }

  public provideIdentity(receiver: (identifier: string, emailString: string) => void): void {
    let emailString = "";
    this.userEmail.transferEmail((email: string) => {
      emailString = email;
    });
    receiver(this.userIdentifier, emailString);
  }
}
