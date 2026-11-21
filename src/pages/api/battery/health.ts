import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import { EcoFlowMqttStreamService } from "../../../infrastructure/services/EcoFlowMqttStreamService";
import { ConfigurationRepository } from "../../../infrastructure/repositories/ConfigurationRepository";
import { EcoFlowHttpClient } from "../../../infrastructure/http/EcoFlowHttpClient";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { DeviceSerialNumber } from "../../../domain/values/DeviceSerialNumber";
import {
  BatteryHealthService,
  BatteryHealthMetrics,
  RawBatteryTelemetryParams,
} from "../../../domain/services/BatteryHealthService";

export interface BatteryHealthApiResponse {
  success: boolean;
  message?: string;
  data?: BatteryHealthMetrics;
}

export default async function handleBatteryHealth(
  request: NextApiRequest,
  response: NextApiResponse<BatteryHealthApiResponse>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");

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
      message: "Não autenticado. Por favor, faça login para acessar a telemetria da bateria.",
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

    const latestLog = await prisma.syncExecutionLog.findFirst({
      where: { userConfigurationId: configuration.id },
      orderBy: { executedAt: "desc" },
    });

    const streamService = EcoFlowMqttStreamService.getInstance();
    const liveTelemetry = streamService.getLatestTelemetry(extractedUserId, 300_000);

    let temp =
      liveTelemetry?.batteryTempCelsius ??
      latestLog?.batteryTempCelsius ??
      configuration.lastBatteryTempCelsius ??
      null;

    let cycles =
      liveTelemetry?.batteryCycles ??
      latestLog?.batteryCycles ??
      configuration.lastBatteryCycles ??
      null;

    let soh =
      liveTelemetry?.batterySoh ??
      latestLog?.batterySoh ??
      configuration.lastBatterySoh ??
      null;

    let volts = liveTelemetry?.batteryVolts ?? null;
    let amps = liveTelemetry?.batteryAmps ?? null;

    if (temp === null && cycles === null && soh === null) {
      try {
        const configRepo = new ConfigurationRepository(prisma);
        const activeConfig = await configRepo.findActiveConfigurationByUserId(extractedUserId);
        if (activeConfig) {
          let ecoflowCreds: EcoFlowCredentials | undefined;
          activeConfig.configuration.provideCredentialsBundle((bundle) => {
            bundle.provideEcoFlowCredentials((creds) => {
              ecoflowCreds = creds;
            });
          });

          let targetDevice: DeviceSerialNumber | undefined;
          activeConfig.configuration.provideAutomationProfile((profile) => {
            profile.provideDevicePair((devices) => {
              devices.provideEcoFlowSerialNumber((serial) => {
                targetDevice = new DeviceSerialNumber(serial);
              });
            });
          });

          if (ecoflowCreds && targetDevice) {
            const endpoint = activeConfig.ecoflowEndpointRegion || "https://api.ecoflow.com";
            const client = new EcoFlowHttpClient(ecoflowCreds, endpoint);
            const telemetry = await client.fetchDeviceTelemetry(targetDevice);

            if (telemetry.batteryTempCelsius !== null && telemetry.batteryTempCelsius !== undefined) {
              temp = telemetry.batteryTempCelsius;
            }
            if (telemetry.batterySoh !== null && telemetry.batterySoh !== undefined) {
              soh = telemetry.batterySoh;
            }
            if (telemetry.batteryCycles !== null && telemetry.batteryCycles !== undefined) {
              cycles = telemetry.batteryCycles;
            }
            if (telemetry.batteryVoltageVolts !== null && telemetry.batteryVoltageVolts !== undefined) {
              volts = telemetry.batteryVoltageVolts;
            }
            if (telemetry.batteryAmperageAmps !== null && telemetry.batteryAmperageAmps !== undefined) {
              amps = telemetry.batteryAmperageAmps;
            }

            if (temp !== null || soh !== null || cycles !== null) {
              configRepo
                .updateBmsTelemetry(configuration.id, {
                  tempCelsius: temp,
                  soh,
                  cycles,
                })
                .catch((saveErr) => {
                  console.warn("[BatteryHealth API] Falha ao persistir leitura ativa de BMS:", saveErr);
                });
            }
          }
        }
      } catch (activeReadErr) {
        console.warn("[BatteryHealth API] Leitura ativa de inicialização BMS falhou:", activeReadErr);
      }
    }

    const watts =
      volts !== null && amps !== null ? Number((volts * amps).toFixed(1)) : null;

    const rawParams: RawBatteryTelemetryParams = {
      temp,
      cycles,
      soh,
      volts,
      amps,
      watts,
    };

    const batteryHealthService = BatteryHealthService.getInstance();
    const metrics = batteryHealthService.evaluateBatteryHealth(
      rawParams,
      configuration,
      configuration.id
    );

    response.status(200).json({
      success: true,
      data: metrics,
    });
  } catch (error: unknown) {
    console.error("[BatteryHealth API] Erro ao obter saúde da bateria:", error);
    response.status(500).json({
      success: false,
      message: "Erro interno ao processar dados de saúde da bateria.",
    });
  }
}
