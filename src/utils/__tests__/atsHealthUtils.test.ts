import { describe, expect, it } from "vitest";
import {
  getAtsHealthTheme,
  getAtsStatusBadge,
} from "../atsHealthUtils";

describe("atsHealthUtils Unit & Logic Suite", () => {
  describe("getAtsHealthTheme", () => {
    it("returns emerald styling for health >= 50%", () => {
      const theme99 = getAtsHealthTheme(99.0);
      expect(theme99.text).toBe("text-emerald-400");
      expect(theme99.bar).toBe("bg-emerald-500");
      expect(theme99.barGradient).toBe("from-emerald-500 to-teal-400");
      expect(theme99.badge).toContain("emerald");
      expect(theme99.dot).toBe("bg-emerald-400");

      const theme50 = getAtsHealthTheme(50.0);
      expect(theme50.text).toBe("text-emerald-400");
    });

    it("returns amber styling for health between 20% and 49.9%", () => {
      const theme49 = getAtsHealthTheme(49.9);
      expect(theme49.text).toBe("text-amber-400");
      expect(theme49.bar).toBe("bg-amber-500");
      expect(theme49.barGradient).toBe("from-amber-500 to-orange-400");
      expect(theme49.badge).toContain("amber");
      expect(theme49.dot).toBe("bg-amber-400");

      const theme20 = getAtsHealthTheme(20.0);
      expect(theme20.text).toBe("text-amber-400");
    });

    it("returns rose styling for health < 20%", () => {
      const theme19 = getAtsHealthTheme(19.9);
      expect(theme19.text).toBe("text-rose-400");
      expect(theme19.bar).toBe("bg-rose-500");
      expect(theme19.barGradient).toBe("from-rose-500 to-red-600");
      expect(theme19.badge).toContain("rose");
      expect(theme19.dot).toBe("bg-rose-400");

      const theme0 = getAtsHealthTheme(0);
      expect(theme0.text).toBe("text-rose-400");
    });
  });

  describe("getAtsStatusBadge", () => {
    it("maps EXCELLENT status correctly", () => {
      const badge = getAtsStatusBadge("EXCELLENT");
      expect(badge.label).toBe("Excelente");
      expect(badge.classes).toContain("bg-emerald-500/20");
    });

    it("maps GOOD status correctly", () => {
      const badge = getAtsStatusBadge("GOOD");
      expect(badge.label).toBe("Operação Normal");
      expect(badge.classes).toContain("bg-sky-500/20");
    });

    it("maps ATTENTION status correctly", () => {
      const badge = getAtsStatusBadge("ATTENTION");
      expect(badge.label).toBe("Atenção (Meia-vida)");
      expect(badge.classes).toContain("bg-amber-500/20");
    });

    it("maps CRITICAL status correctly", () => {
      const badge = getAtsStatusBadge("CRITICAL");
      expect(badge.label).toBe("Substituição Recomendada");
      expect(badge.classes).toContain("bg-rose-500/20");
    });

    it("defaults to Excelente for undefined status", () => {
      const badge = getAtsStatusBadge(undefined);
      expect(badge.label).toBe("Excelente");
      expect(badge.classes).toContain("bg-emerald-500/20");
    });
  });
});
