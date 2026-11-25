import React from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useToast } from "../../hooks/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
  type ToastVariant,
} from "./toast";

function renderVariantIcon(variant: ToastVariant = "default") {
  switch (variant) {
    case "success":
      return (
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
          aria-hidden="true"
        />
      );
    case "destructive":
      return (
        <AlertCircle
          className="mt-0.5 h-4 w-4 shrink-0 text-rose-400"
          aria-hidden="true"
        />
      );
    default:
      return (
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
          aria-hidden="true"
        />
      );
  }
}

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastViewport>
      {toasts.map(({ id, title, description, variant = "default", open = true }) => (
        <Toast key={id} variant={variant} open={open}>
          {renderVariantIcon(variant)}
          <div className="grid flex-1 gap-1">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          <ToastClose onClick={() => dismiss(id)} />
        </Toast>
      ))}
    </ToastViewport>
  );
}
