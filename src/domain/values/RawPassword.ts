import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { HashedPassword } from "./HashedPassword";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

function deriveScryptKeyAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/**
 * Objeto de Valor representando uma senha em texto claro validada (12 a 128 caracteres).
 * Utiliza derivação assíncrona não-bloqueante (crypto.scrypt).
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - Sem getters ou setters
 */
export class RawPassword {
  private readonly passwordText: string;

  constructor(passwordCandidate: string) {
    if (
      typeof passwordCandidate !== "string" ||
      passwordCandidate.length < MIN_PASSWORD_LENGTH ||
      passwordCandidate.length > MAX_PASSWORD_LENGTH
    ) {
      throw new Error(
        `A senha deve possuir entre ${MIN_PASSWORD_LENGTH} e ${MAX_PASSWORD_LENGTH} caracteres.`
      );
    }
    this.passwordText = passwordCandidate;
  }

  public async generateHashedRepresentation(): Promise<HashedPassword> {
    const saltBuffer = randomBytes(16);
    const salt = saltBuffer.toString("hex");
    const derivedBuffer = await deriveScryptKeyAsync(this.passwordText, salt);
    const hashHex = derivedBuffer.toString("hex");
    const combined = `${salt}:${hashHex}`;
    return new HashedPassword(combined);
  }

  public transferRawPassword(receiver: (password: string) => void): void {
    receiver(this.passwordText);
  }
}
