/**
 * Strict Test Database Safety Guard
 *
 * Ensures that tests and test teardowns NEVER execute destructive operations
 * against a non-test database (e.g. development, staging, or production).
 *
 * Rule: Fail-closed unless the ACTUAL connected PostgreSQL database
 * (via SELECT current_database()) has a name that ends strictly with "_test".
 */

export function assertTestDatabaseName(name: string | null | undefined): void {
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (!normalized || !normalized.endsWith('_test')) {
    throw new Error(
      `SAFETY GUARD TRIGGERED: Database name "${name}" does not end with "_test". Destructive test operations are prohibited.`
    );
  }
}

export interface MinimalPrismaClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export async function ensureTestDatabase(prisma: MinimalPrismaClient): Promise<string> {
  if (!prisma || typeof prisma.$queryRaw !== 'function') {
    throw new Error('SAFETY GUARD TRIGGERED: Invalid Prisma client supplied to ensureTestDatabase.');
  }

  const result = await prisma.$queryRaw<Array<{ db_name?: string }>>`SELECT current_database() as db_name;`;
  const dbName = result?.[0]?.db_name || '';
  assertTestDatabaseName(dbName);
  return dbName;
}
