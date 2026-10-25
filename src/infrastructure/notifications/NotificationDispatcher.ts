export interface NotificationConfig {
  telegramBotToken?: string;
  telegramChatId?: string;
  whatsappPhoneNumber?: string;
  whatsappApiKey?: string;
  isNotificationActive?: boolean;
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
  summaryMessage: string;
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
    const hasTelegram = Boolean(config.telegramBotToken?.trim() && config.telegramChatId?.trim());
    if (hasTelegram) {
      const telegramResult = await this.dispatchTelegramOnly(
        payload,
        config.telegramBotToken!.trim(),
        config.telegramChatId!.trim()
      );
      telegramSuccess = telegramResult.isSuccess;
      telegramError = telegramResult.errorMessage;
    }

    let whatsappSuccess = false;
    let whatsappError: string | undefined;
    const hasWhatsApp = Boolean(config.whatsappPhoneNumber?.trim() && config.whatsappApiKey?.trim());
    if (hasWhatsApp) {
      const whatsappResult = await this.dispatchWhatsAppOnly(
        payload,
        config.whatsappPhoneNumber!.trim(),
        config.whatsappApiKey!.trim()
      );
      whatsappSuccess = whatsappResult.isSuccess;
      whatsappError = whatsappResult.errorMessage;
    }

    const summary = this.buildSummary(hasTelegram, telegramSuccess, hasWhatsApp, whatsappSuccess);

    return {
      telegramSuccess,
      telegramError,
      whatsappSuccess,
      whatsappError,
      summaryMessage: summary,
    };
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
      const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlText,
          parse_mode: "HTML",
        }),
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
      const encodedText = encodeURIComponent(plainText);
      const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodedText}&apikey=${apiKey}`;

      const response = await fetch(url, { method: "GET" });
      const textResponse = await response.text();

      const isSuccessful =
        response.ok &&
        (textResponse.includes("Message queued") ||
          textResponse.includes("Message sent") ||
          textResponse.includes("success"));

      if (!isSuccessful) {
        const cleanErrorMessage = textResponse
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);

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
    const eventTime = this.formatReadableTimestamp(payload.timestamp);

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

    let result = `<b>${icon} [WattFlow] ${title}</b>\n\n${message}`;

    if (batteryPercentage !== undefined) {
      result += `\n🔋 <b>Bateria EcoFlow:</b> ${batteryPercentage}%`;
    }

    if (solarWatts !== undefined) {
      result += `\n☀️ <b>Geração Solar:</b> ${solarWatts} W`;
    }

    result += `\n🕒 <b>Horário do Disparo:</b> ${eventTime}`;
    result += `\n\n<i>WattFlow Automation &bull; ATS Transfer</i>`;
    return result;
  }

  private buildPlainText(payload: NotificationPayload): string {
    const { title, message, batteryPercentage, solarWatts } = payload;
    const eventTime = this.formatReadableTimestamp(payload.timestamp);
    let result = `⚡ [WattFlow] ${title}\n\n${message}`;

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
    whatsappOk: boolean
  ): string {
    if (!hasTelegram && !hasWhatsApp) {
      return "Nenhum canal de notificação (Telegram ou WhatsApp) configurado.";
    }

    const parts: string[] = [];
    if (hasTelegram) {
      parts.push(`Telegram: ${telegramOk ? "Enviado com sucesso" : "Falha no envio"}`);
    }
    if (hasWhatsApp) {
      parts.push(`WhatsApp: ${whatsappOk ? "Enviado com sucesso" : "Falha no envio"}`);
    }

    return parts.join(" | ");
  }
}
