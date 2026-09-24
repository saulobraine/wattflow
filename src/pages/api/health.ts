import type { NextApiRequest, NextApiResponse } from "next";

export default function healthHandler(
  _request: NextApiRequest,
  response: NextApiResponse
): void {
  response.status(200).json({ status: "healthy", timestamp: Date.now() });
}
