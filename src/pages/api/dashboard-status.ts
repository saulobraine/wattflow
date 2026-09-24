import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";

interface DashboardStatusResponse {
  success: boolean;
  isAuthenticated?: boolean;
  message?: string;
  data?: {
    isConfigured: boolean;
    isAutomationActive: boolean;
    turnOnThreshold: number;
    turnOffThreshold: number;
    lastBatteryPercentage: number | null;
    lastSolarWatts: number | null;
    lastAction: string | null;
    lastSyncTime: string | null;
    logs: Array<{
      id: string;
      batteryPercentage: number;
      solarInputWatts: number;
      actionTriggered: string;
      executionDetails: string | null;
      executedAt: string;
    }>;
  };
}

export default async function handleDashboardStatus(
  request: NextApiRequest,
  response: NextApiResponse<DashboardStatusResponse>
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", ["GET"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido.",
    });
    return;
  }

  const sessionUser = extractUserFromRequest(request);
  if (!sessionUser) {
    response.status(200).json({
      success: true,
      isAuthenticated: false,
      data: {
        isConfigured: false,
        isAutomationActive: false,
        turnOnThreshold: 90,
        turnOffThreshold: 30,
        lastBatteryPercentage: null,
        lastSolarWatts: null,
        lastAction: null,
        lastSyncTime: null,
        logs: [],
      },
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
      include: {
        syncExecutionLogs: {
          orderBy: { executedAt: "desc" },
          take: 10,
        },
      },
    });

    if (!configuration) {
      response.status(200).json({
        success: true,
        isAuthenticated: true,
        data: {
          isConfigured: false,
          isAutomationActive: false,
          turnOnThreshold: 90,
          turnOffThreshold: 30,
          lastBatteryPercentage: null,
          lastSolarWatts: null,
          lastAction: null,
          lastSyncTime: null,
          logs: [],
        },
      });
      return;
    }

    const latestLog = configuration.syncExecutionLogs[0];
    const isConfigured = Boolean(
      configuration.tuyaAccessId &&
        configuration.tuyaAccessSecret &&
        configuration.ecoflowAccessKey &&
        configuration.ecoflowAccessSecret
    );

    response.status(200).json({
      success: true,
      isAuthenticated: true,
      data: {
        isConfigured,
        isAutomationActive: configuration.isAutomationActive,
        turnOnThreshold: configuration.turnOnThreshold,
        turnOffThreshold: configuration.turnOffThreshold,
        lastBatteryPercentage: latestLog ? latestLog.batteryPercentage : null,
        lastSolarWatts: latestLog ? latestLog.solarInputWatts : null,
        lastAction: latestLog ? latestLog.actionTriggered : null,
        lastSyncTime: latestLog ? latestLog.executedAt.toISOString() : null,
        logs: configuration.syncExecutionLogs.map((log) => ({
          id: log.id,
          batteryPercentage: log.batteryPercentage,
          solarInputWatts: log.solarInputWatts,
          actionTriggered: log.actionTriggered,
          executionDetails: log.executionDetails,
          executedAt: log.executedAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.warn("Aviso ao carregar status do dashboard:", error);
    response.status(200).json({
      success: true,
      isAuthenticated: true,
      data: {
        isConfigured: false,
        isAutomationActive: false,
        turnOnThreshold: 90,
        turnOffThreshold: 30,
        lastBatteryPercentage: null,
        lastSolarWatts: null,
        lastAction: null,
        lastSyncTime: null,
        logs: [],
      },
    });
  }
}
