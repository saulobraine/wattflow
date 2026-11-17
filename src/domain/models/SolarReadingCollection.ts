import { SolarGenerationWatts } from "../values/SolarGenerationWatts";

export interface SolarTelemetryPoint {
  watts: SolarGenerationWatts;
  outputWatts?: number;
  batteryPercentage: number;
  timestamp: Date;
}

/**
 * Coleção de Primeira Classe para telemetria e cálculos estatísticos de energia solar.
 * Realiza a integração temporal física realista (Wh = Potência Média * Horas Decorridas).
 *
 * Respeita Object Calisthenics:
 * - Apenas 1 variável de instância
 * - Sem uso de else
 * - Coleção de primeira classe
 * - Nomes sem abreviação
 */
export class SolarReadingCollection {
  private readonly readings: SolarTelemetryPoint[];

  constructor(readings: SolarTelemetryPoint[] = []) {
    this.readings = readings;
  }

  public calculatePeakWatts(): SolarGenerationWatts {
    let peakValue = 0;
    for (const point of this.readings) {
      point.watts.transferNumericWatts((watts) => {
        const isHigher = watts > peakValue;
        if (isHigher) {
          peakValue = watts;
        }
      });
    }
    return new SolarGenerationWatts(peakValue);
  }

  public calculateAverageWatts(): number {
    const totalCount = this.readings.length;
    if (totalCount === 0) {
      return 0;
    }

    let sum = 0;
    for (const point of this.readings) {
      point.watts.transferNumericWatts((watts) => {
        sum += watts;
      });
    }

    return Math.round(sum / totalCount);
  }

  public calculateAverageOutputWatts(): number {
    const totalCount = this.readings.length;
    if (totalCount === 0) {
      return 0;
    }

    let sum = 0;
    for (const point of this.readings) {
      sum += point.outputWatts ?? 0;
    }

    return Math.round(sum / totalCount);
  }

  public calculateElapsedTimeHours(maxWindowHours = 24): number {
    const totalCount = this.readings.length;
    if (totalCount < 2) {
      return 0;
    }

    const timestamps = this.readings.map((point) => point.timestamp.getTime());
    const minTimestamp = Math.min(...timestamps);
    const maxTimestamp = Math.max(...timestamps);
    const elapsedSeconds = (maxTimestamp - minTimestamp) / 1000;
    const elapsedHours = elapsedSeconds / 3600;

    return Math.min(Math.max(0, elapsedHours), maxWindowHours);
  }

  public calculateAccumulatedEnergyWattHours(maxWindowHours = 24): number {
    const averageWatts = this.calculateAverageWatts();
    const elapsedHours = this.calculateElapsedTimeHours(maxWindowHours);
    return Math.round(averageWatts * elapsedHours);
  }

  public calculateAccumulatedConsumedWattHours(maxWindowHours = 24): number {
    const averageOutputWatts = this.calculateAverageOutputWatts();
    const elapsedHours = this.calculateElapsedTimeHours(maxWindowHours);
    return Math.round(averageOutputWatts * elapsedHours);
  }

  public calculateAccumulatedNetEnergyWattHours(maxWindowHours = 24): number {
    const generated = this.calculateAccumulatedEnergyWattHours(maxWindowHours);
    const consumed = this.calculateAccumulatedConsumedWattHours(maxWindowHours);
    return generated - consumed;
  }

  public calculateEstimatedEnergyWattHours(maxWindowHours = 24): number {
    return this.calculateAccumulatedEnergyWattHours(maxWindowHours);
  }

  public calculateEstimatedConsumedWattHours(maxWindowHours = 24): number {
    return this.calculateAccumulatedConsumedWattHours(maxWindowHours);
  }

  public calculateNetEnergyWattHours(maxWindowHours = 24): number {
    return this.calculateAccumulatedNetEnergyWattHours(maxWindowHours);
  }

  public transferReadings(receiver: (items: SolarTelemetryPoint[]) => void): void {
    receiver([...this.readings]);
  }
}
