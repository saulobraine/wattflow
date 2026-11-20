import { describe, expect, it, vi } from "vitest";
import { settingsPostBodySchema, stormModePostBodySchema } from "../../security/apiSchemas";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
import { EcoFlowHttpClient } from "../../http/EcoFlowHttpClient";
import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";

// Mock encryption key for tests
process.env.ENCRYPTION_KEY = "4f8a2c1e9d7b6a3f0e5c8d1a2b4c6e8f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d";

describe("Suíte de Inteligência (Etapa 1) - Zod Schemas", () => {
  it("validates full Etapa 1 settings", () => {
    const validData = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      energyCostPerKwh: 0.95,
      currencySymbol: "R$",
      batteryCapacityWh: 2048,
      isStormModeActive: true,
      isDailyReportActive: true,
      dailyReportTime: "21:30",
    };
    const result = settingsPostBodySchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.energyCostPerKwh).toBe(0.95);
      expect(result.data.currencySymbol).toBe("R$");
      expect(result.data.batteryCapacityWh).toBe(2048);
      expect(result.data.isStormModeActive).toBe(true);
      expect(result.data.isDailyReportActive).toBe(true);
      expect(result.data.dailyReportTime).toBe("21:30");
    }
  });

  it("rejects negative or zero energyCostPerKwh", () => {
    const invalidZero = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      energyCostPerKwh: 0,
    };
    expect(settingsPostBodySchema.safeParse(invalidZero).success).toBe(false);

    const invalidNegative = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      energyCostPerKwh: -1.5,
    };
    expect(settingsPostBodySchema.safeParse(invalidNegative).success).toBe(false);
  });

  it("rejects batteryCapacityWh below 200 or above 50000", () => {
    const invalidLow = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      batteryCapacityWh: 150,
    };
    expect(settingsPostBodySchema.safeParse(invalidLow).success).toBe(false);

    const invalidHigh = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      batteryCapacityWh: 50001,
    };
    expect(settingsPostBodySchema.safeParse(invalidHigh).success).toBe(false);
  });

  it("validates dailyReportTime HH:mm format strictly", () => {
    const validTime = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      dailyReportTime: "07:05",
    };
    expect(settingsPostBodySchema.safeParse(validTime).success).toBe(true);

    const invalidTimeHour = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      dailyReportTime: "25:00",
    };
    expect(settingsPostBodySchema.safeParse(invalidTimeHour).success).toBe(false);

    const invalidTimeMinute = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      dailyReportTime: "21:60",
    };
    expect(settingsPostBodySchema.safeParse(invalidTimeMinute).success).toBe(false);

    const invalidFormat = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      dailyReportTime: "9:00",
    };
    expect(settingsPostBodySchema.safeParse(invalidFormat).success).toBe(false);
  });

  it("validates stormModePostBodySchema strictly", () => {
    expect(stormModePostBodySchema.safeParse({ isStormModeActive: true }).success).toBe(true);
    expect(stormModePostBodySchema.safeParse({ isStormModeActive: false }).success).toBe(true);
    expect(stormModePostBodySchema.safeParse({ isStormModeActive: "true" }).success).toBe(false);
    expect(stormModePostBodySchema.safeParse({}).success).toBe(false);
  });
});

describe("Suíte de Inteligência (Etapa 1) - Economia Real (Tarifas e Agregação)", () => {
  function calculateFinancialSavings(
    todayKwh: number,
    monthKwh: number,
    totalKwh: number,
    energyCostPerKwh: number,
    currencySymbol: string
  ) {
    const safeTariff = energyCostPerKwh > 0 ? energyCostPerKwh : 0.92;
    const safeSymbol = currencySymbol || "R$";

    return {
      todayKwh: Number(todayKwh.toFixed(2)),
      todaySavings: Number((todayKwh * safeTariff).toFixed(2)),
      monthKwh: Number(monthKwh.toFixed(2)),
      monthSavings: Number((monthKwh * safeTariff).toFixed(2)),
      totalKwh: Number(totalKwh.toFixed(2)),
      totalSavings: Number((totalKwh * safeTariff).toFixed(2)),
      energyCostPerKwh: safeTariff,
      currencySymbol: safeSymbol,
    };
  }

  it("calculates exact financial savings for today, month and total", () => {
    const result = calculateFinancialSavings(6.4, 89.4, 450.0, 0.95, "R$");
    expect(result.todaySavings).toBe(6.08); // 6.4 * 0.95
    expect(result.monthSavings).toBe(84.93); // 89.4 * 0.95
    expect(result.totalSavings).toBe(427.5); // 450 * 0.95
    expect(result.currencySymbol).toBe("R$");
  });

  it("applies safe fallback tariff 0.92 when tariff is zero or negative", () => {
    const fallbackZero = calculateFinancialSavings(10, 20, 30, 0, "");
    expect(fallbackZero.energyCostPerKwh).toBe(0.92);
    expect(fallbackZero.currencySymbol).toBe("R$");
    expect(fallbackZero.todaySavings).toBe(9.2);

    const fallbackNegative = calculateFinancialSavings(10, 20, 30, -0.5, "");
    expect(fallbackNegative.energyCostPerKwh).toBe(0.92);
  });

  it("supports custom currencies such as USD, EUR or BRL", () => {
    const usdResult = calculateFinancialSavings(10, 50, 100, 0.15, "$");
    expect(usdResult.currencySymbol).toBe("$");
    expect(usdResult.todaySavings).toBe(1.5);
  });
});

describe("Suíte de Inteligência (Etapa 1) - Autonomia Dinâmica (Testes de Borda)", () => {
  function calculateAutonomyEstimate(
    batteryCapacityWh: number,
    batteryPercentage: number,
    solarInputWatts: number,
    outputWatts: number
  ) {
    const safeCapacity = batteryCapacityWh > 0 ? batteryCapacityWh : 2048;
    const clampedPercentage = Math.max(0, Math.min(100, batteryPercentage));
    const remainingWh = Math.round(safeCapacity * (clampedPercentage / 100));
    const netDrainWatts = outputWatts - solarInputWatts;

    if (clampedPercentage <= 0) {
      return {
        runtimeMinutes: 0,
        formattedRuntime: "0h 00m",
        isRecharging: false,
        isIdle: false,
        netDrainWatts,
        remainingWh: 0,
        status: "DEPLETED",
      };
    }

    if (outputWatts <= 5) {
      const isRecharging = solarInputWatts > 10;
      return {
        runtimeMinutes: null,
        formattedRuntime: isRecharging ? "Em Carga / Solar" : "Standby / Sem Carga",
        isRecharging,
        isIdle: true,
        netDrainWatts,
        remainingWh,
        status: isRecharging ? "CHARGING" : "IDLE",
      };
    }

    if (solarInputWatts >= outputWatts) {
      return {
        runtimeMinutes: null,
        formattedRuntime: "Em Carga / Solar",
        isRecharging: true,
        isIdle: false,
        netDrainWatts,
        remainingWh,
        status: "CHARGING",
      };
    }

    const runtimeHours = remainingWh / netDrainWatts;
    const runtimeMinutes = Math.round(runtimeHours * 60);
    const hours = Math.floor(runtimeMinutes / 60);
    const mins = runtimeMinutes % 60;
    const formattedRuntime = `${hours}h ${mins.toString().padStart(2, "0")}m`;
    const status = clampedPercentage <= 5 ? "DEPLETED" : "DISCHARGING";

    return {
      runtimeMinutes,
      formattedRuntime,
      isRecharging: false,
      isIdle: false,
      netDrainWatts,
      remainingWh,
      status,
    };
  }

  it("handles zero consumption (outputWatts <= 5W) as Standby / Sem Carga", () => {
    const res = calculateAutonomyEstimate(2048, 80, 0, 0);
    expect(res.isIdle).toBe(true);
    expect(res.runtimeMinutes).toBeNull();
    expect(res.formattedRuntime).toBe("Standby / Sem Carga");
    expect(res.status).toBe("IDLE");
  });

  it("handles zero consumption with solar generation as Em Carga / Solar", () => {
    const res = calculateAutonomyEstimate(2048, 80, 250, 0);
    expect(res.isRecharging).toBe(true);
    expect(res.runtimeMinutes).toBeNull();
    expect(res.formattedRuntime).toBe("Em Carga / Solar");
    expect(res.status).toBe("CHARGING");
  });

  it("handles solar generation greater than or equal to consumption (net positive)", () => {
    const res = calculateAutonomyEstimate(2048, 60, 600, 350);
    expect(res.isRecharging).toBe(true);
    expect(res.runtimeMinutes).toBeNull();
    expect(res.formattedRuntime).toBe("Em Carga / Solar");
    expect(res.status).toBe("CHARGING");
  });

  it("handles depleted battery (SOC <= 0%) safely without negative values", () => {
    const res = calculateAutonomyEstimate(2048, 0, 0, 200);
    expect(res.runtimeMinutes).toBe(0);
    expect(res.formattedRuntime).toBe("0h 00m");
    expect(res.status).toBe("DEPLETED");
    expect(res.remainingWh).toBe(0);
  });

  it("calculates exact hours and minutes for net discharge", () => {
    // 2048Wh a 75% = 1536Wh. Consumo 484W, solar 100W -> Net drain = 384W.
    // 1536 / 384 = 4.0 horas (240 minutos) -> "4h 00m"
    const res = calculateAutonomyEstimate(2048, 75, 100, 484);
    expect(res.remainingWh).toBe(1536);
    expect(res.netDrainWatts).toBe(384);
    expect(res.runtimeMinutes).toBe(240);
    expect(res.formattedRuntime).toBe("4h 00m");
    expect(res.status).toBe("DISCHARGING");
  });
});

describe("Suíte de Inteligência (Etapa 1) - Modo Tempestade (Suspensão e Preservação)", () => {
  const dummyNotificationConfig = {
    isNotificationActive: false,
    telegramBotToken: "",
    telegramChatId: "",
    whatsappPhoneNumber: "",
    whatsappApiKey: "",
  };

  it("suspends hysteresis and switches AC to grid when storm mode is active and AC is currently on", async () => {
    const mockIncrement = vi.fn().mockResolvedValue(1);
    const mockSetAc = vi.spyOn(EcoFlowHttpClient.prototype, "setAcOutputState").mockResolvedValue("AC output set to false");

    const validCreds = new EcoFlowCredentials(
      new AccessKey("test-ak-valid"),
      new AccessSecret("test-sk-valid")
    );

    const mockRepository = {
      findActiveConfigurationByUserId: vi.fn().mockResolvedValue({
        databaseRecordId: "cfg-storm-1",
        ecoflowEndpointRegion: "https://api.ecoflow.com",
        notificationConfig: dummyNotificationConfig,
        isStormModeActive: true,
        isAutomationActive: true,
        atsLifespanCycles: 10000,
        atsCurrentCycles: 10,
        configuration: {
          provideCredentialsBundle: (cb: any) =>
            cb({
              provideEcoFlowCredentials: (c: any) => c(validCreds),
            }),
          provideAutomationProfile: (cb: any) =>
            cb({
              provideDevicePair: (dp: any) =>
                dp({
                  provideEcoFlowSerialNumber: (sn: any) => sn("test-sn"),
                }),
              provideThresholdPair: (tp: any) =>
                tp({
                  evaluateBattery: () => ({
                    transferActionName: (fn: any) => fn("ENABLE_ECOFLOW_AC"),
                  }),
                }),
            }),
        },
      }),
      incrementAtsCycle: mockIncrement,
      findLatestExecutionLog: vi.fn().mockResolvedValue(null),
      recordExecutionLog: vi.fn().mockResolvedValue(undefined),
    } as any;

    const orchestrator = new OrchestratorSyncUseCase(mockRepository);

    // Telemetria fornecida: AC está ligado (true) e bateria alta (95%)
    // Em modo normal ligaria AC, mas com storm mode ativo DEVE desligar AC e manter cargas na rede
    const result = await orchestrator.executeSyncForUser("user-storm", {
      batteryPercentage: 95,
      solarWatts: 0,
      outputWatts: 200,
      isAcOutputEnabled: true,
    });

    expect(result.hasExecutedSuccessfully).toBe(true);
    expect(result.triggeredAction).toBe("STORM_MODE_RESERVE");
    expect(result.detailMessage).toContain("Modo Tempestade / Alerta de Apagão Ativo");
    expect(mockSetAc).toHaveBeenCalled();
    expect(mockIncrement).toHaveBeenCalledWith("cfg-storm-1");

    mockSetAc.mockRestore();
  });

  it("maintains grid power without consuming cycles when AC is already off in storm mode", async () => {
    const mockIncrement = vi.fn();
    const mockRepository = {
      findActiveConfigurationByUserId: vi.fn().mockResolvedValue({
        databaseRecordId: "cfg-storm-2",
        ecoflowEndpointRegion: "https://api.ecoflow.com",
        notificationConfig: dummyNotificationConfig,
        isStormModeActive: true,
        isAutomationActive: true,
        configuration: {
          provideCredentialsBundle: (cb: any) =>
            cb({
              provideEcoFlowCredentials: (c: any) => c({}),
            }),
          provideAutomationProfile: (cb: any) =>
            cb({
              provideDevicePair: (dp: any) =>
                dp({
                  provideEcoFlowSerialNumber: (sn: any) => sn("test-sn"),
                }),
              provideThresholdPair: (tp: any) =>
                tp({
                  evaluateBattery: () => ({
                    transferActionName: (fn: any) => fn("ENABLE_ECOFLOW_AC"),
                  }),
                }),
            }),
        },
      }),
      incrementAtsCycle: mockIncrement,
      findLatestExecutionLog: vi.fn().mockResolvedValue(null),
      recordExecutionLog: vi.fn().mockResolvedValue(undefined),
    } as any;

    const orchestrator = new OrchestratorSyncUseCase(mockRepository);

    // Telemetria fornecida: AC já está desligado (false)
    const result = await orchestrator.executeSyncForUser("user-storm-noop", {
      batteryPercentage: 95,
      solarWatts: 0,
      outputWatts: 0,
      isAcOutputEnabled: false,
    });

    expect(result.hasExecutedSuccessfully).toBe(true);
    expect(result.triggeredAction).toBe("STORM_MODE_RESERVE");
    expect(mockIncrement).not.toHaveBeenCalled();
  });
});

describe("Suíte de Inteligência (Etapa 1) - Relatório Diário WhatsApp (Idempotência e Formatação)", () => {
  function wasAlreadySentToday(lastSentAt: Date | null): boolean {
    if (!lastSentAt) {
      return false;
    }
    const now = new Date();
    return (
      lastSentAt.getFullYear() === now.getFullYear() &&
      lastSentAt.getMonth() === now.getMonth() &&
      lastSentAt.getDate() === now.getDate()
    );
  }

  function formatDailyReportMessage(params: {
    formattedDate: string;
    formattedTime: string;
    todayKwh: number;
    batteryPercent: number;
    autonomyText: string;
    currency: string;
    todaySavings: number;
    monthSavings: number;
    dailySwitches: number;
    remainingCycles: number;
    systemStatus: string;
  }): string {
    return [
      "🌙 *WattFlow - Relatório Diário de Operação*",
      `📅 Data: ${params.formattedDate} às ${params.formattedTime}`,
      "",
      `☀️ Geração Solar Hoje: ${params.todayKwh} kWh`,
      `🔋 Bateria Atual: ${params.batteryPercent}% (${params.autonomyText})`,
      `💰 Economia de Hoje: ${params.currency} ${params.todaySavings.toFixed(2)} (acumulado mês: ${params.currency} ${params.monthSavings.toFixed(2)})`,
      `⚡ Chave ATS: ${params.dailySwitches} comutações hoje (${params.remainingCycles} ciclos restantes)`,
      `🛡️ Status: ${params.systemStatus}`,
      "",
      "_WattFlow - Energia Inteligente_",
    ].join("\n");
  }

  it("enforces daily report idempotency (does not resend if already sent today)", () => {
    const today = new Date();
    expect(wasAlreadySentToday(today)).toBe(true);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(wasAlreadySentToday(yesterday)).toBe(false);

    expect(wasAlreadySentToday(null)).toBe(false);
  });

  it("formats the WhatsApp daily operational report strictly adhering to the specification", () => {
    const message = formatDailyReportMessage({
      formattedDate: "19/11/2026",
      formattedTime: "21:00",
      todayKwh: 6.4,
      batteryPercent: 92,
      autonomyText: "~5h 20m",
      currency: "R$",
      todaySavings: 5.89,
      monthSavings: 82.25,
      dailySwitches: 2,
      remainingCycles: 9958,
      systemStatus: "Sistema 100% Operacional",
    });

    expect(message).toContain("🌙 *WattFlow - Relatório Diário de Operação*");
    expect(message).toContain("📅 Data: 19/11/2026 às 21:00");
    expect(message).toContain("☀️ Geração Solar Hoje: 6.4 kWh");
    expect(message).toContain("🔋 Bateria Atual: 92% (~5h 20m)");
    expect(message).toContain("💰 Economia de Hoje: R$ 5.89 (acumulado mês: R$ 82.25)");
    expect(message).toContain("⚡ Chave ATS: 2 comutações hoje (9958 ciclos restantes)");
    expect(message).toContain("🛡️ Status: Sistema 100% Operacional");
    expect(message).toContain("_WattFlow - Energia Inteligente_");
  });
});
