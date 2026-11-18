import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTE_LENGTH = 12;
const AUTH_TAG_BYTE_LENGTH = 16;
const KEY_BYTE_LENGTH = 32;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const REPEATED_BYTE_HEX_PATTERN = /^([0-9a-f]{2})\1{31}$/;
const REPEATED_DWORD_HEX_PATTERN = /^([0-9a-f]{8})\1{7}$/;
const REPEATED_QWORD_HEX_PATTERN = /^([0-9a-f]{16})\1{3}$/;
const KNOWN_TRIVIAL_HEX_KEYS = new Set([
  "0123456789abcdef".repeat(4),
  "fedcba9876543210".repeat(4),
  "abcdef0123456789".repeat(4),
]);
const CIPHERTEXT_PREFIX = "enc:v1:";
const MASK_BULLETS = "••••••••";

export function isTrivialHexKey(normalizedLowerHex: string): boolean {
  return (
    KNOWN_TRIVIAL_HEX_KEYS.has(normalizedLowerHex) ||
    REPEATED_BYTE_HEX_PATTERN.test(normalizedLowerHex) ||
    REPEATED_DWORD_HEX_PATTERN.test(normalizedLowerHex) ||
    REPEATED_QWORD_HEX_PATTERN.test(normalizedLowerHex)
  );
}

/**
 * Obtém e valida a chave mestra ENCRYPTION_KEY (32 bytes / 64 caracteres hex).
 * Opera em modo fail-closed: lança erro se ausente, inválida ou trivial/conhecida.
 */
export function getEncryptionKey(): Buffer {
  const rawKey = process.env.ENCRYPTION_KEY;
  if (typeof rawKey !== "string") {
    throw new Error(
      "Variável de ambiente ENCRYPTION_KEY obrigatória ausente (esperado 64 caracteres hexadecimais / 32 bytes)."
    );
  }

  const trimmedKey = rawKey.trim();
  if (!HEX_KEY_PATTERN.test(trimmedKey)) {
    throw new Error(
      "Variável de ambiente ENCRYPTION_KEY inválida: deve conter exatamente 64 caracteres hexadecimais (32 bytes)."
    );
  }

  const normalizedLower = trimmedKey.toLowerCase();
  if (isTrivialHexKey(normalizedLower)) {
    throw new Error(
      "Variável de ambiente ENCRYPTION_KEY inválida: chave trivial, repetitiva ou de exemplo não é permitida."
    );
  }

  const keyBuffer = Buffer.from(trimmedKey, "hex");
  if (keyBuffer.byteLength !== KEY_BYTE_LENGTH) {
    throw new Error("Variável de ambiente ENCRYPTION_KEY inválida: tamanho decodificado diferente de 32 bytes.");
  }

  return keyBuffer;
}

/**
 * Cifra um segredo em texto claro utilizando AES-256-GCM autenticado.
 * Formato de saída: enc:v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new Error("O valor para criptografia deve ser uma string.");
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTE_LENGTH,
  });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${CIPHERTEXT_PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

/**
 * Decifra e autentica um segredo cifrado com AES-256-GCM.
 * Rejeita valores não cifrados, malformados ou adulterados (fail-closed).
 */
export function decryptSecret(encryptedPayload: string): string {
  const key = getEncryptionKey();

  if (typeof encryptedPayload !== "string" || !encryptedPayload.startsWith(CIPHERTEXT_PREFIX)) {
    throw new Error("Formato de segredo cifrado inválido ou não autenticado.");
  }

  const withoutPrefix = encryptedPayload.slice(CIPHERTEXT_PREFIX.length);
  const parts = withoutPrefix.split(":");
  if (parts.length !== 3) {
    throw new Error("Estrutura de payload cifrado inválida.");
  }

  const [ivPart, tagPart, cipherPart] = parts;
  if (!ivPart || !tagPart || cipherPart === undefined) {
    throw new Error("Componentes de criptografia ausentes no payload.");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const authTag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(cipherPart, "base64url");

  if (iv.byteLength !== IV_BYTE_LENGTH) {
    throw new Error("IV de criptografia inválido.");
  }

  if (authTag.byteLength !== AUTH_TAG_BYTE_LENGTH) {
    throw new Error("Tag de autenticação GCM inválida.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTE_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Cifra valores opcionais não vazios; mantém string vazia "" quando não preenchido,
 * validando sempre a presença e integridade de ENCRYPTION_KEY.
 */
export function encryptSecretIfPresent(value: string | null | undefined): string {
  getEncryptionKey();
  if (value === null || value === undefined) {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return encryptSecret(trimmed);
}

/**
 * Decifra valores opcionais armazenados no banco; retorna "" se vazio/nulo,
 * validando sempre ENCRYPTION_KEY e rejeitando valores não vazios sem envelope enc:v1:.
 */
export function decryptSecretIfPresent(storedValue: string | null | undefined): string {
  getEncryptionKey();
  if (storedValue === null || storedValue === undefined || storedValue === "") {
    return "";
  }
  return decryptSecret(storedValue);
}

/**
 * Gera representação mascarada irreversível para exibição na UI.
 * Nunca expõe o segredo completo nem o comprimento real; exibe sufixo de 4 caracteres
 * apenas quando o segredo possui ao menos 8 caracteres.
 */
export function maskSecretIrreversible(plaintext: string | null | undefined): string {
  if (typeof plaintext !== "string") {
    return "";
  }
  const trimmed = plaintext.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length < 8) {
    return MASK_BULLETS;
  }
  return `${MASK_BULLETS}${trimmed.slice(-4)}`;
}

/**
 * Identifica se um valor enviado pela UI é vazio ou máscara inalterada.
 */
export function isUnchangedOrMaskedSecret(candidate: unknown): boolean {
  if (typeof candidate !== "string") {
    return true;
  }
  const trimmed = candidate.trim();
  return trimmed.length === 0 || trimmed.includes("••••");
}
