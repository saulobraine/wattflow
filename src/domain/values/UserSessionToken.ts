/**
 * Objeto de Valor representando o token de sessão do usuário.
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 */
export class UserSessionToken {
  private readonly serializedToken: string;

  constructor(tokenCandidate: string) {
    const trimmed = tokenCandidate.trim();
    if (trimmed.length === 0) {
      throw new Error("O token de sessão não pode ser vazio.");
    }
    this.serializedToken = trimmed;
  }

  public transferToken(receiver: (token: string) => void): void {
    receiver(this.serializedToken);
  }
}
