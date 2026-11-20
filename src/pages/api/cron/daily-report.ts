import crypto from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import { decryptAndMigrateConfigurationSecrets } from "../../../infrastructure/security/secretMigrationHelper";
import { NotificationDispatcher } from "../../../infrastructure/notifications/NotificationDispatcher";
import { SolarReadingCollection, SolarTelemetryPoint } from "../../../domain/models/SolarReadingCollection";
import { SolarGenerationWatts } from "../../../domain/values/SolarGenerationWatts";

interface DailyReportResponse {
  success: boolean;
  message: string;
  processedCount: number;
  dispatchedCount: number;
  details?: Array<{
    userId?: string;
    dispatched: boolean;
    reason?: string;
  }>;
}

export function isAuthorizedCronRequest(
  authHeader: string | undefined,
  cronSecret: string | undefined
): boolean {
  if (!cronSecret || cronSecret.trim().length === 0) {
    return false;
  }
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const expectedHeader = `Bearer ${cronSecret}`;
  const actualBuffer = Buffer.from(authHeader, "utf8");
  const expectedBuffer = Buffer.from(expectedHeader, "utf8");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function wasAlreadySentToday(lastSentAt: Date | null): boolean {
  if (!lastSentAt) {
    return false;
  }
  const now = new Date();
  return (
    lastSentAt.getFullYear() === now.getFullYear() &&
    lastSentAt.getMonth() === now.getMonth() &&
    lastSentAt.getDate() === now.getDate()
  );
}

export default async function handleDailyReportCron(
  request: NextApiRequest,
  response: NextApiResponse<DailyReportResponse>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("Allow", ["GET", "POST"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido. Utilize GET ou POST.",
      processedCount: 0,
      dispatchedCount: 0,
    });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.authorization;
  const isCronAuthorized = isAuthorizedCronRequest(authHeader, cronSecret);

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch {
    // Modo cron sem sessão de usuário
  }

  // Fail-Closed: se não for cron autenticado e não tiver sessão de usuário válida, rejeita imediatamente com 401
  if (!isCronAuthorized && !sessionUser) {
    response.status(401).json({
      success: false,
      message: "Não autorizado para executar o cron de relatório diário.",
      processedCount: 0,
      dispatchedCount: 0,
    });
    return;
  }

  // Isolamento Multi-Tenant estrito: se a requisição for de usuário comum, força o escopo apenas para ele
  let targetUserIdScope: string | null = null;
  if (sessionUser && !isCronAuthorized) {
    sessionUser.provideIdentity((userId) => {
      targetUserIdScope = userId;
    });
  }

  const isManualTest = Boolean(request.query.force === "true" || request.body?.force === true);

  try {
    const now = new Date();
    const nowTimestamp = now.getTime();
    const currentHour = now.getHours();

    const configurations = await prisma.userConfiguration.findMany({
      where: {
        isDailyReportActive: true,
        isNotificationActive: true,
        ...(targetUserIdScope ? { userId: targetUserIdScope } : {}),
      },
      include: {
        user: { select: { email: true, fullName: true } },
      },
    });

    const results: Array<{ userId: string; dispatched: boolean; reason?: string }> = [];
    let dispatchedCount = 0;
    const dispatcher = new NotificationDispatcher();

    for (const config of configurations) {
      const alreadySent = wasAlreadySentToday(config.lastDailyReportSentAt);
      if (alreadySent && !isManualTest) {
        results.push({
          userId: config.userId,
          dispatched: false,
          reason: "Relatório diário já foi enviado hoje.",
        });
        continue;
      }

      const [targetHour] = (config.dailyReportTime || "21:00").split(":").map(Number);
      if (!isManualTest && currentHour < targetHour) {
        results.push({
          userId: config.userId,
          dispatched: false,
          reason: `Horário configurado (${config.dailyReportTime}) ainda não foi atingido.`,
        });
        continue;
      }

      // Consulta telemetria do dia (últimas 24h)
      const twentyFourHoursAgo = new Date(nowTimestamp - 24 * 60 * 60 * 1000);
      const startOfMonth = new Date(nowTimestamp);
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const logs24h = await prisma.syncExecutionLog.findMany({
        where: {
          userConfigurationId: config.id,
          executedAt: { gte: twentyFourHoursAgo },
        },
        orderBy: { executedAt: "desc" },
      });

      let todayKwh = 0;
      if (logs24h.length > 0) {
        const points24h: SolarTelemetryPoint[] = logs24h.map((l) => ({
          watts: new SolarGenerationWatts(l.solarInputWatts),
          outputWatts: l.outputWatts ?? 0,
          batteryPercentage: l.batteryPercentage,
          timestamp: l.executedAt,
        }));
        const col = new SolarReadingCollection(points24h);
        todayKwh = Number((col.calculateAccumulatedEnergyWattHours(24) / 1000).toFixed(2));
      }

      // Mês acumulado
      const monthLogs = await prisma.syncExecutionLog.findMany({
        where: {
          userConfigurationId: config.id,
          executedAt: { gte: startOfMonth },
        },
        select: {
          solarInputWatts: true,
          outputWatts: true,
          batteryPercentage: true,
          executedAt: true,
        },
        orderBy: { executedAt: "asc" },
        take: 5000,
      });

      let monthKwh = todayKwh;
      if (monthLogs.length > 0) {
        const monthPoints: SolarTelemetryPoint[] = monthLogs.map((l) => ({
          watts: new SolarGenerationWatts(l.solarInputWatts),
          batteryPercentage: l.batteryPercentage,
          outputWatts: l.outputWatts ?? 0,
          timestamp: l.executedAt,
        }));
        const mCol = new SolarReadingCollection(monthPoints);
        const mHours = Math.max(1, Math.ceil((nowTimestamp - startOfMonth.getTime()) / (1000 * 60 * 60)));
        monthKwh = Math.max(todayKwh, Number((mCol.calculateAccumulatedEnergyWattHours(mHours) / 1000).toFixed(2)));
      }

      const tariff = config.energyCostPerKwh ?? 0.92;
      const currency = config.currencySymbol || "R$";
      const todaySavings = todayKwh * tariff;
      const monthSavings = monthKwh * tariff;

      // Status da bateria mais recente
      const latestLog = logs24h[0];
      const batteryPercent = latestLog ? latestLog.batteryPercentage : 100;
      const outputWatts = latestLog ? (latestLog.outputWatts ?? 0) : 0;
      const solarWatts = latestLog ? latestLog.solarInputWatts : 0;

      // Estimativa simples de autonomia formatada
      let autonomyText = "Standby";
      const capacityWh = config.batteryCapacityWh ?? 2048;
      const remainingWh = Math.round(capacityWh * (batteryPercent / 100));
      const netDrain = outputWatts - solarWatts;
      if (outputWatts <= 5) {
        autonomyText = solarWatts > 10 ? "Em Carga Solar" : "Standby";
      } else if (solarWatts >= outputWatts) {
        autonomyText = "Em Carga Solar";
      } else if (netDrain > 0) {
        const mins = Math.round((remainingWh / netDrain) * 60);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        autonomyText = `~${h}h ${m.toString().padStart(2, "0")}m`;
      }

      // Ciclos da ATS hoje
      const todaySwitchesLogs = logs24h.filter((l) =>
        [
          "ENABLE_ECOFLOW_AC",
          "DISABLE_ECOFLOW_AC",
          "BATTERY_HIGH_DISCHARGE",
          "BATTERY_LOW_RECHARGE",
          "STORM_MODE_RESERVE",
        ].includes(l.actionTriggered)
      );
      const dailySwitches = todaySwitchesLogs.length;
      const lifespanCycles = config.atsLifespanCycles ?? 10000;
      const currentCycles = config.atsCurrentCycles ?? 0;
      const remainingCycles = Math.max(0, lifespanCycles - currentCycles);

      const systemStatus = config.isStormModeActive
        ? "Modo Tempestade Ativo (Reserva 100%)"
        : config.isAutomationActive
        ? "Sistema 100% Operacional"
        : "Automação Pausada (Monitoramento)";

      const formattedDate = now.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const formattedTime = now.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const reportMessage = [
        "🌙 *WattFlow - Relatório Diário de Operação*",
        `📅 Data: ${formattedDate} às ${formattedTime}`,
        "",
        `☀️ Geração Solar Hoje: ${todayKwh} kWh`,
        `🔋 Bateria Atual: ${batteryPercent}% (${autonomyText})`,
        `💰 Economia de Hoje: ${currency} ${todaySavings.toFixed(2)} (acumulado mês: ${currency} ${monthSavings.toFixed(2)})`,
        `⚡ Chave ATS: ${dailySwitches} comutações hoje (${remainingCycles} ciclos restantes)`,
        `🛡️ Status: ${systemStatus}`,
        "",
        "_WattFlow - Energia Inteligente_",
      ].join("\n");

      let decryptedSecrets: { whatsappApiKey: string; telegramBotToken: string };
      try {
        decryptedSecrets = await decryptAndMigrateConfigurationSecrets(prisma, config);
      } catch {
        decryptedSecrets = { whatsappApiKey: "", telegramBotToken: "" };
      }

      await dispatcher.dispatchNotification(
        {
          title: "Relatório Diário de Operação",
          message: reportMessage,
          batteryPercentage: batteryPercent,
          solarWatts,
          actionState: "INFO",
        },
        {
          whatsappPhoneNumber: config.whatsappPhoneNumber,
          whatsappApiKey: decryptedSecrets.whatsappApiKey,
          telegramBotToken: decryptedSecrets.telegramBotToken,
          telegramChatId: config.telegramChatId,
          isNotificationActive: config.isNotificationActive,
        }
      );

      await prisma.userConfiguration.update({
        where: { id: config.id },
        data: { lastDailyReportSentAt: now },
      });

      dispatchedCount++;
      results.push({ userId: config.userId, dispatched: true });
    }

    const sanitizedDetails = isCronAuthorized
      ? results
      : results.map(({ dispatched, reason }) => ({ dispatched, reason }));

    response.status(200).json({
      success: true,
      message: `Processamento do relatório diário concluído (${dispatchedCount} enviado(s)).`,
      processedCount: configurations.length,
      dispatchedCount,
      details: sanitizedDetails,
    });
  } catch (error) {
    console.error("[DailyReport Cron] Erro ao processar relatório diário:", error);
    response.status(500).json({
      success: false,
      message: "Erro interno ao processar relatório diário.",
      processedCount: 0,
      dispatchedCount: 0,
    });
  }
}
