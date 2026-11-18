import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { ConfigurationRepository } from "../../infrastructure/repositories/ConfigurationRepository";
import { OrchestratorSyncUseCase, SyncExecutionResult } from "../../application/OrchestratorSyncUseCase";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";

interface SyncApiResponseData {
  success: boolean;
  message: string;
  data?: SyncExecutionResult | SyncExecutionResult[];
}

const MIN_CRON_SECRET_LENGTH = 32;

export default async function handleSync(
  request: NextApiRequest,
  response: NextApiResponse<SyncApiResponseData>
): Promise<void> {
  const isAllowedMethod = request.method === "GET" || request.method === "POST";
  if (!isAllowedMethod) {
    response.setHeader("Allow", ["GET", "POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize GET ou POST.",
    });
    return;
  }

  const configuredCronSecret = process.env.CRON_SECRET_TOKEN;
  const hasValidCronSecret = Boolean(
    configuredCronSecret && configuredCronSecret.trim().length >= MIN_CRON_SECRET_LENGTH
  );

  let isCronAuthorized = false;
  if (hasValidCronSecret) {
    const authorizationHeader = request.headers.authorization;
    const bearerExpected = `Bearer ${configuredCronSecret}`;
    const rawQueryToken = request.query.token;
    const queryToken = Array.isArray(rawQueryToken) ? rawQueryToken[0] : rawQueryToken;
    isCronAuthorized =
      authorizationHeader === bearerExpected || queryToken === configuredCronSecret;
  }

  let sessionUser: ReturnType<typeof extractUserFromRequest> = null;
  if (!isCronAuthorized) {
    try {
      sessionUser = extractUserFromRequest(request);
    } catch (authError: unknown) {
      const authMessage =
        authError instanceof Error
          ? authError.message
          : "Erro interno na configuração de autenticação do servidor.";
      response.status(500).json({
        success: false,
        message: authMessage,
      });
      return;
    }
  }

  if (!sessionUser && !isCronAuthorized) {
    if (!hasValidCronSecret) {
      response.status(500).json({
        success: false,
        message: "Variável de ambiente CRON_SECRET_TOKEN obrigatória não configurada ou com menos de 32 caracteres.",
      });
      return;
    }

    response.status(401).json({
      success: false,
      message: "Não autorizado. Forneça o token do Cron ou realize login na plataforma.",
    });
    return;
  }

  try {
    const repository = new ConfigurationRepository(prisma);
    const useCase = new OrchestratorSyncUseCase(repository);

    if (sessionUser && !isCronAuthorized) {
      let loggedInUserId = "";
      sessionUser.provideIdentity((userId) => {
        loggedInUserId = userId;
      });

      const singleResult = await useCase.executeSyncForUser(loggedInUserId);
      response.status(200).json({
        success: singleResult.hasExecutedSuccessfully,
        message: singleResult.detailMessage,
        data: singleResult,
      });
      return;
    }

    const batchResults = await useCase.executeSyncAll();
    response.status(200).json({
      success: true,
      message: `Sincronização executada para ${batchResults.length} automação(ões) ativa(s).`,
      data: batchResults,
    });
  } catch (caughtError: unknown) {
    const errorMessage = caughtError instanceof Error ? caughtError.message : "Erro desconhecido na sincronização.";
    response.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
}
