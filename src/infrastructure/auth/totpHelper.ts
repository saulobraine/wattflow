import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MIN_TOTP_SECRET_BYTES = 16;
const BASE32_VALID_PATTERN = /^[A-Z2-7]+={0,6}$/;
const TOTP_STEP_SECONDS = 30;

export interface TotpVerificationResult {
  valid: boolean;
  matchedCounter: number | null;
}

export function generateBase32Secret(byteLength = 20): string {
  if (!Number.isInteger(byteLength) || byteLength < MIN_TOTP_SECRET_BYTES) {
    throw new Error(
      `O segredo TOTP deve possuir no mínimo ${MIN_TOTP_SECRET_BYTES} bytes de entropia.`
    );
  }

  const bytes = randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function decodeBase32(input: string): Buffer {
  if (typeof input !== "string") {
    throw new Error("Segredo TOTP inválido: esperado formato string Base32.");
  }

  const withoutSpaces = input.trim().replace(/\s+/g, "").toUpperCase();
  if (withoutSpaces.length === 0 || withoutSpaces.length > 256) {
    throw new Error("Segredo TOTP Base32 ausente ou excede o tamanho máximo.");
  }

  if (!BASE32_VALID_PATTERN.test(withoutSpaces)) {
    throw new Error("Segredo TOTP contém caracteres Base32 inválidos.");
  }

  const cleaned = withoutSpaces.replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Segredo TOTP contém caracteres Base32 inválidos.");
    }
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  const decodedBuffer = Buffer.from(bytes);
  if (decodedBuffer.byteLength < MIN_TOTP_SECRET_BYTES) {
    throw new Error(
      `Segredo TOTP insuficiente: mínimo de ${MIN_TOTP_SECRET_BYTES} bytes decodificados exigido.`
    );
  }

  return decodedBuffer;
}

export function generateTotpCodeForCounter(key: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(counter), 0);

  const hmac = createHmac("sha1", key);
  hmac.update(buffer);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1] & 0xf;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, "0");
}

export function generateTotpCode(secretBase32: string, stepOffset = 0): string {
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + stepOffset;
  return generateTotpCodeForCounter(key, counter);
}

/**
 * Valida código TOTP com janela ±1 ciclo (30s) e proteção contra replay (SEC-12).
 * Se lastUsedCounter for informado, rejeita qualquer contador <= lastUsedCounter.
 */
export function verifyTotpCodeWithCounter(
  secretBase32: string,
  candidateCode: string,
  lastUsedCounter?: number | null
): TotpVerificationResult {
  const key = decodeBase32(secretBase32);

  if (typeof candidateCode !== "string") {
    return { valid: false, matchedCounter: null };
  }

  const normalizedCandidate = candidateCode.trim().replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalizedCandidate)) {
    return { valid: false, matchedCounter: null };
  }

  const candidateBuffer = Buffer.from(normalizedCandidate, "utf8");
  const baseCounter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);

  for (const offset of [0, -1, 1]) {
    const stepCounter = baseCounter + offset;
    const validCode = generateTotpCodeForCounter(key, stepCounter);
    const validBuffer = Buffer.from(validCode, "utf8");

    if (
      candidateBuffer.byteLength === validBuffer.byteLength &&
      timingSafeEqual(candidateBuffer, validBuffer)
    ) {
      if (typeof lastUsedCounter === "number" && stepCounter <= lastUsedCounter) {
        return { valid: false, matchedCounter: null };
      }

      return {
        valid: true,
        matchedCounter: stepCounter,
      };
    }
  }

  return { valid: false, matchedCounter: null };
}

export function verifyTotpCode(
  secretBase32: string,
  candidateCode: string,
  lastUsedCounter?: number | null
): boolean {
  return verifyTotpCodeWithCounter(secretBase32, candidateCode, lastUsedCounter).valid;
}

export function buildOtpAuthUrl(email: string, secretBase32: string): string {
  decodeBase32(secretBase32);
  const normalizedSecret = secretBase32.trim().replace(/\s+/g, "").toUpperCase().replace(/=+$/, "");
  const cleanEmail = encodeURIComponent(email);
  return `otpauth://totp/WattFlow:${cleanEmail}?secret=${normalizedSecret}&issuer=WattFlow&algorithm=SHA1&digits=6&period=30`;
}
