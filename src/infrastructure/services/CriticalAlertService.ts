import {
  NotificationDispatcher,
  NotificationConfig,
  NotificationPayload,
  NotificationDispatchResult,
} from "../notifications/NotificationDispatcher";

export type CriticalAlertType =
  | "BLACKOUT_DETECTED"
  | "GRID_RESTORED"
  | "INVERTER_OVERLOAD"
  | "THERMAL_WARNING"
  | "THERMAL_CRITICAL"
  | "ATS_ANOMALY";

export interface CriticalAlertSettings {
  isAlertOnBlackout?: boolean;
  isAlertOnGridRestore?: boolean;
  isAlertOnOverload?: boolean;
  isAlertOnThermalRisk?: boolean;
  isAlertOnAtsFailure?: boolean;
  alertCooldownMinutes?: number;
  inverterMaxWatts?: number;
}

/**
 * Gerenciador Singleton de Alertas Críticos em Tempo Real com Trava Anti-Flood (SEC / Etapa 3).
 *
 * Características:
 * - Trava anti-flood em memória: previne spam de mensagens repetidas respeitando o cooldown configurado (default: 10m).
 * - Disparo multi-canal paralelo (WhatsApp CallMeBot + Telegram Bot).
 * - Resolução inteligente de cooldown: alertas de restauração resetam o alerta de falha correspondente.
 */
export class CriticalAlertService {
  private static instance: CriticalAlertService | null = null;
  private readonly lastAlertTimestamps = new Map<string, number>();
  private readonly dispatcher = new NotificationDispatcher();

  private constructor() {}

  public static getInstance(): CriticalAlertService {
    if (!CriticalAlertService.instance) {
      CriticalAlertService.instance = new CriticalAlertService();
    }
    return CriticalAlertService.instance;
  }

  public clearCooldownForTests(): void {
    this.lastAlertTimestamps.clear();
  }

  public resetCooldown(userId: string, alertType: CriticalAlertType): void {
    const key = `${userId}:${alertType}`;
    this.lastAlertTimestamps.delete(key);
  }

  public isAlertAllowedByConfig(
    alertType: CriticalAlertType,
    settings: CriticalAlertSettings
  ): boolean {
    switch (alertType) {
      case "BLACKOUT_DETECTED":
        return settings.isAlertOnBlackout !== false;
      case "GRID_RESTORED":
        return settings.isAlertOnGridRestore !== false;
      case "INVERTER_OVERLOAD":
        return settings.isAlertOnOverload !== false;
      case "THERMAL_WARNING":
      case "THERMAL_CRITICAL":
        return settings.isAlertOnThermalRisk !== false;
      case "ATS_ANOMALY":
        return settings.isAlertOnAtsFailure !== false;
      default:
        return true;
    }
  }

  public async dispatchAlert(
    userId: string,
    alertType: CriticalAlertType,
    payload: NotificationPayload,
    settings: CriticalAlertSettings,
    notificationConfig: NotificationConfig
  ): Promise<{ wasSent: boolean; isFlooded: boolean; result?: NotificationDispatchResult }> {
    const isAllowed = this.isAlertAllowedByConfig(alertType, settings);
    if (!isAllowed) {
      return { wasSent: false, isFlooded: false };
    }

    const key = `${userId}:${alertType}`;
    const now = Date.now();
    const cooldownMs = (settings.alertCooldownMinutes ?? 10) * 60 * 1000;
    const lastTimestamp = this.lastAlertTimestamps.get(key) ?? 0;

    if (now - lastTimestamp < cooldownMs) {
      return { wasSent: false, isFlooded: true };
    }

    // Registra timestamp para travar flood
    this.lastAlertTimestamps.set(key, now);

    // Resolução cruzada de cooldown
    if (alertType === "GRID_RESTORED") {
      this.resetCooldown(userId, "BLACKOUT_DETECTED");
    }
    if (alertType === "BLACKOUT_DETECTED") {
      this.resetCooldown(userId, "GRID_RESTORED");
    }

    try {
      const dispatchResult = await this.dispatcher.dispatchNotification(payload, notificationConfig);
      return { wasSent: true, isFlooded: false, result: dispatchResult };
    } catch (dispatchError: unknown) {
      console.error("[CriticalAlertService] Erro ao disparar alerta crítico:", dispatchError);
      return { wasSent: false, isFlooded: false };
    }
  }
}
