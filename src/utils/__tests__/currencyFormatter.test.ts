import { describe, expect, it } from "vitest";
import { formatCurrency } from "../currencyFormatter";

describe("currencyFormatter - formatCurrency", () => {
  describe("Padrão Brasileiro (BRL / R$)", () => {
    it("formata valores positivos com separador de milhar e vírgula decimal", () => {
      expect(formatCurrency(1234.56, "R$")).toBe("R$ 1.234,56");
      expect(formatCurrency(1234.56, "BRL")).toBe("BRL 1.234,56");
      expect(formatCurrency(1000000, "R$")).toBe("R$ 1.000.000,00");
    });

    it("utiliza R$ como símbolo padrão quando omitido", () => {
      expect(formatCurrency(1234.56)).toBe("R$ 1.234,56");
      expect(formatCurrency(42.5)).toBe("R$ 42,50");
    });

    it("formata valores negativos com sinal antes do símbolo", () => {
      expect(formatCurrency(-1234.56, "R$")).toBe("-R$ 1.234,56");
      expect(formatCurrency(-0.99, "R$")).toBe("-R$ 0,99");
    });

    it("arredonda casas decimais adicionais para 2 dígitos", () => {
      expect(formatCurrency(12.345, "R$")).toBe("R$ 12,35");
      expect(formatCurrency(12.344, "R$")).toBe("R$ 12,34");
    });
  });

  describe("Padrão Americano (USD / $)", () => {
    it("formata valores positivos no padrão en-US ($ 1,234.56)", () => {
      expect(formatCurrency(1234.56, "$")).toBe("$ 1,234.56");
      expect(formatCurrency(1234.56, "USD")).toBe("USD 1,234.56");
      expect(formatCurrency(1000000, "$")).toBe("$ 1,000,000.00");
    });

    it("formata valores negativos americanos", () => {
      expect(formatCurrency(-1234.56, "$")).toBe("-$ 1,234.56");
      expect(formatCurrency(-50, "$")).toBe("-$ 50.00");
    });
  });

  describe("Padrão Europeu (EUR / €)", () => {
    it("formata valores positivos com símbolo no sufixo (1.234,56 €)", () => {
      expect(formatCurrency(1234.56, "€")).toBe("1.234,56 €");
      expect(formatCurrency(1234.56, "EUR")).toBe("1.234,56 EUR");
    });

    it("formata valores negativos europeus (-1.234,56 €)", () => {
      expect(formatCurrency(-1234.56, "€")).toBe("-1.234,56 €");
    });
  });

  describe("Símbolos Customizados & Locales", () => {
    it("formata símbolos customizados com locale explícito", () => {
      expect(formatCurrency(1234.56, "£", "en-GB")).toBe("£ 1,234.56");
      expect(formatCurrency(1234.56, "GBP", "en-GB")).toBe("GBP 1,234.56");
    });

    it("aplica pt-BR como fallback para símbolos genéricos sem locale especificado", () => {
      expect(formatCurrency(5432.1, "US$")).toBe("US$ 5.432,10");
      expect(formatCurrency(-500, "CAD")).toBe("-CAD 500,00");
    });

    it("limpa espaços extras no símbolo de moeda", () => {
      expect(formatCurrency(100, "  R$  ")).toBe("R$ 100,00");
    });
  });

  describe("Zero, Nulos, Indefinidos & Valores Inválidos", () => {
    it("formata zero corretamente", () => {
      expect(formatCurrency(0, "R$")).toBe("R$ 0,00");
      expect(formatCurrency(0, "$")).toBe("$ 0.00");
      expect(formatCurrency(0, "€")).toBe("0,00 €");
      expect(formatCurrency(-0, "R$")).toBe("R$ 0,00");
    });

    it("trata nulos retornando 'R$ 0,00' ou zero no formato da moeda", () => {
      expect(formatCurrency(null)).toBe("R$ 0,00");
      expect(formatCurrency(null, "R$")).toBe("R$ 0,00");
      expect(formatCurrency(null, "$")).toBe("$ 0.00");
      expect(formatCurrency(null, "€")).toBe("0,00 €");
    });

    it("trata undefined retornando 'R$ 0,00'", () => {
      expect(formatCurrency(undefined)).toBe("R$ 0,00");
      expect(formatCurrency(undefined, "$")).toBe("$ 0.00");
    });

    it("trata NaN retornando 'R$ 0,00'", () => {
      expect(formatCurrency(NaN)).toBe("R$ 0,00");
      expect(formatCurrency(NaN, "R$")).toBe("R$ 0,00");
    });

    it("trata valores infinitos como 0", () => {
      expect(formatCurrency(Infinity)).toBe("R$ 0,00");
      expect(formatCurrency(-Infinity)).toBe("R$ 0,00");
    });
  });
});
