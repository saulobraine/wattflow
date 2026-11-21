import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../infrastructure/auth/sessionHelper";
import { LiveTelemetryService } from "../../infrastructure/services/LiveTelemetryService";
import { EcoFlowMqttStreamService } from "../../infrastructure/services/EcoFlowMqttStreamService";

interface DashboardStatusResponse {
  success: boolean;
  isAuthenticated?: boolean;
  message?: string;
  data?: {
    isConfigured: boolean;
    isAutomationActive: boolean;
    isStormModeActive?: boolean;
    turnOnThreshold: number;
    turnOffThreshold: number;
    deviceMaxChargeSoc?: number | null;
    deviceMinDsgSoc?: number | null;
    lastBatteryPercentage: number | null;
    lastSolarWatts: number | null;
    lastOutputWatts?: number | null;
    inverterMaxWatts?: number;
    isSmartChargingActive?: boolean;
    minAcChargingWatts?: number;
    maxAcChargingWatts?: number;
    currentAcChargingWatts?: number;
    chargeOnlyOffPeak?: boolean;
    cloudyPrechargeActive?: boolean;
    lastSmartChargeAdjustAt?: string | null;
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

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno de configuração de autenticação.";
    response.status(500).json({
      success: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionUser) {
    response.status(200).json({
      success: true,
      isAuthenticated: false,
      data: {
        isConfigured: false,
        isAutomationActive: false,
        isStormModeActive: false,
        turnOnThreshold: 90,
        turnOffThreshold: 30,
        lastBatteryPercentage: null,
        lastSolarWatts: null,
        lastOutputWatts: null,
        inverterMaxWatts: 2400,
        isSmartChargingActive: false,
        minAcChargingWatts: 200,
        maxAcChargingWatts: 1200,
        currentAcChargingWatts: 400,
        chargeOnlyOffPeak: true,
        cloudyPrechargeActive: true,
        lastSmartChargeAdjustAt: null,
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
    const streamService = EcoFlowMqttStreamService.getInstance();
    const isMqttConnected = streamService.isStreamConnected(extractedUserId);
    const memoryTelemetry = isMqttConnected
      ? streamService.getLatestTelemetry(extractedUserId, 60000)
      : null;

    if (!isMqttConnected) {
      const liveService = new LiveTelemetryService(prisma);
      await liveService.syncIfStale(extractedUserId, 90000);
    }

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
          isStormModeActive: false,
          turnOnThreshold: 90,
          turnOffThreshold: 30,
          lastBatteryPercentage: null,
          lastSolarWatts: null,
          lastOutputWatts: null,
          inverterMaxWatts: 2400,
          lastAction: null,
          lastSyncTime: null,
          logs: [],
        },
      });
      return;
    }

    const latestLog = configuration.syncExecutionLogs[0];
    const isConfigured = Boolean(
      configuration.ecoflowAccessKey &&
        configuration.ecoflowAccessSecret &&
        configuration.ecoflowSerialNumber
    );

    const isSnapshotRecent =
      Boolean(memoryTelemetry) &&
      Date.now() - memoryTelemetry!.updatedAt.getTime() < 60000;

    let resolvedBattery = latestLog ? latestLog.batteryPercentage : null;
    let resolvedSolarWatts = latestLog ? latestLog.solarInputWatts : null;
    let resolvedOutputWatts = latestLog ? latestLog.outputWatts : null;
    let resolvedAction = latestLog ? latestLog.actionTriggered : null;
    let resolvedSyncTime = latestLog ? latestLog.executedAt.toISOString() : null;

    if (isSnapshotRecent && memoryTelemetry) {
      resolvedBattery = memoryTelemetry.batteryPercentage;
      resolvedSolarWatts = memoryTelemetry.solarInputWatts;
      resolvedOutputWatts = memoryTelemetry.outputWatts;
      resolvedSyncTime = memoryTelemetry.updatedAt.toISOString();
      if (memoryTelemetry.isAcOutputEnabled !== null) {
        resolvedAction = memoryTelemetry.isAcOutputEnabled
          ? "ENABLE_ECOFLOW_AC"
          : "DISABLE_ECOFLOW_AC";
      }
    }

    response.status(200).json({
      success: true,
      isAuthenticated: true,
      data: {
        isConfigured,
        isAutomationActive: configuration.isAutomationActive,
        isStormModeActive: configuration.isStormModeActive ?? false,
        turnOnThreshold: configuration.turnOnThreshold,
        turnOffThreshold: configuration.turnOffThreshold,
        deviceMaxChargeSoc: memoryTelemetry?.deviceMaxChargeSoc ?? null,
        deviceMinDsgSoc: memoryTelemetry?.deviceMinDsgSoc ?? null,
        lastBatteryPercentage: resolvedBattery,
        lastSolarWatts: resolvedSolarWatts,
        lastOutputWatts: resolvedOutputWatts,
        inverterMaxWatts: configuration.inverterMaxWatts ?? 2400,
        isSmartChargingActive: configuration.isSmartChargingActive ?? false,
        minAcChargingWatts: configuration.minAcChargingWatts ?? 200,
        maxAcChargingWatts: configuration.maxAcChargingWatts ?? 1200,
        currentAcChargingWatts: configuration.currentAcChargingWatts ?? 400,
        chargeOnlyOffPeak: configuration.chargeOnlyOffPeak ?? true,
        cloudyPrechargeActive: configuration.cloudyPrechargeActive ?? true,
        lastSmartChargeAdjustAt: configuration.lastSmartChargeAdjustAt?.toISOString() ?? null,
        lastAction: resolvedAction,
        lastSyncTime: resolvedSyncTime,
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
    console.error("Erro ao obter status do dashboard:", error);
    response.status(500).json({
      success: false,
      message: "Erro interno ao processar status do painel.",
    });
  }
}
