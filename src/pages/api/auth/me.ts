import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import { extractUserFromRequest } from "../../../infrastructure/auth/sessionHelper";

interface MeResponseBody {
  isAuthenticated: boolean;
  message?: string;
  user?: {
    id: string;
    email: string;
    fullName?: string | null;
  };
}

export default async function handleMe(
  request: NextApiRequest,
  response: NextApiResponse<MeResponseBody>
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  let sessionUser: Awaited<ReturnType<typeof extractUserFromRequest>> = null;
  try {
    sessionUser = await extractUserFromRequest(request);
  } catch (authError: unknown) {
    const authMessage =
      authError instanceof Error
        ? authError.message
        : "Erro interno de configuração de autenticação.";
    response.status(500).json({
      isAuthenticated: false,
      message: authMessage,
    });
    return;
  }

  if (!sessionUser) {
    response.status(200).json({ isAuthenticated: false });
    return;
  }

  let extractedUserId = "";
  sessionUser.provideIdentity((userId) => {
    extractedUserId = userId;
  });

  const user = await prisma.user.findUnique({
    where: { id: extractedUserId },
    select: {
      id: true,
      email: true,
      fullName: true,
    },
  });

  if (!user) {
    response.status(200).json({ isAuthenticated: false });
    return;
  }

  response.status(200).json({
    isAuthenticated: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    },
  });
}
