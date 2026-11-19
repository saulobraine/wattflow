import { PrismaClient } from "@prisma/client";
import { ConfigurationRepository } from "../repositories/ConfigurationRepository";
import { OrchestratorSyncUseCase, SyncExecutionResult } from "../../application/OrchestratorSyncUseCase";
import { EcoFlowMqttStreamService } from "./EcoFlowMqttStreamService";

interface UserLiveSyncState {
  lastSyncTimeMs: number;
  inFlightSync: Promise<SyncExecutionResult | null> | null;
}

const userSyncStates = new Map<string, UserLiveSyncState>();

export function isLocalCronDisabled(): boolean {
  const environment = process.env;
  return environment.DISABLE_LOCAL_CRON === "true";
}

function getOrCreateUserSyncState(userId: string): UserLiveSyncState {
  const existing = userSyncStates.get(userId);
  if (existing) {
    return existing;
  }

  const initialState: UserLiveSyncState = {
    lastSyncTimeMs: 0,
    inFlightSync: null,
  };
  userSyncStates.set(userId, initialState);
  return initialState;
}

export function resetLiveTelemetryStateForTests(): void {
  userSyncStates.clear();
}

/**
 * Serviço multi-tenant de sincronização de telemetria em tempo real com proteção de taxa por usuário.
 * Isola estritamente lastSyncTimeMs e inFlightSync em Map<string, UserLiveSyncState> por userId.
 *
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else
 * - Nomes sem abreviação
 * - 1 ponto por linha
 */
export class LiveTelemetryService {
  private readonly databaseClient: PrismaClient;

  constructor(databaseClient: PrismaClient) {
    this.databaseClient = databaseClient;
  }

  public async syncIfStale(userId: string, maxAgeMs = 2000): Promise<SyncExecutionResult | null> {
    const isStringUserId = typeof userId === "string";
    const normalizedUserId = isStringUserId ? userId.trim() : "";
    if (!normalizedUserId) {
      return null;
    }

    if (isLocalCronDisabled()) {
      return null;
    }

    const streamService = EcoFlowMqttStreamService.getInstance();
    const isUserStreamConnected = streamService.isStreamConnected(normalizedUserId);
    if (!isUserStreamConnected) {
      const database = this.databaseClient;
      const startPromise = streamService.startForUser(database, normalizedUserId);
      startPromise.catch((streamError) => {
        console.warn("[LiveTelemetryService] Tentativa de inicialização do stream MQTT:", streamError);
      });
    }

    if (isUserStreamConnected) {
      const memoryTelemetry = streamService.getLatestTelemetry(normalizedUserId, 60000);
      if (!memoryTelemetry) {
        return null;
      }

      const userState = getOrCreateUserSyncState(normalizedUserId);
      const pendingSync = userState.inFlightSync;
      if (pendingSync) {
        return await pendingSync;
      }

      const lastSyncMs = userState.lastSyncTimeMs;
      const elapsed = Date.now() - lastSyncMs;
      if (elapsed < maxAgeMs) {
        return null;
      }

      const currentNowMs = Date.now();
      userState.lastSyncTimeMs = currentNowMs;
      const repository = new ConfigurationRepository(this.databaseClient);
      const useCase = new OrchestratorSyncUseCase(repository);

      const executionPromise = useCase.executeSyncForUser(normalizedUserId, {
        batteryPercentage: memoryTelemetry.batteryPercentage,
        solarWatts: memoryTelemetry.solarInputWatts,
        outputWatts: memoryTelemetry.outputWatts,
        isAcOutputEnabled: memoryTelemetry.isAcOutputEnabled,
      });

      const safePromise = executionPromise.catch((error) => {
        console.warn("[LiveTelemetryService] Falha na sincronização via telemetria MQTT:", error);
        return null;
      });
      userState.inFlightSync = safePromise;

      try {
        return await safePromise;
      } finally {
        userState.inFlightSync = null;
      }
    }

    const userState = getOrCreateUserSyncState(normalizedUserId);
    const pendingSync = userState.inFlightSync;
    if (pendingSync) {
      return await pendingSync;
    }

    const lastSyncMs = userState.lastSyncTimeMs;
    const elapsed = Date.now() - lastSyncMs;
    if (elapsed < maxAgeMs) {
      return null;
    }

    const currentNowMs = Date.now();
    userState.lastSyncTimeMs = currentNowMs;
    const repository = new ConfigurationRepository(this.databaseClient);
    const useCase = new OrchestratorSyncUseCase(repository);

    const executionPromise = useCase.executeSyncForUser(normalizedUserId);
    const safePromise = executionPromise.catch((error) => {
      console.warn("[LiveTelemetryService] Falha na sincronização em tempo real:", error);
      return null;
    });
    userState.inFlightSync = safePromise;

    try {
      return await safePromise;
    } finally {
      userState.inFlightSync = null;
    }
  }
}
