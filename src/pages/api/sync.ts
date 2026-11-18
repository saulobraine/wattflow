import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { ConfigurationRepository } from "../../infrastructure/repositories/ConfigurationRepository";
import { OrchestratorSyncUseCase, SyncExecutionResult } from "../../application/OrchestratorSyncUseCase";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
  SESSION_COOKIE_NAME,
} from "../../infrastructure/auth/sessionHelper";
import {
  extractCronTokenFromHeaders,
  verifyCronRequestAuthorization,
} from "../../infrastructure/security/cronAuthHelper";

interface SyncApiResponseData {
  success: boolean;
  message: string;
  data?: SyncExecutionResult | SyncExecutionResult[];
}

export default async function handleSync(
  request: NextApiRequest,
  response: NextApiResponse<SyncApiResponseData>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  const isAllowedMethod = request.method === "GET" || request.method === "POST";
  if (!isAllowedMethod) {
    response.setHeader("Allow", ["GET", "POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize GET ou POST.",
    });
    return;
  }

  const { hasValidSecretConfigured, isAuthorized: isCronAuthorized } =
    verifyCronRequestAuthorization(request, process.env.CRON_SECRET_TOKEN);

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;

  if (!isCronAuthorized) {
    const hasSessionCookie = Boolean(request.headers?.cookie?.includes(SESSION_COOKIE_NAME));
    const hasCronHeaderAttempt = extractCronTokenFromHeaders(request) !== null;

    if (request.method === "GET") {
      if (hasSessionCookie && !hasCronHeaderAttempt) {
        response.setHeader("Allow", ["POST"]);
        response.status(405).json({
          success: false,
          message: "Sincronização autenticada por sessão exige o método POST.",
        });
        return;
      }

      if (!hasValidSecretConfigured) {
        response.status(500).json({
          success: false,
          message:
            "Variável de ambiente CRON_SECRET_TOKEN obrigatória não configurada ou com menos de 32 caracteres.",
        });
        return;
      }

      response.status(401).json({
        success: false,
        message: "Não autorizado. Forneça o token do Cron via cabeçalho HTTP.",
      });
      return;
    }

    // request.method === "POST" sem autorização Cron
    if (hasSessionCookie) {
      try {
        sessionUser = await extractUserFromRequest(request);
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

      if (sessionUser && !enforceCsrfProtection(request, response)) {
        return;
      }
    }

    if (!sessionUser) {
      if (!hasValidSecretConfigured) {
        response.status(500).json({
          success: false,
          message:
            "Variável de ambiente CRON_SECRET_TOKEN obrigatória não configurada ou com menos de 32 caracteres.",
        });
        return;
      }

      response.status(401).json({
        success: false,
        message: "Não autorizado. Forneça o token do Cron via cabeçalho ou realize login na plataforma.",
      });
      return;
    }
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
    console.error("[Sync API] Erro interno durante sincronização:", caughtError);
    response.status(500).json({
      success: false,
      message: "Erro interno ao processar a sincronização de energia.",
    });
  }
}
