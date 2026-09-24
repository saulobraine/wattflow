import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { UserEmail } from "../../../domain/values/UserEmail";
import { RawPassword } from "../../../domain/values/RawPassword";
import { HashedPassword } from "../../../domain/values/HashedPassword";
import { getAuthenticationTokenService, setSessionCookie } from "../../../infrastructure/auth/sessionHelper";

interface LoginResponseBody {
  success: boolean;
  message: string;
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
  if (request.method !== "POST") {
    response.setHeader("Allow", ["POST"]);
    response.status(405).json({ success: false, message: "Método não permitido." });
    return;
  }

  const { email, password } = request.body;

  let userEmail: UserEmail;
  let candidatePassword: RawPassword;

  try {
    userEmail = new UserEmail(String(email || ""));
    candidatePassword = new RawPassword(String(password || ""));
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

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    response.status(401).json({
      success: false,
      message: "Credenciais de acesso incorretas.",
    });
    return;
  }

  const hashedPassword = new HashedPassword(user.passwordHash);
  const isValidPassword = hashedPassword.matchesRawPassword(candidatePassword);

  if (!isValidPassword) {
    response.status(401).json({
      success: false,
      message: "Credenciais de acesso incorretas.",
    });
    return;
  }

  const tokenService = getAuthenticationTokenService();
  const sessionToken = tokenService.createSessionToken(user.id, user.email);
  setSessionCookie(response, sessionToken);

  response.status(200).json({
    success: true,
    message: "Autenticação realizada com sucesso.",
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    },
  });
}
