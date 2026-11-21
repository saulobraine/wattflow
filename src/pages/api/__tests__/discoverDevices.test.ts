import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExtractUserFromRequest,
  mockFindUniqueConfig,
  mockFetchBoundDevices,
  mockDecryptAndMigrate,
} = vi.hoisted(() => ({
  mockExtractUserFromRequest: vi.fn(),
  mockFindUniqueConfig: vi.fn(),
  mockFetchBoundDevices: vi.fn(),
  mockDecryptAndMigrate: vi.fn(),
}));

vi.mock("../../../infrastructure/database/prismaClient", () => ({
  prisma: {
    userConfiguration: {
      findUnique: mockFindUniqueConfig,
    },
  },
}));

vi.mock("../../../infrastructure/auth/sessionHelper", () => ({
  extractUserFromRequest: mockExtractUserFromRequest,
  enforceCsrfProtection: vi.fn(() => true),
}));

vi.mock("../../../infrastructure/security/secretMigrationHelper", () => ({
  decryptAndMigrateConfigurationSecrets: mockDecryptAndMigrate,
}));

vi.mock("../../../infrastructure/http/EcoFlowHttpClient", () => ({
  EcoFlowHttpClient: vi.fn(function () {
    return {
      fetchBoundDevices: mockFetchBoundDevices,
    };
  }),
}));

import handleDiscoverDevices from "../devices/discover";

function createMockReqRes(options: {
  method?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
} = {}) {
  const req = {
    method: options.method ?? "POST",
    body: options.body ?? {},
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      ...(options.headers ?? {}),
    },
  } as unknown as NextApiRequest;

  let statusCode = 200;
  let responseData: unknown = null;
  const headers: Record<string, string | string[]> = {};

  const res = {
    setHeader: vi.fn((key: string, value: string | string[]) => {
      headers[key] = value;
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((data: unknown) => {
      responseData = data;
      return res;
    }),
    getHeader: vi.fn((key: string) => headers[key]),
    get statusCode() {
      return statusCode;
    },
    get responseData() {
      return responseData;
    },
  } as unknown as NextApiResponse & { responseData: unknown; statusCode: number };

  return { req, res };
}

describe("POST /api/devices/discover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should reject non-POST methods with 405 Method Not Allowed", async () => {
    const { req, res } = createMockReqRes({ method: "GET" });

    await handleDiscoverDevices(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.responseData).toEqual({
      success: false,
      message: "Método HTTP não permitido. Utilize POST.",
    });
  });

  it("should reject unauthenticated requests with 401", async () => {
    mockExtractUserFromRequest.mockResolvedValue(null);
    const { req, res } = createMockReqRes();

    await handleDiscoverDevices(req, res);

    expect(res.statusCode).toBe(401);
    expect((res.responseData as any).message).toContain("Não autenticado");
  });

  it("should return 400 when credentials are completely missing", async () => {
    const mockUser = {
      provideIdentity: (cb: (id: string) => void) => cb("user-no-creds"),
    };
    mockExtractUserFromRequest.mockResolvedValue(mockUser);
    mockFindUniqueConfig.mockResolvedValue(null);

    const { req, res } = createMockReqRes({ body: {} });

    await handleDiscoverDevices(req, res);

    expect(res.statusCode).toBe(400);
    expect((res.responseData as any).message).toContain("Credenciais da EcoFlow");
  });

  it("should successfully discover devices using credentials provided in request body", async () => {
    const mockUser = {
      provideIdentity: (cb: (id: string) => void) => cb("user-body-creds"),
    };
    mockExtractUserFromRequest.mockResolvedValue(mockUser);
    mockFindUniqueConfig.mockResolvedValue(null);

    mockFetchBoundDevices.mockResolvedValue({
      isSuccessful: true,
      devices: [
        {
          sn: "R331ZTEST123",
          deviceName: "Minha River 2 Pro",
          productName: "RIVER 2 Pro",
          online: 1,
        },
      ],
    });

    const { req, res } = createMockReqRes({
      body: {
        accessKey: "ak-body-test",
        accessSecret: "sk-body-test",
      },
    });

    await handleDiscoverDevices(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.responseData).toEqual({
      success: true,
      message: "1 dispositivo(s) encontrado(s) na conta EcoFlow.",
      count: 1,
      devices: [
        {
          sn: "R331ZTEST123",
          deviceName: "Minha River 2 Pro",
          productName: "RIVER 2 Pro",
          online: 1,
        },
      ],
    });
  });

  it("should successfully discover devices using stored credentials from userConfiguration", async () => {
    const mockUser = {
      provideIdentity: (cb: (id: string) => void) => cb("user-db-creds"),
    };
    mockExtractUserFromRequest.mockResolvedValue(mockUser);

    mockFindUniqueConfig.mockResolvedValue({
      id: "cfg-1",
      userId: "user-db-creds",
      ecoflowAccessKey: "ak-db-stored",
      ecoflowEndpointRegion: "https://api.ecoflow.com",
    });

    mockDecryptAndMigrate.mockResolvedValue({
      ecoflowAccessSecret: "sk-db-decrypted",
      telegramBotToken: "",
      whatsappApiKey: "",
    });

    mockFetchBoundDevices.mockResolvedValue({
      isSuccessful: true,
      devices: [
        {
          sn: "D2MTEST999",
          deviceName: "Delta 2 Max Sala",
          productName: "DELTA 2 Max",
          online: 0,
        },
        {
          sn: "R2PTEST888",
          deviceName: "River 2 Pro Escritorio",
          productName: "RIVER 2 Pro",
          online: 1,
        },
      ],
    });

    const { req, res } = createMockReqRes({ body: {} });

    await handleDiscoverDevices(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.responseData as any).count).toBe(2);
    expect((res.responseData as any).devices).toHaveLength(2);
  });

  it("should return 400 when EcoFlow API reports failure", async () => {
    const mockUser = {
      provideIdentity: (cb: (id: string) => void) => cb("user-err"),
    };
    mockExtractUserFromRequest.mockResolvedValue(mockUser);

    mockFetchBoundDevices.mockResolvedValue({
      isSuccessful: false,
      devices: [],
      errorMessage: "[EcoFlow] AccessKey inválida ou expirada.",
    });

    const { req, res } = createMockReqRes({
      body: {
        accessKey: "ak-invalid",
        accessSecret: "sk-invalid",
      },
    });

    await handleDiscoverDevices(req, res);

    expect(res.statusCode).toBe(400);
    expect((res.responseData as any).success).toBe(false);
    expect((res.responseData as any).message).toContain("AccessKey inválida");
  });
});
