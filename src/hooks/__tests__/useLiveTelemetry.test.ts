import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LiveTelemetryController,
  type LiveTelemetrySnapshot,
  type ConnectionStatus,
} from "../useLiveTelemetry";

describe("LiveTelemetryController (SSE & Fallback Polling State Machine)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("inicializa em POLLING quando está online mas sem EventSource", () => {
    const controller = new LiveTelemetryController({
      fallbackPollingIntervalMs: 5000,
      eventSourceClass: null,
    });

    expect(controller.getStatus()).toBe("POLLING");
    expect(controller.getTelemetry()).toBeNull();
  });

  it("detecta rede offline e transita para o estado OFFLINE", () => {
    const statusHistory: ConnectionStatus[] = [];
    const controller = new LiveTelemetryController(
      { eventSourceClass: null },
      (_telemetry, status) => statusHistory.push(status)
    );

    controller.start();
    controller.handleNetworkChange(false);

    expect(controller.getStatus()).toBe("OFFLINE");
    controller.destroy();
  });

  it("recupera para POLLING ou reconecta ao restabelecer rede online", () => {
    const controller = new LiveTelemetryController({ eventSourceClass: null });
    controller.start();

    controller.handleNetworkChange(false);
    expect(controller.getStatus()).toBe("OFFLINE");

    controller.handleNetworkChange(true);
    expect(controller.getStatus()).toBe("POLLING");

    controller.destroy();
  });

  it("conecta a EventSource mock e transita para LIVE ao abrir conexão", () => {
    let telemetryHandler: ((event: { data: string }) => void) | null = null;

    class MockEventSource {
      public onopen: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      private listeners: Record<string, ((e: any) => void)[]> = {};

      constructor() {
        setTimeout(() => {
          if (this.onopen) this.onopen();
        }, 10);
      }

      public addEventListener(type: string, fn: (e: any) => void) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(fn);
        if (type === "telemetry") telemetryHandler = fn;
      }

      public close() {}
    }

    const updates: ConnectionStatus[] = [];
    const snapshots: LiveTelemetrySnapshot[] = [];

    const controller = new LiveTelemetryController(
      {
        eventSourceClass: MockEventSource,
      },
      (telemetry, status) => {
        updates.push(status);
        if (telemetry) snapshots.push(telemetry);
      }
    );

    controller.start();

    // Avança 15ms para o setTimeout do MockEventSource disparar onopen
    vi.advanceTimersByTime(20);

    expect(controller.getStatus()).toBe("LIVE");

    // Simula evento 'telemetry' recebido via SSE
    if (telemetryHandler) {
      (telemetryHandler as any)({
        data: JSON.stringify({
          batteryPercentage: 92,
          solarInputWatts: 750,
          outputWatts: 300,
          isAcOutputEnabled: true,
          updatedAt: new Date().toISOString(),
        }),
      });
    }

    expect(controller.getTelemetry()?.solarInputWatts).toBe(750);
    expect(controller.getTelemetry()?.batteryPercentage).toBe(92);

    controller.destroy();
  });

  it("executa fallback polling chamando fetch periodicamente", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          lastBatteryPercentage: 88,
          lastSolarWatts: 450,
          lastOutputWatts: 200,
          lastAction: "BATTERY_HIGH_DISCHARGE",
          lastSyncTime: new Date().toISOString(),
        },
      }),
    });

    const snapshots: LiveTelemetrySnapshot[] = [];
    const controller = new LiveTelemetryController(
      {
        fallbackPollingIntervalMs: 3000,
        eventSourceClass: null,
        fetchFn: mockFetch as any,
      },
      (telemetry) => {
        if (telemetry) snapshots.push(telemetry);
      }
    );

    controller.start();

    // Primeiro poll imediato
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    // Segundo poll após 3 segundos
    vi.advanceTimersByTime(3000);
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    controller.destroy();
  });
});
