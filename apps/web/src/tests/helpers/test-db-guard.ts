/**
 * Strict Test Database Safety Guard
 *
 * Ensures that tests and test teardowns NEVER execute destructive operations
 * against a non-test database (e.g. development, staging, or production).
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
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
}

export async function ensureTestDatabase(prisma: MinimalPrismaClient): Promise<string> {
  const result = await prisma.$queryRawUnsafe<Array<{ db_name?: string; current_database?: string }>>(
    'SELECT current_database() as db_name;'
  );
  const dbName = result?.[0]?.db_name || result?.[0]?.current_database || '';
  assertTestDatabaseName(dbName);
  return dbName;
}
