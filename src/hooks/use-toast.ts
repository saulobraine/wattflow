import * as React from "react";
import { toast as toastManager } from "@/components/ui/toast";

export type ToastVariant = "default" | "destructive" | "success";

export interface ToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

function dispatchToast({
  title,
  description,
  variant = "default",
  duration,
}: ToastInput) {
  const type =
    variant === "destructive"
      ? "error"
      : variant === "success"
        ? "success"
        : undefined;

  const id = toastManager.add({
    title,
    description,
    type,
    timeout: duration,
  });

  return {
    id,
    dismiss: () => toastManager.close(id),
  };
}

export const toast = Object.assign(dispatchToast, {
  add: toastManager.add,
  close: toastManager.close,
  update: toastManager.update,
  promise: toastManager.promise,
});

export function useToast() {
  return {
    toast: dispatchToast,
    dismiss: (id?: string) => {
      if (id) toastManager.close(id);
    },
  };
}
