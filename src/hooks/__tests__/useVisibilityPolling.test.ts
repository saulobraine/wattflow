import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  VisibilityPollingController,
  VisibilityPollingState,
} from "../useVisibilityPolling";

describe("VisibilityPollingController (Otimização de Bateria e Polling Inteligente)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("inicia o polling periódico quando está ativo, visível e online", () => {
    const onPollMock = vi.fn();
    const stateUpdates: VisibilityPollingState[] = [];

    const controller = new VisibilityPollingController(
      {
        pollingIntervalMs: 2000,
        onPoll: onPollMock,
        enabled: true,
      },
      (state) => stateUpdates.push(state)
    );

    controller.start();

    const initialState = controller.getState();
    expect(initialState.isPolling).toBe(true);
    expect(initialState.isTabVisible).toBe(true);
    expect(initialState.isOnline).toBe(true);
    expect(onPollMock).not.toHaveBeenCalled();

    // Avança 2 segundos -> primeiro poll disparado
    vi.advanceTimersByTime(2000);
    expect(onPollMock).toHaveBeenCalledTimes(1);

    // Avança mais 4 segundos -> mais 2 polls
    vi.advanceTimersByTime(4000);
    expect(onPollMock).toHaveBeenCalledTimes(3);

    controller.stop();
  });

  it("suspende o timer de polling quando a aba é ocultada (visibilityState === 'hidden')", () => {
    const onPollMock = vi.fn();

    const controller = new VisibilityPollingController({
      pollingIntervalMs: 2000,
      onPoll: onPollMock,
      enabled: true,
    });

    controller.start();

    // Simula aba minimizada / segundo plano
    controller.handleVisibilityChange(false);

    expect(controller.getState().isTabVisible).toBe(false);
    expect(controller.getState().isPolling).toBe(false);

    // Avança 10 segundos em segundo plano: NENHUM poll deve ser disparado
    vi.advanceTimersByTime(10000);
    expect(onPollMock).not.toHaveBeenCalled();

    controller.stop();
  });

  it("dispara onPoll() imediatamente assim que a aba volta a ser visível (reidratação de dados)", () => {
    const onPollMock = vi.fn();

    const controller = new VisibilityPollingController({
      pollingIntervalMs: 2000,
      onPoll: onPollMock,
      enabled: true,
    });

    controller.start();

    // Oculta
    controller.handleVisibilityChange(false);
    expect(onPollMock).not.toHaveBeenCalled();

    // Retorna para visível
    controller.handleVisibilityChange(true);

    // Deve ter disparado imediatamente
    expect(onPollMock).toHaveBeenCalledTimes(1);

    // E continua o timer normal após 2 segundos
    vi.advanceTimersByTime(2000);
    expect(onPollMock).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it("suspende o timer quando o dispositivo fica offline e dispara imediatamente ao reconectar", () => {
    const onPollMock = vi.fn();

    const controller = new VisibilityPollingController({
      pollingIntervalMs: 2000,
      onPoll: onPollMock,
      enabled: true,
    });

    controller.start();

    // Dispositivo fica offline
    controller.handleOnlineStatus(false);
    expect(controller.getState().isOnline).toBe(false);
    expect(controller.getState().isPolling).toBe(false);

    vi.advanceTimersByTime(6000);
    expect(onPollMock).not.toHaveBeenCalled();

    // Conexão restabelecida
    controller.handleOnlineStatus(true);
    expect(controller.getState().isOnline).toBe(true);
    expect(controller.getState().isPolling).toBe(true);
    expect(onPollMock).toHaveBeenCalledTimes(1);

    controller.stop();
  });

  it("não executa polling quando enabled é falso", () => {
    const onPollMock = vi.fn();

    const controller = new VisibilityPollingController({
      pollingIntervalMs: 2000,
      onPoll: onPollMock,
      enabled: false,
    });

    controller.start();
    expect(controller.getState().isPolling).toBe(false);

    vi.advanceTimersByTime(4000);
    expect(onPollMock).not.toHaveBeenCalled();

    controller.stop();
  });
});
