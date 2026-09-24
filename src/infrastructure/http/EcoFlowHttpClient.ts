import { BatteryLevel } from "../../domain/values/BatteryLevel";
import { DeviceSerialNumber } from "../../domain/values/DeviceSerialNumber";
import { EcoFlowCredentials } from "../../domain/models/EcoFlowCredentials";
import { SolarGenerationWatts } from "../../domain/values/SolarGenerationWatts";
import { EcoFlowSignatureCalculator } from "../../domain/services/EcoFlowSignatureCalculator";

interface EcoFlowQuotaResponseJson {
  code: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface EcoFlowTelemetryResult {
  batteryLevel: BatteryLevel;
  solarWatts: SolarGenerationWatts;
  isAcOutputEnabled: boolean | null;
}

interface TelemetryHttpAttempt {
  isSuccessful: boolean;
  quotaData?: Record<string, unknown>;
  errorMessage?: string;
  errorCode?: string;
}

/**
 * Cliente HTTP robusto para a EcoFlow Developer Open API.
 * Implementa a especificação oficial com resiliência:
 * - Suporta múltiplos esquemas de cotas (River 2, Delta 2, Delta Pro, Delta Max)
 * - Converte strings e números retornados pela API nos valores de domínio
 * - Auto-fallback entre endpoints regionais (Global https://api.ecoflow.com e Europa https://api-e.ecoflow.com)
 * - Chaveamento AC com suporte ao padrão oficial acOutCfg e fallback para cmdSet
 * - Mensagens de erro explicitamente prefixadas com [EcoFlow]
 *
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância (credentials e baseApiUrl)
 * - 1 ponto por linha
 * - Sem a palavra-chave else
 * - Sem abreviações nos identificadores
 * - Apenas um nível de indentação por método
 */
export class EcoFlowHttpClient {
  private readonly credentials: EcoFlowCredentials;
  private readonly baseApiUrl: string;

  constructor(credentials: EcoFlowCredentials, baseApiUrl: string) {
    this.credentials = credentials;
    this.baseApiUrl = baseApiUrl;
  }

  public async fetchDeviceTelemetry(serialNumber: DeviceSerialNumber): Promise<EcoFlowTelemetryResult> {
    let rawSerialNumber = "";
    serialNumber.transferSerialNumber((serialString: string) => {
      rawSerialNumber = serialString;
    });

    const primaryAttempt = await this.performTelemetryRequest(this.baseApiUrl, rawSerialNumber);
    if (primaryAttempt.isSuccessful && primaryAttempt.quotaData) {
      return this.assembleTelemetryResult(primaryAttempt.quotaData);
    }

    const alternateUrl = this.resolveAlternativeEndpoint(this.baseApiUrl);
    const shouldTryAlternate =
      primaryAttempt.errorMessage?.toLowerCase().includes("accesskey") ||
      primaryAttempt.errorCode === "401";

    if (shouldTryAlternate) {
      const alternateAttempt = await this.performTelemetryRequest(alternateUrl, rawSerialNumber);
      if (alternateAttempt.isSuccessful && alternateAttempt.quotaData) {
        return this.assembleTelemetryResult(alternateAttempt.quotaData);
      }
    }

    this.raiseTelemetryError(primaryAttempt);
  }

  public async fetchBatteryLevel(serialNumber: DeviceSerialNumber): Promise<BatteryLevel> {
    const telemetry = await this.fetchDeviceTelemetry(serialNumber);
    return telemetry.batteryLevel;
  }

  /**
   * Aciona ou desativa a saída de corrente alternada (AC) da estação EcoFlow.
   * Suporta o formato oficial acOutCfg (River 2 / Delta 2) com fallback para cmdSet (Delta Pro).
   */
  public async setAcOutputState(serialNumber: DeviceSerialNumber, isEnabled: boolean): Promise<string> {
    let rawSerialNumber = "";
    serialNumber.transferSerialNumber((serialString: string) => {
      rawSerialNumber = serialString;
    });

    const standardResult = await this.dispatchStandardAcCommand(rawSerialNumber, isEnabled, this.baseApiUrl);
    if (standardResult.isSuccess) {
      const stateLabel = isEnabled ? "ligada" : "desligada";
      return `[EcoFlow] Saída AC ${stateLabel} com sucesso (moduleType 5 acOutCfg).`;
    }

    const inverterResult = await this.dispatchInverterAcCommand(rawSerialNumber, isEnabled, this.baseApiUrl);
    if (inverterResult.isSuccess) {
      const stateLabel = isEnabled ? "ligada" : "desligada";
      return `[EcoFlow] Saída AC ${stateLabel} com sucesso (moduleType 3 acOutCfg).`;
    }

    const explicitResult = await this.dispatchExplicitAcCommand(rawSerialNumber, isEnabled, this.baseApiUrl);
    if (explicitResult.isSuccess) {
      const stateLabel = isEnabled ? "ligada" : "desligada";
      return `[EcoFlow] Saída AC ${stateLabel} com sucesso (explicit acOutCfg).`;
    }

    const cmdSetResult = await this.dispatchCmdSetAcCommand(rawSerialNumber, isEnabled, this.baseApiUrl);
    if (cmdSetResult.isSuccess) {
      const stateLabel = isEnabled ? "ligada" : "desligada";
      return `[EcoFlow] Saída AC ${stateLabel} com sucesso (cmdSet 32).`;
    }

    const failureDetail =
      standardResult.errorMessage ||
      inverterResult.errorMessage ||
      explicitResult.errorMessage ||
      cmdSetResult.errorMessage ||
      "Comando não aceito pelos servidores da EcoFlow.";

    return `[EcoFlow] Falha ao acionar saída AC: ${failureDetail}`;
  }

  private async performTelemetryRequest(targetBaseUrl: string, serialNumber: string): Promise<TelemetryHttpAttempt> {
    const timestampString = Date.now().toString();
    const nonceString = Math.floor(100000 + Math.random() * 900000).toString();
    const queryParameters: Record<string, unknown> = { sn: serialNumber };

    const calculator = new EcoFlowSignatureCalculator();
    const { signatureDigest, rawAccessKey } = calculator.calculateSignature(
      this.credentials,
      queryParameters,
      nonceString,
      timestampString
    );

    let signatureHex = "";
    signatureDigest.transferDigest((digestString: string) => {
      signatureHex = digestString;
    });

    const requestUrl = `${targetBaseUrl}/iot-open/sign/device/quota/all?sn=${serialNumber}`;

    let httpResponse: Response;
    try {
      httpResponse = await fetch(requestUrl, {
        method: "GET",
        headers: {
          accessKey: rawAccessKey,
          nonce: nonceString,
          timestamp: timestampString,
          sign: signatureHex,
        },
      });
    } catch (networkError) {
      const detail = networkError instanceof Error ? networkError.message : "falha de conexão";
      return { isSuccessful: false, errorMessage: `Erro de rede (${targetBaseUrl}): ${detail}` };
    }

    if (!httpResponse.ok) {
      return {
        isSuccessful: false,
        errorMessage: `HTTP ${httpResponse.status} (${httpResponse.statusText}) em ${targetBaseUrl}`,
      };
    }

    const responseJson = (await httpResponse.json()) as EcoFlowQuotaResponseJson;
    if (responseJson.code !== "0") {
      return {
        isSuccessful: false,
        errorCode: responseJson.code,
        errorMessage: responseJson.message ?? `código ${responseJson.code}`,
      };
    }

    return {
      isSuccessful: true,
      quotaData: responseJson.data ?? {},
    };
  }

  private assembleTelemetryResult(quotaData: Record<string, unknown>): EcoFlowTelemetryResult {
    const extractedPercentage = this.extractSocFromQuota(quotaData);
    const extractedSolarWatts = this.extractSolarWattsFromQuota(quotaData);
    const extractedAcState = this.extractAcStateFromQuota(quotaData);

    return {
      batteryLevel: new BatteryLevel(extractedPercentage),
      solarWatts: new SolarGenerationWatts(extractedSolarWatts),
      isAcOutputEnabled: extractedAcState,
    };
  }

  private raiseTelemetryError(attempt: TelemetryHttpAttempt): never {
    const rawMessage = attempt.errorMessage ?? "Falha de comunicação com a EcoFlow.";
    const isAccessKeyInvalid = rawMessage.toLowerCase().includes("accesskey");

    if (isAccessKeyInvalid) {
      throw new Error(
        `[EcoFlow] Falha de autenticação (accessKey is invalid): As chaves de acesso informadas não foram reconhecidas nos servidores da EcoFlow (testado em ${this.baseApiUrl}). Verifique suas chaves no Developer Portal da EcoFlow.`
      );
    }

    throw new Error(`[EcoFlow] ${rawMessage}`);
  }

  private resolveAlternativeEndpoint(currentUrl: string): string {
    const isEurope = currentUrl.includes("api-e.ecoflow.com");
    if (isEurope) {
      return "https://api.ecoflow.com";
    }
    return "https://api-e.ecoflow.com";
  }

  private async dispatchStandardAcCommand(
    serialNumber: string,
    isEnabled: boolean,
    targetBaseUrl: string
  ): Promise<{ isSuccess: boolean; errorMessage?: string }> {
    const timestampString = Date.now().toString();
    const nonceString = Math.floor(100000 + Math.random() * 900000).toString();
    const requestId = Math.floor(100 + Math.random() * 900);
    const enabledNumericValue = isEnabled ? 1 : 0;

    const requestBody: Record<string, unknown> = {
      sn: serialNumber,
      id: requestId,
      version: "1.0",
      moduleType: 5,
      operateType: "acOutCfg",
      params: {
        enabled: enabledNumericValue,
        xboost: enabledNumericValue,
        out_voltage: -1,
        out_freq: 255,
      },
    };

    return this.sendPutCommand(targetBaseUrl, requestBody, nonceString, timestampString);
  }

  private async dispatchInverterAcCommand(
    serialNumber: string,
    isEnabled: boolean,
    targetBaseUrl: string
  ): Promise<{ isSuccess: boolean; errorMessage?: string }> {
    const timestampString = Date.now().toString();
    const nonceString = Math.floor(100000 + Math.random() * 900000).toString();
    const requestId = Math.floor(100 + Math.random() * 900);
    const enabledNumericValue = isEnabled ? 1 : 0;

    const requestBody: Record<string, unknown> = {
      sn: serialNumber,
      id: requestId,
      version: "1.0",
      moduleType: 3,
      operateType: "acOutCfg",
      params: {
        enabled: enabledNumericValue,
        xboost: enabledNumericValue,
        out_voltage: -1,
        out_freq: 255,
      },
    };

    return this.sendPutCommand(targetBaseUrl, requestBody, nonceString, timestampString);
  }

  private async dispatchExplicitAcCommand(
    serialNumber: string,
    isEnabled: boolean,
    targetBaseUrl: string
  ): Promise<{ isSuccess: boolean; errorMessage?: string }> {
    const timestampString = Date.now().toString();
    const nonceString = Math.floor(100000 + Math.random() * 900000).toString();
    const requestId = Math.floor(100 + Math.random() * 900);
    const enabledNumericValue = isEnabled ? 1 : 0;

    const requestBody: Record<string, unknown> = {
      sn: serialNumber,
      id: requestId,
      version: "1.0",
      moduleType: 5,
      operateType: "acOutCfg",
      params: {
        enabled: enabledNumericValue,
        xboost: enabledNumericValue,
        out_voltage: 120,
        out_freq: 2,
      },
    };

    return this.sendPutCommand(targetBaseUrl, requestBody, nonceString, timestampString);
  }

  private async dispatchCmdSetAcCommand(
    serialNumber: string,
    isEnabled: boolean,
    targetBaseUrl: string
  ): Promise<{ isSuccess: boolean; errorMessage?: string }> {
    const timestampString = Date.now().toString();
    const nonceString = Math.floor(100000 + Math.random() * 900000).toString();
    const enabledNumericValue = isEnabled ? 1 : 0;

    const requestBody: Record<string, unknown> = {
      sn: serialNumber,
      params: {
        cmdSet: 32,
        id: 66,
        enabled: enabledNumericValue,
      },
    };

    return this.sendPutCommand(targetBaseUrl, requestBody, nonceString, timestampString);
  }

  private async sendPutCommand(
    targetBaseUrl: string,
    requestBody: Record<string, unknown>,
    nonceString: string,
    timestampString: string
  ): Promise<{ isSuccess: boolean; errorMessage?: string }> {
    const calculator = new EcoFlowSignatureCalculator();
    const { signatureDigest, rawAccessKey } = calculator.calculateSignature(
      this.credentials,
      requestBody,
      nonceString,
      timestampString
    );

    let signatureHex = "";
    signatureDigest.transferDigest((digestString: string) => {
      signatureHex = digestString;
    });

    const requestUrl = `${targetBaseUrl}/iot-open/sign/device/quota`;

    let httpResponse: Response;
    try {
      httpResponse = await fetch(requestUrl, {
        method: "PUT",
        headers: {
          accessKey: rawAccessKey,
          nonce: nonceString,
          timestamp: timestampString,
          sign: signatureHex,
          "Content-Type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify(requestBody),
      });
    } catch (networkError) {
      const detail = networkError instanceof Error ? networkError.message : "falha de rede";
      return { isSuccess: false, errorMessage: `Erro de rede: ${detail}` };
    }

    if (!httpResponse.ok) {
      return { isSuccess: false, errorMessage: `HTTP ${httpResponse.status} (${httpResponse.statusText})` };
    }

    const responseJson = (await httpResponse.json()) as EcoFlowQuotaResponseJson;
    console.log(`[EcoFlowHttpClient] PUT /quota retorno (${httpResponse.status}):`, JSON.stringify(responseJson));
    if (responseJson.code !== "0") {
      return { isSuccess: false, errorMessage: responseJson.message ?? `código ${responseJson.code}` };
    }

    return { isSuccess: true };
  }

  private extractSocFromQuota(quotaData: Record<string, unknown>): number {
    const candidateKeys = [
      "pd.soc",
      "soc",
      "bmsMaster.soc",
      "bmsMaster.f32ShowSoc",
      "bms_bmsStatus.soc",
      "bms_emsStatus.f32ShowSoc",
      "bms_emsStatus.lcdShowSoc",
      "pd.bpPowerSoc",
      "ems.soc",
    ];

    for (const key of candidateKeys) {
      const candidateValue = quotaData[key];
      const parsedNumber = this.parseNumericCandidate(candidateValue);
      const isValidPercentage = parsedNumber !== null && parsedNumber >= 0 && parsedNumber <= 100;
      if (isValidPercentage) {
        return Math.round(parsedNumber);
      }
    }

    throw new Error(
      "[EcoFlow] Métrica de nível de bateria (SoC) não localizada no retorno da EcoFlow. Verifique se o Serial Number está correto e o equipamento ligado."
    );
  }

  private extractSolarWattsFromQuota(quotaData: Record<string, unknown>): number {
    const candidateKeys = [
      "mppt.inWatts",
      "mppt.pvInWatts",
      "pd.pvInWatts",
      "solarInWatts",
      "pvInWatts",
      "bmsMaster.inputWatts",
      "inv.inputWatts",
    ];

    for (const key of candidateKeys) {
      const candidateValue = quotaData[key];
      const parsedNumber = this.parseNumericCandidate(candidateValue);
      const isPositiveWatts = parsedNumber !== null && parsedNumber >= 0;
      if (isPositiveWatts) {
        return Math.round(parsedNumber);
      }
    }

    return 0;
  }

  private extractAcStateFromQuota(quotaData: Record<string, unknown>): boolean | null {
    const candidateKeys = [
      "mppt.cfgAcEnabled",
      "inv.cfgAcEnabled",
      "inv.acOutState",
      "pd.acOutCfg",
    ];

    for (const key of candidateKeys) {
      const candidateValue = quotaData[key];
      const isEnabledState = candidateValue === 1 || candidateValue === "1" || candidateValue === true;
      if (isEnabledState) {
        return true;
      }
      const isDisabledState = candidateValue === 0 || candidateValue === "0" || candidateValue === false;
      if (isDisabledState) {
        return false;
      }
    }

    return null;
  }

  private parseNumericCandidate(candidate: unknown): number | null {
    const isDirectNumber = typeof candidate === "number" && !isNaN(candidate);
    if (isDirectNumber) {
      return candidate;
    }

    const isNonEmptyString = typeof candidate === "string" && candidate.trim().length > 0;
    if (isNonEmptyString) {
      const parsed = Number(candidate.trim());
      const isValidNumber = !isNaN(parsed);
      if (isValidNumber) {
        return parsed;
      }
    }

    return null;
  }
}
