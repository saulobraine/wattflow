import mqtt, { MqttClient } from "mqtt";
import { PrismaClient, UserConfiguration as PrismaUserConfiguration } from "@prisma/client";
import { EcoFlowHttpClient } from "../http/EcoFlowHttpClient";
import { EcoFlowCredentials } from "../../domain/models/EcoFlowCredentials";
import { DeviceSerialNumber } from "../../domain/values/DeviceSerialNumber";
import { AccessKey } from "../../domain/values/AccessKey";
import { AccessSecret } from "../../domain/values/AccessSecret";
import {
  resolveEcoFlowEndpointRegion,
  validateEcoFlowMqttBroker,
} from "../security/ecoflowAllowlist";
import { decryptAndMigrateConfigurationSecrets } from "../security/secretMigrationHelper";

export interface LiveTelemetrySnapshot {
  batteryPercentage: number;
  solarInputWatts: number;
  outputWatts: number;
  isAcOutputEnabled: boolean | null;
  updatedAt: Date;
}

export interface MqttStreamConfig {
  userId: string;
  credentials: EcoFlowCredentials;
  serialNumber: DeviceSerialNumber;
  baseApiUrl: string;
  databaseClient?: PrismaClient;
  userConfigurationId?: string;
}

interface UserMqttStreamState {
  client: MqttClient | null;
  latestTelemetry: LiveTelemetrySnapshot | null;
  subscribedTopic: string | null;
  lastPersistTimeMs: number;
  lastPersistedAcState: boolean | null;
  isConnecting: boolean;
}

/**
 * Serviço Singleton multi-tenant que gerencia conexões MQTT nativas com o broker oficial da EcoFlow,
 * isolando estritamente cliente MQTT, tópico, throttling e cache de telemetria por userId (Map<string, UserMqttStreamState>)
 * e exigindo validação estrita de certificado TLS (rejectUnauthorized: true).
 */
export class EcoFlowMqttStreamService {
  private static instance: EcoFlowMqttStreamService | null = null;

  private readonly streamsByUser = new Map<string, UserMqttStreamState>();

  private constructor() {}

  public static getInstance(): EcoFlowMqttStreamService {
    if (EcoFlowMqttStreamService.instance !== null) {
      return EcoFlowMqttStreamService.instance;
    }

    EcoFlowMqttStreamService.instance = new EcoFlowMqttStreamService();
    return EcoFlowMqttStreamService.instance;
  }

  public async startForUser(databaseClient: PrismaClient, userId: string): Promise<void> {
    if (!userId || userId.trim().length === 0) {
      return;
    }

    const configuration = await databaseClient.userConfiguration.findUnique({
      where: { userId: userId.trim() },
    });

    if (
      !configuration ||
      !configuration.ecoflowAccessKey.trim() ||
      !configuration.ecoflowAccessSecret.trim() ||
      !configuration.ecoflowSerialNumber.trim()
    ) {
      return;
    }

    await this.startStreamFromRecord(databaseClient, configuration);
  }

  public async startWithActiveConfiguration(
    databaseClient: PrismaClient,
    userId?: string
  ): Promise<void> {
    if (userId && userId.trim().length > 0) {
      await this.startForUser(databaseClient, userId.trim());
      return;
    }

    const activeConfigurations = await databaseClient.userConfiguration.findMany({
      where: {
        ecoflowAccessKey: { not: "" },
        ecoflowAccessSecret: { not: "" },
        ecoflowSerialNumber: { not: "" },
      },
    });

    if (activeConfigurations.length === 0) {
      console.warn("[EcoFlow MQTT] Nenhuma configuração com credenciais EcoFlow cadastrada para iniciar stream.");
      return;
    }

    let firstError: unknown = null;
    for (const configRecord of activeConfigurations) {
      try {
        await this.startStreamFromRecord(databaseClient, configRecord);
      } catch (err: unknown) {
        if (!firstError) {
          firstError = err;
        }
      }
    }

    if (firstError && this.getConnectedStreamsCount() === 0 && activeConfigurations.length === 1) {
      throw firstError;
    }
  }

  public async startStream(streamConfig: MqttStreamConfig): Promise<void> {
    const normalizedUserId = streamConfig.userId?.trim();
    if (!normalizedUserId) {
      throw new Error("[EcoFlow MQTT] userId é obrigatório para isolar o stream MQTT.");
    }

    const userState = this.getOrCreateUserState(normalizedUserId);
    if (
      userState.client !== null &&
      (userState.client.connected || Boolean(userState.client.reconnecting))
    ) {
      return;
    }

    if (userState.isConnecting) {
      return;
    }

    userState.isConnecting = true;

    try {
      let rawSerialNumber = "";
      streamConfig.serialNumber.transferSerialNumber((serialString: string) => {
        rawSerialNumber = serialString;
      });

      const validatedApiUrl = resolveEcoFlowEndpointRegion(streamConfig.baseApiUrl);
      const httpClient = new EcoFlowHttpClient(streamConfig.credentials, validatedApiUrl);
      const certification = await httpClient.fetchMqttCertification();

      const validatedBroker = validateEcoFlowMqttBroker(certification);
      const brokerUrl = `${validatedBroker.protocol}://${validatedBroker.host}:${validatedBroker.port}`;

      const targetTopic = `/open/${certification.certificateAccount}/${rawSerialNumber}/quota`;
      userState.subscribedTopic = targetTopic;

      const randomSuffix = Math.random().toString(16).slice(2, 10);
      const clientId = `WATTFLOW_${certification.certificateAccount}_${randomSuffix}`;

      console.log(`[EcoFlow MQTT] Conectando ao broker oficial ${brokerUrl} (user=${normalizedUserId})...`);

      const mqttClient = mqtt.connect(brokerUrl, {
        username: certification.certificateAccount,
        password: certification.certificatePassword,
        clientId,
        keepalive: 60,
        clean: true,
        reconnectPeriod: 5000,
        rejectUnauthorized: true,
      });

      this.disposeUserClient(userState);
      userState.client = mqttClient;
      this.setupEventHandlers(normalizedUserId, userState, streamConfig, targetTopic);
    } catch (connectionError) {
      userState.isConnecting = false;
      const detail = connectionError instanceof Error ? connectionError.message : "falha desconhecida";
      console.error("[EcoFlow MQTT] Falha ao inicializar stream:", detail);
      throw connectionError;
    }
  }

  public stopStream(userId?: string): void {
    if (userId !== undefined) {
      const normalized = userId.trim();
      const state = this.streamsByUser.get(normalized);
      if (!state) {
        return;
      }
      this.disposeUserClient(state);
      this.streamsByUser.delete(normalized);
      return;
    }

    for (const [, state] of this.streamsByUser.entries()) {
      this.disposeUserClient(state);
    }
    this.streamsByUser.clear();
  }

  private disposeUserClient(state: UserMqttStreamState): void {
    if (!state.client) {
      return;
    }
    const previousClient = state.client;
    state.client = null;
    if (typeof previousClient.removeAllListeners === "function") {
      previousClient.removeAllListeners();
    }
    previousClient.end(true);
  }

  public getLatestTelemetry(userId?: string, maxAgeMs = 300000): LiveTelemetrySnapshot | null {
    if (!userId || userId.trim().length === 0) {
      return null;
    }

    const state = this.streamsByUser.get(userId.trim());
    if (!state || !state.latestTelemetry) {
      return null;
    }

    const elapsedMs = Date.now() - state.latestTelemetry.updatedAt.getTime();
    if (elapsedMs > maxAgeMs) {
      return null;
    }

    return state.latestTelemetry;
  }

  public isStreamConnected(userId?: string): boolean {
    if (userId !== undefined) {
      const state = this.streamsByUser.get(userId.trim());
      return Boolean(state?.client?.connected);
    }

    return this.getConnectedStreamsCount() > 0;
  }

  public getConnectedStreamsCount(): number {
    let connectedCount = 0;
    for (const state of this.streamsByUser.values()) {
      if (state.client?.connected) {
        connectedCount += 1;
      }
    }
    return connectedCount;
  }

  private getOrCreateUserState(userId: string): UserMqttStreamState {
    const existing = this.streamsByUser.get(userId);
    if (existing) {
      return existing;
    }

    const created: UserMqttStreamState = {
      client: null,
      latestTelemetry: null,
      subscribedTopic: null,
      lastPersistTimeMs: 0,
      lastPersistedAcState: null,
      isConnecting: false,
    };
    this.streamsByUser.set(userId, created);
    return created;
  }

  private async startStreamFromRecord(
    databaseClient: PrismaClient,
    record: PrismaUserConfiguration
  ): Promise<void> {
    const decryptedSecrets = await decryptAndMigrateConfigurationSecrets(databaseClient, record);
    const accessKey = new AccessKey(record.ecoflowAccessKey);
    const accessSecret = new AccessSecret(decryptedSecrets.ecoflowAccessSecret);
    const credentials = new EcoFlowCredentials(accessKey, accessSecret);
    const serialNumber = new DeviceSerialNumber(record.ecoflowSerialNumber);
    const baseApiUrl = resolveEcoFlowEndpointRegion(record.ecoflowEndpointRegion);

    await this.startStream({
      userId: record.userId,
      credentials,
      serialNumber,
      baseApiUrl,
      databaseClient,
      userConfigurationId: record.id,
    });
  }

  private setupEventHandlers(
    userId: string,
    userState: UserMqttStreamState,
    streamConfig: MqttStreamConfig,
    targetTopic: string
  ): void {
    const client = userState.client;
    if (!client) {
      return;
    }

    client.on("connect", () => {
      userState.isConnecting = false;
      console.log(`[EcoFlow MQTT] Conectado com sucesso (user=${userId}). Inscrevendo em ${targetTopic}`);
      client.subscribe(targetTopic, (subscribeError) => {
        this.handleSubscriptionResult(subscribeError, targetTopic);
      });
    });

    client.on("message", (_topic: string, messageBuffer: Buffer) => {
      this.handleIncomingMessage(userState, messageBuffer, streamConfig);
    });

    client.on("error", (mqttError: Error) => {
      console.warn(`[EcoFlow MQTT] Alerta na conexão MQTT (user=${userId}):`, mqttError.message);
    });

    client.on("reconnect", () => {
      console.log(`[EcoFlow MQTT] Reconectando automaticamente ao broker EcoFlow (user=${userId})...`);
    });

    client.on("close", () => {
      userState.isConnecting = false;
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
    userState: UserMqttStreamState,
    messageBuffer: Buffer,
    streamConfig: MqttStreamConfig
  ): void {
    try {
      const rawText = messageBuffer.toString("utf8");
      const parsedJson = JSON.parse(rawText) as Record<string, unknown>;

      const quotaData = this.resolveQuotaPayload(parsedJson);
      this.updateUserSnapshot(userState, quotaData);

      const hasDatabaseContext = streamConfig.databaseClient && streamConfig.userConfigurationId;
      if (hasDatabaseContext) {
        this.persistTelemetryThrottled(
          userState,
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

  private updateUserSnapshot(
    userState: UserMqttStreamState,
    quotaData: Record<string, unknown>
  ): void {
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

    const previousSnapshot = userState.latestTelemetry;

    const resolvedBattery =
      extractedBattery !== null ? extractedBattery : (previousSnapshot?.batteryPercentage ?? 0);
    const resolvedSolar =
      extractedSolarWatts !== null ? extractedSolarWatts : (previousSnapshot?.solarInputWatts ?? 0);
    const resolvedOutput =
      extractedOutputWatts !== null ? extractedOutputWatts : (previousSnapshot?.outputWatts ?? 0);
    const resolvedAcState =
      extractedAcState !== null ? extractedAcState : (previousSnapshot?.isAcOutputEnabled ?? null);

    userState.latestTelemetry = {
      batteryPercentage: resolvedBattery,
      solarInputWatts: resolvedSolar,
      outputWatts: resolvedOutput,
      isAcOutputEnabled: resolvedAcState,
      updatedAt: new Date(),
    };
  }

  private persistTelemetryThrottled(
    userState: UserMqttStreamState,
    databaseClient: PrismaClient,
    userConfigurationId: string
  ): void {
    if (!userState.latestTelemetry) {
      return;
    }

    const now = Date.now();
    const elapsedSinceLastPersist = now - userState.lastPersistTimeMs;
    const currentSnapshot = userState.latestTelemetry;

    const hasAcStateChanged =
      userState.lastPersistedAcState !== null &&
      currentSnapshot.isAcOutputEnabled !== null &&
      currentSnapshot.isAcOutputEnabled !== userState.lastPersistedAcState;

    const STATIC_PERSIST_THROTTLE_MS = 300_000;
    const shouldPersist =
      userState.lastPersistTimeMs === 0 ||
      hasAcStateChanged ||
      elapsedSinceLastPersist >= STATIC_PERSIST_THROTTLE_MS;

    if (!shouldPersist) {
      return;
    }

    userState.lastPersistTimeMs = now;
    userState.lastPersistedAcState = currentSnapshot.isAcOutputEnabled;

    const actionTriggered = hasAcStateChanged
      ? currentSnapshot.isAcOutputEnabled
        ? "ENABLE_ECOFLOW_AC"
        : "DISABLE_ECOFLOW_AC"
      : "MQTT_STREAM";

    const executionDetails = hasAcStateChanged
      ? `Comutação da saída AC detectada via stream MQTT (novo estado: ${currentSnapshot.isAcOutputEnabled ? "LIGADA" : "DESLIGADA"}).`
      : "Telemetria consolidada em tempo real via stream MQTT oficial EcoFlow (amostragem periódica 5m).";

    databaseClient.syncExecutionLog
      .create({
        data: {
          userConfigurationId,
          batteryPercentage: currentSnapshot.batteryPercentage,
          solarInputWatts: currentSnapshot.solarInputWatts,
          outputWatts: currentSnapshot.outputWatts,
          actionTriggered,
          executionDetails,
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
      const isEnabledState =
        candidateValue === 1 || candidateValue === "1" || candidateValue === true;
      if (isEnabledState) {
        return true;
      }
      const isDisabledState =
        candidateValue === 0 || candidateValue === "0" || candidateValue === false;
      if (isDisabledState) {
        return false;
      }
    }

    return null;
  }

  private extractNumberFromCandidates(
    quotaData: Record<string, unknown>,
    keys: string[]
  ): number | null {
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
      if (!isNaN(parsed)) {
        return parsed;
      }
    }

    return null;
  }
}
