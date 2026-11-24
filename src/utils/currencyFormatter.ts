/**
 * Utilitário de Formatação Monetária com Intl.NumberFormat.
 * 
 * Formata valores monetários de acordo com o padrão brasileiro (R$ 1.234,56),
 * americano ($ 1,234.56), europeu (1.234,56 €) ou símbolo customizado
 * com separação localizada de milhar e centavos.
 */

export function formatCurrency(
  value: number | null | undefined,
  currencySymbol = "R$",
  locale?: string
): string {
  const cleanSymbol = (currencySymbol || "R$").trim() || "R$";
  const upperSymbol = cleanSymbol.toUpperCase();

  const isEur = cleanSymbol === "€" || upperSymbol === "EUR";
  const isUsd = cleanSymbol === "$" || upperSymbol === "USD";
  const isBrl = cleanSymbol === "R$" || upperSymbol === "BRL";

  // Determina o locale padrão correspondente caso não seja fornecido
  const targetLocale =
    locale ||
    (isUsd ? "en-US" : isEur ? "de-DE" : isBrl ? "pt-BR" : "pt-BR");

  // Tratamento resiliente de nulos, indefinidos, NaN e valores não-finitos
  if (
    value === null ||
    value === undefined ||
    typeof value !== "number" ||
    Number.isNaN(value) ||
    !Number.isFinite(value)
  ) {
    const zeroFormatted = new Intl.NumberFormat(targetLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(0);

    return isEur
      ? `${zeroFormatted} ${cleanSymbol}`
      : `${cleanSymbol} ${zeroFormatted}`;
  }

  const isNegative = value < 0;
  const absValue = Math.abs(value);

  const formattedNumber = new Intl.NumberFormat(targetLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absValue);

  if (isEur) {
    return isNegative
      ? `-${formattedNumber} ${cleanSymbol}`
      : `${formattedNumber} ${cleanSymbol}`;
  }

  return isNegative
    ? `-${cleanSymbol} ${formattedNumber}`
    : `${cleanSymbol} ${formattedNumber}`;
}
