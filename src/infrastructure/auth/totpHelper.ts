import { randomBytes, createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateBase32Secret(byteLength = 20): string {
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
  if (typeof input !== "string" || input.length > 256) {
    return Buffer.alloc(0);
  }

  let cleaned = input.toUpperCase().replace(/\s+/g, "");
  while (cleaned.endsWith("=")) {
    cleaned = cleaned.slice(0, -1);
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  const maxIterations = Math.min(cleaned.length, 256);

  for (let i = 0; i < maxIterations; i++) {
    const char = cleaned[i];
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      continue;
    }
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpCode(secretBase32: string, stepOffset = 0): string {
  const key = decodeBase32(secretBase32);
  const timeStep = 30;
  const counter = Math.floor(Date.now() / 1000 / timeStep) + stepOffset;

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

export function verifyTotpCode(secretBase32: string, candidateCode: string): boolean {
  const normalizedCandidate = candidateCode.trim().replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalizedCandidate)) {
    return false;
  }

  // Permite tolerância de ±1 ciclo (30s antes ou 30s depois) para compensar desvios de relógio
  for (const offset of [0, -1, 1]) {
    const validCode = generateTotpCode(secretBase32, offset);
    if (validCode === normalizedCandidate) {
      return true;
    }
  }

  return false;
}

export function buildOtpAuthUrl(email: string, secretBase32: string): string {
  const cleanEmail = encodeURIComponent(email);
  return `otpauth://totp/WattFlow:${cleanEmail}?secret=${secretBase32}&issuer=WattFlow&algorithm=SHA1&digits=6&period=30`;
}
