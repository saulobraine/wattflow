import { PrismaClient } from "@prisma/client";
import { ConfigurationRepository } from "../repositories/ConfigurationRepository";
import { OrchestratorSyncUseCase, SyncExecutionResult } from "../../application/OrchestratorSyncUseCase";
import { EcoFlowMqttStreamService } from "./EcoFlowMqttStreamService";

let lastSyncTimeMs = 0;
let inFlightSync: Promise<SyncExecutionResult | null> | null = null;

/**
 * Serviço de sincronização de telemetria em tempo real com proteção de taxa (rate-limit).
 * Permite que páginas como Estatísticas e Dashboard recebam dados ao vivo da EcoFlow
 * a cada 1-2 segundos sem estourar cotas de requisição da Open API.
 *
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem a palavra-chave else (early returns)
 * - Nomes sem abreviação
 * - 1 ponto por linha
 */
export class LiveTelemetryService {
  private readonly databaseClient: PrismaClient;

  constructor(databaseClient: PrismaClient) {
    this.databaseClient = databaseClient;
  }

  public async syncIfStale(userId: string, maxAgeMs = 2000): Promise<SyncExecutionResult | null> {
    const streamService = EcoFlowMqttStreamService.getInstance();
    const isStreamDisconnected = !streamService.isStreamConnected();
    if (isStreamDisconnected) {
      streamService.startWithActiveConfiguration(this.databaseClient).catch((streamError) => {
        console.warn("[LiveTelemetryService] Tentativa de inicialização do stream MQTT:", streamError);
      });
    }

    const elapsed = Date.now() - lastSyncTimeMs;
    const isRecent = elapsed < maxAgeMs;
    if (isRecent) {
      return null;
    }

    if (inFlightSync) {
      return await inFlightSync;
    }

    lastSyncTimeMs = Date.now();
    const repository = new ConfigurationRepository(this.databaseClient);
    const useCase = new OrchestratorSyncUseCase(repository);

    inFlightSync = useCase.executeSyncForUser(userId).catch((error) => {
      console.warn("[LiveTelemetryService] Falha na sincronização em tempo real:", error);
      return null;
    });

    try {
      return await inFlightSync;
    } finally {
      inFlightSync = null;
    }
  }
}
