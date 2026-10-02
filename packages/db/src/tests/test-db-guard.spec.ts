import { describe, it, expect, vi } from 'vitest';
import {
  assertTestDatabaseName,
  ensureTestDatabase,
  type MinimalPrismaClient
} from '../test-guard.js';

describe('Test Database Safety Guard (Shared DB Helper Unit Tests)', () => {
  describe('assertTestDatabaseName', () => {
    it('accepts database names ending strictly with _test', () => {
      expect(() => assertTestDatabaseName('leadmate_test')).not.toThrow();
      expect(() => assertTestDatabaseName('app_test')).not.toThrow();
      expect(() => assertTestDatabaseName('custom_integration_test')).not.toThrow();
    });

    it('rejects database names not ending with _test', () => {
      expect(() => assertTestDatabaseName('')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName('   ')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName('leadmate')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName('production_test_backup')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName('leadmate_test_old')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName('x_test2')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName('leadmate_production')).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName(null as unknown as string)).toThrow(/SAFETY GUARD TRIGGERED/);
      expect(() => assertTestDatabaseName(undefined as unknown as string)).toThrow(/SAFETY GUARD TRIGGERED/);
    });
  });

  describe('ensureTestDatabase', () => {
    it('succeeds and returns database name when connected database ends with _test', async () => {
      const fakePrisma: MinimalPrismaClient = {
        $queryRaw: vi.fn().mockResolvedValue([{ db_name: 'leadmate_test' }])
      };

      const name = await ensureTestDatabase(fakePrisma);
      expect(name).toBe('leadmate_test');
    });

    it('throws BEFORE destructive operations when connected database is "leadmate" (negative proof)', async () => {
      const fakePrisma: MinimalPrismaClient = {
        $queryRaw: vi.fn().mockResolvedValue([{ db_name: 'leadmate' }])
      };

      let destructiveActionExecuted = false;
      const simulateDestructiveCleanup = async () => {
        await ensureTestDatabase(fakePrisma);
        destructiveActionExecuted = true;
      };

      await expect(simulateDestructiveCleanup()).rejects.toThrow(
        /SAFETY GUARD TRIGGERED: Database name "leadmate" does not end with "_test"/
      );
      expect(destructiveActionExecuted).toBe(false);
    });

    it('throws when fake Prisma query rejects or fails', async () => {
      const fakePrisma: MinimalPrismaClient = {
        $queryRaw: vi.fn().mockRejectedValue(new Error('Connection lost'))
      };

      await expect(ensureTestDatabase(fakePrisma)).rejects.toThrow('Connection lost');
    });

    it('throws when fake Prisma returns empty array []', async () => {
      const fakePrisma: MinimalPrismaClient = {
        $queryRaw: vi.fn().mockResolvedValue([])
      };

      await expect(ensureTestDatabase(fakePrisma)).rejects.toThrow(
        /SAFETY GUARD TRIGGERED: Database name "" does not end with "_test"/
      );
    });

    it('throws when fake Prisma returns row without db_name property', async () => {
      const fakePrisma: MinimalPrismaClient = {
        $queryRaw: vi.fn().mockResolvedValue([{}])
      };

      await expect(ensureTestDatabase(fakePrisma)).rejects.toThrow(
        /SAFETY GUARD TRIGGERED: Database name "" does not end with "_test"/
      );
    });

    it('throws when invalid or null Prisma client is passed', async () => {
      await expect(ensureTestDatabase(null as unknown as MinimalPrismaClient)).rejects.toThrow(
        /SAFETY GUARD TRIGGERED: Invalid Prisma client/
      );
      await expect(ensureTestDatabase({} as unknown as MinimalPrismaClient)).rejects.toThrow(
        /SAFETY GUARD TRIGGERED: Invalid Prisma client/
      );
    });
  });
});
