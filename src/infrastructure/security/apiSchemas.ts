import { z } from "zod";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../../domain/values/RawPassword";

export const loginBodySchema = z.object({
  email: z.string().trim().min(1, "E-mail é obrigatório.").max(254, "E-mail excede o limite máximo."),
  password: z
    .string()
    .min(1, "Senha é obrigatória.")
    .max(MAX_PASSWORD_LENGTH, `A senha não pode exceder ${MAX_PASSWORD_LENGTH} caracteres.`),
  rememberMe: z.boolean().optional(),
});

export const loginTwoFactorBodySchema = z
  .object({
    challengeToken: z
      .string()
      .trim()
      .min(1, "O challengeToken é obrigatório.")
      .max(2048, "O challengeToken excede o tamanho máximo permitido."),
    token: z.string().trim().max(16).optional(),
    code: z.string().trim().max(16).optional(),
    rememberMe: z.boolean().optional(),
  })
  .refine(
    (data) => {
      const candidate = data.token ?? data.code ?? "";
      return /^\d{6}$/.test(candidate);
    },
    { message: "O challengeToken e o código TOTP de 6 dígitos são obrigatórios." }
  );

export const registerBodySchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Endereço de e-mail é obrigatório.")
    .max(254, "Endereço de e-mail excede o limite de 254 caracteres."),
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `A senha deve possuir entre ${MIN_PASSWORD_LENGTH} e ${MAX_PASSWORD_LENGTH} caracteres.`
    )
    .max(
      MAX_PASSWORD_LENGTH,
      `A senha deve possuir entre ${MIN_PASSWORD_LENGTH} e ${MAX_PASSWORD_LENGTH} caracteres.`
    ),
  fullName: z.string().trim().max(120, "Nome completo excede 120 caracteres.").nullable().optional(),
});

export const changePasswordBodySchema = z.object({
  currentPassword: z
    .string()
    .min(1, "A senha atual e a nova senha são obrigatórias.")
    .max(MAX_PASSWORD_LENGTH, "Senha atual excede o tamanho máximo."),
  newPassword: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `A senha deve possuir entre ${MIN_PASSWORD_LENGTH} e ${MAX_PASSWORD_LENGTH} caracteres.`
    )
    .max(
      MAX_PASSWORD_LENGTH,
      `A senha deve possuir entre ${MIN_PASSWORD_LENGTH} e ${MAX_PASSWORD_LENGTH} caracteres.`
    ),
});

export const twoFactorBodySchema = z.object({
  action: z.enum(["SETUP", "VERIFY_AND_ENABLE", "DISABLE"], {
    message: "Ação de 2FA inválida.",
  }),
  secret: z.unknown().optional(),
  token: z.string().trim().max(16, "Código TOTP excede o limite de caracteres.").optional(),
  currentPassword: z.string().max(MAX_PASSWORD_LENGTH, "Senha excede o limite máximo.").optional(),
});

export const profilePatchBodySchema = z.object({
  email: z.string().trim().max(254, "E-mail excede 254 caracteres.").optional(),
  fullName: z.string().trim().max(120, "Nome excede 120 caracteres.").nullable().optional(),
  currentPassword: z.string().max(MAX_PASSWORD_LENGTH, "Senha excede o limite máximo.").optional(),
});

export const passkeyPostBodySchema = z.object({
  action: z.string().trim().min(1, "Ação de passkey obrigatória.").max(32, "Ação inválida."),
  passkeyId: z.string().trim().max(128, "ID de passkey excede 128 caracteres.").optional(),
});

export const settingsPostBodySchema = z.object({
  ecoflowEndpointRegion: z
    .string({
      message:
        "Região de endpoint EcoFlow inválida. Utilize apenas https://api.ecoflow.com ou https://api-e.ecoflow.com.",
    })
    .max(128, "Região de endpoint excede 128 caracteres.")
    .optional(),
  ecoflowAccessKey: z
    .string({ message: "Access Key, Secret Key e Serial Number da EcoFlow são obrigatórios." })
    .trim()
    .min(1, "Access Key, Secret Key e Serial Number da EcoFlow são obrigatórios.")
    .max(128, "Access Key excede o limite de 128 caracteres."),
  ecoflowAccessSecret: z.string().max(256, "Secret Key excede o limite de 256 caracteres.").optional(),
  ecoflowSerialNumber: z
    .string({ message: "Access Key, Secret Key e Serial Number da EcoFlow são obrigatórios." })
    .trim()
    .min(1, "Access Key, Secret Key e Serial Number da EcoFlow são obrigatórios.")
    .max(64, "Serial Number excede o limite de 64 caracteres."),
  tuyaAccessId: z.string().max(128, "Tuya Access ID excede 128 caracteres.").optional(),
  tuyaAccessSecret: z.string().max(256, "Tuya Secret excede 256 caracteres.").optional(),
  tuyaDeviceId: z.string().max(128, "Tuya Device ID excede 128 caracteres.").optional(),
  tuyaEndpointRegion: z.string().max(128, "Tuya Endpoint excede 128 caracteres.").optional(),
  telegramBotToken: z.string().max(256, "Token do Telegram excede 256 caracteres.").optional(),
  telegramChatId: z.string().max(64, "Chat ID do Telegram excede 64 caracteres.").optional(),
  whatsappPhoneNumber: z.string().max(32, "Número de WhatsApp excede 32 caracteres.").optional(),
  whatsappApiKey: z.string().max(256, "API Key do WhatsApp excede 256 caracteres.").optional(),
  isNotificationActive: z.boolean().optional(),
  atsLifespanCycles: z
    .number({ message: "Vida útil da ATS deve ser um número." })
    .int("A vida útil deve ser um número inteiro.")
    .min(100, "Vida útil da ATS deve ser de no mínimo 100 ciclos.")
    .max(1000000, "Vida útil excede o limite máximo permitido.")
    .optional(),
  atsCurrentCycles: z
    .number({ message: "Ciclos atuais da ATS deve ser um número." })
    .int("Os ciclos atuais devem ser um número inteiro.")
    .min(0, "Ciclos atuais não podem ser negativos.")
    .max(1000000, "Ciclos atuais excedem o limite máximo permitido.")
    .optional(),
  energyCostPerKwh: z
    .number({ message: "Tarifa de energia deve ser um número." })
    .positive("Tarifa de energia deve ser maior que zero.")
    .max(50, "Tarifa de energia excede o limite razoável.")
    .optional(),
  currencySymbol: z.string().trim().min(1, "Símbolo de moeda não pode ser vazio.").max(8, "Símbolo de moeda excede 8 caracteres.").optional(),
  batteryCapacityWh: z
    .number({ message: "Capacidade da bateria deve ser um número." })
    .int("A capacidade da bateria deve ser um número inteiro em Wh.")
    .min(200, "Capacidade mínima de 200Wh.")
    .max(50000, "Capacidade máxima de 50.000Wh.")
    .optional(),
  isStormModeActive: z.boolean({ message: "Flag isStormModeActive deve ser booleana." }).optional(),
  isDailyReportActive: z.boolean({ message: "Flag isDailyReportActive deve ser booleana." }).optional(),
  dailyReportTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Horário inválido. Utilize o formato HH:mm (ex: 21:00).")
    .optional(),
});

export const stormModePostBodySchema = z.object({
  isStormModeActive: z.boolean({ message: "Flag isStormModeActive deve ser booleana." }),
});

const strictPercentageThresholdSchema = (invalidMessage: string) =>
  z
    .union(
      [
        z.number({ message: invalidMessage }),
        z
          .string()
          .trim()
          .regex(/^\d+$/, invalidMessage)
          .transform(Number),
      ],
      { message: invalidMessage }
    )
    .pipe(
      z
        .number({ message: invalidMessage })
        .int("Limite deve ser um número inteiro.")
        .min(0, "O percentual deve estar entre 0 e 100.")
        .max(100, "O percentual deve estar entre 0 e 100.")
    );

export const automationsPostBodySchema = z.object({
  turnOnThreshold: strictPercentageThresholdSchema("Limite de ativação inválido."),
  turnOffThreshold: strictPercentageThresholdSchema("Limite de desligamento inválido."),
  isAutomationActive: z.boolean({ message: "Flag isAutomationActive deve ser booleana." }),
});

export const testControlPostBodySchema = z.object({
  actionTarget: z.enum(["ECOFLOW_ON", "ECOFLOW_OFF", "ECOFLOW_TELEMETRY"], {
    message: "Ação de teste inválida. Escolha ECOFLOW_ON, ECOFLOW_OFF ou ECOFLOW_TELEMETRY.",
  }),
  ecoflowEndpointRegion: z
    .string({
      message:
        "Região de endpoint EcoFlow inválida. Utilize apenas https://api.ecoflow.com ou https://api-e.ecoflow.com.",
    })
    .max(
      128,
      "Região de endpoint EcoFlow inválida. Utilize apenas https://api.ecoflow.com ou https://api-e.ecoflow.com."
    )
    .optional(),
  ecoflowAccessKey: z.string().max(128, "Access Key excede 128 caracteres.").optional(),
  ecoflowAccessSecret: z.string().max(256, "Secret Key excede 256 caracteres.").optional(),
  ecoflowSerialNumber: z.string().max(64, "Serial Number excede 64 caracteres.").optional(),
});

export const testNotificationPostBodySchema = z.object({
  channel: z.enum(["TELEGRAM", "WHATSAPP"], {
    message: "Canal de notificação inválido. Utilize TELEGRAM ou WHATSAPP.",
  }),
  telegramBotToken: z.string().max(256, "Token do Telegram excede 256 caracteres.").optional(),
  telegramChatId: z.string().max(64, "Chat ID do Telegram excede 64 caracteres.").optional(),
  whatsappPhoneNumber: z.string().max(32, "Telefone excede 32 caracteres.").optional(),
  whatsappApiKey: z.string().max(256, "API Key do WhatsApp excede 256 caracteres.").optional(),
});
