import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { EcoFlowHttpClient } from "../../http/EcoFlowHttpClient";
import {
  ALLOWED_ECOFLOW_ENDPOINTS,
  isAllowedEcoFlowEndpointRegion,
  resolveEcoFlowEndpointRegion,
  validateEcoFlowMqttBroker,
} from "../ecoflowAllowlist";

describe("ecoflowAllowlist (SEC-02)", () => {
  describe("isAllowedEcoFlowEndpointRegion", () => {
    it("accepts official EcoFlow endpoints", () => {
      for (const endpoint of ALLOWED_ECOFLOW_ENDPOINTS) {
        expect(isAllowedEcoFlowEndpointRegion(endpoint)).toBe(true);
      }
      expect(isAllowedEcoFlowEndpointRegion("  https://api.ecoflow.com  ")).toBe(true);
      expect(isAllowedEcoFlowEndpointRegion("  https://api-e.ecoflow.com  ")).toBe(true);
    });

    it("rejects non-allowlisted URLs, insecure schemes, paths, and non-strings", () => {
      const invalidCandidates: unknown[] = [
        "",
        "   ",
        null,
        undefined,
        123,
        {},
        "http://api.ecoflow.com",
        "https://api.ecoflow.com/",
        "https://api.ecoflow.com/iot-open",
        "https://api.ecoflow.com.evil.com",
        "https://evil.com",
        "https://169.254.169.254",
        "https://127.0.0.1:8080",
      ];

      for (const candidate of invalidCandidates) {
        expect(isAllowedEcoFlowEndpointRegion(candidate)).toBe(false);
      }
    });
  });

  describe("resolveEcoFlowEndpointRegion", () => {
    it("defaults to https://api.ecoflow.com when region is omitted or empty", () => {
      expect(resolveEcoFlowEndpointRegion()).toBe("https://api.ecoflow.com");
      expect(resolveEcoFlowEndpointRegion(undefined)).toBe("https://api.ecoflow.com");
      expect(resolveEcoFlowEndpointRegion(null)).toBe("https://api.ecoflow.com");
      expect(resolveEcoFlowEndpointRegion("")).toBe("https://api.ecoflow.com");
    });

    it("returns normalized allowed endpoint", () => {
      expect(resolveEcoFlowEndpointRegion("  https://api-e.ecoflow.com  ")).toBe(
        "https://api-e.ecoflow.com"
      );
    });

    it("throws on arbitrary or whitespace-only endpoints", () => {
      expect(() => resolveEcoFlowEndpointRegion("   ")).toThrow(/Região de endpoint EcoFlow inválida/);
      expect(() => resolveEcoFlowEndpointRegion("http://api.ecoflow.com")).toThrow(
        /Região de endpoint EcoFlow inválida/
      );
      expect(() => resolveEcoFlowEndpointRegion("https://attacker.example.com")).toThrow(
        /Região de endpoint EcoFlow inválida/
      );
    });
  });

  describe("validateEcoFlowMqttBroker", () => {
    it("accepts default and valid mqtts/8883/*.ecoflow.com brokers", () => {
      expect(validateEcoFlowMqttBroker({})).toEqual({
        protocol: "mqtts",
        host: "mqtt.ecoflow.com",
        port: 8883,
      });

      expect(
        validateEcoFlowMqttBroker({
          protocol: "mqtts",
          url: "  MQTT-E.ECOFLOW.COM ",
          port: "8883",
        })
      ).toEqual({
        protocol: "mqtts",
        host: "mqtt-e.ecoflow.com",
        port: 8883,
      });

      expect(
        validateEcoFlowMqttBroker({
          protocol: "mqtts",
          url: "eu-west-1.mqtt.ecoflow.com",
          port: 8883,
        })
      ).toEqual({
        protocol: "mqtts",
        host: "eu-west-1.mqtt.ecoflow.com",
        port: 8883,
      });
    });

    it("rejects non-mqtts protocols", () => {
      for (const protocol of ["mqtt", "ws", "wss", "tcp", ""]) {
        expect(() =>
          validateEcoFlowMqttBroker({
            protocol,
            url: "mqtt.ecoflow.com",
            port: 8883,
          })
        ).toThrow(/Protocolo de broker não permitido/);
      }
    });

    it("rejects ports other than 8883 and malformed port values", () => {
      for (const port of [1883, "1883", 8884, 0, "", "   ", "abc", "8883evil", "8883.0", NaN, Infinity]) {
        expect(() =>
          validateEcoFlowMqttBroker({
            protocol: "mqtts",
            url: "mqtt.ecoflow.com",
            port,
          })
        ).toThrow(/Porta de broker não permitida/);
      }
    });

    it("rejects hosts outside *.ecoflow.com", () => {
      const invalidHosts = [
        "ecoflow.com",
        "evil.com",
        "mqtt.ecoflow.com.evil.com",
        "127.0.0.1",
        "169.254.169.254",
        "mqtt.ecoflow.com:8883",
        "mqtt.ecoflow.com/path",
        "",
        "   ",
      ];

      for (const url of invalidHosts) {
        expect(() =>
          validateEcoFlowMqttBroker({
            protocol: "mqtts",
            url,
            port: 8883,
          })
        ).toThrow(/Domínio de broker não permitido/);
      }
    });
  });

  describe("EcoFlowHttpClient.fetchMqttCertification credential validation", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    function createClient(): EcoFlowHttpClient {
      const credentials = new EcoFlowCredentials(
        new AccessKey("test-access-key-1234"),
        new AccessSecret("test-access-secret-1234")
      );
      return new EcoFlowHttpClient(credentials, "https://api.ecoflow.com");
    }

    it("rejects missing, empty, or whitespace-only certificateAccount/certificatePassword", async () => {
      const invalidCases = [
        { certificateAccount: "", certificatePassword: "valid-password" },
        { certificateAccount: "   ", certificatePassword: "valid-password" },
        { certificateAccount: "valid-account", certificatePassword: "" },
        { certificateAccount: "valid-account", certificatePassword: "   " },
        { certificateAccount: undefined, certificatePassword: "valid-password" },
        { certificateAccount: "valid-account", certificatePassword: undefined },
      ];

      const client = createClient();

      for (const creds of invalidCases) {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            code: "0",
            data: {
              protocol: "mqtts",
              url: "mqtt.ecoflow.com",
              port: 8883,
              ...creds,
            },
          }),
        }) as unknown as typeof fetch;

        await expect(client.fetchMqttCertification()).rejects.toThrow(
          /Credenciais de certificação MQTT ausentes ou vazias/
        );
      }
    });

    it("returns validated broker and non-empty MQTT certification credentials", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: "0",
          data: {
            protocol: "mqtts",
            url: "mqtt-e.ecoflow.com",
            port: "8883",
            certificateAccount: "  open-account-123  ",
            certificatePassword: "secret-cert-password",
          },
        }),
      }) as unknown as typeof fetch;

      const client = createClient();
      const cert = await client.fetchMqttCertification();

      expect(cert).toEqual({
        protocol: "mqtts",
        url: "mqtt-e.ecoflow.com",
        port: 8883,
        certificateAccount: "open-account-123",
        certificatePassword: "secret-cert-password",
      });
    });
  });
});
