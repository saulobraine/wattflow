/**
 * Daemon de Sincronização em Tempo Real e Stream MQTT Contínuo 24/7.
 * Opera em VPS ou ambiente local mantendo a estação EcoFlow acordada
 * sem depender do aplicativo móvel oficial aberto.
 */
const fs = require("fs");
const path = require("path");

function resolveDisableLocalCronFlag() {
  if (process.env.DISABLE_LOCAL_CRON !== undefined) {
    return process.env.DISABLE_LOCAL_CRON;
  }

  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    return undefined;
  }

  try {
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = /^DISABLE_LOCAL_CRON\s*=\s*(.*)$/.exec(trimmed);
      if (match) {
        return match[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

if (resolveDisableLocalCronFlag() === "true") {
  console.log("[Daemon Local] Desativado via DISABLE_LOCAL_CRON=true (producao ativa). Encerrando.");
  process.exit(0);
}

const mqtt = require("mqtt");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const MIN_CRON_SECRET_LENGTH = 32;
const HEX_ENCRYPTION_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const REPEATED_BYTE_HEX_PATTERN = /^([0-9a-f]{2})\1{31}$/;
const REPEATED_DWORD_HEX_PATTERN = /^([0-9a-f]{8})\1{7}$/;
const REPEATED_QWORD_HEX_PATTERN = /^([0-9a-f]{16})\1{3}$/;
const KNOWN_TRIVIAL_HEX_KEYS = new Set([
  "0123456789abcdef".repeat(4),
  "fedcba9876543210".repeat(4),
  "abcdef0123456789".repeat(4),
]);
const CIPHERTEXT_PREFIX = "enc:v1:";

function isTrivialEncryptionKey(lowerHex) {
  return (
    KNOWN_TRIVIAL_HEX_KEYS.has(lowerHex) ||
    REPEATED_BYTE_HEX_PATTERN.test(lowerHex) ||
    REPEATED_DWORD_HEX_PATTERN.test(lowerHex) ||
    REPEATED_QWORD_HEX_PATTERN.test(lowerHex)
  );
}

const token = process.env.CRON_SECRET_TOKEN;
if (!token || token.trim().length < MIN_CRON_SECRET_LENGTH) {
  console.error(
    `[WattFlow MQTT Daemon] ERRO CRÍTICO: Variável de ambiente CRON_SECRET_TOKEN obrigatória ausente ou com menos de ${MIN_CRON_SECRET_LENGTH} caracteres.`
  );
  process.exit(1);
}

const rawEncryptionKey = process.env.ENCRYPTION_KEY;
if (
  typeof rawEncryptionKey !== "string" ||
  !HEX_ENCRYPTION_KEY_PATTERN.test(rawEncryptionKey.trim()) ||
  isTrivialEncryptionKey(rawEncryptionKey.trim().toLowerCase())
) {
  console.error(
    "[WattFlow MQTT Daemon] ERRO CRÍTICO: Variável de ambiente ENCRYPTION_KEY obrigatória ausente, inválida ou trivial/conhecida (gere com openssl rand -hex 32)."
  );
  process.exit(1);
}
const encryptionKeyBuffer = Buffer.from(rawEncryptionKey.trim(), "hex");

function encryptStoredSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKeyBuffer, iv, {
    authTagLength: 16,
  });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${CIPHERTEXT_PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptStoredSecret(encryptedPayload) {
  if (typeof encryptedPayload !== "string" || !encryptedPayload.startsWith(CIPHERTEXT_PREFIX)) {
    throw new Error("Formato de segredo cifrado inválido ou não autenticado no banco.");
  }

  const parts = encryptedPayload.slice(CIPHERTEXT_PREFIX.length).split(":");
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

  if (iv.byteLength !== 12 || authTag.byteLength !== 16) {
    throw new Error("IV ou AuthTag inválidos no segredo cifrado.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKeyBuffer, iv, {
    authTagLength: 16,
  });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

async function resolveAndMigrateDaemonEcoFlowSecret(config) {
  const rawSecret = config.ecoflowAccessSecret;
  if (typeof rawSecret !== "string" || rawSecret.trim().length === 0) {
    throw new Error("ecoflowAccessSecret ausente ou vazio na configuração.");
  }

  if (rawSecret.startsWith("enc:")) {
    return decryptStoredSecret(rawSecret);
  }

  const trimmedLegacy = rawSecret.trim();
  const migratedCiphertext = encryptStoredSecret(trimmedLegacy);
  if (config.id) {
    await prisma.userConfiguration.update({
      where: { id: config.id },
      data: { ecoflowAccessSecret: migratedCiphertext },
    });
    console.log("[WattFlow MQTT Daemon] Segredo EcoFlow legado migrado para AES-256-GCM.");
  }

  return trimmedLegacy;
}

const ALLOWED_ECOFLOW_ENDPOINTS = new Set([
  "https://api.ecoflow.com",
  "https://api-e.ecoflow.com",
]);
const ECOFLOW_SUBDOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ecoflow\.com$/;

function validateEndpointRegion(rawRegion) {
  const region = typeof rawRegion === "string" && rawRegion !== ""
    ? rawRegion.trim()
    : "https://api.ecoflow.com";
  if (!ALLOWED_ECOFLOW_ENDPOINTS.has(region)) {
    throw new Error(`Endpoint EcoFlow não permitido: ${String(rawRegion)}`);
  }
  return region;
}

function validateMqttBrokerResponse(cert) {
  const protocol = cert.protocol ?? "mqtts";
  if (protocol !== "mqtts") {
    throw new Error(`Protocolo MQTT não permitido: ${String(protocol)}. Apenas mqtts é aceito.`);
  }

  const rawPort = cert.port ?? 8883;
  const isValidPort =
    (typeof rawPort === "number" && Number.isInteger(rawPort) && rawPort === 8883) ||
    (typeof rawPort === "string" && /^\d+$/.test(rawPort.trim()) && Number(rawPort.trim()) === 8883);
  if (!isValidPort) {
    throw new Error(`Porta MQTT não permitida: ${String(rawPort)}. Apenas 8883 é aceita.`);
  }

  const rawHost = cert.url ?? "mqtt.ecoflow.com";
  const host = typeof rawHost === "string" ? rawHost.trim().toLowerCase() : "";
  if (!ECOFLOW_SUBDOMAIN_PATTERN.test(host)) {
    throw new Error(`Domínio MQTT não permitido: ${String(rawHost)}. Apenas *.ecoflow.com é aceito.`);
  }

  const account = typeof cert.certificateAccount === "string" ? cert.certificateAccount.trim() : "";
  const password = typeof cert.certificatePassword === "string" ? cert.certificatePassword.trim() : "";
  if (!account || !password) {
    throw new Error("Credenciais de certificação MQTT ausentes ou vazias na resposta da API.");
  }

  return { protocol: "mqtts", host, portNum: 8883, account, password: cert.certificatePassword };
}

const port = process.env.PORT || "3000";
const syncUrl = `http://localhost:${port}/api/sync`;
const streamApiUrl = `http://localhost:${port}/api/mqtt-stream`;

console.log("==================================================");
console.log("  WattFlow — Daemon de Telemetria e Stream MQTT   ");
console.log("==================================================");

let mqttClient = null;

async function getEcoFlowCertification(config) {
  const accessKey = config.ecoflowAccessKey;
  const secretKey = await resolveAndMigrateDaemonEcoFlowSecret(config);
  const nonce = Math.floor(100000 + Math.random() * 900000).toString();
  const timestamp = Date.now().toString();
  const stringToSign = `accessKey=${accessKey}&nonce=${nonce}&timestamp=${timestamp}`;
  const sign = crypto.createHmac("sha256", secretKey).update(stringToSign).digest("hex");

  const baseUrl = validateEndpointRegion(config.ecoflowEndpointRegion);
  const res = await fetch(`${baseUrl}/iot-open/sign/certification`, {
    headers: { accessKey, nonce, timestamp, sign },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ao obter certificação MQTT.`);
  }

  const json = await res.json();
  if (json.code !== "0" || !json.data) {
    throw new Error(`Falha no retorno da certificação: ${json.message || json.code}`);
  }

  return json.data;
}

async function startMqttStream() {
  try {
    const config = await prisma.userConfiguration.findFirst({
      where: {
        ecoflowAccessKey: { not: "" },
        ecoflowAccessSecret: { not: "" },
        ecoflowSerialNumber: { not: "" },
      },
    });

    if (!config) {
      console.warn("[WattFlow MQTT Daemon] Nenhuma credencial cadastrada no banco. Aguardando...");
      return;
    }

    const cert = await getEcoFlowCertification(config);
    const sn = config.ecoflowSerialNumber;
    const { protocol, host, portNum, account, password } = validateMqttBrokerResponse(cert);
    const brokerUrl = `${protocol}://${host}:${portNum}`;
    const topic = `/open/${account}/${sn}/quota`;

    console.log(`[WattFlow MQTT Daemon] Conectando ao broker oficial ${brokerUrl}...`);

    mqttClient = mqtt.connect(brokerUrl, {
      username: account,
      password,
      clientId: `WATTFLOW_DAEMON_${Math.random().toString(16).slice(2, 10)}`,
      keepalive: 60,
      clean: true,
      reconnectPeriod: 5000,
      rejectUnauthorized: true,
    });

    mqttClient.on("connect", () => {
      console.log(`[WattFlow MQTT Daemon] CONECTADO COM SUCESSO!`);
      console.log(`[WattFlow MQTT Daemon] Inscrevendo no tópico: ${topic}`);
      mqttClient.subscribe(topic, (err) => {
        if (err) {
          console.error("[WattFlow MQTT Daemon] Erro na inscrição:", err.message);
        } else {
          console.log(`[WattFlow MQTT Daemon] STREAM ATIVO 24/7! Estação transmitindo sem entrar em sleep mode.`);
        }
      });
    });

    mqttClient.on("message", (t, msg) => {
      try {
        const payload = JSON.parse(msg.toString());
        const data = payload.params || payload.param || payload.data || payload;
        const pv = data["mppt.inWatts"] ?? data["pd.pvInWatts"] ?? data["pvInWatts"];
        const out = data["pd.wattsOutSum"] ?? data["inv.outputWatts"] ?? data["wattsOutSum"];
        const soc = data["bmsMaster.soc"] ?? data["pd.soc"] ?? data["soc"];
        if (pv !== undefined || out !== undefined || soc !== undefined) {
          console.log(`[EcoFlow MQTT] Ao Vivo -> PV: ${pv ?? "?"}W | Saída: ${out ?? "?"}W | Bat: ${soc ?? "?"}%`);
        }
      } catch {
        // Heartbeat ou frame não-JSON
      }
    });

    mqttClient.on("reconnect", () => {
      console.log("[WattFlow MQTT Daemon] Reconectando automaticamente ao broker EcoFlow...");
    });

    mqttClient.on("error", (err) => {
      console.warn("[WattFlow MQTT Daemon] Alerta MQTT:", err.message);
    });

    // Avisa também o servidor web Next.js para manter o singleton do serviço ativo
    fetch(streamApiUrl, {
      headers: { "x-cron-token": token },
    }).catch(() => {});
  } catch (err) {
    console.error("[WattFlow MQTT Daemon] Falha ao iniciar stream MQTT:", err.message);
  }
}

async function tick() {
  try {
    const res = await fetch(syncUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`[WattFlow Poller] HTTP ${res.status}`);
    }
  } catch (err) {
    // Servidor web pode estar reiniciando
  }
}

// Inicia o stream MQTT e o poller de garantia
startMqttStream();
setInterval(tick, 2000);
tick();
