import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../infrastructure/database/prismaClient";
import {
  clearSessionCookie,
  extractUserFromRequest,
} from "../../../infrastructure/auth/sessionHelper";

export default async function handleLogout(
  request: NextApiRequest,
  response: NextApiResponse
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  try {
    const sessionUser = await extractUserFromRequest(request);
    if (sessionUser) {
      let extractedUserId = "";
      sessionUser.provideIdentity((userId) => {
        extractedUserId = userId;
      });

      if (extractedUserId) {
        await prisma.user.update({
          where: { id: extractedUserId },
          data: {
            tokenVersion: { increment: 1 },
          },
        });
      }
    }
  } catch {
    // Mesmo que o token já esteja expirado ou inválido, limpa o cookie no navegador
  }

  clearSessionCookie(response);
  response.status(200).json({ success: true, message: "Sessão encerrada com sucesso." });
}
