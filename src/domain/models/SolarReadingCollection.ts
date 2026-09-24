import { SolarGenerationWatts } from "../values/SolarGenerationWatts";

export interface SolarTelemetryPoint {
  watts: SolarGenerationWatts;
  batteryPercentage: number;
  timestamp: Date;
}

/**
 * Coleção de Primeira Classe para telemetria e cálculos estatísticos de energia solar.
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

  public calculateEstimatedEnergyWattHours(intervalSeconds: number): number {
    let sumWatts = 0;
    for (const point of this.readings) {
      point.watts.transferNumericWatts((watts) => {
        sumWatts += watts;
      });
    }

    const hoursPerInterval = intervalSeconds / 3600;
    return Math.round(sumWatts * hoursPerInterval);
  }

  public transferReadings(receiver: (items: SolarTelemetryPoint[]) => void): void {
    receiver([...this.readings]);
  }
}
