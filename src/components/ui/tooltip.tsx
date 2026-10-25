import React, { createContext, useContext, useState, ReactNode } from "react";

interface TooltipContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  enabled?: boolean;
}

const TooltipContext = createContext<TooltipContextType | undefined>(undefined);

interface TooltipProviderProps {
  children: ReactNode;
  delayDuration?: number;
}

export function TooltipProvider({ children }: TooltipProviderProps) {
  return <>{children}</>;
}

interface TooltipRootProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  enabled?: boolean;
}

export function Tooltip({ children, enabled = true }: TooltipRootProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  return (
    <TooltipContext.Provider
      value={{
        open: internalOpen,
        setOpen: setInternalOpen,
        enabled,
      }}
    >
      <div
        className="relative inline-flex items-center justify-center"
        onMouseEnter={() => setInternalOpen(true)}
        onMouseLeave={() => setInternalOpen(false)}
        onFocus={() => setInternalOpen(true)}
        onBlur={() => setInternalOpen(false)}
      >
        {children}
      </div>
    </TooltipContext.Provider>
  );
}

interface TooltipTriggerProps {
  children: ReactNode;
  asChild?: boolean;
  className?: string;
}

export function TooltipTrigger({ children, className = "" }: TooltipTriggerProps) {
  return <div className={`inline-flex items-center justify-center ${className}`}>{children}</div>;
}

interface TooltipContentProps {
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  sideOffset?: number;
}

export function TooltipContent({
  children,
  side = "bottom",
  className = "",
}: TooltipContentProps) {
  const context = useContext(TooltipContext);

  if (!context || !context.open || context.enabled === false) {
    return null;
  }

  const sideClasses = {
    bottom: "top-full mt-2.5",
    top: "bottom-full mb-2.5",
    left: "right-full mr-2.5",
    right: "left-full ml-2.5",
  };

  const arrowClasses = {
    bottom: "-top-1 left-1/2 -translate-x-1/2 border-t border-l border-slate-700/80 bg-slate-900",
    top: "-bottom-1 left-1/2 -translate-x-1/2 border-b border-r border-slate-700/80 bg-slate-900",
    left: "-right-1 top-1/2 -translate-y-1/2 border-t border-r border-slate-700/80 bg-slate-900",
    right: "-left-1 top-1/2 -translate-y-1/2 border-b border-l border-slate-700/80 bg-slate-900",
  };

  return (
    <div
      role="tooltip"
      className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-slate-700/80 bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-slate-100 shadow-xl shadow-black/60 backdrop-blur-md transition-all duration-150 animate-in fade-in-0 zoom-in-95 ${sideClasses[side]} ${className}`}
    >
      {children}
      {/* Seta indicadora padrão shadcn */}
      <span className={`absolute w-1.5 h-1.5 rotate-45 ${arrowClasses[side]}`} aria-hidden="true" />
    </div>
  );
}
