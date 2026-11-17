import mqtt, { MqttClient } from "mqtt";
import { PrismaClient } from "@prisma/client";
import { EcoFlowHttpClient } from "../http/EcoFlowHttpClient";
import { EcoFlowCredentials } from "../../domain/models/EcoFlowCredentials";
import { DeviceSerialNumber } from "../../domain/values/DeviceSerialNumber";
import { AccessKey } from "../../domain/values/AccessKey";
import { AccessSecret } from "../../domain/values/AccessSecret";

export interface LiveTelemetrySnapshot {
  batteryPercentage: number;
  solarInputWatts: number;
  outputWatts: number;
  isAcOutputEnabled: boolean | null;
  updatedAt: Date;
}

export interface MqttStreamConfig {
  credentials: EcoFlowCredentials;
  serialNumber: DeviceSerialNumber;
  baseApiUrl: string;
  databaseClient?: PrismaClient;
  userConfigurationId?: string;
}

/**
 * Serviço Singleton que gerencia a conexão MQTT nativa com o broker oficial da EcoFlow.
 * 
 * Mantém uma sessão persistente com keep-alive de 60 segundos:
 * - Autentica usando certificado gerado dinamicamente via GET /iot-open/sign/certification.
 * - Inscreve-se no tópico de cotas /open/{certificateAccount}/{serialNumber}/quota.
 * - Simula a sessão de um app móvel conectado, forçando a estação EcoFlow a transmitir
 *   telemetria em alta frequência (1-2s) sem entrar em sleep mode.
 * - Persiste a telemetria recebida no banco com controle de taxa (máx 1 gravação a cada 2s).
 * 
 * Respeita Object Calisthenics:
 * - Apenas 1 nível de indentação por método
 * - Sem uso da palavra-chave else
 * - Nomes descritivos e sem abreviações
 */
export class EcoFlowMqttStreamService {
  private static instance: EcoFlowMqttStreamService | null = null;

  private client: MqttClient | null = null;
  private latestTelemetry: LiveTelemetrySnapshot | null = null;
  private currentSubscribedTopic: string | null = null;
  private lastPersistTimeMs = 0;
  private isConnecting = false;

  private constructor() {}

  public static getInstance(): EcoFlowMqttStreamService {
    const isAlreadyInstantiated = EcoFlowMqttStreamService.instance !== null;
    if (isAlreadyInstantiated) {
      return EcoFlowMqttStreamService.instance as EcoFlowMqttStreamService;
    }

    EcoFlowMqttStreamService.instance = new EcoFlowMqttStreamService();
    return EcoFlowMqttStreamService.instance;
  }

  public async startWithActiveConfiguration(databaseClient: PrismaClient): Promise<void> {
    const activeConfiguration = await databaseClient.userConfiguration.findFirst({
      where: {
        ecoflowAccessKey: { not: "" },
        ecoflowAccessSecret: { not: "" },
        ecoflowSerialNumber: { not: "" },
      },
    });

    if (!activeConfiguration) {
      console.warn("[EcoFlow MQTT] Nenhuma configuração com credenciais EcoFlow cadastrada para iniciar stream.");
      return;
    }

    const accessKey = new AccessKey(activeConfiguration.ecoflowAccessKey);
    const accessSecret = new AccessSecret(activeConfiguration.ecoflowAccessSecret);
    const credentials = new EcoFlowCredentials(accessKey, accessSecret);
    const serialNumber = new DeviceSerialNumber(activeConfiguration.ecoflowSerialNumber);
    const baseApiUrl = activeConfiguration.ecoflowEndpointRegion || "https://api.ecoflow.com";

    await this.startStream({
      credentials,
      serialNumber,
      baseApiUrl,
      databaseClient,
      userConfigurationId: activeConfiguration.id,
    });
  }

  public async startStream(streamConfig: MqttStreamConfig): Promise<void> {
    const isAlreadyConnected = this.client !== null && this.client.connected;
    if (isAlreadyConnected) {
      console.log("[EcoFlow MQTT] Conexão MQTT já ativa e operante.");
      return;
    }

    if (this.isConnecting) {
      console.log("[EcoFlow MQTT] Conexão já em andamento.");
      return;
    }

    this.isConnecting = true;

    try {
      let rawSerialNumber = "";
      streamConfig.serialNumber.transferSerialNumber((serialString: string) => {
        rawSerialNumber = serialString;
      });

      const httpClient = new EcoFlowHttpClient(streamConfig.credentials, streamConfig.baseApiUrl);
      const certification = await httpClient.fetchMqttCertification();

      const brokerProtocol = certification.protocol || "mqtts";
      const brokerPort = certification.port || 8883;
      const brokerHost = certification.url || "mqtt.ecoflow.com";
      const brokerUrl = `${brokerProtocol}://${brokerHost}:${brokerPort}`;

      const targetTopic = `/open/${certification.certificateAccount}/${rawSerialNumber}/quota`;
      this.currentSubscribedTopic = targetTopic;

      const randomSuffix = Math.random().toString(16).slice(2, 10);
      const clientId = `WATTFLOW_${certification.certificateAccount}_${randomSuffix}`;

      console.log(`[EcoFlow MQTT] Conectando ao broker oficial ${brokerUrl}...`);

      this.client = mqtt.connect(brokerUrl, {
        username: certification.certificateAccount,
        password: certification.certificatePassword,
        clientId,
        keepalive: 60,
        clean: true,
        reconnectPeriod: 5000,
        rejectUnauthorized: false,
      });

      this.setupEventHandlers(streamConfig, targetTopic);
    } catch (connectionError) {
      this.isConnecting = false;
      const detail = connectionError instanceof Error ? connectionError.message : "falha desconhecida";
      console.error("[EcoFlow MQTT] Falha ao inicializar stream:", detail);
    }
  }

  public stopStream(): void {
    if (!this.client) {
      return;
    }

    console.log("[EcoFlow MQTT] Encerrando stream de telemetria.");
    this.client.end(true);
    this.client = null;
    this.currentSubscribedTopic = null;
    this.isConnecting = false;
  }

  public getLatestTelemetry(): LiveTelemetrySnapshot | null {
    if (!this.latestTelemetry) {
      return null;
    }

    const elapsedMs = Date.now() - this.latestTelemetry.updatedAt.getTime();
    const isStale = elapsedMs > 15000;
    if (isStale) {
      return null;
    }

    return this.latestTelemetry;
  }

  public isStreamConnected(): boolean {
    if (!this.client) {
      return false;
    }
    return this.client.connected;
  }

  private setupEventHandlers(streamConfig: MqttStreamConfig, targetTopic: string): void {
    if (!this.client) {
      return;
    }

    this.client.on("connect", () => {
      this.isConnecting = false;
      console.log(`[EcoFlow MQTT] Conectado com sucesso. Inscrevendo no tópico: ${targetTopic}`);
      this.client?.subscribe(targetTopic, (subscribeError) => {
        this.handleSubscriptionResult(subscribeError, targetTopic);
      });
    });

    this.client.on("message", (topic: string, messageBuffer: Buffer) => {
      this.handleIncomingMessage(topic, messageBuffer, streamConfig);
    });

    this.client.on("error", (mqttError: Error) => {
      console.warn("[EcoFlow MQTT] Alerta na conexão MQTT:", mqttError.message);
    });

    this.client.on("reconnect", () => {
      console.log("[EcoFlow MQTT] Reconectando automaticamente ao broker EcoFlow...");
    });

    this.client.on("close", () => {
      this.isConnecting = false;
    });
  }

  private handleSubscriptionResult(subscribeError: Error | null, targetTopic: string): void {
    if (subscribeError) {
      console.error(`[EcoFlow MQTT] Erro ao subscrever em ${targetTopic}:`, subscribeError.message);
      return;
    }

    console.log(`[EcoFlow MQTT] Stream ativo 24/7! Escutando telemetria em ${targetTopic}`);
  }

  private handleIncomingMessage(
    topic: string,
    messageBuffer: Buffer,
    streamConfig: MqttStreamConfig
  ): void {
    try {
      const rawText = messageBuffer.toString("utf8");
      const parsedJson = JSON.parse(rawText) as Record<string, unknown>;

      const quotaData = this.resolveQuotaPayload(parsedJson);
      this.updateLatestSnapshot(quotaData);

      const hasDatabaseContext = streamConfig.databaseClient && streamConfig.userConfigurationId;
      if (hasDatabaseContext) {
        this.persistTelemetryThrottled(
          streamConfig.databaseClient as PrismaClient,
          streamConfig.userConfigurationId as string
        );
      }
    } catch {
      // Ignora payloads não-JSON ou de heartbeat
    }
  }

  private resolveQuotaPayload(parsedJson: Record<string, unknown>): Record<string, unknown> {
    const paramsCandidate = parsedJson["params"] ?? parsedJson["param"] ?? parsedJson["data"];
    const isNestedObject = typeof paramsCandidate === "object" && paramsCandidate !== null;
    if (isNestedObject) {
      return paramsCandidate as Record<string, unknown>;
    }

    return parsedJson;
  }

  private updateLatestSnapshot(quotaData: Record<string, unknown>): void {
    const extractedBattery = this.extractNumberFromCandidates(quotaData, [
      "bmsMaster.soc",
      "bmsMaster.f32ShowSoc",
      "pd.soc",
      "pd.bpPowerSoc",
      "ems.soc",
      "soc",
    ]);

    const extractedSolarWatts = this.extractNumberFromCandidates(quotaData, [
      "mppt.inWatts",
      "mppt.pvInWatts",
      "mppt.solarInWatts",
      "mppt.pv2InWatts",
      "mppt.outWatts",
      "pd.pvInWatts",
      "pd.chgPowerDc",
      "pd.carWatts",
      "solarInWatts",
      "pvInWatts",
      "bmsMaster.inputWatts",
    ]);

    const extractedOutputWatts = this.extractOutputWatts(quotaData);
    const extractedAcState = this.extractAcState(quotaData);

    const previousSnapshot = this.latestTelemetry;

    const resolvedBattery = extractedBattery !== null ? extractedBattery : (previousSnapshot?.batteryPercentage ?? 0);
    const resolvedSolar = extractedSolarWatts !== null ? extractedSolarWatts : (previousSnapshot?.solarInputWatts ?? 0);
    const resolvedOutput = extractedOutputWatts !== null ? extractedOutputWatts : (previousSnapshot?.outputWatts ?? 0);
    const resolvedAcState = extractedAcState !== null ? extractedAcState : (previousSnapshot?.isAcOutputEnabled ?? null);

    this.latestTelemetry = {
      batteryPercentage: resolvedBattery,
      solarInputWatts: resolvedSolar,
      outputWatts: resolvedOutput,
      isAcOutputEnabled: resolvedAcState,
      updatedAt: new Date(),
    };
  }

  private persistTelemetryThrottled(
    databaseClient: PrismaClient,
    userConfigurationId: string
  ): void {
    if (!this.latestTelemetry) {
      return;
    }

    const now = Date.now();
    const elapsedSinceLastPersist = now - this.lastPersistTimeMs;
    const isThrottled = elapsedSinceLastPersist < 2000;
    if (isThrottled) {
      return;
    }

    this.lastPersistTimeMs = now;
    const currentSnapshot = this.latestTelemetry;

    databaseClient.syncExecutionLog
      .create({
        data: {
          userConfigurationId,
          batteryPercentage: currentSnapshot.batteryPercentage,
          solarInputWatts: currentSnapshot.solarInputWatts,
          outputWatts: currentSnapshot.outputWatts,
          actionTriggered: "MQTT_STREAM",
          executionDetails: "Telemetria recebida em tempo real via stream MQTT oficial EcoFlow (keep-alive ativo).",
          executedAt: new Date(),
        },
      })
      .catch((databaseError) => {
        console.warn("[EcoFlow MQTT] Falha ao persistir telemetria do stream:", databaseError);
      });
  }

  private extractOutputWatts(quotaData: Record<string, unknown>): number | null {
    const primaryCandidate = quotaData["pd.wattsOutSum"] ?? quotaData["wattsOutSum"];
    const parsedPrimary = this.parseNumericCandidate(primaryCandidate);
    if (parsedPrimary !== null && parsedPrimary >= 0) {
      return Math.round(parsedPrimary);
    }

    const isAcEnabled = this.extractAcState(quotaData);
    if (isAcEnabled === false) {
      return 0;
    }

    const candidateKeys = ["inv.outputWatts", "inv.outWatts", "outputWatts"];
    for (const key of candidateKeys) {
      const candidateValue = quotaData[key];
      const parsedValue = this.parseNumericCandidate(candidateValue);
      if (parsedValue !== null && parsedValue >= 0) {
        return Math.round(parsedValue);
      }
    }

    return null;
  }

  private extractAcState(quotaData: Record<string, unknown>): boolean | null {
    const candidateKeys = [
      "mppt.cfgAcEnabled",
      "inv.cfgAcEnabled",
      "inv.acOutState",
      "pd.acOutCfg",
    ];

    for (const key of candidateKeys) {
      const candidateValue = quotaData[key];
      const isEnabledState = candidateValue === 1 || candidateValue === "1" || candidateValue === true;
      if (isEnabledState) {
        return true;
      }
      const isDisabledState = candidateValue === 0 || candidateValue === "0" || candidateValue === false;
      if (isDisabledState) {
        return false;
      }
    }

    return null;
  }

  private extractNumberFromCandidates(quotaData: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const candidateValue = quotaData[key];
      const parsedValue = this.parseNumericCandidate(candidateValue);
      if (parsedValue !== null && parsedValue >= 0) {
        return Math.round(parsedValue);
      }
    }

    return null;
  }

  private parseNumericCandidate(candidate: unknown): number | null {
    const isDirectNumber = typeof candidate === "number" && !isNaN(candidate);
    if (isDirectNumber) {
      return candidate;
    }

    const isNonEmptyString = typeof candidate === "string" && candidate.trim().length > 0;
    if (isNonEmptyString) {
      const parsed = Number(candidate.trim());
      const isValidNumber = !isNaN(parsed);
      if (isValidNumber) {
        return parsed;
      }
    }

    return null;
  }
}
