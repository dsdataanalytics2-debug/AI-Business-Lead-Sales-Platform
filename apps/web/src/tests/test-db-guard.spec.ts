import { describe, it, expect, vi } from 'vitest';
import {
  assertTestDatabaseName,
  ensureTestDatabase,
  type MinimalPrismaClient
} from './helpers/test-db-guard.js';

describe('Test Database Safety Guard (Pure Unit Tests)', () => {
  describe('assertTestDatabaseName', () => {
    it('accepts database names ending with _test', () => {
      expect(() => assertTestDatabaseName('leadmate_test')).not.toThrow();
      expect(() => assertTestDatabaseName('app_test')).not.toThrow();
      expect(() => assertTestDatabaseName('production_integration_test')).not.toThrow();
    });

    it('rejects non-test database names', () => {
      expect(() => assertTestDatabaseName('')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName('leadmate')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName('leadmate_test_old')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName('x_test2')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName('leadmate_production')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName(null as unknown as string)).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName(undefined as unknown as string)).toThrow(/SAFETY GUARD TRIGGERED/);
    });
  });

  describe('ensureTestDatabase', () => {
    it('throws before any destruction if connected database does not end with _test', async () => {
      const fakePrisma: MinimalPrismaClient = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ db_name: 'leadmate' }])
      };

      await expect(ensureTestDatabase(fakePrisma)).rejects.toThrow(
        /SAFETY GUARD TRIGGERED: Database name "leadmate" does not end with "_test"/
      );
    });

    it('succeeds and returns database name if connected database ends with _test', async () => {
      const fakePrisma: MinimalPrismaClient = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ db_name: 'leadmate_test' }])
      };

      const name = await ensureTestDatabase(fakePrisma);
      expect(name).toBe('leadmate_test');
    });

    it('supports fallback column name current_database', async () => {
      const fakePrisma: MinimalPrismaClient = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ current_database: 'custom_service_test' }])
      };

      const name = await ensureTestDatabase(fakePrisma);
      expect(name).toBe('custom_service_test');
    });
  });
});
