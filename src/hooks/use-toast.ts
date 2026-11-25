import * as React from "react";
import { toast as sonnerToast } from "sonner";

export type ToastVariant = "default" | "success" | "destructive";

export interface ToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

const DEFAULT_TOAST_DURATION = 5000;

export function toast({
  title,
  description,
  variant = "default",
  duration = DEFAULT_TOAST_DURATION,
}: ToastInput) {
  const message = title ?? description ?? "";
  const options = {
    description: title !== undefined ? description : undefined,
    duration,
  };

  let id: string | number;
  switch (variant) {
    case "success":
      id = sonnerToast.success(message, options);
      break;
    case "destructive":
      id = sonnerToast.error(message, options);
      break;
    default:
      id = sonnerToast(message, options);
      break;
  }

  return {
    id: String(id),
    dismiss: () => sonnerToast.dismiss(id),
  };
}

export function useToast() {
  return {
    toast,
    dismiss: (toastId?: string | number) => sonnerToast.dismiss(toastId),
  };
}
