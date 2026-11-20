import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../infrastructure/database/prismaClient";
import {
  enforceCsrfProtection,
  extractUserFromRequest,
} from "../../infrastructure/auth/sessionHelper";
import {
  appliancePostBodySchema,
  applianceToggleBodySchema,
  applianceBatchToggleSchema,
} from "../../infrastructure/security/apiSchemas";
import { EcoFlowMqttStreamService } from "../../infrastructure/services/EcoFlowMqttStreamService";

export interface ApplianceItem {
  id: string;
  name: string;
  category: string;
  averageWatts: number;
  isActiveInSimulation: boolean;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppliancesApiResponse {
  success: boolean;
  message?: string;
  data?: {
    appliances: ApplianceItem[];
    totalSimulatedWatts: number;
    simulatedRuntimeMinutes: number;
    formattedSimulatedRuntime: string;
    batteryCapacityWh: number;
    batteryPercentage: number;
  };
}

const DEFAULT_APPLIANCES = [
  { name: "Geladeira Inverter", category: "ESSENTIAL", averageWatts: 100, icon: "Refrigerator", isActiveInSimulation: false },
  { name: "Iluminação LED Residencial", category: "ESSENTIAL", averageWatts: 60, icon: "Lightbulb", isActiveInSimulation: false },
  { name: "Starlink / ONU + Roteador Wi-Fi", category: "ESSENTIAL", averageWatts: 50, icon: "Wifi", isActiveInSimulation: false },
  { name: "Notebook / Computador Trabalho", category: "COMFORT", averageWatts: 120, icon: "Laptop", isActiveInSimulation: false },
  { name: "Smart TV + Áudio", category: "COMFORT", averageWatts: 140, icon: "Tv", isActiveInSimulation: false },
  { name: "Ar-Condicionado Inverter 9k", category: "HEAVY", averageWatts: 750, icon: "AirVent", isActiveInSimulation: false },
];

function formatRuntime(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export default async function handleAppliances(
  request: NextApiRequest,
  response: NextApiResponse<AppliancesApiResponse>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  const allowedMethods = ["GET", "POST", "DELETE"];
  if (!allowedMethods.includes(request.method ?? "")) {
    response.setHeader("Allow", allowedMethods);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize GET, POST ou DELETE.",
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
        : "Erro interno na autenticação do servidor.";
    response.status(500).json({ success: false, message: authMessage });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autenticado. Faça login para acessar o simulador de cargas.",
    });
    return;
  }

  let sessionUserId = "";
  sessionUser.provideIdentity((id) => {
    sessionUserId = id;
  });

  try {
    // 1. Obtém ou inicializa a configuração do usuário
    let config = await prisma.userConfiguration.findUnique({
      where: { userId: sessionUserId },
      include: { applianceProfiles: { orderBy: { createdAt: "asc" } } },
    });

    if (!config) {
      config = await prisma.userConfiguration.create({
        data: { userId: sessionUserId },
        include: { applianceProfiles: { orderBy: { createdAt: "asc" } } },
      });
    }

    // 2. Processa GET
    if (request.method === "GET") {
      let appliances = config.applianceProfiles;

      // Auto-Seed se vazio
      if (appliances.length === 0) {
        await prisma.applianceLoadProfile.createMany({
          data: DEFAULT_APPLIANCES.map((item) => ({
            ...item,
            userConfigurationId: config.id,
          })),
        });

        appliances = await prisma.applianceLoadProfile.findMany({
          where: { userConfigurationId: config.id },
          orderBy: { createdAt: "asc" },
        });
      }

      // Calcula simulação de autonomia
      const batteryCapacityWh = config.batteryCapacityWh || 2048;
      const latestTelemetry = EcoFlowMqttStreamService.getInstance().getLatestTelemetry(sessionUserId);
      const batteryPercentage = latestTelemetry?.batteryPercentage ?? 80;
      const remainingWh = batteryCapacityWh * (batteryPercentage / 100);

      const totalSimulatedWatts = appliances
        .filter((a) => a.isActiveInSimulation)
        .reduce((sum, a) => sum + a.averageWatts, 0);

      const simulatedRuntimeMinutes =
        totalSimulatedWatts > 0
          ? Math.round((remainingWh / Math.max(10, totalSimulatedWatts)) * 60)
          : 0;

      response.status(200).json({
        success: true,
        data: {
          appliances: appliances.map((a) => ({
            id: a.id,
            name: a.name,
            category: a.category,
            averageWatts: a.averageWatts,
            isActiveInSimulation: a.isActiveInSimulation,
            icon: a.icon,
            createdAt: a.createdAt.toISOString(),
            updatedAt: a.updatedAt.toISOString(),
          })),
          totalSimulatedWatts,
          simulatedRuntimeMinutes,
          formattedSimulatedRuntime: formatRuntime(simulatedRuntimeMinutes),
          batteryCapacityWh,
          batteryPercentage,
        },
      });
      return;
    }

    // Para POST e DELETE, valida CSRF
    if (!enforceCsrfProtection(request, response)) {
      return;
    }

    // 3. Processa POST (Criação ou Toggle)
    if (request.method === "POST") {
      const body = request.body ?? {};

      // Caso A: Batch toggle
      const batchParse = applianceBatchToggleSchema.safeParse(body);
      if (batchParse.success) {
        const { applianceIds, isActive } = batchParse.data;
        await prisma.applianceLoadProfile.updateMany({
          where: {
            id: { in: applianceIds },
            userConfigurationId: config.id,
          },
          data: {
            isActiveInSimulation: isActive !== undefined ? isActive : true,
          },
        });

        response.status(200).json({
          success: true,
          message: "Simulação de cargas atualizada em lote.",
        });
        return;
      }

      // Caso B: Toggle individual
      const toggleParse = applianceToggleBodySchema.safeParse(body);
      if (toggleParse.success) {
        const { applianceId, isActiveInSimulation } = toggleParse.data;
        const updated = await prisma.applianceLoadProfile.updateMany({
          where: { id: applianceId, userConfigurationId: config.id },
          data: { isActiveInSimulation },
        });

        if (updated.count === 0) {
          response.status(404).json({ success: false, message: "Aparelho não encontrado." });
          return;
        }

        response.status(200).json({
          success: true,
          message: `Aparelho ${isActiveInSimulation ? "incluído na" : "removido da"} simulação.`,
        });
        return;
      }

      // Caso C: Criação de novo aparelho customizado
      const createParse = appliancePostBodySchema.safeParse(body);
      if (!createParse.success) {
        const firstIssue = createParse.error.issues[0]?.message || "Dados do aparelho inválidos.";
        response.status(400).json({ success: false, message: firstIssue });
        return;
      }

      const { name, category, averageWatts, isActiveInSimulation, icon } = createParse.data;
      const created = await prisma.applianceLoadProfile.create({
        data: {
          userConfigurationId: config.id,
          name,
          category,
          averageWatts,
          isActiveInSimulation: isActiveInSimulation ?? false,
          icon: icon || "Zap",
        },
      });

      response.status(201).json({
        success: true,
        message: "Aparelho cadastrado com sucesso.",
        data: {
          appliances: [
            {
              id: created.id,
              name: created.name,
              category: created.category,
              averageWatts: created.averageWatts,
              isActiveInSimulation: created.isActiveInSimulation,
              icon: created.icon,
              createdAt: created.createdAt.toISOString(),
              updatedAt: created.updatedAt.toISOString(),
            },
          ],
          totalSimulatedWatts: created.isActiveInSimulation ? created.averageWatts : 0,
          simulatedRuntimeMinutes: 0,
          formattedSimulatedRuntime: "0m",
          batteryCapacityWh: config.batteryCapacityWh,
          batteryPercentage: 100,
        },
      });
      return;
    }

    // 4. Processa DELETE
    if (request.method === "DELETE") {
      const rawId = (request.query.id as string) || (request.body?.id as string);
      if (!rawId || typeof rawId !== "string") {
        response.status(400).json({ success: false, message: "ID do aparelho é obrigatório para exclusão." });
        return;
      }

      const deleted = await prisma.applianceLoadProfile.deleteMany({
        where: { id: rawId, userConfigurationId: config.id },
      });

      if (deleted.count === 0) {
        response.status(404).json({ success: false, message: "Aparelho não encontrado para exclusão." });
        return;
      }

      response.status(200).json({
        success: true,
        message: "Aparelho removido com sucesso.",
      });
      return;
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Erro interno ao processar aparelhos.";
    response.status(500).json({ success: false, message: errorMsg });
  }
}
