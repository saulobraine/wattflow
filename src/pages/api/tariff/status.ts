import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import {
  TariffScheduleService,
  type TariffStatusDetail,
} from "../../../domain/services/TariffScheduleService";

interface TariffStatusResponseBody {
  success: boolean;
  message?: string;
  data?: TariffStatusDetail & {
    nextTransition: {
      period: TariffStatusDetail["nextPeriod"];
      time: string;
      minutesRemaining: number;
    };
  };
}

export default async function handleTariffStatus(
  request: NextApiRequest,
  response: NextApiResponse<TariffStatusResponseBody>
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", ["GET"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido.",
    });
    return;
  }

  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error ? authError.message : "Erro interno de autenticação.";
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

  try {
    const configuration = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
    });

    if (!configuration) {
      response.status(404).json({
        success: false,
        message: "Configuração do usuário não encontrada.",
      });
      return;
    }

    const service = TariffScheduleService.getInstance();
    const tariffStatus = service.evaluateTariffPeriod(configuration);

    response.status(200).json({
      success: true,
      data: {
        ...tariffStatus,
        nextTransition: {
          period: tariffStatus.nextPeriod,
          time: tariffStatus.nextTransitionTime,
          minutesRemaining: tariffStatus.minutesToNextTransition,
        },
      },
    });
  } catch (serviceError: unknown) {
    console.error("[Tariff Status API] Falha ao processar status tarifário:", serviceError);
    response.status(500).json({
      success: false,
      message: "Erro interno ao consultar status tarifário.",
    });
  }
}
