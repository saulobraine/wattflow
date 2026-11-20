import { useEffect, useRef, useState, useCallback } from "react";

export interface VisibilityPollingOptions {
  pollingIntervalMs: number;
  onPoll: () => Promise<void> | void;
  enabled?: boolean;
}

export interface VisibilityPollingState {
  isPolling: boolean;
  isTabVisible: boolean;
  isOnline: boolean;
}

/**
 * Controlador de ciclo de vida e eventos de visibilidade/rede.
 * Opera de forma desacoplada para suportar execução segura no browser, SSR e testes unitários.
 */
export class VisibilityPollingController {
  private isTabVisible: boolean;
  private isOnline: boolean;
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly options: VisibilityPollingOptions;
  private readonly onStateChange?: (state: VisibilityPollingState) => void;

  constructor(
    options: VisibilityPollingOptions,
    onStateChange?: (state: VisibilityPollingState) => void
  ) {
    this.options = options;
    this.onStateChange = onStateChange;

    const docVisible =
      typeof document !== "undefined" && typeof document.visibilityState === "string"
        ? document.visibilityState === "visible"
        : true;
    const navOnline =
      typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
        ? navigator.onLine
        : true;

    this.isTabVisible = Boolean(docVisible);
    this.isOnline = Boolean(navOnline);
  }

  public getState(): VisibilityPollingState {
    const isPolling = (this.options.enabled !== false) && this.isTabVisible && this.isOnline;
    return {
      isPolling,
      isTabVisible: this.isTabVisible,
      isOnline: this.isOnline,
    };
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.attachDomListeners();
    this.evaluateTimer();
    this.notifyState();
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    this.detachDomListeners();
    this.clearTimer();
    this.notifyState();
  }

  public handleVisibilityChange(visible: boolean): void {
    const wasVisible = this.isTabVisible;
    this.isTabVisible = visible;
    this.notifyState();

    if (!wasVisible && visible && this.isOnline && this.options.enabled !== false) {
      this.triggerPoll();
    }

    this.evaluateTimer();
  }

  public handleOnlineStatus(online: boolean): void {
    const wasOnline = this.isOnline;
    this.isOnline = online;
    this.notifyState();

    if (!wasOnline && online && this.isTabVisible && this.options.enabled !== false) {
      this.triggerPoll();
    }

    this.evaluateTimer();
  }

  public triggerPoll(): void {
    try {
      const result = this.options.onPoll();
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch((err: unknown) => {
          console.error("[VisibilityPollingController] Erro assíncrono em onPoll:", err);
        });
      }
    } catch (err: unknown) {
      console.error("[VisibilityPollingController] Erro síncrono em onPoll:", err);
    }
  }

  private evaluateTimer(): void {
    this.clearTimer();

    const state = this.getState();
    if (!this.isRunning || !state.isPolling || this.options.pollingIntervalMs <= 0) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.triggerPoll();
    }, this.options.pollingIntervalMs);
  }

  private clearTimer(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private notifyState(): void {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  private onVisibilityEvent = () => {
    if (typeof document !== "undefined") {
      this.handleVisibilityChange(document.visibilityState === "visible");
    }
  };

  private onOnlineEvent = () => {
    this.handleOnlineStatus(true);
  };

  private onOfflineEvent = () => {
    this.handleOnlineStatus(false);
  };

  private attachDomListeners(): void {
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.onVisibilityEvent);
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", this.onOnlineEvent);
      window.addEventListener("offline", this.onOfflineEvent);
    }
  }

  private detachDomListeners(): void {
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.onVisibilityEvent);
    }
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("online", this.onOnlineEvent);
      window.removeEventListener("offline", this.onOfflineEvent);
    }
  }
}

/**
 * Hook reativo para polling eficiente com suspensão automática de bateria/dados:
 * - Suspende a execução de `setInterval` quando o documento estiver oculto (aba minimizada/segundo plano)
 *   ou quando a conexão de rede for interrompida (offline).
 * - Dispara `onPoll()` imediatamente assim que o app voltar a ser visível e online para reidratar os dados.
 */
export function useVisibilityPolling({
  pollingIntervalMs,
  onPoll,
  enabled = true,
}: VisibilityPollingOptions): VisibilityPollingState {
  const [state, setState] = useState<VisibilityPollingState>(() => {
    const isTabVisible =
      typeof document !== "undefined" && typeof document.visibilityState === "string"
        ? document.visibilityState === "visible"
        : true;
    const isOnline =
      typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
        ? navigator.onLine
        : true;
    return {
      isPolling: (enabled !== false) && Boolean(isTabVisible) && Boolean(isOnline),
      isTabVisible: Boolean(isTabVisible),
      isOnline: Boolean(isOnline),
    };
  });

  const onPollRef = useRef(onPoll);
  useEffect(() => {
    onPollRef.current = onPoll;
  }, [onPoll]);

  const handlePoll = useCallback(() => {
    return onPollRef.current();
  }, []);

  useEffect(() => {
    const controller = new VisibilityPollingController(
      {
        pollingIntervalMs,
        onPoll: handlePoll,
        enabled,
      },
      (newState) => {
        setState(newState);
      }
    );

    controller.start();
    return () => {
      controller.stop();
    };
  }, [pollingIntervalMs, enabled, handlePoll]);

  return state;
}
