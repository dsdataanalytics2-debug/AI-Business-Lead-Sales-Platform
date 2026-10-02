/**
 * Test Database Safety Guard (Web Test Helper)
 *
 * Re-exports shared test database safety utilities from @leadmate/db/test-guard.
 */

export {
  assertTestDatabaseName,
  ensureTestDatabase,
  type MinimalPrismaClient
} from '@leadmate/db/test-guard';
