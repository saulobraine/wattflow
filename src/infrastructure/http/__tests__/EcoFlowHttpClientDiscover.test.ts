import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessKey } from "../../../domain/values/AccessKey";
import { AccessSecret } from "../../../domain/values/AccessSecret";
import { EcoFlowCredentials } from "../../../domain/models/EcoFlowCredentials";
import { EcoFlowHttpClient } from "../EcoFlowHttpClient";

describe("EcoFlowHttpClient - fetchBoundDevices", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should successfully fetch and map bound devices list", async () => {
    const mockApiResponse = {
      code: "0",
      message: "success",
      data: [
        {
          sn: "R331ZECOFLOW123",
          deviceName: "River 2 Pro - Varanda",
          productName: "RIVER 2 Pro",
          online: 1,
        },
        {
          sn: "DELTA2ECOFLOW456",
          deviceName: "Delta 2 - Sala",
          productName: "DELTA 2",
          online: 0,
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockApiResponse),
    });

    const client = new EcoFlowHttpClient(
      new EcoFlowCredentials(new AccessKey("ak-test-discover"), new AccessSecret("sk-test-discover")),
      "https://api.ecoflow.com"
    );

    const result = await client.fetchBoundDevices();

    expect(result.isSuccessful).toBe(true);
    expect(result.devices).toHaveLength(2);
    expect(result.devices[0]).toEqual({
      sn: "R331ZECOFLOW123",
      deviceName: "River 2 Pro - Varanda",
      productName: "RIVER 2 Pro",
      online: 1,
    });
    expect(result.devices[1]).toEqual({
      sn: "DELTA2ECOFLOW456",
      deviceName: "Delta 2 - Sala",
      productName: "DELTA 2",
      online: 0,
    });
  });

  it("should automatically retry with alternative endpoint when primary endpoint returns 401", async () => {
    global.fetch = vi
      .fn()
      // First attempt on api.ecoflow.com fails with 401
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ code: "401", message: "Unauthorized or Invalid AccessKey" }),
      })
      // Second attempt on alternate endpoint (api-e.ecoflow.com) succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          code: "0",
          message: "success",
          data: [
            {
              sn: "EU-RIVER2PRO-789",
              deviceName: "River 2 Pro Europa",
              productName: "RIVER 2 Pro",
              online: 1,
            },
          ],
        }),
      });

    const client = new EcoFlowHttpClient(
      new EcoFlowCredentials(new AccessKey("ak-eu-key"), new AccessSecret("sk-eu-secret")),
      "https://api.ecoflow.com"
    );

    const result = await client.fetchBoundDevices();

    expect(result.isSuccessful).toBe(true);
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].sn).toBe("EU-RIVER2PRO-789");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("should handle API failure gracefully when code is non-zero", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        code: "10001",
        message: "Device query quota exceeded",
      }),
    });

    const client = new EcoFlowHttpClient(
      new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("sk-test")),
      "https://api.ecoflow.com"
    );

    const result = await client.fetchBoundDevices();

    expect(result.isSuccessful).toBe(false);
    expect(result.devices).toHaveLength(0);
    expect(result.errorMessage).toContain("Device query quota exceeded");
  });

  it("should handle network exception gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network connection reset"));

    const client = new EcoFlowHttpClient(
      new EcoFlowCredentials(new AccessKey("ak-test"), new AccessSecret("sk-test")),
      "https://api.ecoflow.com"
    );

    const result = await client.fetchBoundDevices();

    expect(result.isSuccessful).toBe(false);
    expect(result.devices).toHaveLength(0);
    expect(result.errorMessage).toContain("Network connection reset");
  });
});
