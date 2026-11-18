export const ALLOWED_ECOFLOW_ENDPOINTS = [
  "https://api.ecoflow.com",
  "https://api-e.ecoflow.com",
] as const;

export type AllowedEcoFlowEndpoint = (typeof ALLOWED_ECOFLOW_ENDPOINTS)[number];

const DEFAULT_ECOFLOW_ENDPOINT: AllowedEcoFlowEndpoint = "https://api.ecoflow.com";
const DEFAULT_MQTT_HOST = "mqtt.ecoflow.com";
const ALLOWED_MQTT_PROTOCOL = "mqtts";
const ALLOWED_MQTT_PORT = 8883;
const ECOFLOW_SUBDOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ecoflow\.com$/;

export interface ValidatedMqttBroker {
  protocol: "mqtts";
  host: string;
  port: 8883;
}

/**
 * Valida se a região de endpoint EcoFlow pertence estritamente à allowlist oficial.
 */
export function isAllowedEcoFlowEndpointRegion(region: unknown): region is AllowedEcoFlowEndpoint {
  if (typeof region !== "string") {
    return false;
  }
  const normalized = region.trim();
  return (ALLOWED_ECOFLOW_ENDPOINTS as readonly string[]).includes(normalized);
}

/**
 * Resolve uma região opcional (usando o endpoint global padrão quando ausente)
 * e rejeita qualquer valor fora da allowlist estrita.
 */
export function resolveEcoFlowEndpointRegion(region?: unknown): AllowedEcoFlowEndpoint {
  if (region === undefined || region === null || region === "") {
    return DEFAULT_ECOFLOW_ENDPOINT;
  }
  if (!isAllowedEcoFlowEndpointRegion(region)) {
    throw new Error(
      "Região de endpoint EcoFlow inválida. Utilize apenas https://api.ecoflow.com ou https://api-e.ecoflow.com."
    );
  }
  return region.trim() as AllowedEcoFlowEndpoint;
}

/**
 * Valida os parâmetros do broker MQTT retornados pela EcoFlow API.
 * Aceita exclusivamente protocol === "mqtts", porta 8883 e domínio *.ecoflow.com.
 */
export function validateEcoFlowMqttBroker(broker: {
  protocol?: unknown;
  url?: unknown;
  port?: unknown;
}): ValidatedMqttBroker {
  const protocol = broker.protocol ?? ALLOWED_MQTT_PROTOCOL;
  if (protocol !== ALLOWED_MQTT_PROTOCOL) {
    throw new Error(`[EcoFlow MQTT] Protocolo de broker não permitido: ${String(protocol)}. Apenas mqtts é aceito.`);
  }

  const rawPort = broker.port ?? ALLOWED_MQTT_PORT;
  const isValidPort =
    (typeof rawPort === "number" && Number.isInteger(rawPort) && rawPort === ALLOWED_MQTT_PORT) ||
    (typeof rawPort === "string" &&
      /^\d+$/.test(rawPort.trim()) &&
      Number(rawPort.trim()) === ALLOWED_MQTT_PORT);

  if (!isValidPort) {
    throw new Error(`[EcoFlow MQTT] Porta de broker não permitida: ${String(rawPort)}. Apenas 8883 é aceita.`);
  }

  const rawHost = broker.url ?? DEFAULT_MQTT_HOST;
  const normalizedHost = typeof rawHost === "string" ? rawHost.trim().toLowerCase() : "";
  if (!ECOFLOW_SUBDOMAIN_PATTERN.test(normalizedHost)) {
    throw new Error(`[EcoFlow MQTT] Domínio de broker não permitido: ${String(rawHost)}. Apenas *.ecoflow.com é aceito.`);
  }

  return {
    protocol: ALLOWED_MQTT_PROTOCOL,
    host: normalizedHost,
    port: ALLOWED_MQTT_PORT,
  };
}
