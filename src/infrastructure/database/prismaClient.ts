import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobalInstance: PrismaClient | undefined;
}

export const prisma = globalThis.prismaGlobalInstance ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobalInstance = prisma;
}
