import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { UserEmail } from "../../../domain/values/UserEmail";
import { RawPassword } from "../../../domain/values/RawPassword";
import { getAuthenticationTokenService, setSessionCookie } from "../../../infrastructure/auth/sessionHelper";

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
  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({ success: false, message: "Método não permitido." });
    return;
  }

  const { email, password, fullName } = request.body;

  let userEmail: UserEmail;
  let rawPassword: RawPassword;

  try {
    userEmail = new UserEmail(String(email || ""));
    rawPassword = new RawPassword(String(password || ""));
  } catch (validationError: unknown) {
    const message = validationError instanceof Error ? validationError.message : "Dados inválidos.";
    response.status(400).json({ success: false, message });
    return;
  }

  let normalizedEmail = "";
  userEmail.transferEmail((e) => {
    normalizedEmail = e;
  });

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

  const hashedPassword = rawPassword.generateHashedRepresentation();
  let storedHash = "";
  hashedPassword.transferHash((h) => {
    storedHash = h;
  });

  const createdUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: storedHash,
        fullName: fullName ? String(fullName) : null,
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

  const tokenService = getAuthenticationTokenService();
  const sessionToken = tokenService.createSessionToken(createdUser.id, createdUser.email);
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
