import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import { EcoFlowMqttStreamService } from "../../../infrastructure/services/EcoFlowMqttStreamService";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handleTelemetryStream(
  request: NextApiRequest,
  response: NextApiResponse
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. O stream SSE aceita apenas GET.",
    });
    return;
  }

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno de autenticação.";
    response.status(500).json({
      success: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Usuário não autenticado.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  if (!extractedUserId) {
    response.status(401).json({
      success: false,
      message: "Identificador de usuário inválido.",
    });
    return;
  }

  // Headers mandatórios para SSE (incluindo X-Accel-Buffering: no para Nginx)
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");

  if (typeof response.flushHeaders === "function") {
    response.flushHeaders();
  }

  const streamService = EcoFlowMqttStreamService.getInstance();

  // Auto-inicia o stream MQTT caso não esteja conectado para este usuário
  if (!streamService.isStreamConnected(extractedUserId)) {
    streamService.startForUser(prisma, extractedUserId).catch((err) => {
      console.warn("[SSE Stream] Falha ao auto-iniciar stream MQTT:", err);
    });
  }

  // 1. Envio imediato da telemetria atual (snapshot de handshake)
  const initialSnapshot = streamService.getLatestTelemetry(extractedUserId);
  response.write(`event: telemetry\ndata: ${JSON.stringify(initialSnapshot)}\n\n`);

  // 2. Subscrição de eventos em tempo real
  const unsubscribe = streamService.subscribeTelemetry(
    extractedUserId,
    (liveSnapshot) => {
      try {
        response.write(
          `event: telemetry\ndata: ${JSON.stringify(liveSnapshot)}\n\n`
        );
      } catch (writeError) {
        console.warn("[SSE Stream] Falha ao despachar snapshot SSE:", writeError);
      }
    }
  );

  // 3. Heartbeat periódico a cada 15 segundos para manter a conexão ativa em proxies e NAT
  const HEARTBEAT_INTERVAL_MS = 15000;
  const heartbeatTimer = setInterval(() => {
    try {
      response.write(": keep-alive\n\n");
    } catch (heartbeatError) {
      console.warn("[SSE Stream] Falha no heartbeat:", heartbeatError);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // 4. Prevenção rigorosa de memory leaks no encerramento da conexão
  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) {
      return;
    }
    isCleanedUp = true;
    clearInterval(heartbeatTimer);
    unsubscribe();
  };

  request.on("close", cleanup);
  request.on("finish", cleanup);
  response.on("close", cleanup);
  response.on("finish", cleanup);
}
