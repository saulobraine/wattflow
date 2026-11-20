import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EcoFlowMqttStreamService,
  type LiveTelemetrySnapshot,
} from "../EcoFlowMqttStreamService";

describe("EcoFlowMqttStreamService Event Bridge (SSE Live-Sync)", () => {
  let service: EcoFlowMqttStreamService;

  beforeEach(() => {
    service = EcoFlowMqttStreamService.getInstance();
    service.stopStream(); // limpa clientes e streams
  });

  const sampleSnapshot: LiveTelemetrySnapshot = {
    batteryPercentage: 88,
    solarInputWatts: 750,
    outputWatts: 300,
    isAcOutputEnabled: true,
    updatedAt: new Date(),
    batteryTempCelsius: 31.5,
    batterySoh: 99,
    batteryCycles: 42,
  };

  it("registra listener para um usuário e recebe snapshots via broadcastTelemetry", () => {
    const receivedSnapshots: LiveTelemetrySnapshot[] = [];

    const unsubscribe = service.subscribeTelemetry("user-event-1", (snap) => {
      receivedSnapshots.push(snap);
    });

    expect(service.getActiveListenersCount("user-event-1")).toBe(1);

    service.broadcastTelemetry("user-event-1", sampleSnapshot);

    expect(receivedSnapshots).toHaveLength(1);
    expect(receivedSnapshots[0].batteryPercentage).toBe(88);
    expect(receivedSnapshots[0].solarInputWatts).toBe(750);

    unsubscribe();
    expect(service.getActiveListenersCount("user-event-1")).toBe(0);

    // Novo broadcast após desinscrição não deve chamar o listener
    service.broadcastTelemetry("user-event-1", {
      ...sampleSnapshot,
      batteryPercentage: 90,
    });
    expect(receivedSnapshots).toHaveLength(1);
  });

  it("garante isolamento estrito multi-tenant no broadcast (user-A não recebe de user-B)", () => {
    const snapshotsA: LiveTelemetrySnapshot[] = [];
    const snapshotsB: LiveTelemetrySnapshot[] = [];

    const unsubA = service.subscribeTelemetry("user-A", (s) => snapshotsA.push(s));
    const unsubB = service.subscribeTelemetry("user-B", (s) => snapshotsB.push(s));

    service.broadcastTelemetry("user-A", sampleSnapshot);

    expect(snapshotsA).toHaveLength(1);
    expect(snapshotsB).toHaveLength(0);

    const snapshotB: LiveTelemetrySnapshot = {
      ...sampleSnapshot,
      batteryPercentage: 55,
      solarInputWatts: 1200,
    };

    service.broadcastTelemetry("user-B", snapshotB);

    expect(snapshotsA).toHaveLength(1);
    expect(snapshotsB).toHaveLength(1);
    expect(snapshotsB[0].batteryPercentage).toBe(55);

    unsubA();
    unsubB();
  });

  it("isola exceções lançadas por um listener para não afetar os demais", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const healthySnapshots: LiveTelemetrySnapshot[] = [];

    const unsubFaulty = service.subscribeTelemetry("user-fault-test", () => {
      throw new Error("Simulated listener crash");
    });

    const unsubHealthy = service.subscribeTelemetry("user-fault-test", (s) => {
      healthySnapshots.push(s);
    });

    service.broadcastTelemetry("user-fault-test", sampleSnapshot);

    expect(healthySnapshots).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[EcoFlow SSE] Erro ao notificar listener para user=user-fault-test:"),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
    unsubFaulty();
    unsubHealthy();
  });

  it("expurga a chave do Map de listeners quando o último unsubscribe é acionado", () => {
    const unsub1 = service.subscribeTelemetry("user-cleanup", () => {});
    const unsub2 = service.subscribeTelemetry("user-cleanup", () => {});

    expect(service.getActiveListenersCount("user-cleanup")).toBe(2);

    unsub1();
    expect(service.getActiveListenersCount("user-cleanup")).toBe(1);

    unsub2();
    expect(service.getActiveListenersCount("user-cleanup")).toBe(0);
  });
});
