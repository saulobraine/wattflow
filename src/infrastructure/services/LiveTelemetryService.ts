import { PrismaClient } from "@prisma/client";
import { ConfigurationRepository } from "../repositories/ConfigurationRepository";
import { OrchestratorSyncUseCase, SyncExecutionResult } from "../../application/OrchestratorSyncUseCase";
import { EcoFlowMqttStreamService } from "./EcoFlowMqttStreamService";

interface UserLiveSyncState {
  lastSyncTimeMs: number;
  inFlightSync: Promise<SyncExecutionResult | null> | null;
}

const userSyncStates = new Map<string, UserLiveSyncState>();

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
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) {
      return null;
    }

    const streamService = EcoFlowMqttStreamService.getInstance();
    const isUserStreamConnected = streamService.isStreamConnected(normalizedUserId);
    if (!isUserStreamConnected) {
      const startPromise = streamService.startForUser(this.databaseClient, normalizedUserId);
      startPromise.catch((streamError) => {
        console.warn("[LiveTelemetryService] Tentativa de inicialização do stream MQTT:", streamError);
      });
    }

    const userState = getOrCreateUserSyncState(normalizedUserId);
    if (userState.inFlightSync) {
      return await userState.inFlightSync;
    }

    const elapsed = Date.now() - userState.lastSyncTimeMs;
    if (elapsed < maxAgeMs) {
      return null;
    }

    userState.lastSyncTimeMs = Date.now();
    const repository = new ConfigurationRepository(this.databaseClient);
    const useCase = new OrchestratorSyncUseCase(repository);

    const executionPromise = useCase.executeSyncForUser(normalizedUserId);
    userState.inFlightSync = executionPromise.catch((error) => {
      console.warn("[LiveTelemetryService] Falha na sincronização em tempo real:", error);
      return null;
    });

    try {
      return await userState.inFlightSync;
    } finally {
      userState.inFlightSync = null;
    }
  }
}
