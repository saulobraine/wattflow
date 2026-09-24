import { SignatureDigest } from "../values/SignatureDigest";
import { EcoFlowCredentials } from "../models/EcoFlowCredentials";

export interface ParameterKeyValuePair {
  key: string;
  value: string;
}

/**
 * Calculador de assinatura HMAC-SHA256 para a EcoFlow Developer Open API.
 * Segue rigorosamente a especificação oficial de autenticação da EcoFlow:
 *
 * 1. Parâmetros ordenados alfabeticamente por valor ASCII de chave (com = e &)
 * 2. Objetos aninhados expandidos com notação de ponto (ex: params.cmdSet=11)
 * 3. Arrays expandidos com índice entre colchetes (ex: ids[0]=1)
 * 4. Chaves accessKey, nonce e timestamp anexadas AO FINAL da string de parâmetros
 * 5. Criptografia HMAC-SHA256 gerada a partir da Secret Key
 *
 * Respeita Object Calisthenics:
 * - 0 variáveis de instância (serviço puro de domínio)
 * - 1 ponto por linha
 * - Sem a palavra-chave else
 * - Sem abreviações nos identificadores
 * - Apenas 1 nível de indentação por método
 */
export class EcoFlowSignatureCalculator {
  public flattenParameters(source: Record<string, unknown>, prefix = ""): ParameterKeyValuePair[] {
    const collectedPairs: ParameterKeyValuePair[] = [];
    const sourceKeys = Object.keys(source);

    for (const key of sourceKeys) {
      const propertyValue = source[key];
      this.collectPropertyPairs(collectedPairs, key, propertyValue, prefix);
    }

    return collectedPairs;
  }

  private collectPropertyPairs(
    targetPairs: ParameterKeyValuePair[],
    key: string,
    propertyValue: unknown,
    prefix: string
  ): void {
    const isNullOrUndefined = propertyValue === null || propertyValue === undefined;
    if (isNullOrUndefined) {
      return;
    }

    const fullKeyName = prefix.length > 0 ? `${prefix}.${key}` : key;
    const isArray = Array.isArray(propertyValue);
    if (isArray) {
      const arrayPairs = this.flattenArray(propertyValue as unknown[], fullKeyName);
      targetPairs.push(...arrayPairs);
      return;
    }

    const isObject = typeof propertyValue === "object";
    if (isObject) {
      const nestedPairs = this.flattenParameters(propertyValue as Record<string, unknown>, fullKeyName);
      targetPairs.push(...nestedPairs);
      return;
    }

    targetPairs.push({
      key: fullKeyName,
      value: String(propertyValue),
    });
  }

  private flattenArray(sourceArray: unknown[], prefix: string): ParameterKeyValuePair[] {
    const collectedPairs: ParameterKeyValuePair[] = [];

    for (let index = 0; index < sourceArray.length; index += 1) {
      const arrayItem = sourceArray[index];
      const itemKeyName = `${prefix}[${index}]`;
      this.collectArrayItemPairs(collectedPairs, itemKeyName, arrayItem);
    }

    return collectedPairs;
  }

  private collectArrayItemPairs(
    targetPairs: ParameterKeyValuePair[],
    itemKeyName: string,
    arrayItem: unknown
  ): void {
    const isNullOrUndefined = arrayItem === null || arrayItem === undefined;
    if (isNullOrUndefined) {
      return;
    }

    const isArray = Array.isArray(arrayItem);
    if (isArray) {
      const nestedArrayPairs = this.flattenArray(arrayItem as unknown[], itemKeyName);
      targetPairs.push(...nestedArrayPairs);
      return;
    }

    const isObject = typeof arrayItem === "object";
    if (isObject) {
      const nestedObjectPairs = this.flattenParameters(arrayItem as Record<string, unknown>, itemKeyName);
      targetPairs.push(...nestedObjectPairs);
      return;
    }

    targetPairs.push({
      key: itemKeyName,
      value: String(arrayItem),
    });
  }

  public buildStringToSign(
    parameters: Record<string, unknown>,
    accessKey: string,
    nonce: string,
    timestamp: string
  ): string {
    const flattenedPairs = this.flattenParameters(parameters);
    this.sortPairsAscii(flattenedPairs);

    const parameterSegments = flattenedPairs.map((pair) => `${pair.key}=${pair.value}`);
    const joinedParameters = parameterSegments.join("&");

    const hasParameters = joinedParameters.length > 0;
    if (hasParameters) {
      return `${joinedParameters}&accessKey=${accessKey}&nonce=${nonce}&timestamp=${timestamp}`;
    }

    return `accessKey=${accessKey}&nonce=${nonce}&timestamp=${timestamp}`;
  }

  private sortPairsAscii(pairs: ParameterKeyValuePair[]): void {
    pairs.sort((pairA, pairB) => {
      const isLess = pairA.key < pairB.key;
      if (isLess) {
        return -1;
      }
      const isGreater = pairA.key > pairB.key;
      if (isGreater) {
        return 1;
      }
      return 0;
    });
  }

  public calculateSignature(
    credentials: EcoFlowCredentials,
    parameters: Record<string, unknown>,
    nonce: string,
    timestamp: string
  ): { signatureDigest: SignatureDigest; rawAccessKey: string } {
    let rawAccessKey = "";
    credentials.provideAccessKey((accessKeyString) => {
      rawAccessKey = accessKeyString;
    });

    const stringToSign = this.buildStringToSign(parameters, rawAccessKey, nonce, timestamp);
    const signatureDigest = credentials.calculateSignature(stringToSign);

    return { signatureDigest, rawAccessKey };
  }
}
