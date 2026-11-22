export type SolarExpectationLevel =
  | "SOLAR_EXCELLENT"
  | "SOLAR_GOOD"
  | "SOLAR_MODERATE"
  | "SOLAR_POOR";

export type StormSeverity = "NORMAL" | "MODERATE" | "SEVERE";

export interface WeatherRiskAssessment {
  isStormRisk: boolean;
  severity: StormSeverity;
  weatherCode: number;
  weatherDescription: string;
  precipitationSumMm: number;
  precipitationProbabilityMax: number;
  windSpeedMaxKmh: number;
  temperatureMaxCelsius: number;
  temperatureMinCelsius: number;
  alertSummary: string;
}

export interface WeatherForecastResponseData {
  assessment: WeatherRiskAssessment;
  dailyForecast: Array<{
    date: string;
    weatherCode: number;
    weatherDescription: string;
    precipitationMm: number;
    precipitationProbability: number;
    windSpeedMaxKmh: number;
    temperatureMaxCelsius: number;
    temperatureMinCelsius: number;
  }>;
  fetchedAt: Date;
  isCached: boolean;
}

export function getWeatherDescriptionByCode(code: number): string {
  switch (code) {
    case 0:
      return "Céu limpo";
    case 1:
      return "Principalmente limpo";
    case 2:
      return "Parcialmente nublado";
    case 3:
      return "Nublado";
    case 45:
    case 48:
      return "Nevoeiro";
    case 51:
    case 53:
    case 55:
      return "Garoa";
    case 61:
      return "Chuva fraca";
    case 63:
      return "Chuva moderada";
    case 65:
      return "Chuva forte contínua";
    case 71:
    case 73:
    case 75:
      return "Neve";
    case 80:
      return "Pancadas de chuva fracas";
    case 81:
      return "Pancadas de chuva moderadas";
    case 82:
      return "Pancadas de chuva violentas";
    case 95:
      return "Trovoada leve ou moderada";
    case 96:
      return "Trovoada com granizo leve";
    case 99:
      return "Trovoada severa com granizo pesado";
    default:
      return "Condições meteorológicas variáveis";
  }
}

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
  peakSunHours: number;
  irradianceKwhM2: number;
  estimatedDailyGenerationKwh: number;
  sunrise?: string | null;
  sunset?: string | null;
  isDaylight?: boolean;
}

export function isWithinDaylightWindow(
  sunriseStr: string | null | undefined,
  sunsetStr: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!sunriseStr || !sunsetStr) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return currentMinutes >= 360 && currentMinutes <= 1080; // 06:00 - 18:00
  }

  // Handle format "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss"
  if (sunriseStr.includes("T") && sunsetStr.includes("T")) {
    const parsedSunrise = new Date(sunriseStr);
    const parsedSunset = new Date(sunsetStr);
    if (!isNaN(parsedSunrise.getTime()) && !isNaN(parsedSunset.getTime())) {
      if (parsedSunrise.toDateString() === now.toDateString()) {
        return now.getTime() >= parsedSunrise.getTime() && now.getTime() <= parsedSunset.getTime();
      }
      const sunriseMinutes = parsedSunrise.getHours() * 60 + parsedSunrise.getMinutes();
      const sunsetMinutes = parsedSunset.getHours() * 60 + parsedSunset.getMinutes();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      return currentMinutes >= sunriseMinutes && currentMinutes <= sunsetMinutes;
    }
  }

  // Handle format "HH:mm"
  const [riseH, riseM] = sunriseStr.split(":").map(Number);
  const [setH, setM] = sunsetStr.split(":").map(Number);
  if (!isNaN(riseH) && !isNaN(riseM) && !isNaN(setH) && !isNaN(setM)) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const sunriseMinutes = riseH * 60 + riseM;
    const sunsetMinutes = setH * 60 + setM;
    return currentMinutes >= sunriseMinutes && currentMinutes <= sunsetMinutes;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= 360 && currentMinutes <= 1080;
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
  private readonly weatherCache = new Map<
    string,
    { result: WeatherForecastResponseData; timestamp: number }
  >();
  private readonly WEATHER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

  private constructor() {}

  public static getInstance(): OpenMeteoSolarForecastService {
    if (!OpenMeteoSolarForecastService.instance) {
      OpenMeteoSolarForecastService.instance = new OpenMeteoSolarForecastService();
    }
    return OpenMeteoSolarForecastService.instance;
  }

  public clearCacheForTests(): void {
    this.cache.clear();
    this.weatherCache.clear();
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

  public calculateGenerationMetrics(
    radiationMj: number,
    solarCapacityWatts = 400
  ): {
    peakSunHours: number;
    irradianceKwhM2: number;
    estimatedDailyGenerationKwh: number;
  } {
    const peakSunHours = Number((radiationMj / 3.6).toFixed(2));
    const irradianceKwhM2 = peakSunHours;
    const capacity = Math.max(0, solarCapacityWatts);
    const estimatedDailyGenerationKwh = Number(
      ((capacity / 1000) * peakSunHours * 0.85).toFixed(2)
    );
    return {
      peakSunHours,
      irradianceKwhM2,
      estimatedDailyGenerationKwh,
    };
  }

  public async getForecast(
    latitude: number,
    longitude: number,
    minAdaptiveThreshold = 20,
    maxAdaptiveThreshold = 50,
    solarCapacityWatts = 400
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
      const metrics = this.calculateGenerationMetrics(
        cached.result.irradianceMj,
        solarCapacityWatts
      );
      return {
        ...cached.result,
        effectiveTurnOffThreshold: adaptiveThreshold,
        peakSunHours: metrics.peakSunHours,
        irradianceKwhM2: metrics.irradianceKwhM2,
        estimatedDailyGenerationKwh: metrics.estimatedDailyGenerationKwh,
        isDaylight: isWithinDaylightWindow(cached.result.sunrise, cached.result.sunset, new Date()),
        isCached: true,
      };
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=shortwave_radiation_sum,sunshine_duration,weathercode,sunrise,sunset&timezone=auto`;
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
      const sunriseValues = daily?.sunrise as string[] | undefined;
      const sunsetValues = daily?.sunset as string[] | undefined;

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
      const sunrise =
        Array.isArray(sunriseValues) && typeof sunriseValues[0] === "string"
          ? sunriseValues[0]
          : null;
      const sunset =
        Array.isArray(sunsetValues) && typeof sunsetValues[0] === "string"
          ? sunsetValues[0]
          : null;
      const isDaylight = isWithinDaylightWindow(sunrise, sunset, new Date());

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
      const metrics = this.calculateGenerationMetrics(
        radiationMj,
        solarCapacityWatts
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
        peakSunHours: metrics.peakSunHours,
        irradianceKwhM2: metrics.irradianceKwhM2,
        estimatedDailyGenerationKwh: metrics.estimatedDailyGenerationKwh,
        sunrise,
        sunset,
        isDaylight,
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
          isDaylight: isWithinDaylightWindow(cached.result.sunrise, cached.result.sunset, new Date()),
          isCached: true,
        };
      }

      const fallbackLevel: SolarExpectationLevel = "SOLAR_MODERATE";
      const fallbackThreshold = Math.round(
        minAdaptiveThreshold + (maxAdaptiveThreshold - minAdaptiveThreshold) * 0.5
      );
      const fallbackRadiationMj = 10.0;
      const fallbackMetrics = this.calculateGenerationMetrics(
        fallbackRadiationMj,
        solarCapacityWatts
      );
      const fallbackSunrise = "06:00";
      const fallbackSunset = "18:00";
      const fallbackIsDaylight = isWithinDaylightWindow(fallbackSunrise, fallbackSunset, new Date());

      return {
        irradianceMj: fallbackRadiationMj,
        sunshineDurationSeconds: 14400,
        weatherCode: 3,
        expectationLevel: fallbackLevel,
        effectiveTurnOffThreshold: fallbackThreshold,
        forecastDate: new Date().toISOString().split("T")[0],
        isCached: false,
        fetchedAt: new Date(),
        forecastSummary: `Previsão solar indisponível temporariamente. Aplicando corte de segurança intermediário (${fallbackThreshold}%).`,
        peakSunHours: fallbackMetrics.peakSunHours,
        irradianceKwhM2: fallbackMetrics.irradianceKwhM2,
        estimatedDailyGenerationKwh: fallbackMetrics.estimatedDailyGenerationKwh,
        sunrise: fallbackSunrise,
        sunset: fallbackSunset,
        isDaylight: fallbackIsDaylight,
      };
    }
  }

  /**
   * Avalia o risco meteorológico imediato e para as próximas 24-48h com base em códigos WMO,
   * precipitação acumulada e velocidade máxima do vento.
   */
  public async evaluateWeatherRisk(
    latitude: number,
    longitude: number,
    rainThresholdMm = 20.0
  ): Promise<WeatherRiskAssessment> {
    const forecastData = await this.getWeatherForecast(
      latitude,
      longitude,
      rainThresholdMm
    );
    return forecastData.assessment;
  }

  /**
   * Consulta a previsão meteorológica completa na Open-Meteo com cache de 1 hora e fail-safe gracioso.
   */
  public async getWeatherForecast(
    latitude: number,
    longitude: number,
    rainThresholdMm = 20.0
  ): Promise<WeatherForecastResponseData> {
    const cacheKey = `weather_${latitude.toFixed(2)}_${longitude.toFixed(2)}`;
    const now = Date.now();
    const cached = this.weatherCache.get(cacheKey);

    if (cached && now - cached.timestamp < this.WEATHER_CACHE_TTL_MS) {
      return {
        ...cached.result,
        isCached: true,
      };
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=weather_code,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,temperature_2m_max,temperature_2m_min&timezone=auto`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "WattFlow-WeatherService/1.0",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Open-Meteo HTTP error: status ${response.status}`);
      }

      const json = await response.json();
      const daily = json?.daily;

      const weatherCodes = (daily?.weather_code ?? daily?.weathercode) as number[] | undefined;
      const precipitationSums = daily?.precipitation_sum as number[] | undefined;
      const precipitationProbs = daily?.precipitation_probability_max as number[] | undefined;
      const windSpeeds = (daily?.wind_speed_10m_max ?? daily?.windspeed_10m_max) as number[] | undefined;
      const tempMaxes = daily?.temperature_2m_max as number[] | undefined;
      const tempMins = daily?.temperature_2m_min as number[] | undefined;
      const dates = daily?.time as string[] | undefined;

      const count = Array.isArray(dates) ? dates.length : 0;
      const dailyForecast: WeatherForecastResponseData["dailyForecast"] = [];

      for (let i = 0; i < count; i++) {
        const code = weatherCodes?.[i] ?? 0;
        dailyForecast.push({
          date: dates?.[i] ?? new Date().toISOString().split("T")[0],
          weatherCode: code,
          weatherDescription: getWeatherDescriptionByCode(code),
          precipitationMm: Number((precipitationSums?.[i] ?? 0).toFixed(1)),
          precipitationProbability: Math.round(precipitationProbs?.[i] ?? 0),
          windSpeedMaxKmh: Number((windSpeeds?.[i] ?? 0).toFixed(1)),
          temperatureMaxCelsius: Number((tempMaxes?.[i] ?? 25).toFixed(1)),
          temperatureMinCelsius: Number((tempMins?.[i] ?? 18).toFixed(1)),
        });
      }

      let isStormRisk = false;
      let severity: StormSeverity = "NORMAL";
      let primaryRiskDay = dailyForecast[0] ?? {
        date: new Date().toISOString().split("T")[0],
        weatherCode: 0,
        weatherDescription: "Céu limpo",
        precipitationMm: 0,
        precipitationProbability: 0,
        windSpeedMaxKmh: 0,
        temperatureMaxCelsius: 25,
        temperatureMinCelsius: 18,
      };

      const daysToCheck = dailyForecast.slice(0, 2);

      for (const day of daysToCheck) {
        const isSevereCode = day.weatherCode === 96 || day.weatherCode === 99;
        const isHighWind = day.windSpeedMaxKmh > 65;

        if (isSevereCode || isHighWind) {
          isStormRisk = true;
          severity = "SEVERE";
          primaryRiskDay = day;
          break;
        }

        const isModerateCode =
          day.weatherCode === 95 || day.weatherCode === 65 || day.weatherCode === 82;
        const isHeavyRain = day.precipitationMm >= rainThresholdMm;

        if (isModerateCode || isHeavyRain) {
          isStormRisk = true;
          if (severity === "NORMAL") {
            severity = "MODERATE";
            primaryRiskDay = day;
          }
        }
      }

      let alertSummary = `Condições meteorológicas estáveis (${primaryRiskDay.weatherDescription}). Modo econômico solar operando normalmente.`;
      if (severity === "SEVERE") {
        alertSummary = `Alerta de Tempestade Severa: ${primaryRiskDay.weatherDescription} com ventos de até ${primaryRiskDay.windSpeedMaxKmh} km/h e ${primaryRiskDay.precipitationMm} mm de chuva. Modo No-Break Preventivo ativado.`;
      } else if (severity === "MODERATE") {
        alertSummary = `Alerta de Chuva Forte / Tempestade: ${primaryRiskDay.weatherDescription} com ${primaryRiskDay.precipitationMm} mm de precipitação. Modo No-Break Preventivo ativado.`;
      }

      const assessment: WeatherRiskAssessment = {
        isStormRisk,
        severity,
        weatherCode: primaryRiskDay.weatherCode,
        weatherDescription: primaryRiskDay.weatherDescription,
        precipitationSumMm: primaryRiskDay.precipitationMm,
        precipitationProbabilityMax: primaryRiskDay.precipitationProbability,
        windSpeedMaxKmh: primaryRiskDay.windSpeedMaxKmh,
        temperatureMaxCelsius: primaryRiskDay.temperatureMaxCelsius,
        temperatureMinCelsius: primaryRiskDay.temperatureMinCelsius,
        alertSummary,
      };

      const finalResult: WeatherForecastResponseData = {
        assessment,
        dailyForecast,
        fetchedAt: new Date(),
        isCached: false,
      };

      this.weatherCache.set(cacheKey, {
        result: finalResult,
        timestamp: now,
      });

      return finalResult;
    } catch (weatherError: unknown) {
      console.warn(
        "[OpenMeteoSolarForecastService] Falha ao consultar previsão meteorológica, aplicando fallback gracioso:",
        weatherError
      );

      if (cached) {
        return {
          ...cached.result,
          isCached: true,
        };
      }

      const fallbackAssessment: WeatherRiskAssessment = {
        isStormRisk: false,
        severity: "NORMAL",
        weatherCode: 0,
        weatherDescription: "Previsão meteorológica temporariamente indisponível",
        precipitationSumMm: 0,
        precipitationProbabilityMax: 0,
        windSpeedMaxKmh: 0,
        temperatureMaxCelsius: 25,
        temperatureMinCelsius: 18,
        alertSummary:
          "Previsão meteorológica indisponível temporariamente. Sistema mantido em operação normal.",
      };

      return {
        assessment: fallbackAssessment,
        dailyForecast: [
          {
            date: new Date().toISOString().split("T")[0],
            weatherCode: 0,
            weatherDescription: "Céu limpo",
            precipitationMm: 0,
            precipitationProbability: 0,
            windSpeedMaxKmh: 0,
            temperatureMaxCelsius: 25,
            temperatureMinCelsius: 18,
          },
        ],
        fetchedAt: new Date(),
        isCached: false,
      };
    }
  }
}
