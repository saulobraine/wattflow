import { DeviceSerialNumber } from "../domain/values/DeviceSerialNumber";
import { EcoFlowHttpClient } from "../infrastructure/http/EcoFlowHttpClient";

export interface EcoFlowTestResult {
  isSuccess: boolean;
  summaryMessage: string;
  ecoflowMessage: string;
  batteryPercentage?: number;
  solarWatts?: number;
  isAcOutputEnabled?: boolean | null;
}

/**
 * Caso de Uso para teste direto de conexão e controle da saída AC da estação EcoFlow.
 * Permite ao usuário validar a comutação da Chave de Transferência Automática (ATS) e a leitura de telemetria.
 *
 * Respeita Object Calisthenics:
 * - 0 variáveis de instância
 * - 1 ponto por linha
 * - Sem a palavra-chave else
 * - Sem abreviações nos identificadores
 */
export class EcoFlowTestUseCase {
  public async executeTestAc(
    ecoflowClient: EcoFlowHttpClient,
    ecoflowDevice: DeviceSerialNumber,
    enableAc: boolean
  ): Promise<EcoFlowTestResult> {
    try {
      const feedback = await ecoflowClient.setAcOutputState(ecoflowDevice, enableAc);
      const isFailed = feedback.includes("Falha") || feedback.includes("Erro");

      if (isFailed) {
        return {
          isSuccess: false,
          summaryMessage: `Falha ao ${enableAc ? "ligar" : "desligar"} a saída AC da EcoFlow.`,
          ecoflowMessage: feedback,
        };
      }

      const actionText = enableAc ? "LIGADA" : "DESLIGADA";
      const atsText = enableAc
        ? "A Chave de Transferência Automática (ATS) deve transferir as cargas para Solar/Bateria."
        : "A Chave de Transferência Automática (ATS) deve transferir as cargas para a Rede da Concessionária.";

      return {
        isSuccess: true,
        summaryMessage: `Comando executado com sucesso: Saída AC EcoFlow ${actionText}. ${atsText}`,
        ecoflowMessage: feedback,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao acionar saída AC.";
      return {
        isSuccess: false,
        summaryMessage: `Exceção ao comunicar com a EcoFlow: ${message}`,
        ecoflowMessage: message,
      };
    }
  }

  public async executeTestTelemetry(
    ecoflowClient: EcoFlowHttpClient,
    ecoflowDevice: DeviceSerialNumber
  ): Promise<EcoFlowTestResult> {
    try {
      const telemetry = await ecoflowClient.fetchDeviceTelemetry(ecoflowDevice);

      let battery = 0;
      telemetry.batteryLevel.transferBatteryPercentage((val) => {
        battery = val;
      });

      let solar = 0;
      telemetry.solarWatts.transferNumericWatts((val) => {
        solar = val;
      });

      return {
        isSuccess: true,
        summaryMessage: `Telemetria EcoFlow obtida com sucesso: Bateria ${battery}%, Geração Solar ${solar}W, Saída AC ${telemetry.isAcOutputEnabled ? "Ligada" : "Desligada"}.`,
        ecoflowMessage: "Comunicação estabelecida com a Open API da EcoFlow.",
        batteryPercentage: battery,
        solarWatts: solar,
        isAcOutputEnabled: telemetry.isAcOutputEnabled,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido na leitura de telemetria.";
      return {
        isSuccess: false,
        summaryMessage: `Falha ao obter telemetria da EcoFlow: ${message}`,
        ecoflowMessage: message,
      };
    }
  }
}
