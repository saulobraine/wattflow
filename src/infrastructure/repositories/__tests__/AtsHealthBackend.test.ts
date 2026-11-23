import { describe, expect, it, vi, beforeEach } from "vitest";
import { settingsPostBodySchema } from "../../security/apiSchemas";
import { ConfigurationRepository } from "../ConfigurationRepository";
import { OrchestratorSyncUseCase } from "../../../application/OrchestratorSyncUseCase";
import { DesiredDeviceAction } from "../../../domain/values/DesiredDeviceAction";
import { DeviceSerialNumber } from "../../../domain/values/DeviceSerialNumber";
import { encryptSecret } from "../../security/encryptionHelper";
import { calculateAtsHealth } from "../../../pages/api/statistics";

// Mock encryption key for repository decryption calls
process.env.ENCRYPTION_KEY = "4f8a2c1e9d7b6a3f0e5c8d1a2b4c6e8f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d";

describe("ATS Health - Zod Validation (settingsPostBodySchema)", () => {
  it("validates valid ATS lifespan and current cycles", () => {
    const validData = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      atsLifespanCycles: 15000,
      atsCurrentCycles: 42,
    };
    const result = settingsPostBodySchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.atsLifespanCycles).toBe(15000);
      expect(result.data.atsCurrentCycles).toBe(42);
    }
  });

  it("rejects non-integer ATS lifespan cycles", () => {
    const invalidData = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      atsLifespanCycles: 1000.5,
    };
    const result = settingsPostBodySchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("rejects negative ATS current cycles", () => {
    const invalidData = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      atsCurrentCycles: -5,
    };
    const result = settingsPostBodySchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("rejects ATS lifespan below 100", () => {
    const invalidData = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      atsLifespanCycles: 99,
    };
    const result = settingsPostBodySchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("rejects ATS lifespan above 1,000,000", () => {
    const invalidData = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
      atsLifespanCycles: 1000001,
    };
    const result = settingsPostBodySchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("allows omitting ATS cycles (optional for backwards compatibility)", () => {
    const minimalData = {
      ecoflowAccessKey: "test-ak",
      ecoflowSerialNumber: "test-sn",
    };
    const result = settingsPostBodySchema.safeParse(minimalData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.atsLifespanCycles).toBeUndefined();
      expect(result.data.atsCurrentCycles).toBeUndefined();
    }
  });
});

describe("ATS Health - ConfigurationRepository.incrementAtsCycle", () => {
  it("atomically increments atsCurrentCycles and updates atsLastSwitchedAt", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ atsCurrentCycles: 15 });
    const mockPrisma = {
      userConfiguration: {
        update: mockUpdate,
      },
    } as any;

    const repository = new ConfigurationRepository(mockPrisma);
    const newCycles = await repository.incrementAtsCycle("cfg-test-id");

    expect(newCycles).toBe(15);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "cfg-test-id" },
      data: {
        atsCurrentCycles: { increment: 1 },
        atsLastSwitchedAt: expect.any(Date),
      },
      select: { atsCurrentCycles: true },
    });
  });

  it("ensures fallback default 10000 and 0 when retrieving records with null fields", async () => {
    const mockPrisma = {
      userConfiguration: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "cfg-null-test",
            userId: "user-1",
            ecoflowEndpointRegion: "https://api.ecoflow.com",
            ecoflowAccessKey: "ak",
            ecoflowAccessSecret: encryptSecret("secret-value-1"),
            ecoflowSerialNumber: "sn-12345",
            turnOnThreshold: 90,
            turnOffThreshold: 30,
            isAutomationActive: true,
            telegramBotToken: "",
            telegramChatId: "",
            whatsappPhoneNumber: "",
            whatsappApiKey: "",
            isNotificationActive: true,
            atsLifespanCycles: null,
            atsCurrentCycles: null,
            atsLastSwitchedAt: null,
          },
        ]),
      },
    } as any;

    const repository = new ConfigurationRepository(mockPrisma);
    const records = await repository.findAllActiveConfigurations();

    expect(records).toHaveLength(1);
    expect(records[0].atsLifespanCycles).toBe(10000);
    expect(records[0].atsCurrentCycles).toBe(0);
    expect(records[0].atsLastSwitchedAt).toBeNull();
  });
});

describe("ATS Health - Orchestrator Switching & Cycle Consumption", () => {
  const dummyNotificationConfig = {
    isNotificationActive: false,
    telegramBotToken: "",
    telegramChatId: "",
    whatsappPhoneNumber: "",
    whatsappApiKey: "",
  };

  it("increments ATS cycle when switching AC from OFF to ON (Solar/Bateria)", async () => {
    const mockIncrement = vi.fn().mockResolvedValue(1);
    const mockRepository = {
      incrementAtsCycle: mockIncrement,
      findLatestExecutionLog: vi.fn().mockResolvedValue(null),
      recordExecutionLog: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockClient = {
      setAcOutputState: vi.fn().mockResolvedValue("AC output set to true"),
    } as any;

    const mockDevice = new DeviceSerialNumber("mock-sn");
    const orchestrator = new OrchestratorSyncUseCase(mockRepository);

    // Deseja LIGAR AC e o estado atual é desligado (false) -> Comutação real
    const result = await (orchestrator as any).dispatchEcoFlowAcAction(
      DesiredDeviceAction.enableEcoFlowAc(),
      mockDevice,
      mockClient,
      false, // isCurrentlyAcEnabled = false
      95,
      0,
      dummyNotificationConfig,
      "cfg-id-123"
    );

    expect(mockClient.setAcOutputState).toHaveBeenCalledWith(mockDevice, true);
    expect(mockIncrement).toHaveBeenCalledWith("cfg-id-123");
    expect(result.detailMessage).toContain("Saída AC EcoFlow LIGADA");
    expect(result.actionName).toBe("ENABLE_ECOFLOW_AC");
    expect(result.didSwitchAts).toBe(true);
  });

  it("increments ATS cycle when switching AC from ON to OFF (Concessionária)", async () => {
    const mockIncrement = vi.fn().mockResolvedValue(2);
    const mockRepository = {
      incrementAtsCycle: mockIncrement,
      findLatestExecutionLog: vi.fn().mockResolvedValue(null),
      recordExecutionLog: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockClient = {
      setAcOutputState: vi.fn().mockResolvedValue("AC output set to false"),
    } as any;

    const mockDevice = new DeviceSerialNumber("mock-sn");
    const orchestrator = new OrchestratorSyncUseCase(mockRepository);

    // Deseja DESLIGAR AC e o estado atual é ligado (true) -> Comutação real
    const result = await (orchestrator as any).dispatchEcoFlowAcAction(
      DesiredDeviceAction.disableEcoFlowAc(),
      mockDevice,
      mockClient,
      true, // isCurrentlyAcEnabled = true
      25,
      0,
      dummyNotificationConfig,
      "cfg-id-456"
    );

    expect(mockClient.setAcOutputState).toHaveBeenCalledWith(mockDevice, false);
    expect(mockIncrement).toHaveBeenCalledWith("cfg-id-456");
    expect(result.detailMessage).toContain("Saída AC EcoFlow DESLIGADA");
    expect(result.actionName).toBe("DISABLE_ECOFLOW_AC");
    expect(result.didSwitchAts).toBe(true);
  });

  it("does NOT increment ATS cycle when AC is already in the desired state (no real switching)", async () => {
    const mockIncrement = vi.fn();
    const mockRepository = {
      incrementAtsCycle: mockIncrement,
    } as any;

    const mockClient = {
      setAcOutputState: vi.fn(),
    } as any;

    const mockDevice = new DeviceSerialNumber("mock-sn");
    const orchestrator = new OrchestratorSyncUseCase(mockRepository);

    // Deseja LIGAR AC, mas já está LIGADO (isCurrentlyAcEnabled = true)
    const resultOn = await (orchestrator as any).dispatchEcoFlowAcAction(
      DesiredDeviceAction.enableEcoFlowAc(),
      mockDevice,
      mockClient,
      true,
      95,
      0,
      dummyNotificationConfig,
      "cfg-id-noop"
    );

    expect(mockClient.setAcOutputState).not.toHaveBeenCalled();
    expect(mockIncrement).not.toHaveBeenCalled();
    expect(resultOn.detailMessage).toContain("já está LIGADA");
    expect(resultOn.actionName).toBe("HOLD_CURRENT_STATE");
    expect(resultOn.didSwitchAts).toBe(false);

    // Deseja DESLIGAR AC, mas já está DESLIGADO (isCurrentlyAcEnabled = false)
    const resultOff = await (orchestrator as any).dispatchEcoFlowAcAction(
      DesiredDeviceAction.disableEcoFlowAc(),
      mockDevice,
      mockClient,
      false,
      25,
      0,
      dummyNotificationConfig,
      "cfg-id-noop"
    );

    expect(mockClient.setAcOutputState).not.toHaveBeenCalled();
    expect(mockIncrement).not.toHaveBeenCalled();
    expect(resultOff.detailMessage).toContain("já está DESLIGADA");
    expect(resultOff.actionName).toBe("HOLD_CURRENT_STATE");
    expect(resultOff.didSwitchAts).toBe(false);
  });
});

describe("ATS Health - Statistics Calculation & Edge Cases", () => {
  it("calculates 100% health for fresh ATS (0 cycles consumed)", () => {
    const health = calculateAtsHealth({ atsLifespanCycles: 10000, atsCurrentCycles: 0 }, 0, 0);
    expect(health.healthPercentage).toBe(100);
    expect(health.remainingCycles).toBe(10000);
    expect(health.status).toBe("EXCELLENT");
    expect(health.estimatedYearsRemaining).toBe(13.7); // 10000 / (2 * 365) = 13.698 -> 13.7
    expect(health.isProratedEstimate).toBe(true);
  });

  it("calculates GOOD status between 50% and 80% (e.g. 2500 cycles consumed)", () => {
    const health = calculateAtsHealth({ atsLifespanCycles: 10000, atsCurrentCycles: 2500 }, 0, 0);
    expect(health.healthPercentage).toBe(75);
    expect(health.remainingCycles).toBe(7500);
    expect(health.status).toBe("GOOD");
    expect(health.estimatedYearsRemaining).toBe(10.3); // 7500 / 730 = 10.27 -> 10.3
  });

  it("calculates ATTENTION status between 20% and 50% (e.g. 6000 cycles consumed)", () => {
    const health = calculateAtsHealth({ atsLifespanCycles: 10000, atsCurrentCycles: 6000 }, 0, 0);
    expect(health.healthPercentage).toBe(40);
    expect(health.remainingCycles).toBe(4000);
    expect(health.status).toBe("ATTENTION");
    expect(health.estimatedYearsRemaining).toBe(5.5); // 4000 / 730 = 5.479 -> 5.5
  });

  it("calculates CRITICAL status below 20% (e.g. 9000 cycles consumed)", () => {
    const health = calculateAtsHealth({ atsLifespanCycles: 10000, atsCurrentCycles: 9000 }, 0, 0);
    expect(health.healthPercentage).toBe(10);
    expect(health.remainingCycles).toBe(1000);
    expect(health.status).toBe("CRITICAL");
    expect(health.estimatedYearsRemaining).toBe(1.4); // 1000 / 730 = 1.369 -> 1.4
  });

  it("handles cycle exhaustion safely (currentCycles > lifespanCycles)", () => {
    const health = calculateAtsHealth({ atsLifespanCycles: 10000, atsCurrentCycles: 10500 }, 0, 0);
    expect(health.healthPercentage).toBe(0);
    expect(health.remainingCycles).toBe(0);
    expect(health.status).toBe("CRITICAL");
    expect(health.estimatedYearsRemaining).toBe(0);
  });

  it("accurately computes real daily rate based on 30-day switching log span", () => {
    // 30 comutações ao longo de 10 dias -> 3.0 comutações/dia
    const health = calculateAtsHealth(
      { atsLifespanCycles: 10000, atsCurrentCycles: 1000 },
      30,
      10
    );
    expect(health.dailyRate).toBe(3);
    expect(health.isProratedEstimate).toBe(false);
    expect(health.remainingCycles).toBe(9000);
    // 9000 / (3 * 365) = 9000 / 1095 = 8.219 -> 8.2 anos
    expect(health.estimatedYearsRemaining).toBe(8.2);
  });

  it("calculates canonical rate based on atsCurrentCycles divided by active days", () => {
    // 98 ciclos realizados em 30 dias ativos da configuração -> 3.27 comutações/dia
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const health = calculateAtsHealth(
      {
        atsLifespanCycles: 10000,
        atsCurrentCycles: 98,
        createdAt: thirtyDaysAgo,
      },
      0,
      0
    );

    expect(health.currentCycles).toBe(98);
    expect(health.remainingCycles).toBe(9902);
    expect(health.healthPercentage).toBe(99);
    expect(health.dailyRate).toBe(3.27);
    expect(health.isProratedEstimate).toBe(false);
    // 9902 / (3.27 * 365) = 9902 / 1193.55 = 8.296 -> 8.3 anos
    expect(health.estimatedYearsRemaining).toBe(8.3);
  });

  it("prevents physical explosion and applies sanity guard when dailyRate > 20 (corrupted polling logs)", () => {
    // Simulação do bug relatado por Baggute: 7896 logs em 2 dias -> 3948 comutações/dia
    const health = calculateAtsHealth(
      {
        atsLifespanCycles: 10000,
        atsCurrentCycles: 98,
      },
      7896,
      2
    );

    // O guard intercepta a taxa absurda (>20) e aplica o fallback de 2.0 comutações/dia
    expect(health.dailyRate).toBe(2);
    expect(health.isProratedEstimate).toBe(true);
    expect(health.remainingCycles).toBe(9902);
    // 9902 / (2 * 365) = 9902 / 730 = 13.564 -> 13.6 anos (NUNCA ~0 anos)
    expect(health.estimatedYearsRemaining).toBe(13.6);
  });

  it("prefers canonical rate over corrupted log counts when both are present", () => {
    // Caso de Baggute: 98 ciclos reais, criado há 25 dias (3.92/dia), mas com 5000 logs em 2 dias
    const twentyFiveDaysAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
    const health = calculateAtsHealth(
      {
        atsLifespanCycles: 10000,
        atsCurrentCycles: 98,
        createdAt: twentyFiveDaysAgo,
      },
      5000,
      2
    );

    // Fonte primária canônica (98 / 25 = 3.92) é usada porque está no intervalo seguro (<= 20)
    expect(health.dailyRate).toBe(3.92);
    expect(health.isProratedEstimate).toBe(false);
    // 9902 / (3.92 * 365) = 9902 / 1430.8 = 6.9 anos
    expect(health.estimatedYearsRemaining).toBe(6.9);
  });
});
