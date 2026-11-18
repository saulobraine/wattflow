import type { PrismaClient } from "@prisma/client";
import {
  decryptSecret,
  encryptSecret,
  getEncryptionKey,
} from "./encryptionHelper";

const ENCRYPTED_NAMESPACE_PREFIX = "enc:";

export interface DecryptedConfigurationSecrets {
  ecoflowAccessSecret: string;
  tuyaAccessSecret: string;
  telegramBotToken: string;
  whatsappApiKey: string;
}

export interface ConfigurationSecretSource {
  id?: string;
  userId?: string;
  ecoflowAccessSecret?: string | null;
  tuyaAccessSecret?: string | null;
  telegramBotToken?: string | null;
  whatsappApiKey?: string | null;
}

interface SingleSecretResolution {
  plaintext: string;
  migratedCiphertext: string | null;
}

/**
 * Resolve um campo secreto armazenado:
 * - Valida ENCRYPTION_KEY imediatamente (fail-closed).
 * - Qualquer payload iniciado com "enc:" passa obrigatoriamente por decryptSecret() (fail-closed se adulterado ou versão inválida).
 * - Valores legados não vazios sem prefixo "enc:" são decodificados como legado e cifrados para migração imediata.
 */
export function resolveStoredSecretWithMigration(
  rawValue: string | null | undefined
): SingleSecretResolution {
  getEncryptionKey();

  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return { plaintext: "", migratedCiphertext: null };
  }

  if (rawValue.startsWith(ENCRYPTED_NAMESPACE_PREFIX)) {
    const decrypted = decryptSecret(rawValue);
    return { plaintext: decrypted, migratedCiphertext: null };
  }

  const trimmedLegacy = rawValue.trim();
  if (trimmedLegacy.length === 0) {
    return { plaintext: "", migratedCiphertext: "" };
  }

  const encrypted = encryptSecret(trimmedLegacy);
  return {
    plaintext: trimmedLegacy,
    migratedCiphertext: encrypted,
  };
}

/**
 * Decifra os segredos de UserConfiguration realizando lazy migration transparente no banco
 * caso algum campo legado esteja armazenado sem prefixo "enc:".
 * Falha de forma fechada (fail-closed) se ENCRYPTION_KEY estiver ausente/inválida
 * ou se qualquer payload "enc:" estiver malformado/adulterado.
 */
export async function decryptAndMigrateConfigurationSecrets(
  databaseClient: PrismaClient,
  record: ConfigurationSecretSource | null | undefined
): Promise<DecryptedConfigurationSecrets> {
  getEncryptionKey();

  if (!record) {
    return {
      ecoflowAccessSecret: "",
      tuyaAccessSecret: "",
      telegramBotToken: "",
      whatsappApiKey: "",
    };
  }

  const ecoflowRes = resolveStoredSecretWithMigration(record.ecoflowAccessSecret);
  const tuyaRes = resolveStoredSecretWithMigration(record.tuyaAccessSecret);
  const telegramRes = resolveStoredSecretWithMigration(record.telegramBotToken);
  const whatsappRes = resolveStoredSecretWithMigration(record.whatsappApiKey);

  const migrationData: Record<string, string> = {};
  if (ecoflowRes.migratedCiphertext !== null) {
    migrationData.ecoflowAccessSecret = ecoflowRes.migratedCiphertext;
  }
  if (tuyaRes.migratedCiphertext !== null) {
    migrationData.tuyaAccessSecret = tuyaRes.migratedCiphertext;
  }
  if (telegramRes.migratedCiphertext !== null) {
    migrationData.telegramBotToken = telegramRes.migratedCiphertext;
  }
  if (whatsappRes.migratedCiphertext !== null) {
    migrationData.whatsappApiKey = whatsappRes.migratedCiphertext;
  }

  const hasFieldsToMigrate = Object.keys(migrationData).length > 0;
  const canPersistUpdate =
    hasFieldsToMigrate &&
    Boolean(record.id || record.userId) &&
    typeof databaseClient.userConfiguration?.update === "function";

  if (canPersistUpdate) {
    const whereClause = record.id ? { id: record.id } : { userId: record.userId as string };
    await databaseClient.userConfiguration.update({
      where: whereClause,
      data: migrationData,
    });
  }

  return {
    ecoflowAccessSecret: ecoflowRes.plaintext,
    tuyaAccessSecret: tuyaRes.plaintext,
    telegramBotToken: telegramRes.plaintext,
    whatsappApiKey: whatsappRes.plaintext,
  };
}

/**
 * Decifra segredo TOTP (twoFactorSecret ou pendingTwoFactorSecret) do modelo User,
 * realizando lazy migration transparente se o valor legado não possuir prefixo "enc:".
 */
export async function decryptAndMigrateUserTotpSecret(
  databaseClient: PrismaClient,
  userId: string,
  fieldName: "twoFactorSecret" | "pendingTwoFactorSecret",
  rawSecret: string
): Promise<string> {
  const resolution = resolveStoredSecretWithMigration(rawSecret);

  if (
    resolution.migratedCiphertext !== null &&
    userId &&
    typeof databaseClient.user?.update === "function"
  ) {
    await databaseClient.user.update({
      where: { id: userId },
      data: {
        [fieldName]: resolution.migratedCiphertext,
      },
    });
  }

  return resolution.plaintext;
}
