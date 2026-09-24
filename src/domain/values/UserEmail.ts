/**
 * Objeto de Valor representando o endereço de e-mail do usuário.
 * Respeita Object Calisthenics:
 * - Encapsula string primitiva
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - Validação no construtor
 */
export class UserEmail {
  private readonly emailAddress: string;

  constructor(emailCandidate: string) {
    const trimmed = emailCandidate.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      throw new Error("Formato de e-mail inválido.");
    }
    this.emailAddress = trimmed;
  }

  public transferEmail(receiver: (email: string) => void): void {
    receiver(this.emailAddress);
  }

  public matches(otherEmail: UserEmail): boolean {
    let hasMatched = false;
    otherEmail.transferEmail((other: string) => {
      hasMatched = this.emailAddress === other;
    });
    return hasMatched;
  }
}
