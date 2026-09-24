import { randomBytes, scryptSync } from "node:crypto";
import { HashedPassword } from "./HashedPassword";

/**
 * Objeto de Valor representando uma senha em texto claro a ser validada ou criptografada.
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - Sem getters ou setters
 */
export class RawPassword {
  private readonly passwordText: string;

  constructor(passwordCandidate: string) {
    if (passwordCandidate.length < 6) {
      throw new Error("A senha deve possuir no mínimo 6 caracteres.");
    }
    this.passwordText = passwordCandidate;
  }

  public generateHashedRepresentation(): HashedPassword {
    const salt = randomBytes(16).toString("hex");
    const derivedBuffer = scryptSync(this.passwordText, salt, 64);
    const hashHex = derivedBuffer.toString("hex");
    const combined = `${salt}:${hashHex}`;
    return new HashedPassword(combined);
  }

  public transferRawPassword(receiver: (password: string) => void): void {
    receiver(this.passwordText);
  }
}
