import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { UserEmail } from "../../../domain/values/UserEmail";
import { RawPassword } from "../../../domain/values/RawPassword";
import {
  getAuthenticationTokenService,
  setSessionCookie,
} from "../../../infrastructure/auth/sessionHelper";
import {
  checkRateLimit,
  extractClientIp,
  sendRateLimitExceeded,
} from "../../../infrastructure/security/rateLimiter";
import { registerBodySchema } from "../../../infrastructure/security/apiSchemas";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const MAX_REGISTER_PER_IP = 10;
const MAX_REGISTER_PER_EMAIL = 5;

interface RegisterResponseBody {
  success: boolean;
  message: string;
  user?: {
    id: string;
    email: string;
    fullName?: string | null;
  };
}

export default async function handleRegister(
  request: NextApiRequest,
  response: NextApiResponse<RegisterResponseBody>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({ success: false, message: "Método não permitido." });
    return;
  }

  if (process.env.ALLOW_PUBLIC_REGISTRATION !== "true") {
    response.status(403).json({
      success: false,
      message: "O cadastro público de novas contas está desabilitado neste servidor.",
    });
    return;
  }

  const clientIp = extractClientIp(request);
  const ipLimit = checkRateLimit(`register:ip:${clientIp}`, MAX_REGISTER_PER_IP, FIFTEEN_MINUTES_MS);
  if (!ipLimit.allowed) {
    sendRateLimitExceeded(
      response,
      ipLimit.retryAfterSeconds,
      "Muitas tentativas de cadastro a partir deste IP. Aguarde antes de tentar novamente."
    );
    return;
  }

  let tokenService: ReturnType<typeof getAuthenticationTokenService>;
  try {
    tokenService = getAuthenticationTokenService();
  } catch (authConfigError: unknown) {
    const errorMessage =
      authConfigError instanceof Error
        ? authConfigError.message
        : "Erro interno de configuração de autenticação.";
    response.status(500).json({ success: false, message: errorMessage });
    return;
  }

  const parsedBody = registerBodySchema.safeParse(request.body ?? {});
  if (!parsedBody.success) {
    const message = parsedBody.error.issues[0]?.message || "Dados inválidos.";
    response.status(400).json({ success: false, message });
    return;
  }

  const { email, password, fullName } = parsedBody.data;

  let userEmail: UserEmail;
  let rawPassword: RawPassword;

  try {
    userEmail = new UserEmail(email);
    rawPassword = new RawPassword(password);
  } catch (validationError: unknown) {
    const message = validationError instanceof Error ? validationError.message : "Dados inválidos.";
    response.status(400).json({ success: false, message });
    return;
  }

  let normalizedEmail = "";
  userEmail.transferEmail((e) => {
    normalizedEmail = e;
  });

  const emailLimit = checkRateLimit(
    `register:acct:${normalizedEmail}`,
    MAX_REGISTER_PER_EMAIL,
    FIFTEEN_MINUTES_MS
  );
  if (!emailLimit.allowed) {
    sendRateLimitExceeded(response, emailLimit.retryAfterSeconds);
    return;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    response.status(409).json({
      success: false,
      message: "Já existe uma conta cadastrada com este endereço de e-mail.",
    });
    return;
  }

  const hashedPassword = await rawPassword.generateHashedRepresentation();
  let storedHash = "";
  hashedPassword.transferHash((h) => {
    storedHash = h;
  });

  const createdUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: storedHash,
        fullName: fullName ? fullName : null,
      },
    });

    await tx.userConfiguration.create({
      data: {
        userId: user.id,
        turnOnThreshold: 90,
        turnOffThreshold: 30,
        isAutomationActive: true,
      },
    });

    return user;
  });

  const sessionToken = tokenService.createSessionToken(
    createdUser.id,
    createdUser.email,
    7,
    createdUser.tokenVersion ?? 0
  );
  setSessionCookie(response, sessionToken);

  response.status(201).json({
    success: true,
    message: "Conta criada com sucesso!",
    user: {
      id: createdUser.id,
      email: createdUser.email,
      fullName: createdUser.fullName,
    },
  });
}
