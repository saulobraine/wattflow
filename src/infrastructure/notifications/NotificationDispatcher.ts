import { WebPushService, WebPushSubscriptionData } from "./WebPushService";

export interface NotificationConfig {
  telegramBotToken?: string;
  telegramChatId?: string;
  whatsappPhoneNumber?: string;
  whatsappApiKey?: string;
  isNotificationActive?: boolean;
  isWebPushActive?: boolean;
  userId?: string;
  webPushSubscriptions?: WebPushSubscriptionData[];
}

export interface NotificationPayload {
  title: string;
  message: string;
  batteryPercentage?: number;
  solarWatts?: number;
  actionState?: "SOLAR_BATTERY" | "GRID" | "ALERT" | "INFO";
  timestamp?: Date;
}

export interface NotificationDispatchResult {
  telegramSuccess: boolean;
  telegramError?: string;
  whatsappSuccess: boolean;
  whatsappError?: string;
  webPushSuccess?: boolean;
  webPushError?: string;
  summaryMessage: string;
}

const EXTERNAL_HTTP_TIMEOUT_MS = 8000;

/**
 * Escapa caracteres especiais HTML para evitar injeção ou quebra de marcação no parse_mode="HTML" do Telegram (SEC-11).
 */
export function escapeHtml(rawText: string): string {
  return rawText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Despachante resiliente de notificações para Telegram e WhatsApp (CallMeBot).
 *
 * Respeita Object Calisthenics:
 * - 0 variáveis de instância
 * - Sem a palavra-chave else
 * - 1 ponto por linha
 * - Nomes sem abreviação
 */
export class NotificationDispatcher {
  public async dispatchNotification(
    payload: NotificationPayload,
    config: NotificationConfig
  ): Promise<NotificationDispatchResult> {
    const isGloballyDisabled = config.isNotificationActive === false;
    if (isGloballyDisabled) {
      return {
        telegramSuccess: false,
        whatsappSuccess: false,
        summaryMessage: "Notificações desativadas nas configurações do usuário.",
      };
    }

    let telegramSuccess = false;
    let telegramError: string | undefined;
    const trimmedTelegramToken = config.telegramBotToken?.trim() ?? "";
    const trimmedTelegramChat = config.telegramChatId?.trim() ?? "";
    const hasTelegram = trimmedTelegramToken.length > 0 && trimmedTelegramChat.length > 0;
    if (hasTelegram) {
      const telegramResult = await this.dispatchTelegramOnly(
        payload,
        trimmedTelegramToken,
        trimmedTelegramChat
      );
      telegramSuccess = telegramResult.isSuccess;
      telegramError = telegramResult.errorMessage;
    }

    let whatsappSuccess = false;
    let whatsappError: string | undefined;
    const trimmedWhatsappPhone = config.whatsappPhoneNumber?.trim() ?? "";
    const trimmedWhatsappKey = config.whatsappApiKey?.trim() ?? "";
    const hasWhatsApp = trimmedWhatsappPhone.length > 0 && trimmedWhatsappKey.length > 0;
    if (hasWhatsApp) {
      const whatsappResult = await this.dispatchWhatsAppOnly(
        payload,
        trimmedWhatsappPhone,
        trimmedWhatsappKey
      );
      whatsappSuccess = whatsappResult.isSuccess;
      whatsappError = whatsappResult.errorMessage;
    }

    let webPushSuccess = false;
    let webPushError: string | undefined;
    let hasWebPush = false;

    const isAtsSwitchOrAlert =
      !payload.actionState ||
      payload.actionState === "SOLAR_BATTERY" ||
      payload.actionState === "GRID" ||
      payload.actionState === "ALERT";

    if (config.isWebPushActive !== false && isAtsSwitchOrAlert) {
      const pushResult = await this.dispatchWebPushOnly(payload, config);
      hasWebPush = true;
      webPushSuccess = pushResult.isSuccess;
      webPushError = pushResult.errorMessage;
    }

    const summary = this.buildSummary(
      hasTelegram,
      telegramSuccess,
      hasWhatsApp,
      whatsappSuccess,
      hasWebPush,
      webPushSuccess
    );

    return {
      telegramSuccess,
      telegramError,
      whatsappSuccess,
      whatsappError,
      webPushSuccess,
      webPushError,
      summaryMessage: summary,
    };
  }

  public async dispatchWebPushOnly(
    payload: NotificationPayload,
    config?: NotificationConfig
  ): Promise<{ isSuccess: boolean; errorMessage?: string; sentCount?: number }> {
    try {
      const pushService = WebPushService.getInstance();
      const pushPayload = {
        title: `⚡ [WattFlow] ${payload.title}`,
        message: payload.message,
        actionState: payload.actionState,
        batteryPercentage: payload.batteryPercentage,
        solarWatts: payload.solarWatts,
        timestamp: payload.timestamp ?? new Date(),
        url: "/",
        tag: `wattflow-${payload.actionState || "status"}`,
      };

      if (config?.webPushSubscriptions && config.webPushSubscriptions.length > 0) {
        let sent = 0;
        let lastErr: string | undefined;
        for (const sub of config.webPushSubscriptions) {
          const res = await pushService.sendNotification(sub, pushPayload);
          if (res.isSuccess) {
            sent += 1;
          } else {
            lastErr = res.errorMessage;
          }
        }
        return {
          isSuccess: sent > 0 || config.webPushSubscriptions.length === 0,
          errorMessage: sent === 0 && config.webPushSubscriptions.length > 0 ? lastErr : undefined,
          sentCount: sent,
        };
      }

      const broadcastResult = await pushService.broadcastNotification(pushPayload, config?.userId);
      return {
        isSuccess: broadcastResult.totalSent > 0 || broadcastResult.failed === 0,
        errorMessage:
          broadcastResult.failed > 0 && broadcastResult.totalSent === 0
            ? "Falha ao entregar notificação push aos dispositivos inscritos."
            : undefined,
        sentCount: broadcastResult.totalSent,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido ao despachar Web Push";
      return { isSuccess: false, errorMessage: msg };
    }
  }

  public async dispatchTelegramOnly(
    payload: NotificationPayload,
    botToken: string,
    chatId: string
  ): Promise<{ isSuccess: boolean; errorMessage?: string }> {
    const htmlText = this.buildFormattedMessage(payload);
    return this.sendTelegram(botToken, chatId, htmlText);
  }

  public async dispatchWhatsAppOnly(
    payload: NotificationPayload,
    phone: string,
    apiKey: string
  ): Promise<{ isSuccess: boolean; errorMessage?: string }> {
    const plainText = this.buildPlainText(payload);
    return this.sendWhatsAppCallMeBot(phone, apiKey, plainText);
  }

  private async sendTelegram(
    botToken: string,
    chatId: string,
    htmlText: string
  ): Promise<{ isSuccess: boolean; errorMessage?: string }> {
    try {
      const sanitizedToken = botToken.trim();
      if (!/^[0-9]+:[a-zA-Z0-9_-]+$/.test(sanitizedToken)) {
        return { isSuccess: false, errorMessage: "Token do bot do Telegram inválido." };
      }

      const endpoint = `https://api.telegram.org/bot${encodeURIComponent(sanitizedToken)}/sendMessage`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId.trim(),
          text: htmlText,
          parse_mode: "HTML",
        }),
        signal: AbortSignal.timeout(EXTERNAL_HTTP_TIMEOUT_MS),
      });

      const responseJson = (await response.json()) as { ok?: boolean; description?: string };
      if (!response.ok || !responseJson.ok) {
        return {
          isSuccess: false,
          errorMessage: responseJson.description || `Status HTTP ${response.status}`,
        };
      }

      return { isSuccess: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido ao chamar Telegram";
      return { isSuccess: false, errorMessage: msg };
    }
  }

  private async sendWhatsAppCallMeBot(
    phone: string,
    apiKey: string,
    plainText: string
  ): Promise<{ isSuccess: boolean; errorMessage?: string }> {
    try {
      const cleanPhone = phone.replace(/[^0-9]/g, "");
      const cleanApiKey = apiKey.trim();

      if (!/^\d{10,15}$/.test(cleanPhone)) {
        return {
          isSuccess: false,
          errorMessage: "Número de WhatsApp inválido (esperado entre 10 e 15 dígitos numéricos).",
        };
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(cleanApiKey)) {
        return {
          isSuccess: false,
          errorMessage: "API Key do CallMeBot contém caracteres inválidos.",
        };
      }

      const callMeBotUrl = new URL("https://api.callmebot.com/whatsapp.php");
      const searchParams = callMeBotUrl.searchParams;
      searchParams.set("phone", cleanPhone);
      searchParams.set("text", plainText);
      searchParams.set("apikey", cleanApiKey);

      const response = await fetch(callMeBotUrl.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "WattFlow-SecureNotifier/1.0",
        },
        signal: AbortSignal.timeout(EXTERNAL_HTTP_TIMEOUT_MS),
      });
      const textResponse = await response.text();

      const isSuccessful =
        response.ok &&
        (textResponse.includes("Message queued") ||
          textResponse.includes("Message sent") ||
          textResponse.includes("success"));

      if (!isSuccessful) {
        const strippedTags = textResponse.replace(/<[^>]*>/g, " ");
        const normalizedWhitespace = strippedTags.replace(/\s+/g, " ");
        const cleanErrorMessage = normalizedWhitespace.trim().slice(0, 160);

        return {
          isSuccess: false,
          errorMessage: cleanErrorMessage || `Status HTTP ${response.status}`,
        };
      }

      return { isSuccess: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido ao chamar CallMeBot WhatsApp";
      return { isSuccess: false, errorMessage: msg };
    }
  }

  private buildFormattedMessage(payload: NotificationPayload): string {
    const { title, message, batteryPercentage, solarWatts, actionState } = payload;
    const safeTitle = escapeHtml(String(title));
    const safeMessage = escapeHtml(String(message));
    const eventTime = escapeHtml(this.formatReadableTimestamp(payload.timestamp));

    let icon = "⚡";
    if (actionState === "SOLAR_BATTERY") {
      icon = "🟢";
    }
    if (actionState === "GRID") {
      icon = "🟡";
    }
    if (actionState === "ALERT") {
      icon = "🔴";
    }

    let result = `<b>${icon} [WattFlow] ${safeTitle}</b>\n\n${safeMessage}\n`;

    if (batteryPercentage !== undefined) {
      const safeBattery = escapeHtml(String(batteryPercentage));
      result += `\n🔋 <b>Bateria EcoFlow:</b> ${safeBattery}%`;
    }

    if (solarWatts !== undefined) {
      const safeSolar = escapeHtml(String(solarWatts));
      result += `\n☀️ <b>Geração Solar:</b> ${safeSolar} W`;
    }

    result += `\n🕒 <b>Horário do Disparo:</b> ${eventTime}`;
    result += `\n\n<i>WattFlow Automation • ATS Transfer</i>`;
    return result;
  }

  private buildPlainText(payload: NotificationPayload): string {
    const { title, message, batteryPercentage, solarWatts } = payload;
    const eventTime = this.formatReadableTimestamp(payload.timestamp);
    let result = `⚡ [WattFlow] ${title}\n\n${message}\n`;

    if (batteryPercentage !== undefined) {
      result += `\n🔋 Bateria EcoFlow: ${batteryPercentage}%`;
    }

    if (solarWatts !== undefined) {
      result += `\n☀️ Geração Solar: ${solarWatts} W`;
    }

    result += `\n🕒 Horário do Disparo: ${eventTime}`;
    result += `\n\nWattFlow Automation`;
    return result;
  }

  private formatReadableTimestamp(timestamp?: Date): string {
    const targetDate = timestamp ?? new Date();
    return targetDate.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  private buildSummary(
    hasTelegram: boolean,
    telegramOk: boolean,
    hasWhatsApp: boolean,
    whatsappOk: boolean,
    hasWebPush = false,
    webPushOk = false
  ): string {
    if (!hasTelegram && !hasWhatsApp && !hasWebPush) {
      return "Nenhum canal de notificação (Telegram ou WhatsApp) configurado.";
    }

    const parts: string[] = [];
    if (hasTelegram) {
      parts.push(telegramOk ? "Telegram: enviado" : "Telegram: falhou");
    }
    if (hasWhatsApp) {
      parts.push(whatsappOk ? "WhatsApp: enviado" : "WhatsApp: falhou");
    }
    if (hasWebPush) {
      parts.push(webPushOk ? "Web Push: enviado" : "Web Push: falhou");
    }
    return parts.join(" | ");
  }
}
