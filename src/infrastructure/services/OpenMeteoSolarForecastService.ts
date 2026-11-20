export type SolarExpectationLevel =
  | "SOLAR_EXCELLENT"
  | "SOLAR_GOOD"
  | "SOLAR_MODERATE"
  | "SOLAR_POOR";

export interface SolarForecastResult {
  irradianceMj: number;
  sunshineDurationSeconds: number;
  weatherCode: number;
  expectationLevel: SolarExpectationLevel;
  effectiveTurnOffThreshold: number;
  forecastDate: string;
  isCached: boolean;
  fetchedAt: Date;
  forecastSummary: string;
}

interface CacheEntry {
  result: SolarForecastResult;
  timestamp: number;
}

/**
 * Serviço Singleton resiliente para consulta meteorológica aberta (Open-Meteo).
 * Fornece dados de irradiância diária (MJ/m²), duração solar e cálculo dinâmico
 * do limiar de descarregamento (histerese adaptativa).
 *
 * Cache inteligente em memória: TTL de 2 horas por coordenada geográfica.
 * Fail-Safe: Nunca trava o ciclo de sincronização em caso de falha de rede/timeout.
 */
export class OpenMeteoSolarForecastService {
  private static instance: OpenMeteoSolarForecastService | null = null;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

  private constructor() {}

  public static getInstance(): OpenMeteoSolarForecastService {
    if (!OpenMeteoSolarForecastService.instance) {
      OpenMeteoSolarForecastService.instance = new OpenMeteoSolarForecastService();
    }
    return OpenMeteoSolarForecastService.instance;
  }

  public clearCacheForTests(): void {
    this.cache.clear();
  }

  public calculateExpectationLevel(radiationMj: number): SolarExpectationLevel {
    if (radiationMj > 18) {
      return "SOLAR_EXCELLENT";
    }
    if (radiationMj >= 12) {
      return "SOLAR_GOOD";
    }
    if (radiationMj >= 8) {
      return "SOLAR_MODERATE";
    }
    return "SOLAR_POOR";
  }

  public calculateAdaptiveThreshold(
    expectation: SolarExpectationLevel,
    minAdaptiveThreshold: number,
    maxAdaptiveThreshold: number
  ): number {
    const min = Math.min(minAdaptiveThreshold, maxAdaptiveThreshold);
    const max = Math.max(minAdaptiveThreshold, maxAdaptiveThreshold);
    const range = max - min;

    switch (expectation) {
      case "SOLAR_EXCELLENT":
        return min;
      case "SOLAR_GOOD":
        return Math.round(min + range * 0.33);
      case "SOLAR_MODERATE":
        return Math.round(min + range * 0.66);
      case "SOLAR_POOR":
        return max;
    }
  }

  public buildForecastSummary(
    expectation: SolarExpectationLevel,
    radiationMj: number,
    effectiveThreshold: number
  ): string {
    const formattedMj = radiationMj.toFixed(1);
    switch (expectation) {
      case "SOLAR_EXCELLENT":
        return `Sol pleno previsto para hoje (${formattedMj} MJ/m²). Descarregamento expandido para até ${effectiveThreshold}%.`;
      case "SOLAR_GOOD":
        return `Boa radiação solar prevista (${formattedMj} MJ/m²). Corte ajustado para ${effectiveThreshold}%.`;
      case "SOLAR_MODERATE":
        return `Radiação solar moderada (${formattedMj} MJ/m²). Corte de segurança em ${effectiveThreshold}%.`;
      case "SOLAR_POOR":
        return `Baixa radiação / tempo nublado (${formattedMj} MJ/m²). Reserva preservada em ${effectiveThreshold}%.`;
    }
  }

  public async getForecast(
    latitude: number,
    longitude: number,
    minAdaptiveThreshold = 20,
    maxAdaptiveThreshold = 50
  ): Promise<SolarForecastResult> {
    const cacheKey = `${latitude.toFixed(2)}_${longitude.toFixed(2)}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      const adaptiveThreshold = this.calculateAdaptiveThreshold(
        cached.result.expectationLevel,
        minAdaptiveThreshold,
        maxAdaptiveThreshold
      );
      return {
        ...cached.result,
        effectiveTurnOffThreshold: adaptiveThreshold,
        isCached: true,
      };
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=shortwave_radiation_sum,sunshine_duration,weathercode&timezone=auto`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "WattFlow-SmartEnergy/1.0",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Open-Meteo HTTP error: status ${response.status}`);
      }

      const json = await response.json();
      const daily = json?.daily;
      const radiationValues = daily?.shortwave_radiation_sum as number[] | undefined;
      const sunshineValues = daily?.sunshine_duration as number[] | undefined;
      const weatherCodes = daily?.weathercode as number[] | undefined;
      const dates = daily?.time as string[] | undefined;

      const radiationMj =
        Array.isArray(radiationValues) && typeof radiationValues[0] === "number"
          ? radiationValues[0]
          : 0;
      const sunshineDuration =
        Array.isArray(sunshineValues) && typeof sunshineValues[0] === "number"
          ? sunshineValues[0]
          : 0;
      const weatherCode =
        Array.isArray(weatherCodes) && typeof weatherCodes[0] === "number"
          ? weatherCodes[0]
          : 0;
      const forecastDate =
        Array.isArray(dates) && typeof dates[0] === "string"
          ? dates[0]
          : new Date().toISOString().split("T")[0];

      const expectationLevel = this.calculateExpectationLevel(radiationMj);
      const effectiveTurnOffThreshold = this.calculateAdaptiveThreshold(
        expectationLevel,
        minAdaptiveThreshold,
        maxAdaptiveThreshold
      );
      const forecastSummary = this.buildForecastSummary(
        expectationLevel,
        radiationMj,
        effectiveTurnOffThreshold
      );

      const result: SolarForecastResult = {
        irradianceMj: Number(radiationMj.toFixed(2)),
        sunshineDurationSeconds: Math.round(sunshineDuration),
        weatherCode,
        expectationLevel,
        effectiveTurnOffThreshold,
        forecastDate,
        isCached: false,
        fetchedAt: new Date(),
        forecastSummary,
      };

      this.cache.set(cacheKey, {
        result,
        timestamp: now,
      });

      return result;
    } catch (error: unknown) {
      console.warn("[OpenMeteoSolarForecastService] Falha ao consultar Open-Meteo, aplicando fallback gracioso:", error);

      if (cached) {
        return {
          ...cached.result,
          isCached: true,
        };
      }

      const fallbackLevel: SolarExpectationLevel = "SOLAR_MODERATE";
      const fallbackThreshold = Math.round(
        minAdaptiveThreshold + (maxAdaptiveThreshold - minAdaptiveThreshold) * 0.5
      );

      return {
        irradianceMj: 10.0,
        sunshineDurationSeconds: 14400,
        weatherCode: 3,
        expectationLevel: fallbackLevel,
        effectiveTurnOffThreshold: fallbackThreshold,
        forecastDate: new Date().toISOString().split("T")[0],
        isCached: false,
        fetchedAt: new Date(),
        forecastSummary: `Previsão solar indisponível temporariamente. Aplicando corte de segurança intermediário (${fallbackThreshold}%).`,
      };
    }
  }
}
