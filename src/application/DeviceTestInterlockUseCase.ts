import { DeviceCommandCode } from "../domain/values/DeviceCommandCode";
import { DeviceIdentifier } from "../domain/values/DeviceIdentifier";
import { DeviceSerialNumber } from "../domain/values/DeviceSerialNumber";
import { TuyaCommand } from "../domain/models/TuyaCommand";
import { TuyaCommandCollection } from "../domain/models/TuyaCommandCollection";
import { TuyaHttpClient } from "../infrastructure/http/TuyaHttpClient";
import { EcoFlowHttpClient } from "../infrastructure/http/EcoFlowHttpClient";

export interface DeviceTestResult {
  isSuccess: boolean;
  summaryMessage: string;
  tuyaMessage: string;
  ecoflowMessage: string;
}

/**
 * Caso de Uso para teste direto de acionamento com intertravamento estrito de segurança (Break-Before-Make):
 *
 * REGRA ABSOLUTA DE SEGURANÇA ELÉTRICA:
 * - O dispositivo que deve ser desarmado é SEMPRE desligado PRIMEIRO.
 * - Se o desligamento do primeiro falhar, o segundo dispositivo JAMAIS é acionado (bloqueio preventivo contra queima).
 * - Aplica-se um tempo morto (Dead-Time) de 2.500ms entre as operações para desenergização de relés e capacitores.
 *
 * Respeita Object Calisthenics:
 * - 0 variáveis de instância (serviço puro de aplicação)
 * - 1 ponto por linha
 * - Sem a palavra-chave else
 * - Sem abreviações nos identificadores
 * - Apenas um nível de indentação por método
 */
export class DeviceTestInterlockUseCase {
  private static readonly SAFETY_DEAD_TIME_MS = 2500;

  public async executeTuyaOn(
    tuyaClient: TuyaHttpClient,
    tuyaDevice: DeviceIdentifier,
    ecoflowClient: EcoFlowHttpClient,
    ecoflowDevice: DeviceSerialNumber
  ): Promise<DeviceTestResult> {
    const ecoflowOutcome = await this.dispatchEcoFlowAc(ecoflowClient, ecoflowDevice, false);
    if (!ecoflowOutcome.isSuccess) {
      return {
        isSuccess: false,
        summaryMessage:
          "ABORTADO POR SEGURANÇA: Falha ao desligar a Saída AC da EcoFlow. A Tomada Tuya NÃO foi ligada para proteger contra colisão elétrica.",
        tuyaMessage: "[Bloqueio de Segurança] Tomada Tuya permaneceu inalterada.",
        ecoflowMessage: ecoflowOutcome.message,
      };
    }

    await this.waitSafetyDeadTime();

    const tuyaOutcome = await this.dispatchTuyaSwitch(tuyaClient, tuyaDevice, true);
    const summary = tuyaOutcome.isSuccess
      ? "Intertravamento seguro concluído: Saída AC EcoFlow DESLIGADA e Tomada Tuya LIGADA."
      : "EcoFlow AC desativada com sucesso, porém houve falha ao ligar a Tomada Tuya.";

    return {
      isSuccess: tuyaOutcome.isSuccess,
      summaryMessage: summary,
      tuyaMessage: tuyaOutcome.message,
      ecoflowMessage: ecoflowOutcome.message,
    };
  }

  public async executeTuyaOff(
    tuyaClient: TuyaHttpClient,
    tuyaDevice: DeviceIdentifier,
    ecoflowClient: EcoFlowHttpClient,
    ecoflowDevice: DeviceSerialNumber
  ): Promise<DeviceTestResult> {
    const tuyaOutcome = await this.dispatchTuyaSwitch(tuyaClient, tuyaDevice, false);
    if (!tuyaOutcome.isSuccess) {
      return {
        isSuccess: false,
        summaryMessage:
          "ABORTADO POR SEGURANÇA: Falha ao desligar a Tomada Tuya. A Saída AC da EcoFlow NÃO foi ligada para evitar retorno de rede (backfeeding).",
        tuyaMessage: tuyaOutcome.message,
        ecoflowMessage: "[Bloqueio de Segurança] Saída AC EcoFlow permaneceu desligada.",
      };
    }

    await this.waitSafetyDeadTime();

    const ecoflowOutcome = await this.dispatchEcoFlowAc(ecoflowClient, ecoflowDevice, true);
    const summary = ecoflowOutcome.isSuccess
      ? "Intertravamento seguro concluído: Tomada Tuya DESLIGADA e Saída AC EcoFlow LIGADA."
      : "Tomada Tuya desligada com sucesso, porém houve falha ao ligar a Saída AC da EcoFlow.";

    return {
      isSuccess: ecoflowOutcome.isSuccess,
      summaryMessage: summary,
      tuyaMessage: tuyaOutcome.message,
      ecoflowMessage: ecoflowOutcome.message,
    };
  }

  public async executeEcoFlowOn(
    tuyaClient: TuyaHttpClient,
    tuyaDevice: DeviceIdentifier,
    ecoflowClient: EcoFlowHttpClient,
    ecoflowDevice: DeviceSerialNumber
  ): Promise<DeviceTestResult> {
    const tuyaOutcome = await this.dispatchTuyaSwitch(tuyaClient, tuyaDevice, false);
    if (!tuyaOutcome.isSuccess) {
      return {
        isSuccess: false,
        summaryMessage:
          "ABORTADO POR SEGURANÇA: Falha ao desligar a Tomada Tuya. A Saída AC da EcoFlow NÃO foi ligada para evitar queima do inversor por backfeeding.",
        tuyaMessage: tuyaOutcome.message,
        ecoflowMessage: "[Bloqueio de Segurança] Saída AC EcoFlow permaneceu desligada.",
      };
    }

    await this.waitSafetyDeadTime();

    const ecoflowOutcome = await this.dispatchEcoFlowAc(ecoflowClient, ecoflowDevice, true);
    const summary = ecoflowOutcome.isSuccess
      ? "Intertravamento seguro concluído: Tomada Tuya DESLIGADA e Saída AC EcoFlow LIGADA."
      : "Tomada Tuya desligada com sucesso, porém houve falha ao ligar a Saída AC da EcoFlow.";

    return {
      isSuccess: ecoflowOutcome.isSuccess,
      summaryMessage: summary,
      tuyaMessage: tuyaOutcome.message,
      ecoflowMessage: ecoflowOutcome.message,
    };
  }

  public async executeEcoFlowOff(
    tuyaClient: TuyaHttpClient,
    tuyaDevice: DeviceIdentifier,
    ecoflowClient: EcoFlowHttpClient,
    ecoflowDevice: DeviceSerialNumber
  ): Promise<DeviceTestResult> {
    const ecoflowOutcome = await this.dispatchEcoFlowAc(ecoflowClient, ecoflowDevice, false);
    if (!ecoflowOutcome.isSuccess) {
      return {
        isSuccess: false,
        summaryMessage:
          "ABORTADO POR SEGURANÇA: Falha ao desligar a Saída AC da EcoFlow. A Tomada Tuya NÃO foi ligada para proteger os circuitos elétricos.",
        tuyaMessage: "[Bloqueio de Segurança] Tomada Tuya permaneceu inalterada.",
        ecoflowMessage: ecoflowOutcome.message,
      };
    }

    await this.waitSafetyDeadTime();

    const tuyaOutcome = await this.dispatchTuyaSwitch(tuyaClient, tuyaDevice, true);
    const summary = tuyaOutcome.isSuccess
      ? "Intertravamento seguro concluído: Saída AC EcoFlow DESLIGADA e Tomada Tuya LIGADA."
      : "EcoFlow AC desativada com sucesso, porém houve falha ao ligar a Tomada Tuya.";

    return {
      isSuccess: tuyaOutcome.isSuccess,
      summaryMessage: summary,
      tuyaMessage: tuyaOutcome.message,
      ecoflowMessage: ecoflowOutcome.message,
    };
  }

  private async waitSafetyDeadTime(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, DeviceTestInterlockUseCase.SAFETY_DEAD_TIME_MS));
  }

  private async dispatchTuyaSwitch(
    tuyaClient: TuyaHttpClient,
    deviceIdentifier: DeviceIdentifier,
    shouldTurnOn: boolean
  ): Promise<{ isSuccess: boolean; message: string }> {
    const switchCode = DeviceCommandCode.standardSwitch();
    const command = shouldTurnOn
      ? TuyaCommand.createTurnOn(switchCode)
      : TuyaCommand.createTurnOff(switchCode);

    const collection = TuyaCommandCollection.singleCommand(command);

    try {
      await tuyaClient.sendDeviceCommands(deviceIdentifier, collection);
      const actionText = shouldTurnOn ? "ligada" : "desligada";
      return { isSuccess: true, message: `[Tuya] Tomada ${actionText} com sucesso.` };
    } catch (caughtError) {
      const errorDetail = caughtError instanceof Error ? caughtError.message : "Erro desconhecido na Tuya";
      return { isSuccess: false, message: errorDetail };
    }
  }

  private async dispatchEcoFlowAc(
    ecoflowClient: EcoFlowHttpClient,
    deviceSerialNumber: DeviceSerialNumber,
    shouldTurnOn: boolean
  ): Promise<{ isSuccess: boolean; message: string }> {
    try {
      const resultMessage = await ecoflowClient.setAcOutputState(deviceSerialNumber, shouldTurnOn);
      const isFailure = resultMessage.includes("Falha") || resultMessage.includes("Erro");
      const isSuccess = !isFailure;
      return { isSuccess, message: resultMessage };
    } catch (caughtError) {
      const errorDetail = caughtError instanceof Error ? caughtError.message : "Erro desconhecido na EcoFlow";
      return { isSuccess: false, message: errorDetail };
    }
  }
}
