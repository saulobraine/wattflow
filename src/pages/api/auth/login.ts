import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { UserEmail } from "../../../domain/values/UserEmail";
import { HashedPassword } from "../../../domain/values/HashedPassword";
import {
  getAuthenticationTokenService,
  setSessionCookie,
} from "../../../infrastructure/auth/sessionHelper";
import {
  checkRateLimit,
  extractClientIp,
  sendRateLimitExceeded,
} from "../../../infrastructure/security/rateLimiter";
import { loginBodySchema } from "../../../infrastructure/security/apiSchemas";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS_PER_IP = 20;
const MAX_LOGIN_ATTEMPTS_PER_ACCOUNT = 5;

// Hash dummy de 16B salt + 64B digest (hex) para equalizar custo de CPU scrypt quando o e-mail não existe (SEC-14)
const DUMMY_PASSWORD_HASH = new HashedPassword(
  `${"7a3f9c1b5e8d2046a1b2c3d4e5f60718"}:${"8f4e2d1c9b7a60514233241506f7e8d9".repeat(4)}`
);

interface LoginResponseBody {
  success: boolean;
  message: string;
  requiresTwoFactor?: boolean;
  challengeToken?: string;
  user?: {
    id: string;
    email: string;
    fullName?: string | null;
  };
}

export default async function handleLogin(
  request: NextApiRequest,
  response: NextApiResponse<LoginResponseBody>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({ success: false, message: "Método não permitido." });
    return;
  }

  const clientIp = extractClientIp(request);
  const ipLimit = checkRateLimit(`login:ip:${clientIp}`, MAX_LOGIN_ATTEMPTS_PER_IP, FIFTEEN_MINUTES_MS);
  if (!ipLimit.allowed) {
    sendRateLimitExceeded(
      response,
      ipLimit.retryAfterSeconds,
      "Muitas tentativas de login a partir deste IP. Aguarde antes de tentar novamente."
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
        : "Erro de configuração de autenticação no servidor.";
    response.status(500).json({
      success: false,
      message: errorMessage,
    });
    return;
  }

  const parsedBody = loginBodySchema.safeParse(request.body ?? {});
  if (!parsedBody.success) {
    response.status(400).json({
      success: false,
      message: "E-mail ou senha em formato inválido.",
    });
    return;
  }

  const { email, password } = parsedBody.data;

  let userEmail: UserEmail;
  try {
    userEmail = new UserEmail(email);
  } catch {
    response.status(400).json({
      success: false,
      message: "E-mail ou senha em formato inválido.",
    });
    return;
  }

  let normalizedEmail = "";
  userEmail.transferEmail((e) => {
    normalizedEmail = e;
  });

  const accountLimit = checkRateLimit(
    `login:acct:${normalizedEmail}`,
    MAX_LOGIN_ATTEMPTS_PER_ACCOUNT,
    FIFTEEN_MINUTES_MS
  );
  if (!accountLimit.allowed) {
    sendRateLimitExceeded(
      response,
      accountLimit.retryAfterSeconds,
      "Muitas tentativas de login para esta conta. Aguarde antes de tentar novamente."
    );
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    await DUMMY_PASSWORD_HASH.matchesPlaintextCandidate(password);
    response.status(401).json({
      success: false,
      message: "Credenciais de acesso incorretas.",
    });
    return;
  }

  const hashedPassword = new HashedPassword(user.passwordHash);
  const isValidPassword = await hashedPassword.matchesPlaintextCandidate(password);

  if (!isValidPassword) {
    response.status(401).json({
      success: false,
      message: "Credenciais de acesso incorretas.",
    });
    return;
  }

  const currentTokenVersion = user.tokenVersion ?? 0;

  if (user.twoFactorEnabled) {
    const challengeToken = tokenService.createTwoFactorChallengeToken(
      user.id,
      user.email,
      5 * 60 * 1000,
      currentTokenVersion
    );
    response.status(200).json({
      success: true,
      requiresTwoFactor: true,
      challengeToken,
      message: "Verificação em duas etapas necessária. Informe o código de 6 dígitos do autenticador.",
    });
    return;
  }

  const sessionToken = tokenService.createSessionToken(
    user.id,
    user.email,
    7,
    currentTokenVersion
  );
  setSessionCookie(response, sessionToken);

  response.status(200).json({
    success: true,
    requiresTwoFactor: false,
    message: "Autenticação realizada com sucesso.",
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    },
  });
}
