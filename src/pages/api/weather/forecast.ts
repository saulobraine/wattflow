import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";
import {
  OpenMeteoSolarForecastService,
  type WeatherForecastResponseData,
  type SolarForecastResult,
} from "../../../infrastructure/services/OpenMeteoSolarForecastService";

interface WeatherForecastResponseBody {
  success: boolean;
  message?: string;
  data?: WeatherForecastResponseData & {
    isAutoStormActive: boolean;
    isStormAlertActive: boolean;
    autoStormReserveThreshold: number;
    autoStormRainThresholdMm: number;
    autoStormPrechargeAc: boolean;
    solarForecast?: SolarForecastResult;
    peakSunHours?: number | null;
    irradianceKwhM2?: number | null;
    estimatedDailyGenerationKwh?: number | null;
    isDaylightOnlyActive?: boolean;
    sunrise?: string | null;
    sunset?: string | null;
    isDaylight?: boolean;
  };
}

export default async function handleWeatherForecast(
  request: NextApiRequest,
  response: NextApiResponse<WeatherForecastResponseBody>
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", ["GET"]);
    response.status(405).json({
      success: false,
      message: "Método HTTP não permitido.",
    });
    return;
  }

  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno de autenticação.";
    response.status(500).json({
      success: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionUser) {
    response.status(401).json({
      success: false,
      message: "Usuário não autenticado.",
    });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  try {
    const configuration = await prisma.userConfiguration.findUnique({
      where: { userId: extractedUserId },
    });

    if (!configuration) {
      response.status(404).json({
        success: false,
        message: "Configuração do usuário não encontrada.",
      });
      return;
    }

    if (configuration.latitude === null || configuration.longitude === null) {
      response.status(400).json({
        success: false,
        message:
          "Coordenadas geográficas (latitude/longitude) não configuradas. Acesse Configurações para cadastrar sua localização.",
      });
      return;
    }

    const rainThreshold = configuration.autoStormRainThresholdMm ?? 20.0;
    const forecastService = OpenMeteoSolarForecastService.getInstance();
    const weatherData = await forecastService.getWeatherForecast(
      configuration.latitude,
      configuration.longitude,
      rainThreshold
    );

    let solarForecast: SolarForecastResult | null = null;
    try {
      solarForecast = await forecastService.getForecast(
        configuration.latitude,
        configuration.longitude,
        configuration.minAdaptiveThreshold ?? 20,
        configuration.maxAdaptiveThreshold ?? 50
      );
    } catch {
      // Fallback gracioso caso a chamada solar falhe isoladamente
    }

    response.status(200).json({
      success: true,
      data: {
        ...weatherData,
        isAutoStormActive: configuration.isAutoStormActive ?? false,
        isStormAlertActive: configuration.isStormAlertActive ?? false,
        autoStormReserveThreshold: configuration.autoStormReserveThreshold ?? 85,
        autoStormRainThresholdMm: rainThreshold,
        autoStormPrechargeAc: configuration.autoStormPrechargeAc ?? true,
        solarForecast: solarForecast ?? undefined,
        peakSunHours: solarForecast?.peakSunHours ?? null,
        irradianceKwhM2: solarForecast?.irradianceKwhM2 ?? null,
        estimatedDailyGenerationKwh: solarForecast?.estimatedDailyGenerationKwh ?? null,
        isDaylightOnlyActive: configuration.isDaylightOnlyActive ?? false,
        sunrise: solarForecast?.sunrise ?? null,
        sunset: solarForecast?.sunset ?? null,
        isDaylight: solarForecast?.isDaylight ?? true,
      },
    });
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : "Erro interno ao consultar previsão do tempo.";
    response.status(500).json({
      success: false,
      message: detail,
    });
  }
}
