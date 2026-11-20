import { TariffScheduleService, DynamicTariffConfig } from "./TariffScheduleService";
import { SolarExpectationLevel } from "../../infrastructure/services/OpenMeteoSolarForecastService";

export interface SmartChargingEvaluationParams {
  isSmartChargingActive: boolean;
  minAcChargingWatts: number;
  maxAcChargingWatts: number;
  currentAcChargingWatts: number;
  chargeOnlyOffPeak: boolean;
  cloudyPrechargeActive: boolean;
  isStormModeActive: boolean;
  batteryPercentage: number;
  solarWatts?: number;
  outputWatts?: number;
  solarForecastLevel?: SolarExpectationLevel | null;
  tariffConfig?: DynamicTariffConfig;
  currentDate?: Date;
}

export interface SmartChargingEvaluationResult {
  isSmartChargingActive: boolean;
  targetWatts: number;
  shouldSendAdjustCommand: boolean;
  reason: string;
}

/**
 * Serviço de domínio puro para modulação inteligente da potência de recarga AC (EcoFlow).
 * Feature 3.2: Solar Smart Charging (Etapa 4).
 *
 * Regras:
 * 1. Modo Tempestade: Precedência máxima -> maxAcChargingWatts.
 * 2. Horário de Ponta (Tarifa Branca ANEEL): Se chargeOnlyOffPeak -> minAcChargingWatts (mínimo permitido para evitar R$ 1,85+/kWh).
 * 3. Pré-Recarga Noturna Econômica: Se madrugada (00:00 - 05:00, fora de ponta), cloudyPrechargeActive ativo, previsão SOLAR_POOR e bateria < 85% -> recarrega suavemente na tarifa econômica.
 * 4. Modulação em Banda Morta: Evita chamadas repetidas à API se a variação for inferior a 50W.
 */
export class SolarSmartChargingService {
  private static instance: SolarSmartChargingService | null = null;

  public static getInstance(): SolarSmartChargingService {
    if (!SolarSmartChargingService.instance) {
      SolarSmartChargingService.instance = new SolarSmartChargingService();
    }
    return SolarSmartChargingService.instance;
  }

  public evaluate(params: SmartChargingEvaluationParams): SmartChargingEvaluationResult {
    const {
      isSmartChargingActive,
      minAcChargingWatts,
      maxAcChargingWatts,
      currentAcChargingWatts,
      chargeOnlyOffPeak,
      cloudyPrechargeActive,
      isStormModeActive,
      batteryPercentage,
      solarForecastLevel,
      tariffConfig,
      currentDate = new Date(),
    } = params;

    const safeMin = Math.max(100, Math.min(1000, minAcChargingWatts || 200));
    const safeMax = Math.max(safeMin, Math.min(3600, maxAcChargingWatts || 1200));
    const safeCurrent = currentAcChargingWatts || safeMin;

    if (!isSmartChargingActive) {
      return {
        isSmartChargingActive: false,
        targetWatts: safeCurrent,
        shouldSendAdjustCommand: false,
        reason: "Solar Smart Charging desativado nas configurações.",
      };
    }

    // 1. Precedência Máxima: Modo Tempestade / Alerta de Blecaute
    if (isStormModeActive) {
      const targetWatts = safeMax;
      const shouldSend = Math.abs(targetWatts - safeCurrent) >= 50;
      return {
        isSmartChargingActive: true,
        targetWatts,
        shouldSendAdjustCommand: shouldSend,
        reason: `Modo Tempestade Ativo: recarga AC maximizada para emergência (${targetWatts}W).`,
      };
    }

    // Avaliação de Horário de Ponta (Brasília)
    const scheduleService = TariffScheduleService.getInstance();
    const evaluatedTariff = tariffConfig
      ? scheduleService.evaluate(tariffConfig, currentDate)
      : { period: "OFF_PEAK", isDynamicActive: false, rate: 0.92, description: "" };

    const isPeakPeriod = evaluatedTariff.isDynamicActive && evaluatedTariff.period === "PEAK";

    // 2. Bloqueio no Horário de Ponta
    const isZeroBlock = Boolean(
      tariffConfig &&
      "blockAcChargingDuringPeak" in tariffConfig &&
      tariffConfig.blockAcChargingDuringPeak === true
    );
    const shouldBlockDuringPeak = isZeroBlock || Boolean(chargeOnlyOffPeak);

    if (shouldBlockDuringPeak && isPeakPeriod) {
      const targetWatts = isZeroBlock ? 0 : safeMin;
      const shouldSend = Math.abs(targetWatts - safeCurrent) >= 50 || (targetWatts === 0 && safeCurrent > 0);
      return {
        isSmartChargingActive: true,
        targetWatts,
        shouldSendAdjustCommand: shouldSend,
        reason: `Horário de Ponta Ativo (${evaluatedTariff.period}): recarga AC ${isZeroBlock ? "bloqueada (0W)" : "restrita ao mínimo (" + targetWatts + "W)"} para evitar custos tarifários elevados.`,
      };
    }

    // 3. Pré-Recarga Noturna Econômica (00:00 às 05:00 na tarifa fora de ponta)
    const { hours } = scheduleService.getBrasiliaTime(currentDate);
    const isNightWindow = hours >= 0 && hours < 5;

    if (cloudyPrechargeActive && isNightWindow && solarForecastLevel === "SOLAR_POOR" && batteryPercentage < 85) {
      const prechargeWatts = Math.min(safeMax, Math.max(safeMin, 400));
      const shouldSend = Math.abs(prechargeWatts - safeCurrent) >= 50;
      return {
        isSmartChargingActive: true,
        targetWatts: prechargeWatts,
        shouldSendAdjustCommand: shouldSend,
        reason: `Pré-recarga noturna econômica ativa: previsão de tempo nublado/chuva (${solarForecastLevel}), elevando bateria (${batteryPercentage}%) na tarifa econômica (${prechargeWatts}W).`,
      };
    }

    // 4. Modulação Padrão Fora de Ponta:
    // Se a bateria estiver cheia (>= 95%), reduz para o mínimo
    if (batteryPercentage >= 95) {
      const targetWatts = safeMin;
      const shouldSend = Math.abs(targetWatts - safeCurrent) >= 50;
      return {
        isSmartChargingActive: true,
        targetWatts,
        shouldSendAdjustCommand: shouldSend,
        reason: `Bateria quase plena (${batteryPercentage}%): recarga AC mantida na potência mínima de flutuação (${targetWatts}W).`,
      };
    }

    // Se bateria baixa (< 30%) e fora de ponta, recarrega em potência média/padrão
    if (batteryPercentage < 30) {
      const targetWatts = Math.round((safeMin + safeMax) / 2);
      const shouldSend = Math.abs(targetWatts - safeCurrent) >= 50;
      return {
        isSmartChargingActive: true,
        targetWatts,
        shouldSendAdjustCommand: shouldSend,
        reason: `Bateria em nível baixo (${batteryPercentage}%): recarga AC equilibrada (${targetWatts}W) em horário econômico.`,
      };
    }

    // Estado estável padrão: mantém corrente sem alteração
    return {
      isSmartChargingActive: true,
      targetWatts: safeCurrent,
      shouldSendAdjustCommand: false,
      reason: `Operação solar e recarga balanceadas (${safeCurrent}W).`,
    };
  }
}
