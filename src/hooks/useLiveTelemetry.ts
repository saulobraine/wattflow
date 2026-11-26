import { useEffect, useRef, useState, useCallback } from "react";

export type ConnectionStatus = "LIVE" | "POLLING" | "OFFLINE";

export interface LiveTelemetrySnapshot {
  batteryPercentage: number;
  solarInputWatts: number;
  outputWatts: number;
  isAcOutputEnabled: boolean | null;
  updatedAt: Date | string;
  batteryTempCelsius?: number | null;
  batteryTemperature?: number | null;
  batterySoh?: number | null;
  batteryCycles?: number | null;
  batteryVolts?: number | null;
  batteryAmps?: number | null;
  deviceMaxChargeSoc?: number | null;
  deviceMinDsgSoc?: number | null;
}

export interface UseLiveTelemetryOptions {
  enabled?: boolean;
  fallbackPollingIntervalMs?: number;
  streamUrl?: string;
  fallbackUrl?: string;
  fetchFn?: typeof fetch;
  eventSourceClass?: any;
  onTelemetry?: (snapshot: LiveTelemetrySnapshot) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
}

export interface UseLiveTelemetryResult {
  telemetry: LiveTelemetrySnapshot | null;
  connectionStatus: ConnectionStatus;
  lastUpdated: Date | null;
  isLive: boolean;
  reconnect: () => void;
}

/**
 * Controlador de EventSource e Fallback Polling para Telemetria em Tempo Real (SSE).
 * Suporta execução isolada para testes unitários, SSR e clients browser.
 */
export class LiveTelemetryController {
  private status: ConnectionStatus = "POLLING";
  private telemetry: LiveTelemetrySnapshot | null = null;
  private lastUpdated: Date | null = null;
  private eventSource: EventSource | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private isDestroyed = false;

  private readonly streamUrl: string;
  private readonly fallbackUrl: string;
  private readonly fallbackIntervalMs: number;
  private readonly enabled: boolean;
  private readonly fetchFn?: typeof fetch;
  private readonly eventSourceClass: any;
  private readonly onTelemetryCallback?: (snapshot: LiveTelemetrySnapshot) => void;
  private readonly onConnectionChangeCallback?: (status: ConnectionStatus) => void;
  private readonly onStateUpdate?: (
    telemetry: LiveTelemetrySnapshot | null,
    status: ConnectionStatus,
    lastUpdated: Date | null
  ) => void;

  constructor(
    options: UseLiveTelemetryOptions = {},
    onStateUpdate?: (
      telemetry: LiveTelemetrySnapshot | null,
      status: ConnectionStatus,
      lastUpdated: Date | null
    ) => void
  ) {
    this.streamUrl = options.streamUrl || "/api/telemetry/stream";
    this.fallbackUrl = options.fallbackUrl || "/api/dashboard-status";
    this.fallbackIntervalMs = options.fallbackPollingIntervalMs || 5000;
    this.enabled = options.enabled !== false;
    this.fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
    this.eventSourceClass = options.eventSourceClass || (typeof EventSource !== "undefined" ? EventSource : null);
    this.onTelemetryCallback = options.onTelemetry;
    this.onConnectionChangeCallback = options.onConnectionChange;
    this.onStateUpdate = onStateUpdate;

    const isOnline =
      typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
        ? navigator.onLine
        : true;

    this.status = isOnline ? "POLLING" : "OFFLINE";
  }

  private isOnline(): boolean {
    if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
      return navigator.onLine;
    }
    return true;
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public getTelemetry(): LiveTelemetrySnapshot | null {
    return this.telemetry;
  }

  public getLastUpdated(): Date | null {
    return this.lastUpdated;
  }

  public start(): void {
    if (!this.enabled || this.isDestroyed) return;

    this.attachNetworkListeners();

    if (!this.isOnline()) {
      this.updateStatus("OFFLINE");
      return;
    }

    this.connectSse();
  }

  public reconnect(): void {
    if (this.isDestroyed) return;
    this.cleanupSse();
    this.stopPolling();
    this.reconnectAttempts = 0;

    if (!this.isOnline()) {
      this.updateStatus("OFFLINE");
      return;
    }

    this.connectSse();
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.detachNetworkListeners();
    this.cleanupSse();
    this.stopPolling();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public handleNetworkChange(isOnline: boolean): void {
    if (this.isDestroyed) return;
    if (isOnline) {
      this.reconnect();
    } else {
      this.cleanupSse();
      this.stopPolling();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.updateStatus("OFFLINE");
    }
  }

  public handleVisibilityChange(isVisible: boolean): void {
    if (this.isDestroyed) return;
    if (isVisible && this.status !== "LIVE") {
      this.reconnect();
    }
  }

  private connectSse(): void {
    const ESClass = this.eventSourceClass;
    if (!ESClass) {
      // Sem suporte a EventSource -> comuta para polling
      this.activatePollingFallback();
      return;
    }

    try {
      this.cleanupSse();
      const es = new ESClass(this.streamUrl);
      this.eventSource = es;

      es.onopen = () => {
        if (this.isDestroyed) return;
        this.reconnectAttempts = 0;
        this.stopPolling();
        this.updateStatus("LIVE");
      };

      es.addEventListener("telemetry", (event: MessageEvent) => {
        if (this.isDestroyed) return;
        try {
          const snapshot = JSON.parse(event.data);
          this.handleNewSnapshot(snapshot);
          this.updateStatus("LIVE");
        } catch (err) {
          console.warn("[LiveTelemetry] Falha ao processar evento de telemetria:", err);
        }
      });

      es.onerror = () => {
        if (this.isDestroyed) return;
        this.cleanupSse();

        if (!this.isOnline()) {
          this.updateStatus("OFFLINE");
        } else {
          this.activatePollingFallback();
          this.scheduleSseReconnect();
        }
      };
    } catch (err) {
      console.warn("[LiveTelemetry] Erro ao instanciar EventSource:", err);
      this.activatePollingFallback();
      this.scheduleSseReconnect();
    }
  }

  private activatePollingFallback(): void {
    this.updateStatus("POLLING");
    this.startPolling();
  }

  private startPolling(): void {
    if (this.pollingTimer || this.isDestroyed) return;

    // Dispara primeira consulta imediatamente
    this.pollFallback();

    this.pollingTimer = setInterval(() => {
      if (this.isDestroyed) return;
      this.pollFallback();
    }, this.fallbackIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private async pollFallback(): Promise<void> {
    if (typeof this.fetchFn !== "function") return;

    try {
      const res = await this.fetchFn(`${this.fallbackUrl}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;

      const json = await res.json();
      if (json && json.data) {
        const d = json.data;
        const snapshot: LiveTelemetrySnapshot = {
          batteryPercentage: d.lastBatteryPercentage ?? 0,
          solarInputWatts: d.lastSolarWatts ?? 0,
          outputWatts: d.lastOutputWatts ?? 0,
          isAcOutputEnabled:
            d.lastAction === "ENABLE_ECOFLOW_AC" ||
            d.lastAction === "BATTERY_HIGH_DISCHARGE" ||
            (d.lastOutputWatts ?? 0) > 0,
          updatedAt: d.lastSyncTime ? new Date(d.lastSyncTime) : new Date(),
          deviceMaxChargeSoc: d.deviceMaxChargeSoc ?? null,
          deviceMinDsgSoc: d.deviceMinDsgSoc ?? null,
        };
        this.handleNewSnapshot(snapshot);
      }
    } catch {
      // Ignora falhas isoladas de polling
    }
  }

  private scheduleSseReconnect(): void {
    if (this.reconnectTimer || this.isDestroyed) return;

    // Backoff exponencial com teto de 15 segundos: 2s -> 4s -> 8s -> 15s (com jitter)
    const baseDelay = Math.min(15000, Math.pow(2, this.reconnectAttempts + 1) * 1000);
    const jitter = Math.floor(Math.random() * 500);
    const delay = baseDelay + jitter;
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isDestroyed) return;

      if (this.isOnline()) {
        this.connectSse();
      } else {
        this.updateStatus("OFFLINE");
      }
    }, delay);
  }

  private handleNewSnapshot(snapshot: LiveTelemetrySnapshot): void {
    if (snapshot) {
      if (snapshot.batteryTemperature === undefined && snapshot.batteryTempCelsius !== undefined) {
        snapshot.batteryTemperature = snapshot.batteryTempCelsius;
      }
      if (snapshot.batteryTempCelsius === undefined && snapshot.batteryTemperature !== undefined) {
        snapshot.batteryTempCelsius = snapshot.batteryTemperature;
      }
    }
    this.telemetry = snapshot;
    this.lastUpdated = new Date();
    this.onTelemetryCallback?.(snapshot);
    this.notifyState();
  }

  private updateStatus(newStatus: ConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.onConnectionChangeCallback?.(newStatus);
      this.notifyState();
    }
  }

  private notifyState(): void {
    this.onStateUpdate?.(this.telemetry, this.status, this.lastUpdated);
  }

  private cleanupSse(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private readonly handleOnline = (): void => {
    if (this.isDestroyed) return;
    this.reconnect();
  };

  private readonly handleOffline = (): void => {
    if (this.isDestroyed) return;
    this.cleanupSse();
    this.stopPolling();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.updateStatus("OFFLINE");
  };

  private readonly onDocumentVisibilityChange = (): void => {
    if (this.isDestroyed) return;
    if (typeof document !== "undefined") {
      this.handleVisibilityChange(document.visibilityState === "visible");
    }
  };

  private attachNetworkListeners(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    document.addEventListener("visibilitychange", this.onDocumentVisibilityChange);
  }

  private detachNetworkListeners(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    document.removeEventListener("visibilitychange", this.onDocumentVisibilityChange);
  }
}

/**
 * Hook Reativo para Telemetria em Tempo Real (SSE com Fallback para Polling).
 */
export function useLiveTelemetry(options: UseLiveTelemetryOptions = {}): UseLiveTelemetryResult {
  const [telemetry, setTelemetry] = useState<LiveTelemetrySnapshot | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("POLLING");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const controllerRef = useRef<LiveTelemetryController | null>(null);

  useEffect(() => {
    const controller = new LiveTelemetryController(options, (t, status, updated) => {
      setTelemetry(t);
      setConnectionStatus(status);
      setLastUpdated(updated);
    });

    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [options.enabled, options.streamUrl, options.fallbackUrl]);

  const reconnect = useCallback(() => {
    controllerRef.current?.reconnect();
  }, []);

  return {
    telemetry,
    connectionStatus,
    lastUpdated,
    isLive: connectionStatus === "LIVE",
    reconnect,
  };
}
