import { UserEmail } from "../values/UserEmail";

interface IdentityMetadata {
  email: UserEmail;
  tokenVersion: number;
}

/**
 * Entidade de Domínio representando a identidade autenticada do usuário.
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Sem a palavra-chave else
 * - Tell, Don't Ask
 */
export class UserIdentity {
  private readonly userIdentifier: string;
  private readonly metadata: IdentityMetadata;

  constructor(userIdentifier: string, userEmail: UserEmail, tokenVersion = 0) {
    this.userIdentifier = userIdentifier;
    this.metadata = {
      email: userEmail,
      tokenVersion,
    };
  }

  public provideIdentity(
    receiver: (identifier: string, emailString: string, tokenVersion: number) => void
  ): void {
    let emailString = "";
    const emailObject = this.metadata.email;
    emailObject.transferEmail((email: string) => {
      emailString = email;
    });
    receiver(this.userIdentifier, emailString, this.metadata.tokenVersion);
  }
}
