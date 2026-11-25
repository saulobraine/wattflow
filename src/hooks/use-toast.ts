import * as React from "react";
import type { ToastVariant } from "../components/ui/toast";

const TOAST_LIMIT = 4;
const DEFAULT_TOAST_DURATION = 5000;

export interface ToasterToast {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
  open?: boolean;
}

type ToastInput = Omit<ToasterToast, "id" | "open">;

interface State {
  toasts: ToasterToast[];
}

type Action =
  | { type: "ADD_TOAST"; toast: ToasterToast }
  | { type: "UPDATE_TOAST"; toast: Partial<ToasterToast> & { id: string } }
  | { type: "DISMISS_TOAST"; toastId?: string }
  | { type: "REMOVE_TOAST"; toastId?: string };

let count = 0;

function genId(): string {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function clearToastTimeout(toastId: string) {
  const existing = toastTimeouts.get(toastId);
  if (existing) {
    clearTimeout(existing);
    toastTimeouts.delete(toastId);
  }
}

function scheduleAutoDismiss(toastId: string, duration: number) {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(duration) || duration <= 0) return;

  clearToastTimeout(toastId);
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({ type: "REMOVE_TOAST", toastId });
  }, duration);

  toastTimeouts.set(toastId, timeout);
}

const listeners: Array<(state: State) => void> = [];
let memoryState: State = { toasts: [] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case "DISMISS_TOAST": {
      const { toastId } = action;
      if (toastId) {
        clearToastTimeout(toastId);
        return {
          ...state,
          toasts: state.toasts.filter((t) => t.id !== toastId),
        };
      }
      state.toasts.forEach((t) => clearToastTimeout(t.id));
      return {
        ...state,
        toasts: [],
      };
    }

    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return { ...state, toasts: [] };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
}

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

export function toast({
  duration = DEFAULT_TOAST_DURATION,
  variant = "default",
  ...props
}: ToastInput) {
  const id = genId();

  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });
  const update = (nextProps: Partial<ToasterToast>) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...nextProps, id },
    });

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      variant,
      duration,
      open: true,
    },
  });

  scheduleAutoDismiss(id, duration);

  return {
    id,
    dismiss,
    update,
  };
}

export function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}
