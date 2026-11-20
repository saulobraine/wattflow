import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CriticalAlertService,
  CriticalAlertType,
  CriticalAlertSettings,
} from "../CriticalAlertService";
import { NotificationConfig } from "../../notifications/NotificationDispatcher";
import { settingsPostBodySchema } from "../../security/apiSchemas";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
import {
  ConfigurationRepository,
  RetrievedConfigurationRecord,
} from "../../repositories/ConfigurationRepository";
import { DeviceSerialNumber } from "../../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { CredentialsBundle } from "../../../domain/models/CredentialsBundle";
import { DevicePair } from "../../../domain/models/DevicePair";
import { PercentageValue } from "../../../domain/values/PercentageValue";
import { AutomationThresholdPair } from "../../../domain/models/AutomationThresholdPair";
import { AutomationProfile } from "../../../domain/models/AutomationProfile";
import { OrchestratorConfiguration } from "../../../domain/models/OrchestratorConfiguration";
import { TariffScheduleService } from "../../../domain/services/TariffScheduleService";

const mockSetAcOutputState = vi.fn().mockResolvedValue("SUCCESS");
const mockFetchDeviceTelemetry = vi.fn().mockResolvedValue({
  batteryLevel: {
    transferBatteryPercentage: (fn: (v: number) => void) => fn(25),
  },
  solarWatts: {
    transferNumericWatts: (fn: (v: number) => void) => fn(0),
  },
  isAcOutputEnabled: true,
  outputWatts: 200,
});

vi.mock("../../http/EcoFlowHttpClient", () => {
  return {
    EcoFlowHttpClient: vi.fn().mockImplementation(function () {
      return {
        setAcOutputState: mockSetAcOutputState,
        fetchDeviceTelemetry: mockFetchDeviceTelemetry,
        fetchMqttCertification: vi.fn().mockResolvedValue({
          protocol: "mqtts",
          brokerHost: "mqtt.ecoflow.com",
          brokerPort: 8883,
          certificateAccount: "test-cert",
        }),
      };
    }),
  };
});

function buildMockEtapa3Record(
  databaseRecordId: string,
  overrides: Partial<RetrievedConfigurationRecord> = {}
): RetrievedConfigurationRecord {
  const credentialsBundle = new CredentialsBundle(
    new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("as-test"))
  );
  const devicePair = new DevicePair(new DeviceSerialNumber("EF-DELTA2-TEST"));
  const thresholdPair = new AutomationThresholdPair(
    new PercentageValue(90),
    new PercentageValue(30)
  );
  const profile = new AutomationProfile(devicePair, thresholdPair);
  const configuration = new OrchestratorConfiguration(credentialsBundle, profile);

  return {
    databaseRecordId,
    ecoflowEndpointRegion: "https://api.ecoflow.com",
    isAutomationActive: true,
    notificationConfig: {
      telegramBotToken: "mock-token",
      telegramChatId: "123456",
      whatsappPhoneNumber: "5511999999999",
      whatsappApiKey: "test-key",
      isNotificationActive: true,
    },
    configuration,
    atsLifespanCycles: 10000,
    atsCurrentCycles: 120,
    atsLastSwitchedAt: new Date(),
    energyCostPerKwh: 0.92,
    currencySymbol: "R$",
    batteryCapacityWh: 2048,
    isStormModeActive: false,
    isDailyReportActive: true,
    dailyReportTime: "21:00",
    lastDailyReportSentAt: null,
    latitude: -23.5505,
    longitude: -46.6333,
    isAdaptiveHysteresisActive: false,
    minAdaptiveThreshold: 20,
    maxAdaptiveThreshold: 50,
    lastSolarIrradianceMj: 21.4,
    lastSolarForecastCheckAt: new Date(),
    thermalWarningThreshold: 45.0,
    thermalShutdownThreshold: 50.0,
    lastBatteryTempCelsius: 30.0,
    lastBatterySoh: 100,
    lastBatteryCycles: 50,
    maxRecordedBatteryTemp: 35.0,
    // Etapa 3:
    isDynamicTariffActive: true,
    peakTariffPerKwh: 1.85,
    intermediateTariffPerKwh: 1.15,
    offPeakTariffPerKwh: 0.65,
    peakStartTime: "17:30",
    peakEndTime: "20:30",
    intermediateStartTime1: "16:30",
    intermediateEndTime1: "17:30",
    intermediateStartTime2: "20:30",
    intermediateEndTime2: "21:30",
    peakReserveThreshold: 15,
    inverterMaxWatts: 2400,
    isAlertOnBlackout: true,
    isAlertOnGridRestore: true,
    isAlertOnOverload: true,
    isAlertOnThermalRisk: true,
    isAlertOnAtsFailure: true,
    alertCooldownMinutes: 10,
    // Etapa 4:
    isSmartChargingActive: false,
    minAcChargingWatts: 200,
    maxAcChargingWatts: 1200,
    currentAcChargingWatts: 400,
    chargeOnlyOffPeak: true,
    cloudyPrechargeActive: true,
    lastSmartChargeAdjustAt: null,
    ...overrides,
  };
}

describe("Suíte de Inteligência Operacional - Etapa 3 (Backend)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CriticalAlertService.getInstance().clearCooldownForTests();
    OrchestratorSyncUseCase.resetLoggedStatesForTests();
  });

  describe("Feature 5.2: CriticalAlertService & Trava Anti-Flood", () => {
    const service = CriticalAlertService.getInstance();
    const userId = "user-alert-test";
    const notificationConfig: NotificationConfig = {
      telegramBotToken: "mock-token",
      telegramChatId: "123456",
      isNotificationActive: true,
    };
    const settings: CriticalAlertSettings = {
      isAlertOnBlackout: true,
      isAlertOnGridRestore: true,
      isAlertOnOverload: true,
      isAlertOnThermalRisk: true,
      isAlertOnAtsFailure: true,
      alertCooldownMinutes: 10,
    };

    it("dispara alerta com sucesso no primeiro evento", async () => {
      const result = await service.dispatchAlert(
        userId,
        "BLACKOUT_DETECTED",
        { title: "Apagão", message: "Rede concessionária caiu" },
        settings,
        notificationConfig
      );

      expect(result.wasSent).toBe(true);
      expect(result.isFlooded).toBe(false);
    });

    it("bloqueia envios repetidos dentro do período de cooldown (anti-flood)", async () => {
      const first = await service.dispatchAlert(
        userId,
        "INVERTER_OVERLOAD",
        { title: "Sobrecarga 1", message: "Inversor em 95%" },
        settings,
        notificationConfig
      );
      expect(first.wasSent).toBe(true);
      expect(first.isFlooded).toBe(false);

      // Segundo envio imediato deve ser travado como flood
      const second = await service.dispatchAlert(
        userId,
        "INVERTER_OVERLOAD",
        { title: "Sobrecarga 2", message: "Inversor ainda alto" },
        settings,
        notificationConfig
      );
      expect(second.wasSent).toBe(false);
      expect(second.isFlooded).toBe(true);
    });

    it("realiza resolução cruzada de cooldown entre BLACKOUT_DETECTED e GRID_RESTORED", async () => {
      // 1. Ocorre blecaute
      const blackout1 = await service.dispatchAlert(
        userId,
        "BLACKOUT_DETECTED",
        { title: "Blecaute 1", message: "Rede caiu" },
        settings,
        notificationConfig
      );
      expect(blackout1.wasSent).toBe(true);

      // 2. Blecaute repetido é travado
      const blackout2 = await service.dispatchAlert(
        userId,
        "BLACKOUT_DETECTED",
        { title: "Blecaute 2", message: "Rede ainda fora" },
        settings,
        notificationConfig
      );
      expect(blackout2.isFlooded).toBe(true);

      // 3. Rede retorna -> GRID_RESTORED deve resetar o cooldown de BLACKOUT_DETECTED
      const restored = await service.dispatchAlert(
        userId,
        "GRID_RESTORED",
        { title: "Rede Normalizada", message: "Energia retornou" },
        settings,
        notificationConfig
      );
      expect(restored.wasSent).toBe(true);

      // 4. Se a rede cair novamente logo em seguida, novo blecaute NÃO é tratado como flood
      const blackout3 = await service.dispatchAlert(
        userId,
        "BLACKOUT_DETECTED",
        { title: "Blecaute 3", message: "Nova oscilação na rede" },
        settings,
        notificationConfig
      );
      expect(blackout3.wasSent).toBe(true);
      expect(blackout3.isFlooded).toBe(false);
    });

    it("ignora o envio se o alerta estiver desativado nas preferências do usuário", async () => {
      const customSettings: CriticalAlertSettings = {
        ...settings,
        isAlertOnOverload: false,
      };

      const result = await service.dispatchAlert(
        userId,
        "INVERTER_OVERLOAD",
        { title: "Sobrecarga", message: "Inversor em 95%" },
        customSettings,
        notificationConfig
      );

      expect(result.wasSent).toBe(false);
      expect(result.isFlooded).toBe(false);
    });
  });

  describe("Feature 1.1: Priorização de Descarga no Horário de Ponta (OrchestratorSyncUseCase)", () => {
    it("preserva a saída AC ligada durante a Ponta quando a bateria está abaixo da histerese normal (30%), mas acima da reserva de ponta (15%)", async () => {
      vi.spyOn(TariffScheduleService.prototype, "getBrasiliaTime").mockReturnValue({
        dayOfWeek: 5, // Sexta-feira
        hours: 18,
        minutes: 0,
        timeInMinutes: 18 * 60,
        timeString: "18:00",
      });

      const record = buildMockEtapa3Record("rec-peak-priority", {
        isDynamicTariffActive: true,
        peakReserveThreshold: 15,
      });

      const mockRecordExecutionLog = vi.fn().mockResolvedValue(undefined);
      const mockIncrementAts = vi.fn().mockResolvedValue(121);
      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
        incrementAtsCycle: mockIncrementAts,
        recordExecutionLog: mockRecordExecutionLog,
        retrieveConfiguration: vi.fn(),
      } as unknown as ConfigurationRepository;

      const useCase = new OrchestratorSyncUseCase(mockRepo);

      // Bateria em 25%: normalmente desligaria (< 30%), mas como está na Ponta e > 15%, deve manter AC ligado
      const result = await useCase.executeSyncForUser("rec-peak-priority", {
        batteryPercentage: 25,
        solarWatts: 0,
        outputWatts: 300,
        isAcOutputEnabled: true,
        batteryTempCelsius: 30.0,
      });

      // Não deve ter chamado setAcOutputState(false) pois está protegendo na ponta
      expect(mockSetAcOutputState).not.toHaveBeenCalledWith(expect.anything(), false);
      expect(result.triggeredAction).toBe("HOLD_CURRENT_STATE");
      expect(result.detailMessage).toContain("Horário de Ponta Ativo");
      expect(mockRecordExecutionLog).toHaveBeenCalledWith(
        "rec-peak-priority",
        25,
        "HOLD_CURRENT_STATE",
        expect.stringContaining("Horário de Ponta Ativo"),
        0,
        300,
        30.0,
        100,
        50
      );
    });

    it("desliga a saída AC na Ponta se a bateria atingir ou cair abaixo da reserva de ponta (<= 15%)", async () => {
      vi.spyOn(TariffScheduleService.prototype, "getBrasiliaTime").mockReturnValue({
        dayOfWeek: 5,
        hours: 18,
        minutes: 0,
        timeInMinutes: 18 * 60,
        timeString: "18:00",
      });

      const record = buildMockEtapa3Record("rec-peak-depleted", {
        isDynamicTariffActive: true,
        peakReserveThreshold: 15,
      });

      const mockRecordExecutionLog = vi.fn().mockResolvedValue(undefined);
      const mockIncrementAts = vi.fn().mockResolvedValue(121);
      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
        incrementAtsCycle: mockIncrementAts,
        recordExecutionLog: mockRecordExecutionLog,
        retrieveConfiguration: vi.fn(),
      } as unknown as ConfigurationRepository;

      const useCase = new OrchestratorSyncUseCase(mockRepo);

      // Bateria em 14% (<= reserva de 15%): deve cortar para a rede concessionária
      const result = await useCase.executeSyncForUser("rec-peak-depleted", {
        batteryPercentage: 14,
        solarWatts: 0,
        outputWatts: 300,
        isAcOutputEnabled: true,
        batteryTempCelsius: 30.0,
      });

      // Deve desligar a saída AC para evitar descarga profunda
      expect(mockSetAcOutputState).toHaveBeenCalledWith(expect.anything(), false);
      expect(mockIncrementAts).toHaveBeenCalledWith("rec-peak-depleted");
      expect(result.triggeredAction).toBe("DISABLE_ECOFLOW_AC");
    });
  });

  describe("Feature 5.2: Detecção de Sobrecarga do Inversor (OrchestratorSyncUseCase)", () => {
    it("dispara alerta crítico de sobrecarga quando outputWatts >= 90% de inverterMaxWatts", async () => {
      const dispatchSpy = vi.spyOn(CriticalAlertService.getInstance(), "dispatchAlert");

      const record = buildMockEtapa3Record("rec-overload", {
        inverterMaxWatts: 2000,
        isAlertOnOverload: true,
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
        incrementAtsCycle: vi.fn(),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        retrieveConfiguration: vi.fn(),
      } as unknown as ConfigurationRepository;

      const useCase = new OrchestratorSyncUseCase(mockRepo);

      // Inversor configurado para 2000W; carga em 1850W (> 90% = 1800W)
      await useCase.executeSyncForUser("rec-overload", {
        batteryPercentage: 80,
        solarWatts: 400,
        outputWatts: 1850,
        isAcOutputEnabled: true,
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        "rec-overload",
        "INVERTER_OVERLOAD",
        expect.objectContaining({
          title: expect.stringContaining("SOBRECARGA DO INVERSOR"),
          message: expect.stringContaining("1850W"),
        }),
        expect.anything(),
        expect.anything()
      );
    });

    it("não dispara alerta quando a potência está abaixo do limite de 90%", async () => {
      const dispatchSpy = vi.spyOn(CriticalAlertService.getInstance(), "dispatchAlert");

      const record = buildMockEtapa3Record("rec-safe-load", {
        inverterMaxWatts: 2000,
        isAlertOnOverload: true,
      });

      const mockRepo = {
        findActiveConfigurationByUserId: vi.fn().mockResolvedValue(record),
        incrementAtsCycle: vi.fn(),
        recordExecutionLog: vi.fn().mockResolvedValue(undefined),
        retrieveConfiguration: vi.fn(),
      } as unknown as ConfigurationRepository;

      const useCase = new OrchestratorSyncUseCase(mockRepo);

      await useCase.executeSyncForUser("rec-safe-load", {
        batteryPercentage: 80,
        solarWatts: 400,
        outputWatts: 1500, // < 1800W (90% de 2000W)
        isAcOutputEnabled: true,
      });

      expect(dispatchSpy).not.toHaveBeenCalledWith(
        "rec-safe-load",
        "INVERTER_OVERLOAD",
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe("Validação de Segurança de Schemas da API (apiSchemas.ts)", () => {
    it("valida com sucesso payload completo da Etapa 3", () => {
      const validPayload = {
        ecoflowAccessKey: "ak-test-12345",
        ecoflowSerialNumber: "EF-DELTA2-TEST",
        isDynamicTariffActive: true,
        peakTariffPerKwh: 1.85,
        intermediateTariffPerKwh: 1.15,
        offPeakTariffPerKwh: 0.65,
        peakStartTime: "17:30",
        peakEndTime: "20:30",
        intermediateStartTime1: "16:30",
        intermediateEndTime1: "17:30",
        intermediateStartTime2: "20:30",
        intermediateEndTime2: "21:30",
        peakReserveThreshold: 15,
        inverterMaxWatts: 2400,
        isAlertOnBlackout: true,
        isAlertOnGridRestore: true,
        isAlertOnOverload: true,
        isAlertOnThermalRisk: true,
        isAlertOnAtsFailure: true,
        alertCooldownMinutes: 10,
      };

      const parsed = settingsPostBodySchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
    });

    it("rejeita formatos de hora inválidos", () => {
      const invalidTimes = ["25:00", "18:65", "invalido", "8:30"];
      for (const time of invalidTimes) {
        const res = settingsPostBodySchema.shape.peakStartTime.safeParse(time);
        expect(res.success).toBe(false);
      }
    });

    it("rejeita tarifas negativas ou limites fora do intervalo", () => {
      expect(settingsPostBodySchema.shape.peakTariffPerKwh.safeParse(-1).success).toBe(false);
      expect(settingsPostBodySchema.shape.peakReserveThreshold.safeParse(3).success).toBe(false); // min: 5
      expect(settingsPostBodySchema.shape.peakReserveThreshold.safeParse(55).success).toBe(false); // max: 50
      expect(settingsPostBodySchema.shape.alertCooldownMinutes.safeParse(0).success).toBe(false); // min: 1
      expect(settingsPostBodySchema.shape.inverterMaxWatts.safeParse(200).success).toBe(false); // min: 500
    });
  });
});
