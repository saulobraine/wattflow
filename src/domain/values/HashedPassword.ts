import { scryptSync, timingSafeEqual } from "node:crypto";
import { RawPassword } from "./RawPassword";

/**
 * Objeto de Valor representando a senha criptografada (hash + salt).
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - Comportamento Tell, Don't Ask (compara a senha internamente)
 */
export class HashedPassword {
  private readonly storedHashString: string;

  constructor(storedHashString: string) {
    if (!storedHashString.includes(":")) {
      throw new Error("Formato de hash de senha inválido.");
    }
    this.storedHashString = storedHashString;
  }

  public matchesRawPassword(candidatePassword: RawPassword): boolean {
    const parts = this.storedHashString.split(":");
    const salt = parts[0];
    const originalHashHex = parts[1];

    let candidateRawString = "";
    candidatePassword.transferRawPassword((raw: string) => {
      candidateRawString = raw;
    });

    const derivedBuffer = scryptSync(candidateRawString, salt, 64);
    const originalBuffer = Buffer.from(originalHashHex, "hex");

    if (derivedBuffer.length !== originalBuffer.length) {
      return false;
    }

    const matches = timingSafeEqual(derivedBuffer, originalBuffer);
    return matches;
  }

  public transferHash(receiver: (hash: string) => void): void {
    receiver(this.storedHashString);
  }
}
