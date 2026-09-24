import { DeviceIdentifier } from "../../domain/values/DeviceIdentifier";
import { TuyaCommandCollection } from "../../domain/models/TuyaCommandCollection";
import { TuyaCredentials } from "../../domain/models/TuyaCredentials";
import { TuyaSignatureCalculator } from "../../domain/services/TuyaSignatureCalculator";

interface TuyaTokenResponseJson {
  success: boolean;
  result?: {
    access_token: string;
    expire_time: number;
  };
  msg?: string;
}

interface TuyaCommandResponseJson {
  success: boolean;
  result?: boolean;
  msg?: string;
}

interface CommandDispatchOutcome {
  isSuccess: boolean;
  errorMessage?: string;
}

/**
 * Cliente HTTP para a Tuya Cloud OpenAPI.
 * Suporta o padrão IoT Core (Standard Instruction Set) e fallback para rotas legadas:
 * - Obtenção de Token: GET /v1.0/token?grant_type=1
 * - Comandos IoT Core: POST /v1.0/iot-03/devices/{device_id}/commands
 * - Comandos Legados: POST /v1.0/devices/{device_id}/commands
 *
 * Respeita Object Calisthenics:
 * - Apenas 2 variáveis de instância (credentials e baseApiUrl)
 * - 1 ponto por linha
 * - Sem a palavra-chave else
 * - Sem abreviações nos identificadores
 * - Apenas 1 nível de indentação por método
 */
export class TuyaHttpClient {
  private readonly credentials: TuyaCredentials;
  private readonly baseApiUrl: string;

  constructor(credentials: TuyaCredentials, baseApiUrl: string) {
    this.credentials = credentials;
    this.baseApiUrl = baseApiUrl;
  }

  public async obtainAccessToken(): Promise<string> {
    const calculator = new TuyaSignatureCalculator();
    const timestampString = Date.now().toString();
    const requestPath = "/v1.0/token?grant_type=1";
    const emptyBodyHash = calculator.calculateBodyHash("");

    const stringToSign = calculator.buildStringToSign("GET", emptyBodyHash, requestPath);
    const signatureDigest = calculator.calculateTokenSignature(
      this.credentials,
      timestampString,
      stringToSign
    );

    let signatureUppercase = "";
    signatureDigest.transferUpperCase((signature: string) => {
      signatureUppercase = signature;
    });

    let clientIdentifier = "";
    this.credentials.provideAccessKey((accessKey: string) => {
      clientIdentifier = accessKey;
    });

    const fullUrl = `${this.baseApiUrl}${requestPath}`;

    let httpResponse: Response;
    try {
      httpResponse = await fetch(fullUrl, {
        method: "GET",
        headers: {
          client_id: clientIdentifier,
          sign: signatureUppercase,
          t: timestampString,
          sign_method: "HMAC-SHA256",
        },
      });
    } catch (networkError) {
      const detail = networkError instanceof Error ? networkError.message : "falha de rede";
      throw new Error(`[Tuya] Erro de rede ao conectar com a Tuya Cloud (${this.baseApiUrl}): ${detail}`);
    }

    if (!httpResponse.ok) {
      throw new Error(
        `[Tuya] Servidor Tuya retornou status HTTP ${httpResponse.status} (${httpResponse.statusText})`
      );
    }

    const jsonResponseBody = (await httpResponse.json()) as TuyaTokenResponseJson;
    if (!jsonResponseBody.success) {
      const errorMessage = jsonResponseBody.msg ?? "Verifique Client ID, Client Secret e a Região do Endpoint.";
      throw new Error(`[Tuya] Falha de autenticação (Token): ${errorMessage}`);
    }

    if (!jsonResponseBody.result) {
      throw new Error("[Tuya] A resposta da API Tuya não retornou os dados de token de acesso.");
    }

    return jsonResponseBody.result.access_token;
  }

  public async sendDeviceCommands(
    deviceIdentifier: DeviceIdentifier,
    commandCollection: TuyaCommandCollection
  ): Promise<boolean> {
    const accessToken = await this.obtainAccessToken();
    const calculator = new TuyaSignatureCalculator();
    const timestampString = Date.now().toString();

    let rawDeviceIdentifier = "";
    deviceIdentifier.transferIdentifier((identifierString: string) => {
      rawDeviceIdentifier = identifierString;
    });

    let commandPayloadList: Array<{ code: string; value: boolean }> = [];
    commandCollection.exportAsPayloadArray((payloads) => {
      commandPayloadList = payloads;
    });

    const requestBodyText = JSON.stringify({ commands: commandPayloadList });

    // 1. Rota moderna IoT Core (Device Control Standard Instruction Set): /v1.0/iot-03/devices/{device_id}/commands
    const iotCorePath = `/v1.0/iot-03/devices/${rawDeviceIdentifier}/commands`;
    const iotCoreOutcome = await this.executePostCommand(
      accessToken,
      calculator,
      timestampString,
      iotCorePath,
      requestBodyText
    );

    if (iotCoreOutcome.isSuccess) {
      return true;
    }

    // 2. Fallback para rota legada Smart Home Basic: /v1.0/devices/{device_id}/commands
    const legacyPath = `/v1.0/devices/${rawDeviceIdentifier}/commands`;
    const legacyOutcome = await this.executePostCommand(
      accessToken,
      calculator,
      timestampString,
      legacyPath,
      requestBodyText
    );

    if (legacyOutcome.isSuccess) {
      return true;
    }

    const failureReason = iotCoreOutcome.errorMessage || legacyOutcome.errorMessage || "Comando não aceito.";
    throw new Error(`[Tuya] Falha ao executar comando na tomada (${rawDeviceIdentifier}): ${failureReason}`);
  }

  private async executePostCommand(
    accessToken: string,
    calculator: TuyaSignatureCalculator,
    timestampString: string,
    requestPath: string,
    requestBodyText: string
  ): Promise<CommandDispatchOutcome> {
    const bodyHash = calculator.calculateBodyHash(requestBodyText);
    const stringToSign = calculator.buildStringToSign("POST", bodyHash, requestPath);

    const signatureDigest = calculator.calculateRequestSignature(
      this.credentials,
      accessToken,
      timestampString,
      stringToSign
    );

    let signatureUppercase = "";
    signatureDigest.transferUpperCase((signature: string) => {
      signatureUppercase = signature;
    });

    let clientIdentifier = "";
    this.credentials.provideAccessKey((accessKey: string) => {
      clientIdentifier = accessKey;
    });

    const fullUrl = `${this.baseApiUrl}${requestPath}`;

    let httpResponse: Response;
    try {
      httpResponse = await fetch(fullUrl, {
        method: "POST",
        headers: {
          client_id: clientIdentifier,
          access_token: accessToken,
          sign: signatureUppercase,
          t: timestampString,
          sign_method: "HMAC-SHA256",
          "Content-Type": "application/json",
        },
        body: requestBodyText,
      });
    } catch (networkError) {
      const detail = networkError instanceof Error ? networkError.message : "falha de rede";
      return { isSuccess: false, errorMessage: `Erro de rede: ${detail}` };
    }

    if (!httpResponse.ok) {
      return {
        isSuccess: false,
        errorMessage: `HTTP ${httpResponse.status} (${httpResponse.statusText}) em ${requestPath}`,
      };
    }

    const jsonResponseBody = (await httpResponse.json()) as TuyaCommandResponseJson;
    if (!jsonResponseBody.success) {
      return {
        isSuccess: false,
        errorMessage: jsonResponseBody.msg ?? "Comando rejeitado pela Tuya",
      };
    }

    return { isSuccess: true };
  }
}
