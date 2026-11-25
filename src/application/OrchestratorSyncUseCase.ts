import { ConfigurationRepository, RetrievedConfigurationRecord } from "../infrastructure/repositories/ConfigurationRepository";
import { EcoFlowHttpClient } from "../infrastructure/http/EcoFlowHttpClient";
import { DeviceSerialNumber } from "../domain/values/DeviceSerialNumber";
import { DesiredDeviceAction } from "../domain/values/DesiredDeviceAction";
import { EcoFlowCredentials } from "../domain/models/EcoFlowCredentials";
import { AutomationThresholdPair } from "../domain/models/AutomationThresholdPair";
import { PercentageValue } from "../domain/values/PercentageValue";
import { BatteryLevel } from "../domain/values/BatteryLevel";
import {
  NotificationDispatcher,
  NotificationConfig,
} from "../infrastructure/notifications/NotificationDispatcher";
import {
  OpenMeteoSolarForecastService,
  isWithinDaylightWindow,
  SolarExpectationLevel,
  WeatherRiskAssessment,
} from "../infrastructure/services/OpenMeteoSolarForecastService";
import { TariffScheduleService } from "../domain/services/TariffScheduleService";
import { CriticalAlertService } from "../infrastructure/services/CriticalAlertService";
import { SolarSmartChargingService } from "../domain/services/SolarSmartChargingService";
import { BatteryHealthService } from "../domain/services/BatteryHealthService";

export interface SyncExecutionResult {
  hasExecutedSuccessfully: boolean;
  batteryPercentage: number;
  solarWatts: number;
  outputWatts: number;
  triggeredAction: string;
  detailMessage: string;
  actionTaken?: string;
  isDaylightStandby?: boolean;
}

export interface ProvidedTelemetry {
  batteryPercentage: number | null;
  solarWatts: number;
  outputWatts: number;
  isAcOutputEnabled: boolean | null;
  batteryTempCelsius?: number | null;
  batterySoh?: number | null;
  batteryCycles?: number | null;
  deviceMaxChargeSoc?: number | null;
  deviceMinDsgSoc?: number | null;
}

/**
 * Caso de Uso principal para sincronização e automação de energia via EcoFlow.
 * Opera em conjunto com uma Chave de Transferência Automática (ATS) física:
 * - Ao atingir o limite superior de carga, liga a saída AC da EcoFlow -> ATS comuta para Solar/Bateria.
 * - Ao atingir o limite inferior de carga, desliga a saída AC da EcoFlow -> ATS comuta para a Concessionária (Rede).
 * - Dispara alertas instantâneos via Telegram e WhatsApp (CallMeBot) quando configurados.
 *
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância
 * - Sem a palavra-chave else (guard clauses e early returns)
 * - 1 ponto por linha
 * - Nomes sem abreviação
 */
export interface EcoFlowAcDispatchResult {
  detailMessage: string;
  actionName: string;
  didSwitchAts: boolean;
}

export class OrchestratorSyncUseCase {
  private readonly repository: ConfigurationRepository;
  private readonly ecoflowBaseApiUrl: string;

  constructor(
    repository: ConfigurationRepository,
    ecoflowBaseApiUrl = process.env.ECOFLOW_BASE_URL || "https://api.ecoflow.com"
  ) {
    this.repository = repository;
    this.ecoflowBaseApiUrl = ecoflowBaseApiUrl;
  }

  private static readonly activeUserSyncs = new Map<string, Promise<SyncExecutionResult>>();

  public static resetActiveUserSyncsForTests(): void {
    OrchestratorSyncUseCase.activeUserSyncs.clear();
  }

  public async executeSyncForUser(
    userId: string,
    providedTelemetry?: ProvidedTelemetry
  ): Promise<SyncExecutionResult> {
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) {
      return this.buildEmptyConfigurationResult();
    }

    const existingSync = OrchestratorSyncUseCase.activeUserSyncs.get(normalizedUserId);
    if (existingSync) {
      return await existingSync;
    }

    const syncPromise = (async () => {
      try {
        const configurationRecord = await this.repository.findActiveConfigurationByUserId(normalizedUserId);
        if (!configurationRecord) {
          return this.buildEmptyConfigurationResult();
        }
        return await this.executeSyncForRecord(configurationRecord, providedTelemetry);
      } finally {
        OrchestratorSyncUseCase.activeUserSyncs.delete(normalizedUserId);
      }
    })();

    OrchestratorSyncUseCase.activeUserSyncs.set(normalizedUserId, syncPromise);
    return await syncPromise;
  }

  public async executeSyncAll(): Promise<SyncExecutionResult[]> {
    const activeRecords = await this.repository.findAllActiveConfigurations();
    const results: SyncExecutionResult[] = [];

    for (const record of activeRecords) {
      const targetUserId = record.userId || record.databaseRecordId;
      const syncResult = await this.executeSyncForUser(targetUserId);
      results.push(syncResult);
    }

    return results;
  }

  public async executeSync(userId?: string, providedTelemetry?: ProvidedTelemetry): Promise<SyncExecutionResult> {
    if (userId) {
      return this.executeSyncForUser(userId, providedTelemetry);
    }
    return this.buildEmptyConfigurationResult();
  }

  private async executeSyncForRecord(
    configurationRecord: RetrievedConfigurationRecord,
    providedTelemetry?: ProvidedTelemetry
  ): Promise<SyncExecutionResult> {
    if (configurationRecord.isDaylightOnlyActive) {
      let isDaylight = true;
      let sunriseDisplay = "06:00";
      let sunsetDisplay = "18:00";

      if (
        typeof configurationRecord.latitude === "number" &&
        typeof configurationRecord.longitude === "number"
      ) {
        try {
          const solarService = OpenMeteoSolarForecastService.getInstance();
          const forecast = await solarService.getForecast(
            configurationRecord.latitude,
            configurationRecord.longitude,
            configurationRecord.minAdaptiveThreshold,
            configurationRecord.maxAdaptiveThreshold,
            configurationRecord.batteryCapacityWh
          );
          sunriseDisplay = forecast.sunrise ?? "06:00";
          sunsetDisplay = forecast.sunset ?? "18:00";
          isDaylight = isWithinDaylightWindow(forecast.sunrise, forecast.sunset, new Date());
        } catch (solarErr) {
          console.warn(
            "[OrchestratorSyncUseCase] Falha ao verificar janela solar para Daylight Only, usando fallback 06:00-18:00:",
            solarErr
          );
          isDaylight = isWithinDaylightWindow("06:00", "18:00", new Date());
        }
      } else {
        isDaylight = isWithinDaylightWindow("06:00", "18:00", new Date());
      }

      if (!isDaylight) {
        console.log(
          `[OrchestratorSyncUseCase] Operação Exclusiva em Período Solar ativa. Fora da janela solar (${sunriseDisplay} - ${sunsetDisplay}). Sincronização e telemetria suspensas em modo noturno (standby).`
        );
        return {
          hasExecutedSuccessfully: true,
          batteryPercentage: configurationRecord.lastBatteryPercentage ?? 0,
          solarWatts: 0,
          outputWatts: 0,
          triggeredAction: "NONE",
          actionTaken: "NONE",
          detailMessage: `Modo Noturno (Standby): Operação suspensa fora da janela solar (${sunriseDisplay} às ${sunsetDisplay}). Economia de cota e rede ativa.`,
          isDaylightStandby: true,
        };
      }
    }

    const { databaseRecordId, ecoflowEndpointRegion, notificationConfig, configuration } = configurationRecord;

    let ecoflowCredentials: EcoFlowCredentials | undefined;
    configuration.provideCredentialsBundle((bundle) => {
      bundle.provideEcoFlowCredentials((credentials) => {
        ecoflowCredentials = credentials;
      });
    });

    let ecoflowDevice: DeviceSerialNumber | undefined;
    let thresholdPair: AutomationThresholdPair | undefined;
    configuration.provideAutomationProfile((profile) => {
      profile.provideDevicePair((devices) => {
        devices.provideEcoFlowSerialNumber((serialString) => {
          ecoflowDevice = new DeviceSerialNumber(serialString);
        });
      });
      profile.provideThresholdPair((thresholds) => {
        thresholdPair = thresholds;
      });
    });

    if (!ecoflowCredentials || !ecoflowDevice || !thresholdPair) {
      throw new Error(
        "[WattFlow] Configuração incompleta: preencha as credenciais da EcoFlow na tela de Configurações."
      );
    }

    try {
      const activeEcoFlowUrl = ecoflowEndpointRegion || this.ecoflowBaseApiUrl;
      const ecoflowClient = new EcoFlowHttpClient(ecoflowCredentials, activeEcoFlowUrl);

      let numericBattery = 0;
      let numericSolarWatts = 0;
      let outputWatts = 0;
      let isAcOutputEnabled: boolean | null = null;
      let batteryLevel: BatteryLevel;
      let batteryTempCelsius: number | null = configurationRecord.lastBatteryTempCelsius;
      let batterySoh: number | null = configurationRecord.lastBatterySoh;
      let batteryCycles: number | null = configurationRecord.lastBatteryCycles;
      let deviceMaxChargeSoc: number | null = null;
      let deviceMinDsgSoc: number | null = null;

      if (providedTelemetry) {
        let candidateBattery = providedTelemetry.batteryPercentage;
        const recordedBattery = configurationRecord.lastBatteryPercentage;

        if (
          (candidateBattery === null || candidateBattery === undefined || candidateBattery <= 0) &&
          typeof recordedBattery === "number" &&
          recordedBattery > 15
        ) {
          console.warn(
            `[OrchestratorSyncUseCase] Dropout detectado na telemetria (SOC=${candidateBattery}%, anterior=${recordedBattery}%). Preservando leitura anterior para evitar corte indevido da ATS.`
          );
          candidateBattery = recordedBattery;
        }

        numericBattery = candidateBattery ?? 0;
        numericSolarWatts = providedTelemetry.solarWatts;
        outputWatts = providedTelemetry.outputWatts;
        isAcOutputEnabled = providedTelemetry.isAcOutputEnabled;
        if (providedTelemetry.batteryTempCelsius !== undefined && providedTelemetry.batteryTempCelsius !== null) {
          batteryTempCelsius = providedTelemetry.batteryTempCelsius;
        }
        if (providedTelemetry.batterySoh !== undefined && providedTelemetry.batterySoh !== null) {
          batterySoh = providedTelemetry.batterySoh;
        }
        if (providedTelemetry.batteryCycles !== undefined && providedTelemetry.batteryCycles !== null) {
          batteryCycles = providedTelemetry.batteryCycles;
        }
        if (providedTelemetry.deviceMaxChargeSoc !== undefined && providedTelemetry.deviceMaxChargeSoc !== null) {
          deviceMaxChargeSoc = providedTelemetry.deviceMaxChargeSoc;
        }
        if (providedTelemetry.deviceMinDsgSoc !== undefined && providedTelemetry.deviceMinDsgSoc !== null) {
          deviceMinDsgSoc = providedTelemetry.deviceMinDsgSoc;
        }
        batteryLevel = new BatteryLevel(numericBattery);
      } else {
        const telemetry = await ecoflowClient.fetchDeviceTelemetry(ecoflowDevice);
        batteryLevel = telemetry.batteryLevel;
        isAcOutputEnabled = telemetry.isAcOutputEnabled;
        outputWatts = telemetry.outputWatts;
        if (telemetry.deviceMaxChargeSoc !== undefined && telemetry.deviceMaxChargeSoc !== null) {
          deviceMaxChargeSoc = telemetry.deviceMaxChargeSoc;
        }
        if (telemetry.deviceMinDsgSoc !== undefined && telemetry.deviceMinDsgSoc !== null) {
          deviceMinDsgSoc = telemetry.deviceMinDsgSoc;
        }
        if (telemetry.batteryTempCelsius !== undefined && telemetry.batteryTempCelsius !== null) {
          batteryTempCelsius = telemetry.batteryTempCelsius;
        }
        if (telemetry.batterySoh !== undefined && telemetry.batterySoh !== null) {
          batterySoh = telemetry.batterySoh;
        }
        if (telemetry.batteryCycles !== undefined && telemetry.batteryCycles !== null) {
          batteryCycles = telemetry.batteryCycles;
        }

        batteryLevel.transferBatteryPercentage((percentageNumber: number) => {
          numericBattery = percentageNumber;
        });

        telemetry.solarWatts.transferNumericWatts((wattsNumber: number) => {
          numericSolarWatts = wattsNumber;
        });
      }

      const thermalService = BatteryHealthService.getInstance();
      const isThermalActive = configurationRecord.isThermalProtectionActive ?? true;
      const thermalWarning =
        configurationRecord.thermalThrottleTempThreshold ??
        configurationRecord.thermalWarningThreshold ??
        42.0;
      const thermalShutdown =
        configurationRecord.thermalCutoffTempThreshold ??
        configurationRecord.thermalShutdownThreshold ??
        48.0;
      const thermalRecovery =
        configurationRecord.thermalRecoveryTempThreshold ??
        Math.max(30, thermalShutdown - 4.0);
      const throttleSpeed = configurationRecord.thermalThrottleSpeedWatts ?? 200;

      const thermalRisk = thermalService.evaluateThermalRisk(batteryTempCelsius, {
        isThermalProtectionActive: isThermalActive,
        thermalWarningThreshold: thermalWarning,
        thermalShutdownThreshold: thermalShutdown,
        thermalRecoveryTempThreshold: thermalRecovery,
        isThermalCutoffActive: configurationRecord.isThermalCutoffActive,
      });

      const hasThermalShutdown = thermalRisk.shouldCutoff;
      const hasThermalThrottle = thermalRisk.shouldThrottle;

      if (thermalRisk.shouldRecover && configurationRecord.isThermalCutoffActive) {
        if (typeof this.repository.updateThermalState === "function") {
          await this.repository.updateThermalState(databaseRecordId, {
            isThermalCutoffActive: false,
            isThermalThrottleActive: false,
            lastThermalEventAt: new Date(),
            lastThermalActionMessage: `Bateria resfriada com sucesso (${batteryTempCelsius!.toFixed(1)}°C <= ${thermalRecovery.toFixed(1)}°C). Operação normal restabelecida.`,
          });
        }
        this.dispatchSafeAlert(
          {
            title: "🛡️ Bateria Resfriada - Normalização BMS",
            message: `A temperatura das células caiu para ${batteryTempCelsius!.toFixed(1)}°C (histerese <= ${thermalRecovery.toFixed(1)}°C). Operação normal restabelecida.`,
            batteryPercentage: numericBattery,
            solarWatts: numericSolarWatts,
            actionState: isAcOutputEnabled ? "SOLAR_BATTERY" : "GRID",
          },
          notificationConfig
        );
      }

      const isStormMode = configurationRecord.isStormModeActive;
      const isAutomationEnabled = configurationRecord.isAutomationActive;
      let autoStormRiskActive = false;
      let actionResult = "Automação pausada: telemetria registrada sem alteração da saída AC.";
      let actionName = "MONITORAMENTO";

      if (hasThermalShutdown) {
        if (isAcOutputEnabled !== false) {
          await ecoflowClient.setAcOutputState(ecoflowDevice, false);
          if (typeof this.repository.incrementAtsCycle === "function") {
            await this.repository.incrementAtsCycle(databaseRecordId);
          }
        }
        if (typeof ecoflowClient.setAcChargingSpeed === "function") {
          try {
            await ecoflowClient.setAcChargingSpeed(ecoflowDevice, 0);
            if (typeof this.repository.updateCurrentAcChargingWatts === "function") {
              await this.repository.updateCurrentAcChargingWatts(databaseRecordId, 0);
            }
          } catch (speedErr) {
            console.warn(
              "[OrchestratorSyncUseCase] Falha ao zerar recarga AC no corte térmico:",
              speedErr
            );
          }
        }
        if (typeof this.repository.updateThermalState === "function") {
          await this.repository.updateThermalState(databaseRecordId, {
            isThermalCutoffActive: true,
            isThermalThrottleActive: false,
            lastThermalEventAt: new Date(),
            lastThermalActionMessage: `Corte térmico de emergência ativado (${batteryTempCelsius!.toFixed(1)}°C >= ${thermalShutdown.toFixed(1)}°C).`,
          });
        }
        this.dispatchSafeAlert(
          {
            title: "🚨 CORTE TÉRMICO DE EMERGÊNCIA BMS",
            message: `Temperatura crítica das células atingiu ${batteryTempCelsius!.toFixed(1)}°C (limite ${thermalShutdown.toFixed(1)}°C). Saída AC desligada, recarga suspensa (0W) e cargas transferidas para a concessionária.`,
            batteryPercentage: numericBattery,
            solarWatts: numericSolarWatts,
            actionState: "GRID",
          },
          notificationConfig
        );
        actionName = "THERMAL_PROTECTION_DISARM";
        actionResult = `Proteção térmica acionada: células atingiram ${batteryTempCelsius!.toFixed(1)}°C (limiar de corte: ${thermalShutdown.toFixed(1)}°C). Saída AC desligada preventivamente e cargas transferidas para a concessionária.`;
      } else {
        if (hasThermalThrottle) {
          if (typeof ecoflowClient.setAcChargingSpeed === "function") {
            try {
              await ecoflowClient.setAcChargingSpeed(ecoflowDevice, throttleSpeed);
              if (typeof this.repository.updateCurrentAcChargingWatts === "function") {
                await this.repository.updateCurrentAcChargingWatts(databaseRecordId, throttleSpeed);
              }
            } catch (speedErr) {
              console.warn(
                "[OrchestratorSyncUseCase] Falha ao modular recarga no thermal throttling:",
                speedErr
              );
            }
          }
          if (typeof this.repository.updateThermalState === "function") {
            await this.repository.updateThermalState(databaseRecordId, {
              isThermalCutoffActive: false,
              isThermalThrottleActive: true,
              lastThermalEventAt: new Date(),
              lastThermalActionMessage: `Thermal Throttling: temperatura elevada (${batteryTempCelsius!.toFixed(1)}°C >= ${thermalWarning.toFixed(1)}°C). Recarga reduzida para ${throttleSpeed}W.`,
            });
          }
          this.dispatchSafeAlert(
            {
              title: "⚠️ Alerta de Temperatura EcoFlow",
              message: `As células da bateria atingiram ${batteryTempCelsius!.toFixed(1)}°C (limiar de alerta: ${thermalWarning.toFixed(1)}°C). Recarga AC modulada para ${throttleSpeed}W para resfriamento.`,
              batteryPercentage: numericBattery,
              solarWatts: numericSolarWatts,
              actionState: isAcOutputEnabled ? "SOLAR_BATTERY" : "GRID",
            },
            notificationConfig
          );
        }

        const inverterMax = configurationRecord.inverterMaxWatts ?? 2400;
        const isOverloaded = outputWatts >= Math.round(inverterMax * 0.9);
        if (isOverloaded) {
          CriticalAlertService.getInstance().dispatchAlert(
            databaseRecordId,
            "INVERTER_OVERLOAD",
            {
              title: "⚠️ ALERTA: SOBRECARGA DO INVERSOR",
              message: `A saída AC da EcoFlow atingiu ${outputWatts}W (90%+ da capacidade de ${inverterMax}W). Desligue equipamentos pesados imediatamente para evitar desarme.`,
              batteryPercentage: numericBattery,
              solarWatts: numericSolarWatts,
              actionState: "ALERT",
            },
            {
              isAlertOnOverload: configurationRecord.isAlertOnOverload,
              alertCooldownMinutes: configurationRecord.alertCooldownMinutes,
            },
            notificationConfig
          );
        }

        let stormAssessment: WeatherRiskAssessment | null = null;

        if (
          configurationRecord.isAutoStormActive &&
          configurationRecord.latitude !== null &&
          configurationRecord.longitude !== null
        ) {
          try {
            const forecastService = OpenMeteoSolarForecastService.getInstance();
            const rainThreshold = configurationRecord.autoStormRainThresholdMm ?? 20.0;
            stormAssessment = await forecastService.evaluateWeatherRisk(
              configurationRecord.latitude,
              configurationRecord.longitude,
              rainThreshold
            );
            autoStormRiskActive = stormAssessment.isStormRisk;

            const previousAlertActive = configurationRecord.isStormAlertActive ?? false;

            if (autoStormRiskActive && !previousAlertActive) {
              if (typeof this.repository.updateStormAlertStatus === "function") {
                await this.repository.updateStormAlertStatus(databaseRecordId, {
                  isStormAlertActive: true,
                  lastStormAlertCode: stormAssessment.weatherCode,
                  lastStormAlertDescription: stormAssessment.weatherDescription,
                  lastStormAlertTriggeredAt: new Date(),
                });
              }

              const lastTriggered = configurationRecord.lastStormAlertTriggeredAt;
              const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
              const shouldDispatchAlert =
                !lastTriggered || Date.now() - new Date(lastTriggered).getTime() > FOUR_HOURS_MS;

              if (shouldDispatchAlert) {
                this.dispatchSafeAlert(
                  {
                    title: "⛈️ ALERTA AUTO-STORM: MODO DE DEFESA ATIVADO",
                    message: `Risco de tempestade detectado (${stormAssessment.weatherDescription}, WMO ${stormAssessment.weatherCode}, Vento: ${stormAssessment.windSpeedMaxKmh} km/h, Chuva: ${stormAssessment.precipitationSumMm} mm). Cargas transferidas para a concessionária e reserva elevada para ${configurationRecord.autoStormReserveThreshold ?? 85}%.`,
                    batteryPercentage: numericBattery,
                    solarWatts: numericSolarWatts,
                    actionState: "GRID",
                  },
                  notificationConfig
                );
              }
            } else if (!autoStormRiskActive && previousAlertActive) {
              if (typeof this.repository.updateStormAlertStatus === "function") {
                await this.repository.updateStormAlertStatus(databaseRecordId, {
                  isStormAlertActive: false,
                  lastStormAlertEndedAt: new Date(),
                });
              }

              this.dispatchSafeAlert(
                {
                  title: "☀️ ALERTA METEOROLÓGICO ENCERRADO",
                  message:
                    "Condições meteorológicas normalizadas. Modo Auto-Storm desarmado e automação inteligente reestabelecida.",
                  batteryPercentage: numericBattery,
                  solarWatts: numericSolarWatts,
                  actionState: isAcOutputEnabled ? "SOLAR_BATTERY" : "GRID",
                },
                notificationConfig
              );
            }
          } catch (weatherErr) {
            console.warn(
              "[OrchestratorSyncUseCase] Falha ao avaliar risco meteorológico para Auto-Storm:",
              weatherErr
            );
          }
        }

        if (isStormMode) {
          if (isAcOutputEnabled === true) {
            await ecoflowClient.setAcOutputState(ecoflowDevice, false);
            if (typeof this.repository.incrementAtsCycle === "function") {
              await this.repository.incrementAtsCycle(databaseRecordId);
            }
            this.dispatchSafeAlert(
              {
                title: "Modo Tempestade Ativo",
                message:
                  "Saída AC desligada. Cargas comutadas para a Concessionária para preservar 100% de reserva na bateria.",
                batteryPercentage: numericBattery,
                solarWatts: numericSolarWatts,
                actionState: "GRID",
              },
              notificationConfig
            );
          }
          actionResult =
            "Modo Tempestade / Alerta de Apagão Ativo: comutação suspensa, bateria preservada em reserva máxima.";
          actionName = "STORM_MODE_RESERVE";
        } else if (isAutomationEnabled) {
          const tariffStatus = TariffScheduleService.getInstance().evaluateTariffPeriod(configurationRecord);
          const isPeakPeriod = tariffStatus.isTimeOfUseActive && tariffStatus.currentPeriod === "PEAK";
          const peakReserve =
            configurationRecord.peakDischargeReserveLimit ??
            configurationRecord.peakReserveThreshold ??
            20;

          if (isPeakPeriod) {
            // 1. Horário de Ponta (Pico) tem PREVALÊNCIA sobre Auto-Storm (prioridade financeira)
            if (configurationRecord.blockAcChargingDuringPeak ?? true) {
              if (typeof ecoflowClient.setAcChargingSpeed === "function") {
                try {
                  await ecoflowClient.setAcChargingSpeed(ecoflowDevice, 0);
                  if (typeof this.repository.updateCurrentAcChargingWatts === "function") {
                    await this.repository.updateCurrentAcChargingWatts(databaseRecordId, 0);
                  }
                } catch (chargeSpeedErr) {
                  console.warn(
                    "[OrchestratorSyncUseCase] Falha ao zerar recarga AC no horário de ponta:",
                    chargeSpeedErr
                  );
                }
              }
            }

            if (numericBattery > peakReserve) {
              if (isAcOutputEnabled !== true) {
                await ecoflowClient.setAcOutputState(ecoflowDevice, true);
                if (typeof this.repository.incrementAtsCycle === "function") {
                  await this.repository.incrementAtsCycle(databaseRecordId);
                }
                const blockNote = (configurationRecord.blockAcChargingDuringPeak ?? true)
                  ? " Recarga AC da rede bloqueada (0W)."
                  : "";
                this.dispatchSafeAlert(
                  {
                    title: "⚡ Horário de Ponta: Bateria/Solar Ativada",
                    message: `Início do Horário de Ponta (tarifa ${tariffStatus.currencySymbol} ${tariffStatus.currentRate.toFixed(2)}/kWh). Saída AC ativada para consumo prioritário da reserva da bateria (limite ${peakReserve}%).${blockNote}`,
                    batteryPercentage: numericBattery,
                    solarWatts: numericSolarWatts,
                    actionState: "SOLAR_BATTERY",
                  },
                  notificationConfig
                );
                actionName = "ENABLE_ECOFLOW_AC";
                actionResult = `Horário de Ponta Ativo: Saída AC ligada para consumo prioritário da bateria (tarifa máxima ${tariffStatus.currencySymbol} ${tariffStatus.currentRate.toFixed(2)}/kWh). ATS transferida para Bateria/Solar.`;
              } else {
                actionName = "HOLD_CURRENT_STATE";
                actionResult = `Horário de Ponta Ativo: Bateria em ${numericBattery}% preservando economia na ponta (acima da reserva de ${peakReserve}%). Saída AC mantida ligada.`;
              }
            } else {
              if (isAcOutputEnabled !== false) {
                await ecoflowClient.setAcOutputState(ecoflowDevice, false);
                if (typeof this.repository.incrementAtsCycle === "function") {
                  await this.repository.incrementAtsCycle(databaseRecordId);
                }
                this.dispatchSafeAlert(
                  {
                    title: "⚠️ Reserva de Ponta Esgotada",
                    message: `A bateria atingiu o limite de segurança da ponta (${numericBattery}% <= ${peakReserve}%). Saída AC desligada e cargas comutadas para a Concessionária.`,
                    batteryPercentage: numericBattery,
                    solarWatts: numericSolarWatts,
                    actionState: "GRID",
                  },
                  notificationConfig
                );
                actionName = "DISABLE_ECOFLOW_AC";
                actionResult = `Reserva de Ponta Atingida (${numericBattery}% <= ${peakReserve}%): Saída AC desligada para evitar descarga profunda. Cargas transferidas para a Concessionária.`;
              } else {
                actionName = "HOLD_CURRENT_STATE";
                actionResult = `Reserva de Ponta Mantida: Bateria em ${numericBattery}% (limite ${peakReserve}%). Saída AC mantida desligada na Concessionária.`;
              }
            }
          } else if (autoStormRiskActive) {
            // 2. Auto-Storm atua fora do horário de ponta (subordinado ao disjuntor geral)
            const configuredReserve = configurationRecord.autoStormReserveThreshold ?? 85;
            const reserveThreshold =
              deviceMaxChargeSoc !== null && deviceMaxChargeSoc > 0
                ? Math.min(configuredReserve, deviceMaxChargeSoc)
                : configuredReserve;

            if (isAcOutputEnabled === true) {
              await ecoflowClient.setAcOutputState(ecoflowDevice, false);
              if (typeof this.repository.incrementAtsCycle === "function") {
                await this.repository.incrementAtsCycle(databaseRecordId);
              }
              this.dispatchSafeAlert(
                {
                  title: "Modo Auto-Storm Ativo",
                  message: `Saída AC desligada preventivamente devido à aproximação de tempestade (${stormAssessment?.weatherDescription ?? "Risco Meteorológico"}). Bateria preservada para contingência.`,
                  batteryPercentage: numericBattery,
                  solarWatts: numericSolarWatts,
                  actionState: "GRID",
                },
                notificationConfig
              );
            }

            if (
              configurationRecord.autoStormPrechargeAc &&
              numericBattery < reserveThreshold
            ) {
              try {
                const maxChargeSpeed = configurationRecord.maxAcChargingWatts ?? 1200;
                await ecoflowClient.setAcChargingSpeed(ecoflowDevice, maxChargeSpeed);
                if (typeof this.repository.updateCurrentAcChargingWatts === "function") {
                  await this.repository.updateCurrentAcChargingWatts(databaseRecordId, maxChargeSpeed);
                }
              } catch (chargeErr) {
                console.warn(
                  "[OrchestratorSyncUseCase] Falha ao acionar pré-recarga rápida no Auto-Storm:",
                  chargeErr
                );
              }
            }

            actionName = "AUTO_STORM_DEFENSE";
            actionResult = `Modo Auto-Storm Ativo: risco meteorológico severo (${stormAssessment?.weatherDescription ?? "Tempestade"}). Cargas na concessionária e reserva elevada para ${reserveThreshold}%.`;
          } else {
            // 3. Histerese de Bateria (Estática ou Adaptativa se habilitada)
            let configuredUpper = 90;
            let configuredLower = 30;
            thresholdPair.transferThresholds((upper, lower) => {
              configuredUpper = upper;
              configuredLower = lower;
            });

            // Sincronização Nativa de Limites da EcoFlow:
            // Se deviceMaxChargeSoc for detectado (ex: 80%), o religamento da ATS (turnOnThreshold)
            // DEVE ser automaticamente sincronizado para o teto da EcoFlow (<= 80%),
            // religando o inversor assim que a bateria bater o limite do app e evitando que o sol continue enchendo até 97%+
            if (deviceMaxChargeSoc !== null && deviceMaxChargeSoc > 0) {
              configuredUpper = Math.min(configuredUpper, deviceMaxChargeSoc);
            }

            if (deviceMinDsgSoc !== null && deviceMinDsgSoc > 0) {
              configuredLower = Math.max(configuredLower, deviceMinDsgSoc);
            }

            const effectiveLower = Math.min(configuredLower, configuredUpper - 1);

            let activeThresholdPair = new AutomationThresholdPair(
              new PercentageValue(configuredUpper),
              new PercentageValue(effectiveLower)
            );

            if (
              configurationRecord.isAdaptiveHysteresisActive &&
              configurationRecord.latitude !== null &&
              configurationRecord.longitude !== null
            ) {
              try {
                const forecastService = OpenMeteoSolarForecastService.getInstance();
                const forecast = await forecastService.getForecast(
                  configurationRecord.latitude,
                  configurationRecord.longitude,
                  configurationRecord.minAdaptiveThreshold,
                  configurationRecord.maxAdaptiveThreshold
                );
                if (typeof this.repository.updateSolarForecast === "function") {
                  await this.repository.updateSolarForecast(databaseRecordId, forecast.irradianceMj);
                }
                const adaptiveLower = Math.min(forecast.effectiveTurnOffThreshold, configuredUpper - 1);
                activeThresholdPair = new AutomationThresholdPair(
                  new PercentageValue(configuredUpper),
                  new PercentageValue(adaptiveLower)
                );
              } catch (forecastErr) {
                console.warn(
                  "[OrchestratorSyncUseCase] Falha ao consultar previsão solar para histerese adaptativa:",
                  forecastErr
                );
              }
            }

            const desiredAction = activeThresholdPair.evaluateBattery(batteryLevel);
            const acDispatchResult = await this.dispatchEcoFlowAcAction(
              desiredAction,
              ecoflowDevice,
              ecoflowClient,
              isAcOutputEnabled,
              numericBattery,
              numericSolarWatts,
              notificationConfig,
              databaseRecordId
            );
            actionResult = acDispatchResult.detailMessage;
            actionName = acDispatchResult.actionName;
          }
        }
      }

      // Feature 3.2: Solar Smart Charging (Etapa 4)
      if (configurationRecord.isSmartChargingActive && !hasThermalShutdown) {
        let solarForecastLevel: SolarExpectationLevel | null = null;
        if (
          configurationRecord.latitude !== null &&
          configurationRecord.longitude !== null
        ) {
          try {
            const forecastService = OpenMeteoSolarForecastService.getInstance();
            const forecastData = await forecastService.getForecast(
              configurationRecord.latitude,
              configurationRecord.longitude
            );
            if (forecastData) {
              solarForecastLevel = forecastData.expectationLevel;
            }
          } catch (forecastErr) {
            console.warn("[OrchestratorSyncUseCase] Falha ao consultar previsão solar para Smart Charging:", forecastErr);
          }
        }

        const effectiveStormReserve =
          deviceMaxChargeSoc !== null && deviceMaxChargeSoc > 0
            ? Math.min(configurationRecord.autoStormReserveThreshold ?? 85, deviceMaxChargeSoc)
            : configurationRecord.autoStormReserveThreshold ?? 85;

        const smartChargingService = SolarSmartChargingService.getInstance();
        const smartChargeResult = smartChargingService.evaluate({
          isSmartChargingActive: configurationRecord.isSmartChargingActive,
          minAcChargingWatts: configurationRecord.minAcChargingWatts,
          maxAcChargingWatts: configurationRecord.maxAcChargingWatts,
          currentAcChargingWatts: configurationRecord.currentAcChargingWatts,
          chargeOnlyOffPeak: configurationRecord.chargeOnlyOffPeak,
          cloudyPrechargeActive: configurationRecord.cloudyPrechargeActive,
          isStormModeActive:
            configurationRecord.isStormModeActive ||
            (autoStormRiskActive && numericBattery < effectiveStormReserve),
          batteryPercentage: numericBattery,
          solarWatts: numericSolarWatts,
          outputWatts,
          solarForecastLevel,
          tariffConfig: configurationRecord,
        });

        const finalTargetWatts = hasThermalThrottle
          ? Math.min(smartChargeResult.targetWatts, throttleSpeed)
          : smartChargeResult.targetWatts;

        if (
          smartChargeResult.shouldSendAdjustCommand ||
          (hasThermalThrottle && smartChargeResult.targetWatts > throttleSpeed)
        ) {
          try {
            await ecoflowClient.setAcChargingSpeed(
              ecoflowDevice,
              finalTargetWatts
            );
            if (typeof this.repository.updateCurrentAcChargingWatts === "function") {
              await this.repository.updateCurrentAcChargingWatts(
                databaseRecordId,
                finalTargetWatts
              );
            }
          } catch (speedError: unknown) {
            console.error("[OrchestratorSyncUseCase] Falha ao modular velocidade de recarga AC:", speedError);
          }
        }
      }

      await this.recordExecutionLogThrottled(
        databaseRecordId,
        numericBattery,
        actionName,
        actionResult,
        numericSolarWatts,
        outputWatts,
        batteryTempCelsius,
        batterySoh,
        batteryCycles
      );

      return {
        hasExecutedSuccessfully: true,
        batteryPercentage: numericBattery,
        solarWatts: numericSolarWatts,
        outputWatts: outputWatts,
        triggeredAction: actionName,
        detailMessage: actionResult,
      };
    } catch (executionError) {
      const errorMessage =
        executionError instanceof Error ? executionError.message : "Erro desconhecido na sincronização.";

      await this.repository.recordExecutionLog(
        databaseRecordId,
        0,
        "FALHA_SINCRONIZACAO",
        errorMessage,
        0,
        0
      );

      throw executionError;
    }
  }

  private static readonly lastLoggedStatesByRecordId = new Map<
    string,
    { batteryPercentage: number; actionTriggered: string; loggedAtMs: number }
  >();

  public static resetLoggedStatesForTests(): void {
    OrchestratorSyncUseCase.lastLoggedStatesByRecordId.clear();
    OrchestratorSyncUseCase.activeUserSyncs.clear();
  }

  private async recordExecutionLogThrottled(
    databaseRecordId: string,
    numericBattery: number,
    actionName: string,
    actionResult: string,
    numericSolarWatts: number,
    outputWatts: number,
    batteryTempCelsius?: number | null,
    batterySoh?: number | null,
    batteryCycles?: number | null
  ): Promise<void> {
    const isAtsAction =
      actionName === "ENABLE_ECOFLOW_AC" ||
      actionName === "DISABLE_ECOFLOW_AC" ||
      actionName === "STORM_MODE_RESERVE" ||
      actionName === "THERMAL_PROTECTION_DISARM";

    let lastState = OrchestratorSyncUseCase.lastLoggedStatesByRecordId.get(databaseRecordId);
    if (!lastState && typeof this.repository.findLatestExecutionLog === "function") {
      const latestDbLog = await this.repository.findLatestExecutionLog(databaseRecordId);
      if (latestDbLog) {
        lastState = {
          batteryPercentage: latestDbLog.batteryPercentage,
          actionTriggered: latestDbLog.actionTriggered,
          loggedAtMs: latestDbLog.executedAt.getTime(),
        };
        OrchestratorSyncUseCase.lastLoggedStatesByRecordId.set(databaseRecordId, lastState);
      }
    }

    const now = Date.now();
    let shouldRecord = isAtsAction || !lastState;

    if (!shouldRecord && lastState) {
      const batteryDifference = Math.abs(numericBattery - lastState.batteryPercentage);
      const isActionChanged = actionName !== lastState.actionTriggered;
      const elapsedSinceLastLogMs = now - lastState.loggedAtMs;
      const MAX_IDLE_LOG_INTERVAL_MS = 300_000;

      shouldRecord =
        isActionChanged ||
        batteryDifference >= 1 ||
        elapsedSinceLastLogMs >= MAX_IDLE_LOG_INTERVAL_MS;
    }

    if (!shouldRecord) {
      return;
    }

    OrchestratorSyncUseCase.lastLoggedStatesByRecordId.set(databaseRecordId, {
      batteryPercentage: numericBattery,
      actionTriggered: actionName,
      loggedAtMs: now,
    });

    const hasBmsTelemetry =
      (batteryTempCelsius !== undefined && batteryTempCelsius !== null) ||
      (batterySoh !== undefined && batterySoh !== null) ||
      (batteryCycles !== undefined && batteryCycles !== null);

    if (hasBmsTelemetry) {
      await this.repository.recordExecutionLog(
        databaseRecordId,
        numericBattery,
        actionName,
        actionResult,
        numericSolarWatts,
        outputWatts,
        batteryTempCelsius,
        batterySoh,
        batteryCycles
      );
      if (typeof this.repository.updateBmsTelemetry === "function") {
        try {
          await this.repository.updateBmsTelemetry(databaseRecordId, {
            tempCelsius: batteryTempCelsius,
            soh: batterySoh,
            cycles: batteryCycles,
          });
        } catch (bmsUpdateErr) {
          console.warn("[OrchestratorSyncUseCase] Falha ao atualizar dados BMS no repositório:", bmsUpdateErr);
        }
      }
    } else {
      await this.repository.recordExecutionLog(
        databaseRecordId,
        numericBattery,
        actionName,
        actionResult,
        numericSolarWatts,
        outputWatts
      );
    }
  }

  private async dispatchEcoFlowAcAction(
    desiredAction: DesiredDeviceAction,
    ecoflowDevice: DeviceSerialNumber,
    ecoflowClient: EcoFlowHttpClient,
    isCurrentlyAcEnabled: boolean | null,
    batteryPercentage: number,
    solarWatts: number,
    notificationConfig: NotificationConfig,
    databaseRecordId: string
  ): Promise<EcoFlowAcDispatchResult> {
    const isEnable = desiredAction.isEnableEcoFlowAc();
    if (isEnable) {
      if (isCurrentlyAcEnabled === true) {
        return {
          detailMessage: "Bateria Alta (atingiu limite superior): Saída AC EcoFlow já está LIGADA. Chave ATS mantida em Solar/Bateria.",
          actionName: "HOLD_CURRENT_STATE",
          didSwitchAts: false,
        };
      }
      const feedback = await ecoflowClient.setAcOutputState(ecoflowDevice, true);
      if (typeof this.repository.incrementAtsCycle === "function") {
        await this.repository.incrementAtsCycle(databaseRecordId);
      }

      // Dispara notificação de comutação para Solar/Bateria
      this.dispatchSafeAlert(
        {
          title: "ATS Comutada para Solar/Bateria",
          message:
            "A bateria atingiu o limite superior configurado. A saída AC da EcoFlow foi ativada e a Chave de Transferência Automática (ATS) comutou a residência para energia solar/bateria!",
          batteryPercentage,
          solarWatts,
          actionState: "SOLAR_BATTERY",
        },
        notificationConfig
      );

      return {
        detailMessage: `Bateria Alta (atingiu limite superior): Saída AC EcoFlow LIGADA. A Chave ATS comutou para Solar/Bateria. [EcoFlow: ${feedback}]`,
        actionName: "ENABLE_ECOFLOW_AC",
        didSwitchAts: true,
      };
    }

    const isDisable = desiredAction.isDisableEcoFlowAc();
    if (isDisable) {
      if (isCurrentlyAcEnabled === false) {
        return {
          detailMessage: "Bateria Baixa (atingiu limite inferior): Saída AC EcoFlow já está DESLIGADA. Chave ATS mantida na Concessionária.",
          actionName: "HOLD_CURRENT_STATE",
          didSwitchAts: false,
        };
      }
      const feedback = await ecoflowClient.setAcOutputState(ecoflowDevice, false);
      if (typeof this.repository.incrementAtsCycle === "function") {
        await this.repository.incrementAtsCycle(databaseRecordId);
      }

      // Dispara notificação de comutação para a Concessionária
      this.dispatchSafeAlert(
        {
          title: "ATS Comutada para Concessionária",
          message:
            "A bateria desceu ao limite inferior de corte. A saída AC da EcoFlow foi desligada para preservar a bateria e a Chave ATS transferiu a residência para a rede da concessionária.",
          batteryPercentage,
          solarWatts,
          actionState: "GRID",
        },
        notificationConfig
      );

      return {
        detailMessage: `Bateria Baixa (atingiu limite inferior): Saída AC EcoFlow DESLIGADA. A Chave ATS comutou para a Rede Concessionária. [EcoFlow: ${feedback}]`,
        actionName: "DISABLE_ECOFLOW_AC",
        didSwitchAts: true,
      };
    }

    return {
      detailMessage: "Bateria em faixa intermediária (histerese). Estados atuais mantidos.",
      actionName: "HOLD_CURRENT_STATE",
      didSwitchAts: false,
    };
  }

  private dispatchSafeAlert(
    payload: {
      title: string;
      message: string;
      batteryPercentage: number;
      solarWatts: number;
      actionState: "SOLAR_BATTERY" | "GRID";
    },
    config: NotificationConfig
  ): void {
    const dispatcher = new NotificationDispatcher();
    dispatcher.dispatchNotification(payload, config).catch((err) => {
      console.error("[WattFlow Alert] Falha ao enviar notificação:", err);
    });
  }

  private buildEmptyConfigurationResult(): SyncExecutionResult {
    return {
      hasExecutedSuccessfully: false,
      batteryPercentage: 0,
      solarWatts: 0,
      outputWatts: 0,
      triggeredAction: "INACTIVE_CONFIGURATION",
      detailMessage: "Nenhuma configuração ativa foi cadastrada no banco de dados.",
    };
  }
}
