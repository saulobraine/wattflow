"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import {
  AlertCircle,
  AlertTriangle,
  CircleCheck,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const toast = ToastPrimitive.createToastManager();
const { createToastManager, useToastManager } = ToastPrimitive;

function mergeClassName<State>(
  base: string,
  className?: string | ((state: State) => string | undefined)
) {
  if (typeof className === "function") {
    return (state: State) => cn(base, className(state));
  }
  return cn(base, className);
}

function ToastProvider({
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Provider>) {
  return <ToastPrimitive.Provider {...props} />;
}

function ToastPortal({
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Portal>) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={mergeClassName(
        "pointer-events-none fixed inset-x-4 bottom-4 z-[100] mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full",
        className
      )}
      {...props}
    />
  );
}

function Toast({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root>) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={mergeClassName(
        "cn-toast group/toast pointer-events-auto absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom rounded-xl border border-slate-800 bg-slate-900/95 text-slate-100 shadow-xl backdrop-blur-md transition-all duration-300 ease-out select-none [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-var(--toast-index)*0.75rem))_scale(calc(1-var(--toast-index)*0.04))] data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:[transform:translateY(1rem)] data-[limited]:opacity-0 data-[expanded]:[transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-offset-y)*-1+var(--toast-index)*-0.75rem+var(--toast-swipe-movement-y)))]",
        className
      )}
      {...props}
    />
  );
}

function ToastContent({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Content>) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={mergeClassName(
        "flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity duration-200 data-[behind]:opacity-0 data-[expanded]:opacity-100",
        className
      )}
      {...props}
    />
  );
}

function ToastTitle({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Title>) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={mergeClassName("text-sm font-semibold text-slate-100", className)}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={mergeClassName(
        "text-xs leading-relaxed text-slate-400",
        className
      )}
      {...props}
    />
  );
}

function ToastAction({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Action>) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      className={mergeClassName(
        "inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer",
        className
      )}
      {...props}
    />
  );
}

function ToastClose({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Close>) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Fechar notificação"
      className={mergeClassName(
        "ml-auto inline-flex shrink-0 items-center justify-center rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500/50 cursor-pointer",
        className
      )}
      {...props}
    >
      {children ?? (
        <X className="h-4 w-4 text-slate-400 transition-colors hover:text-slate-100" />
      )}
    </ToastPrimitive.Close>
  );
}

function ToastIcon({ type }: { type?: string }) {
  switch (type) {
    case "success":
      return <CircleCheck className="h-5 w-5 shrink-0 text-emerald-400" />;
    case "error":
      return <AlertCircle className="h-5 w-5 shrink-0 text-rose-400" />;
    case "warning":
      return <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />;
    case "info":
      return <Info className="h-5 w-5 shrink-0 text-cyan-400" />;
    case "loading":
      return (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-cyan-400" />
      );
    default:
      return null;
  }
}

function ToastList() {
  const { toasts } = useToastManager();

  return toasts.map((toastItem) => (
    <Toast key={toastItem.id} toast={toastItem}>
      <ToastContent>
        <ToastIcon type={toastItem.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {toastItem.title && <ToastTitle>{toastItem.title}</ToastTitle>}
          {toastItem.description && (
            <ToastDescription>{toastItem.description}</ToastDescription>
          )}
        </div>
        {toastItem.actionProps && <ToastAction {...toastItem.actionProps} />}
        <ToastClose />
      </ToastContent>
    </Toast>
  ));
}

export function Toaster({
  children,
  toastManager = toast,
  ...props
}: ToastPrimitive.Provider.Props) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

export {
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
};
