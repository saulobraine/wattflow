export interface AtsHealthTheme {
  text: string;
  bar: string;
  barGradient: string;
  badge: string;
  dot: string;
}

export interface AtsStatusBadge {
  label: string;
  classes: string;
}

export function getAtsHealthTheme(pct: number): AtsHealthTheme {
  if (pct >= 50) {
    return {
      text: "text-emerald-400",
      bar: "bg-emerald-500",
      barGradient: "from-emerald-500 to-teal-400",
      badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      dot: "bg-emerald-400",
    };
  }
  if (pct >= 20) {
    return {
      text: "text-amber-400",
      bar: "bg-amber-500",
      barGradient: "from-amber-500 to-orange-400",
      badge: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      dot: "bg-amber-400",
    };
  }
  return {
    text: "text-rose-400",
    bar: "bg-rose-500",
    barGradient: "from-rose-500 to-red-600",
    badge: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    dot: "bg-rose-400",
  };
}

export function getAtsStatusBadge(
  status?: "EXCELLENT" | "GOOD" | "ATTENTION" | "CRITICAL"
): AtsStatusBadge {
  switch (status) {
    case "EXCELLENT":
      return {
        label: "Excelente",
        classes: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      };
    case "GOOD":
      return {
        label: "Operação Normal",
        classes: "bg-sky-500/20 text-sky-300 border-sky-500/30",
      };
    case "ATTENTION":
      return {
        label: "Atenção (Meia-vida)",
        classes: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      };
    case "CRITICAL":
      return {
        label: "Substituição Recomendada",
        classes: "bg-rose-500/20 text-rose-300 border-rose-500/30",
      };
    default:
      return {
        label: "Excelente",
        classes: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      };
  }
}
