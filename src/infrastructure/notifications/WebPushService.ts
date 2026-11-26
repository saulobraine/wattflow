import webpush from "web-push";
import { prisma } from "../database/prismaClient";

export interface WebPushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface WebPushSubscriptionData {
  endpoint: string;
  keys: WebPushSubscriptionKeys;
  userId?: string;
  expirationTime?: number | null;
}

export interface WebPushPayloadData {
  title: string;
  message: string;
  actionState?: "SOLAR_BATTERY" | "GRID" | "ALERT" | "INFO";
  batteryPercentage?: number;
  solarWatts?: number;
  timestamp?: Date | string;
  url?: string;
  tag?: string;
}

export interface SendPushResult {
  isSuccess: boolean;
  errorMessage?: string;
  statusCode?: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __wattflowVapidKeys: { publicKey: string; privateKey: string } | undefined;
  // eslint-disable-next-line no-var
  var __wattflowInMemorySubscriptions: Map<string, WebPushSubscriptionData> | undefined;
}

/**
 * Serviço de Gerenciamento e Disparo de Notificações Web Push (VAPID / RFC 8292).
 * Fornece armazenamento híbrido resiliente (Prisma com fallback em memória para desenvolvimento e testes).
 */
export class WebPushService {
  private static instance: WebPushService | null = null;
  private readonly defaultVapidSubject = "mailto:admin@wattflow.local";

  public static getInstance(): WebPushService {
    if (!WebPushService.instance) {
      WebPushService.instance = new WebPushService();
    }
    return WebPushService.instance;
  }

  public getVapidKeys(): { publicKey: string; privateKey: string } {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      return {
        publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
        privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
      };
    }

    if (globalThis.__wattflowVapidKeys) {
      return globalThis.__wattflowVapidKeys;
    }

    const generated = webpush.generateVAPIDKeys();
    globalThis.__wattflowVapidKeys = generated;
    return generated;
  }

  public getPublicKey(): string {
    return this.getVapidKeys().publicKey;
  }

  private configureVapid(): void {
    const keys = this.getVapidKeys();
    const subject = process.env.VAPID_SUBJECT?.trim() || this.defaultVapidSubject;
    webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  }

  private getInMemorySubscriptions(): Map<string, WebPushSubscriptionData> {
    if (!globalThis.__wattflowInMemorySubscriptions) {
      globalThis.__wattflowInMemorySubscriptions = new Map();
    }
    return globalThis.__wattflowInMemorySubscriptions;
  }

  public async saveSubscription(subscription: WebPushSubscriptionData, userId?: string): Promise<void> {
    const memoryMap = this.getInMemorySubscriptions();
    const normalizedUserId = userId || subscription.userId;

    memoryMap.set(subscription.endpoint, {
      ...subscription,
      userId: normalizedUserId,
    });

    try {
      if (prisma && prisma.webPushSubscription) {
        await prisma.webPushSubscription.upsert({
          where: { endpoint: subscription.endpoint },
          create: {
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            userId: normalizedUserId || null,
          },
          update: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            userId: normalizedUserId || null,
          },
        });
      }
    } catch {
      // Falha silenciosa para fallback gracioso em memória caso o banco não tenha a tabela ainda
    }
  }

  public async removeSubscription(endpoint: string): Promise<void> {
    const memoryMap = this.getInMemorySubscriptions();
    memoryMap.delete(endpoint);

    try {
      if (prisma && prisma.webPushSubscription) {
        await prisma.webPushSubscription.deleteMany({
          where: { endpoint },
        });
      }
    } catch {
      // Ignora erro no fallback
    }
  }

  public async getSubscriptions(userId?: string): Promise<WebPushSubscriptionData[]> {
    const memoryMap = this.getInMemorySubscriptions();
    const memorySubscriptions = Array.from(memoryMap.values());

    let dbSubscriptions: WebPushSubscriptionData[] = [];
    try {
      if (prisma && prisma.webPushSubscription) {
        const queryWhere = userId ? { userId } : {};
        const records = await prisma.webPushSubscription.findMany({
          where: queryWhere,
        });

        dbSubscriptions = records.map((record) => ({
          endpoint: record.endpoint,
          keys: {
            p256dh: record.p256dh,
            auth: record.auth,
          },
          userId: record.userId || undefined,
        }));
      }
    } catch {
      // Fallback em memória
    }

    const mergedMap = new Map<string, WebPushSubscriptionData>();
    for (const sub of memorySubscriptions) {
      if (!userId || sub.userId === userId) {
        mergedMap.set(sub.endpoint, sub);
      }
    }
    for (const sub of dbSubscriptions) {
      mergedMap.set(sub.endpoint, sub);
    }

    return Array.from(mergedMap.values());
  }

  public async sendNotification(
    subscription: WebPushSubscriptionData,
    payload: WebPushPayloadData
  ): Promise<SendPushResult> {
    this.configureVapid();

    const pushPayloadString = JSON.stringify({
      title: payload.title,
      body: payload.message,
      message: payload.message,
      icon: "/icons/icon-192.png",
      badge: "/favicon.svg",
      tag: payload.tag || "wattflow-ats-switch",
      data: {
        url: payload.url || "/",
        actionState: payload.actionState,
        batteryPercentage: payload.batteryPercentage,
        solarWatts: payload.solarWatts,
        timestamp: payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString(),
      },
    });

    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    };

    try {
      const response = await webpush.sendNotification(pushSubscription, pushPayloadString, {
        TTL: 60 * 60, // 1 hora de retenção
        urgency: payload.actionState === "ALERT" ? "high" : "normal",
      });

      return {
        isSuccess: true,
        statusCode: response.statusCode,
      };
    } catch (error: unknown) {
      const webPushError = error as { statusCode?: number; message?: string };
      const statusCode = webPushError.statusCode;
      const errorMessage = webPushError.message || "Erro desconhecido ao enviar Web Push";

      // Se a subscrição expirou ou foi cancelada no browser (404/410), faz limpeza automática
      if (statusCode === 404 || statusCode === 410) {
        await this.removeSubscription(subscription.endpoint);
      }

      return {
        isSuccess: false,
        statusCode,
        errorMessage,
      };
    }
  }

  public async broadcastNotification(
    payload: WebPushPayloadData,
    userId?: string
  ): Promise<{ totalSent: number; failed: number }> {
    const subscriptions = await this.getSubscriptions(userId);
    if (subscriptions.length === 0) {
      return { totalSent: 0, failed: 0 };
    }

    let totalSent = 0;
    let failed = 0;

    const promises = subscriptions.map(async (subscription) => {
      const result = await this.sendNotification(subscription, payload);
      if (result.isSuccess) {
        totalSent += 1;
      }
      if (!result.isSuccess) {
        failed += 1;
      }
    });

    await Promise.allSettled(promises);
    return { totalSent, failed };
  }
}
