import React from "react";
import { X } from "lucide-react";

export type ToastVariant = "default" | "success" | "destructive";

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: ToastVariant;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const variantClasses: Record<ToastVariant, string> = {
  default:
    "border-slate-700/80 bg-slate-900/95 text-slate-100 shadow-black/60",
  success:
    "border-emerald-500/40 bg-slate-900/95 text-emerald-100 shadow-emerald-950/40",
  destructive:
    "border-rose-500/40 bg-slate-900/95 text-rose-100 shadow-rose-950/40",
};

export const ToastViewport = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    aria-label="Notificações"
    className={`pointer-events-none fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-4 sm:right-4 sm:top-auto sm:flex-col md:max-w-[420px] ${className}`}
    {...props}
  />
));
ToastViewport.displayName = "ToastViewport";

export const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ className = "", variant = "default", open = true, children, ...props }, ref) => {
    if (!open) return null;

    return (
      <div
        ref={ref}
        role={variant === "destructive" ? "alert" : "status"}
        aria-live={variant === "destructive" ? "assertive" : "polite"}
        data-variant={variant}
        className={`pointer-events-auto group relative flex w-full items-start gap-3 overflow-hidden rounded-xl border p-4 pr-9 shadow-2xl backdrop-blur-md transition-all duration-200 animate-fade-in ${variantClasses[variant]} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Toast.displayName = "Toast";

export const ToastTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={`text-sm font-semibold leading-tight tracking-tight ${className}`}
    {...props}
  />
));
ToastTitle.displayName = "ToastTitle";

export const ToastDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={`text-xs leading-relaxed opacity-90 ${className}`}
    {...props}
  />
));
ToastDescription.displayName = "ToastDescription";

export const ToastClose = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className = "", onClick, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label="Fechar notificação"
    onClick={onClick}
    className={`absolute right-2.5 top-2.5 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800/80 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500/50 cursor-pointer ${className}`}
    {...props}
  >
    <X className="h-4 w-4" aria-hidden="true" />
  </button>
));
ToastClose.displayName = "ToastClose";
