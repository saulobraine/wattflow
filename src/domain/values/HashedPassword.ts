import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { MAX_PASSWORD_LENGTH, RawPassword } from "./RawPassword";

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
 * Objeto de Valor representando a senha criptografada (hash + salt).
 * Utiliza comparação assíncrona não-bloqueante (crypto.scrypt + timingSafeEqual).
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - Comportamento Tell, Don't Ask
 */
export class HashedPassword {
  private readonly storedHashString: string;

  constructor(storedHashString: string) {
    if (typeof storedHashString !== "string" || !storedHashString.includes(":")) {
      throw new Error("Formato de hash de senha inválido.");
    }
    this.storedHashString = storedHashString;
  }

  public async matchesRawPassword(candidatePassword: RawPassword): Promise<boolean> {
    let candidateRawString = "";
    candidatePassword.transferRawPassword((raw: string) => {
      candidateRawString = raw;
    });

    return this.matchesPlaintextCandidate(candidateRawString);
  }

  public async matchesPlaintextCandidate(candidateRawString: string): Promise<boolean> {
    if (
      typeof candidateRawString !== "string" ||
      candidateRawString.length === 0 ||
      candidateRawString.length > MAX_PASSWORD_LENGTH
    ) {
      return false;
    }

    const parts = this.storedHashString.split(":");
    if (parts.length !== 2) {
      return false;
    }

    const salt = parts[0];
    const originalHashHex = parts[1];
    if (!salt || !originalHashHex) {
      return false;
    }

    const originalBuffer = Buffer.from(originalHashHex, "hex");
    if (originalBuffer.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }

    const derivedBuffer = await deriveScryptKeyAsync(candidateRawString, salt);
    if (derivedBuffer.length !== originalBuffer.length) {
      return false;
    }

    return timingSafeEqual(derivedBuffer, originalBuffer);
  }

  public transferHash(receiver: (hash: string) => void): void {
    receiver(this.storedHashString);
  }
}
