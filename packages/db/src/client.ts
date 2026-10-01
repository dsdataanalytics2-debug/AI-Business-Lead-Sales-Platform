import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __leadmatePrismaClient: PrismaClient | undefined;
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error']
  });
}

export const prisma: PrismaClient =
  globalThis.__leadmatePrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__leadmatePrismaClient = prisma;
}

export default prisma;
