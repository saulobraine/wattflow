import type { NextApiRequest, NextApiResponse } from "next";
import { clearSessionCookie } from "../../../infrastructure/auth/sessionHelper";

export default function handleLogout(
  _request: NextApiRequest,
  response: NextApiResponse
): void {
  clearSessionCookie(response);
  response.status(200).json({ success: true, message: "Sessão encerrada com sucesso." });
}
