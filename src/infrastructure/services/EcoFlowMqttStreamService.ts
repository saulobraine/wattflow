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
import { OrchestratorSyncUseCase } from "../../application/OrchestratorSyncUseCase";
import { ConfigurationRepository } from "../repositories/ConfigurationRepository";

export interface LiveTelemetrySnapshot {
  batteryPercentage: number;
  solarInputWatts: number;
  outputWatts: number;
  isAcOutputEnabled: boolean | null;
  updatedAt: Date;
  batteryTempCelsius?: number | null;
  batterySoh?: number | null;
  batteryCycles?: number | null;
  batteryVolts?: number | null;
  batteryAmps?: number | null;
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
  lastEvaluatedSoc: number | null;
  lastEvaluatedAcState: boolean | null;
  lastEvaluationTimeMs: number;
  isEvaluatingAutomation: boolean;
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
      lastEvaluatedSoc: null,
      lastEvaluatedAcState: null,
      lastEvaluationTimeMs: 0,
      isEvaluatingAutomation: false,
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
      this.updateUserSnapshot(userState, quotaData, parsedJson);

      const hasDatabaseContext = streamConfig.databaseClient && streamConfig.userConfigurationId;
      if (hasDatabaseContext) {
        this.evaluateAutomationThrottled(userState, streamConfig).catch((evalError) => {
          console.warn("[EcoFlow MQTT] Erro na avaliação de automação:", evalError);
        });

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

  private async evaluateAutomationThrottled(
    userState: UserMqttStreamState,
    streamConfig: MqttStreamConfig
  ): Promise<void> {
    if (!userState.latestTelemetry || !streamConfig.databaseClient) {
      return;
    }

    if (userState.isEvaluatingAutomation) {
      return;
    }

    const hasConfigAccess =
      typeof streamConfig.databaseClient.userConfiguration?.findUnique === "function" ||
      typeof (streamConfig.databaseClient as unknown as Record<string, unknown>)["findActiveConfigurationByUserId"] === "function";
    if (!hasConfigAccess) {
      return;
    }

    const currentSnapshot = userState.latestTelemetry;
    const currentSoc = currentSnapshot.batteryPercentage;
    const currentAcState = currentSnapshot.isAcOutputEnabled;
    const now = Date.now();

    const isFirstEvaluation = userState.lastEvaluationTimeMs === 0;
    const hasAcStateChanged =
      userState.lastEvaluatedAcState !== null &&
      currentAcState !== null &&
      currentAcState !== userState.lastEvaluatedAcState;
    const socDiff =
      userState.lastEvaluatedSoc !== null
        ? Math.abs(currentSoc - userState.lastEvaluatedSoc)
        : 0;
    const elapsedSinceLastEval = now - userState.lastEvaluationTimeMs;

    const shouldEvaluate =
      isFirstEvaluation ||
      hasAcStateChanged ||
      socDiff >= 1 ||
      elapsedSinceLastEval >= 60_000;

    if (!shouldEvaluate) {
      return;
    }

    userState.isEvaluatingAutomation = true;
    try {
      const repository = new ConfigurationRepository(streamConfig.databaseClient);
      const useCase = new OrchestratorSyncUseCase(repository, streamConfig.baseApiUrl);
      const syncResult = await useCase.executeSyncForUser(streamConfig.userId, {
        batteryPercentage: currentSnapshot.batteryPercentage,
        solarWatts: currentSnapshot.solarInputWatts,
        outputWatts: currentSnapshot.outputWatts,
        isAcOutputEnabled: currentSnapshot.isAcOutputEnabled,
        batteryTempCelsius: currentSnapshot.batteryTempCelsius,
        batterySoh: currentSnapshot.batterySoh,
        batteryCycles: currentSnapshot.batteryCycles,
      });

      userState.lastEvaluationTimeMs = Date.now();
      userState.lastEvaluatedSoc = currentSoc;

      if (syncResult.triggeredAction === "ENABLE_ECOFLOW_AC") {
        currentSnapshot.isAcOutputEnabled = true;
        userState.lastEvaluatedAcState = true;
        userState.lastPersistedAcState = true;
        userState.lastPersistTimeMs = Date.now();
      }
      if (
        syncResult.triggeredAction === "DISABLE_ECOFLOW_AC" ||
        syncResult.triggeredAction === "THERMAL_PROTECTION_DISARM"
      ) {
        currentSnapshot.isAcOutputEnabled = false;
        userState.lastEvaluatedAcState = false;
        userState.lastPersistedAcState = false;
        userState.lastPersistTimeMs = Date.now();
      }
      if (
        currentAcState !== null &&
        syncResult.triggeredAction !== "ENABLE_ECOFLOW_AC" &&
        syncResult.triggeredAction !== "DISABLE_ECOFLOW_AC"
      ) {
        userState.lastEvaluatedAcState = currentAcState;
      }
    } finally {
      userState.isEvaluatingAutomation = false;
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
    quotaData: Record<string, unknown>,
    parsedJson?: Record<string, unknown>
  ): void {
    const extractedBattery = this.extractBattery(quotaData, parsedJson);
    const extractedSolarWatts = this.extractSolarWatts(quotaData, parsedJson);
    const extractedOutputWatts = this.extractOutputWatts(quotaData, parsedJson);
    const extractedAcState = this.extractAcState(quotaData, parsedJson);
    const extractedTemp = this.extractBatteryTemp(quotaData, parsedJson);
    const extractedSoh = this.extractBatterySoh(quotaData, parsedJson);
    const extractedCycles = this.extractBatteryCycles(quotaData, parsedJson);
    const extractedVolts = this.extractBatteryVolts(quotaData, parsedJson);
    const extractedAmps = this.extractBatteryAmps(quotaData, parsedJson);

    const previousSnapshot = userState.latestTelemetry;

    const resolvedBattery =
      extractedBattery !== null ? extractedBattery : (previousSnapshot?.batteryPercentage ?? 0);
    const resolvedSolar =
      extractedSolarWatts !== null ? extractedSolarWatts : (previousSnapshot?.solarInputWatts ?? 0);
    const resolvedOutput =
      extractedOutputWatts !== null ? extractedOutputWatts : (previousSnapshot?.outputWatts ?? 0);
    const resolvedAcState =
      extractedAcState !== null ? extractedAcState : (previousSnapshot?.isAcOutputEnabled ?? null);
    const resolvedTemp =
      extractedTemp !== null ? extractedTemp : (previousSnapshot?.batteryTempCelsius ?? null);
    const resolvedSoh =
      extractedSoh !== null ? extractedSoh : (previousSnapshot?.batterySoh ?? null);
    const resolvedCycles =
      extractedCycles !== null ? extractedCycles : (previousSnapshot?.batteryCycles ?? null);
    const resolvedVolts =
      extractedVolts !== null ? extractedVolts : (previousSnapshot?.batteryVolts ?? null);
    const resolvedAmps =
      extractedAmps !== null ? extractedAmps : (previousSnapshot?.batteryAmps ?? null);

    userState.latestTelemetry = {
      batteryPercentage: resolvedBattery,
      solarInputWatts: resolvedSolar,
      outputWatts: resolvedOutput,
      isAcOutputEnabled: resolvedAcState,
      updatedAt: new Date(),
      batteryTempCelsius: resolvedTemp,
      batterySoh: resolvedSoh,
      batteryCycles: resolvedCycles,
      batteryVolts: resolvedVolts,
      batteryAmps: resolvedAmps,
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
          batteryTempCelsius: currentSnapshot.batteryTempCelsius ?? null,
          batterySoh: currentSnapshot.batterySoh ?? null,
          batteryCycles: currentSnapshot.batteryCycles ?? null,
        },
      })
      .catch((databaseError) => {
        console.warn("[EcoFlow MQTT] Falha ao persistir telemetria do stream:", databaseError);
      });

    if (currentSnapshot.batteryTempCelsius !== null && currentSnapshot.batteryTempCelsius !== undefined) {
      databaseClient.userConfiguration
        .update({
          where: { id: userConfigurationId },
          data: {
            lastBatteryTempCelsius: currentSnapshot.batteryTempCelsius,
            ...(currentSnapshot.batterySoh !== null && currentSnapshot.batterySoh !== undefined
              ? { lastBatterySoh: currentSnapshot.batterySoh }
              : {}),
            ...(currentSnapshot.batteryCycles !== null && currentSnapshot.batteryCycles !== undefined
              ? { lastBatteryCycles: currentSnapshot.batteryCycles }
              : {}),
          },
        })
        .catch((databaseError) => {
          console.warn("[EcoFlow MQTT] Falha ao atualizar telemetria BMS em userConfiguration:", databaseError);
        });
    }
  }

  private extractBattery(
    quotaData: Record<string, unknown>,
    parsedJson?: Record<string, unknown>
  ): number | null {
    const candidateKeys = [
      "bmsMaster.soc",
      "bmsMaster.f32ShowSoc",
      "pd.soc",
      "pd.bpPowerSoc",
      "ems.soc",
      "soc",
    ];

    const flatBattery = this.extractNumberFromCandidates(quotaData, candidateKeys);
    if (flatBattery !== null) {
      return flatBattery;
    }

    const nestedContainers = ["bmsMaster", "bms", "ems", "pd"];
    for (const container of nestedContainers) {
      const nestedObj = quotaData[container];
      if (typeof nestedObj === "object" && nestedObj !== null) {
        const nestedRec = nestedObj as Record<string, unknown>;
        const nestedSoc = this.parseNumericCandidate(
          nestedRec["soc"] ?? nestedRec["f32ShowSoc"] ?? nestedRec["bpPowerSoc"]
        );
        if (nestedSoc !== null && nestedSoc >= 0) {
          return Math.round(nestedSoc);
        }
      }
    }

    const typeCode =
      typeof parsedJson?.["typeCode"] === "string"
        ? (parsedJson["typeCode"] as string).toLowerCase()
        : "";
    const moduleType = parsedJson?.["moduleType"];
    const isBmsContext = typeCode.includes("bms") || moduleType === 2 || moduleType === "2";
    if (isBmsContext) {
      const directSoc = this.parseNumericCandidate(quotaData["soc"] ?? quotaData["f32ShowSoc"]);
      if (directSoc !== null && directSoc >= 0) {
        return Math.round(directSoc);
      }
    }

    return null;
  }

  private extractSolarWatts(
    quotaData: Record<string, unknown>,
    parsedJson?: Record<string, unknown>
  ): number | null {
    const typeCode =
      typeof parsedJson?.["typeCode"] === "string"
        ? (parsedJson["typeCode"] as string).toLowerCase()
        : "";
    const moduleType = parsedJson?.["moduleType"];
    const isMpptContext =
      typeCode.includes("mppt") || moduleType === 5 || moduleType === "5";

    // 1. Objeto aninhado: { mppt: { inWatts: 200, pv2InWatts: 150 } }
    const mpptNested = quotaData["mppt"];
    if (typeof mpptNested === "object" && mpptNested !== null) {
      const mpptRec = mpptNested as Record<string, unknown>;
      const pv1 = this.parseNumericCandidate(
        mpptRec["inWatts"] ??
          mpptRec["pvInWatts"] ??
          mpptRec["solarInWatts"] ??
          mpptRec["outWatts"]
      );
      const pv2 = this.parseNumericCandidate(mpptRec["pv2InWatts"]);
      if (pv1 !== null || pv2 !== null) {
        return Math.round((pv1 ?? 0) + (pv2 ?? 0));
      }
    }

    // 2. Chaves diretas no pacote modular MPPT: { inWatts: 240, pv2InWatts: 60 }
    if (isMpptContext) {
      const directPv1 = this.parseNumericCandidate(
        quotaData["inWatts"] ??
          quotaData["pvInWatts"] ??
          quotaData["solarInWatts"] ??
          quotaData["outWatts"]
      );
      const directPv2 = this.parseNumericCandidate(quotaData["pv2InWatts"]);
      if (directPv1 !== null || directPv2 !== null) {
        return Math.round((directPv1 ?? 0) + (directPv2 ?? 0));
      }
    }

    // 3. Chaves planas pontuadas ou unificadas
    const flatPv1 = this.parseNumericCandidate(
      quotaData["mppt.inWatts"] ??
        quotaData["mppt.pvInWatts"] ??
        quotaData["mppt.solarInWatts"] ??
        quotaData["mppt.outWatts"] ??
        quotaData["pd.pvInWatts"] ??
        quotaData["pd.chgPowerDc"] ??
        quotaData["pd.carWatts"] ??
        quotaData["solarInWatts"] ??
        quotaData["pvInWatts"]
    );
    const flatPv2 = this.parseNumericCandidate(
      quotaData["mppt.pv2InWatts"] ?? quotaData["pv2InWatts"]
    );

    if (flatPv1 !== null || flatPv2 !== null) {
      return Math.round((flatPv1 ?? 0) + (flatPv2 ?? 0));
    }

    // 4. Fallback: bmsMaster.inputWatts se disponível
    const bmsInput = this.parseNumericCandidate(quotaData["bmsMaster.inputWatts"]);
    if (bmsInput !== null && bmsInput >= 0) {
      return Math.round(bmsInput);
    }

    return null;
  }

  private extractOutputWatts(
    quotaData: Record<string, unknown>,
    parsedJson?: Record<string, unknown>
  ): number | null {
    const typeCode =
      typeof parsedJson?.["typeCode"] === "string"
        ? (parsedJson["typeCode"] as string).toLowerCase()
        : "";
    const moduleType = parsedJson?.["moduleType"];
    const isMpptContext =
      typeCode.includes("mppt") || moduleType === 5 || moduleType === "5";
    const isInvContext =
      typeCode.includes("inv") || moduleType === 3 || moduleType === "3";
    const isPdContext =
      typeCode.includes("pd") || moduleType === 1 || moduleType === "1";

    // 1. Objeto aninhado inv ou pd
    const invNested = quotaData["inv"];
    if (typeof invNested === "object" && invNested !== null) {
      const invRec = invNested as Record<string, unknown>;
      const parsedInv = this.parseNumericCandidate(
        invRec["outputWatts"] ?? invRec["outWatts"] ?? invRec["invOutWatts"]
      );
      if (parsedInv !== null && parsedInv >= 0) {
        return Math.round(parsedInv);
      }
    }

    const pdNested = quotaData["pd"];
    if (typeof pdNested === "object" && pdNested !== null) {
      const pdRec = pdNested as Record<string, unknown>;
      const parsedPd = this.parseNumericCandidate(
        pdRec["wattsOutSum"] ?? pdRec["outWatts"]
      );
      if (parsedPd !== null && parsedPd >= 0) {
        return Math.round(parsedPd);
      }
    }

    // 2. Chaves diretas no pacote modular Inversor ou PD
    if (isInvContext) {
      const directInv = this.parseNumericCandidate(
        quotaData["outputWatts"] ?? quotaData["outWatts"] ?? quotaData["invOutWatts"]
      );
      if (directInv !== null && directInv >= 0) {
        return Math.round(directInv);
      }
    }

    if (isPdContext) {
      const directPd = this.parseNumericCandidate(
        quotaData["wattsOutSum"] ?? quotaData["outWatts"]
      );
      if (directPd !== null && directPd >= 0) {
        return Math.round(directPd);
      }
    }

    // 3. Chave primária pd.wattsOutSum ou wattsOutSum
    const primaryCandidate = quotaData["pd.wattsOutSum"] ?? quotaData["wattsOutSum"];
    const parsedPrimary = this.parseNumericCandidate(primaryCandidate);
    if (parsedPrimary !== null && parsedPrimary >= 0) {
      return Math.round(parsedPrimary);
    }

    const isAcEnabled = this.extractAcState(quotaData, parsedJson);
    if (isAcEnabled === false && (isInvContext || isPdContext)) {
      return 0;
    }

    // 4. Chaves planas para saída de inversor (exceto em contexto MPPT onde outWatts é carga DC da bateria)
    if (!isMpptContext) {
      const candidateKeys = ["inv.outputWatts", "inv.outWatts", "invOutWatts", "outputWatts"];
      for (const key of candidateKeys) {
        const candidateValue = quotaData[key];
        const parsedValue = this.parseNumericCandidate(candidateValue);
        if (parsedValue !== null && parsedValue >= 0) {
          return Math.round(parsedValue);
        }
      }
    }

    return null;
  }

  private extractAcState(
    quotaData: Record<string, unknown>,
    parsedJson?: Record<string, unknown>
  ): boolean | null {
    // 1. Objetos aninhados
    const invNested = quotaData["inv"];
    if (typeof invNested === "object" && invNested !== null) {
      const invRec = invNested as Record<string, unknown>;
      const state = this.resolveBooleanState(
        invRec["cfgAcEnabled"] ?? invRec["acOutState"] ?? invRec["acState"]
      );
      if (state !== null) {
        return state;
      }
    }

    const pdNested = quotaData["pd"];
    if (typeof pdNested === "object" && pdNested !== null) {
      const pdRec = pdNested as Record<string, unknown>;
      const state = this.resolveBooleanState(
        pdRec["acOutCfg"] ?? pdRec["acOutState"] ?? pdRec["acState"]
      );
      if (state !== null) {
        return state;
      }
    }

    const mpptNested = quotaData["mppt"];
    if (typeof mpptNested === "object" && mpptNested !== null) {
      const mpptRec = mpptNested as Record<string, unknown>;
      const state = this.resolveBooleanState(mpptRec["cfgAcEnabled"]);
      if (state !== null) {
        return state;
      }
    }

    // 2. Chaves diretas em mensagens modulares
    const typeCode =
      typeof parsedJson?.["typeCode"] === "string"
        ? (parsedJson["typeCode"] as string).toLowerCase()
        : "";
    const moduleType = parsedJson?.["moduleType"];
    const isRelevantModule =
      typeCode.includes("inv") ||
      typeCode.includes("mppt") ||
      typeCode.includes("pd") ||
      moduleType === 1 ||
      moduleType === "1" ||
      moduleType === 3 ||
      moduleType === "3" ||
      moduleType === 5 ||
      moduleType === "5";

    if (isRelevantModule || !parsedJson?.["moduleType"]) {
      const directCandidate = this.resolveBooleanState(
        quotaData["cfgAcEnabled"] ??
          quotaData["acOutState"] ??
          quotaData["acOutCfg"] ??
          quotaData["acState"]
      );
      if (directCandidate !== null) {
        return directCandidate;
      }
    }

    // 3. Chaves candidatas pontuadas
    const candidateKeys = [
      "mppt.cfgAcEnabled",
      "inv.cfgAcEnabled",
      "inv.acOutState",
      "pd.acOutCfg",
      "pd.acOutState",
      "cfgAcEnabled",
      "acOutState",
      "acOutCfg",
      "acState",
    ];

    for (const key of candidateKeys) {
      const candidateValue = quotaData[key];
      const resolved = this.resolveBooleanState(candidateValue);
      if (resolved !== null) {
        return resolved;
      }
    }

    return null;
  }

  private resolveBooleanState(candidateValue: unknown): boolean | null {
    if (candidateValue === 1 || candidateValue === "1" || candidateValue === true) {
      return true;
    }
    if (candidateValue === 0 || candidateValue === "0" || candidateValue === false) {
      return false;
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

  public extractBatteryTemp(
    quotaData: Record<string, unknown>,
    parsedJson?: Record<string, unknown>
  ): number | null {
    const candidateKeys = [
      "bmsMaster.temp",
      "bmsMaster.cellTemp",
      "bms.temp",
      "bms.cellTemp",
      "temp",
      "cellTemp",
    ];

    const flatTemp = this.extractNumericCandidateFromKeys(quotaData, candidateKeys);
    if (flatTemp !== null) {
      return this.normalizeTemperature(flatTemp);
    }

    const nestedContainers = ["bmsMaster", "bms", "ems", "bms_emsStatus", "bms_kit"];
    for (const container of nestedContainers) {
      const nestedObj = quotaData[container];
      if (typeof nestedObj === "object" && nestedObj !== null) {
        const nestedRec = nestedObj as Record<string, unknown>;
        const rawNested = this.parseNumericCandidate(
          nestedRec["temp"] ?? nestedRec["cellTemp"] ?? nestedRec["maxCellTemp"]
        );
        if (rawNested !== null) {
          return this.normalizeTemperature(rawNested);
        }
      }
    }

    const typeCode =
      typeof parsedJson?.["typeCode"] === "string"
        ? (parsedJson["typeCode"] as string).toLowerCase()
        : "";
    const moduleType = parsedJson?.["moduleType"];
    const isBmsContext = typeCode.includes("bms") || moduleType === 2 || moduleType === "2";
    if (isBmsContext) {
      const direct = this.parseNumericCandidate(quotaData["temp"] ?? quotaData["cellTemp"]);
      if (direct !== null) {
        return this.normalizeTemperature(direct);
      }
    }

    return null;
  }

  private normalizeTemperature(raw: number): number {
    if (raw > 100) {
      return Number((raw / 10).toFixed(1));
    }
    return Number(raw.toFixed(1));
  }

  public extractBatterySoh(
    quotaData: Record<string, unknown>,
    parsedJson?: Record<string, unknown>
  ): number | null {
    const candidateKeys = ["bmsMaster.soh", "bms.soh", "soh", "f32ShowSoh"];
    const flatSoh = this.extractNumericCandidateFromKeys(quotaData, candidateKeys);
    if (flatSoh !== null && flatSoh >= 0 && flatSoh <= 100) {
      return Math.round(flatSoh);
    }

    const nestedContainers = ["bmsMaster", "bms", "ems"];
    for (const container of nestedContainers) {
      const nestedObj = quotaData[container];
      if (typeof nestedObj === "object" && nestedObj !== null) {
        const nestedRec = nestedObj as Record<string, unknown>;
        const raw = this.parseNumericCandidate(nestedRec["soh"] ?? nestedRec["f32ShowSoh"]);
        if (raw !== null && raw >= 0 && raw <= 100) {
          return Math.round(raw);
        }
      }
    }

    const typeCode =
      typeof parsedJson?.["typeCode"] === "string"
        ? (parsedJson["typeCode"] as string).toLowerCase()
        : "";
    const moduleType = parsedJson?.["moduleType"];
    const isBmsContext = typeCode.includes("bms") || moduleType === 2 || moduleType === "2";
    if (isBmsContext) {
      const direct = this.parseNumericCandidate(quotaData["soh"] ?? quotaData["f32ShowSoh"]);
      if (direct !== null && direct >= 0 && direct <= 100) {
        return Math.round(direct);
      }
    }

    return null;
  }

  public extractBatteryCycles(
    quotaData: Record<string, unknown>,
    parsedJson?: Record<string, unknown>
  ): number | null {
    const candidateKeys = ["bmsMaster.cycles", "bms.cycles", "cycles", "cycleCount"];
    const flatCycles = this.extractNumericCandidateFromKeys(quotaData, candidateKeys);
    if (flatCycles !== null && flatCycles >= 0) {
      return Math.round(flatCycles);
    }

    const nestedContainers = ["bmsMaster", "bms", "ems"];
    for (const container of nestedContainers) {
      const nestedObj = quotaData[container];
      if (typeof nestedObj === "object" && nestedObj !== null) {
        const nestedRec = nestedObj as Record<string, unknown>;
        const raw = this.parseNumericCandidate(nestedRec["cycles"] ?? nestedRec["cycleCount"]);
        if (raw !== null && raw >= 0) {
          return Math.round(raw);
        }
      }
    }

    const typeCode =
      typeof parsedJson?.["typeCode"] === "string"
        ? (parsedJson["typeCode"] as string).toLowerCase()
        : "";
    const moduleType = parsedJson?.["moduleType"];
    const isBmsContext = typeCode.includes("bms") || moduleType === 2 || moduleType === "2";
    if (isBmsContext) {
      const direct = this.parseNumericCandidate(quotaData["cycles"] ?? quotaData["cycleCount"]);
      if (direct !== null && direct >= 0) {
        return Math.round(direct);
      }
    }

    return null;
  }

  public extractBatteryVolts(
    quotaData: Record<string, unknown>,
    parsedJson?: Record<string, unknown>
  ): number | null {
    const candidateKeys = ["bmsMaster.vol", "bms.vol", "vol", "voltage"];
    const flatVol = this.extractNumericCandidateFromKeys(quotaData, candidateKeys);
    if (flatVol !== null && flatVol > 0) {
      return flatVol > 1000 ? Number((flatVol / 1000).toFixed(2)) : Number(flatVol.toFixed(2));
    }

    const nestedContainers = ["bmsMaster", "bms", "ems"];
    for (const container of nestedContainers) {
      const nestedObj = quotaData[container];
      if (typeof nestedObj === "object" && nestedObj !== null) {
        const nestedRec = nestedObj as Record<string, unknown>;
        const raw = this.parseNumericCandidate(nestedRec["vol"] ?? nestedRec["voltage"]);
        if (raw !== null && raw > 0) {
          return raw > 1000 ? Number((raw / 1000).toFixed(2)) : Number(raw.toFixed(2));
        }
      }
    }

    return null;
  }

  public extractBatteryAmps(
    quotaData: Record<string, unknown>,
    parsedJson?: Record<string, unknown>
  ): number | null {
    const candidateKeys = ["bmsMaster.amp", "bms.amp", "amp", "current"];
    const flatAmp = this.extractNumericCandidateFromKeys(quotaData, candidateKeys);
    if (flatAmp !== null) {
      return Math.abs(flatAmp) > 1000 ? Number((flatAmp / 1000).toFixed(2)) : Number(flatAmp.toFixed(2));
    }

    const nestedContainers = ["bmsMaster", "bms", "ems"];
    for (const container of nestedContainers) {
      const nestedObj = quotaData[container];
      if (typeof nestedObj === "object" && nestedObj !== null) {
        const nestedRec = nestedObj as Record<string, unknown>;
        const raw = this.parseNumericCandidate(nestedRec["amp"] ?? nestedRec["current"]);
        if (raw !== null) {
          return Math.abs(raw) > 1000 ? Number((raw / 1000).toFixed(2)) : Number(raw.toFixed(2));
        }
      }
    }

    return null;
  }

  private extractNumericCandidateFromKeys(
    quotaData: Record<string, unknown>,
    keys: string[]
  ): number | null {
    for (const key of keys) {
      const candidateValue = quotaData[key];
      const parsed = this.parseNumericCandidate(candidateValue);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }
}
