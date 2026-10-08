import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { Role, TeamErrorCode } from '@leadmate/shared';
import {
  teamService,
  TeamServiceError,
  TeamActorContext,
  isSerializationFailure,
  runWithSerializationRetry
} from '../services/team.service.js';
import { hashPassword } from '../lib/crypto.js';

describe('M7 Step 2: Last-SUPER_ADMIN Concurrency Protection Tests', () => {
  const ORG_CONCURRENCY_1 = '33333333-3333-3333-3333-333333333331';
  const ORG_CONCURRENCY_2 = '33333333-3333-3333-3333-333333333332';
  const ORG_CONCURRENCY_3 = '33333333-3333-3333-3333-333333333333';

  let passHash: string;

  async function cleanup() {
    await ensureTestDatabase(prisma);
    const orgs = [ORG_CONCURRENCY_1, ORG_CONCURRENCY_2, ORG_CONCURRENCY_3];
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.session.deleteMany({ where: { user: { organizationId: { in: orgs } } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  }

  beforeAll(async () => {
    await cleanup();
    passHash = await hashPassword('ConcurPass123!');
  });

  afterAll(async () => {
    await cleanup();
  });

  describe('Serialization Retry Unit Tests', () => {
    it('isSerializationFailure identifies P2034 and PostgreSQL 40001 write conflict errors', () => {
      expect(isSerializationFailure({ code: 'P2034', message: 'Transaction failed due to write conflict' })).toBe(true);
      expect(isSerializationFailure({ meta: { code: '40001' }, message: 'serialization_failure' })).toBe(true);
      expect(isSerializationFailure({ message: 'could not serialize access due to read/write dependencies' })).toBe(true);

      // Business and validation errors are NEVER retryable
      expect(isSerializationFailure(new TeamServiceError(TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED, 'Protected'))).toBe(false);
      expect(isSerializationFailure(new TeamServiceError(TeamErrorCode.TEAM_ROLE_FORBIDDEN, 'Forbidden'))).toBe(false);
      expect(isSerializationFailure(new TeamServiceError(TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN, 'Forbidden'))).toBe(false);
      expect(isSerializationFailure(new TeamServiceError(TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN, 'Forbidden'))).toBe(false);
      expect(isSerializationFailure(new TeamServiceError(TeamErrorCode.TEAM_MEMBER_NOT_FOUND, 'Not found'))).toBe(false);
      expect(isSerializationFailure(null)).toBe(false);
    });

    it('runWithSerializationRetry retries transient serialization errors up to 3 attempts and succeeds', async () => {
      let attempts = 0;
      const result = await runWithSerializationRetry(async () => {
        attempts++;
        if (attempts < 2) {
          const conflictErr = new Error('P2034 conflict');
          (conflictErr as any).code = 'P2034';
          throw conflictErr;
        }
        return 'success';
      }, 3);

      expect(attempts).toBe(2);
      expect(result).toBe('success');
    });

    it('runWithSerializationRetry fails immediately without retry on non-serialization error', async () => {
      let attempts = 0;
      await expect(
        runWithSerializationRetry(async () => {
          attempts++;
          throw new TeamServiceError(TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED, 'Forbidden', 409);
        }, 3)
      ).rejects.toThrowError(TeamServiceError);

      expect(attempts).toBe(1);
    });
  });

  describe('Real PostgreSQL Concurrent Execution Tests', () => {
    it('concurrent demotion of 2 active SUPER_ADMINs preserves active count >= 1', async () => {
      await prisma.organization.create({
        data: { id: ORG_CONCURRENCY_1, name: 'Concurrent Demote Org' }
      });

      const sa1 = await prisma.user.create({
        data: {
          organizationId: ORG_CONCURRENCY_1,
          name: 'SuperAdmin 1',
          email: 'sa1@demote-org.com',
          role: Role.SUPER_ADMIN as any,
          passwordHash: passHash,
          isActive: true
        }
      });

      const sa2 = await prisma.user.create({
        data: {
          organizationId: ORG_CONCURRENCY_1,
          name: 'SuperAdmin 2',
          email: 'sa2@demote-org.com',
          role: Role.SUPER_ADMIN as any,
          passwordHash: passHash,
          isActive: true
        }
      });

      const sa1Actor: TeamActorContext = {
        actorId: sa1.id,
        organizationId: ORG_CONCURRENCY_1,
        role: Role.SUPER_ADMIN
      };

      const sa2Actor: TeamActorContext = {
        actorId: sa2.id,
        organizationId: ORG_CONCURRENCY_1,
        role: Role.SUPER_ADMIN
      };

      // Both demotions run concurrently:
      // sa1 attempts to demote sa2 to ADMIN
      // sa2 attempts to demote sa1 to ADMIN
      const results = await Promise.allSettled([
        teamService.updateMember(sa1Actor, sa2.id, { role: Role.ADMIN }),
        teamService.updateMember(sa2Actor, sa1.id, { role: Role.ADMIN })
      ]);

      // INVARIANT: At least one active SUPER_ADMIN must remain in the database
      const activeSuperAdmins = await prisma.user.count({
        where: {
          organizationId: ORG_CONCURRENCY_1,
          role: Role.SUPER_ADMIN,
          isActive: true
        }
      });

      expect(activeSuperAdmins).toBeGreaterThanOrEqual(1);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly one mutation succeeded and the other was rejected
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      if (rejected[0].status === 'rejected') {
        const error = rejected[0].reason as TeamServiceError;
        expect(error).toBeInstanceOf(TeamServiceError);
        expect(error.code).toBe(TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED);
        expect(error.statusCode).toBe(409);
      }
    });

    it('concurrent deactivation of 2 active SUPER_ADMINs preserves active count >= 1', async () => {
      await prisma.organization.create({
        data: { id: ORG_CONCURRENCY_2, name: 'Concurrent Deactivate Org' }
      });

      const saA = await prisma.user.create({
        data: {
          organizationId: ORG_CONCURRENCY_2,
          name: 'SuperAdmin A',
          email: 'saa@deact-org.com',
          role: Role.SUPER_ADMIN as any,
          passwordHash: passHash,
          isActive: true
        }
      });

      const saB = await prisma.user.create({
        data: {
          organizationId: ORG_CONCURRENCY_2,
          name: 'SuperAdmin B',
          email: 'sab@deact-org.com',
          role: Role.SUPER_ADMIN as any,
          passwordHash: passHash,
          isActive: true
        }
      });

      const saAActor: TeamActorContext = {
        actorId: saA.id,
        organizationId: ORG_CONCURRENCY_2,
        role: Role.SUPER_ADMIN
      };

      const saBActor: TeamActorContext = {
        actorId: saB.id,
        organizationId: ORG_CONCURRENCY_2,
        role: Role.SUPER_ADMIN
      };

      // Both deactivations run concurrently
      const results = await Promise.allSettled([
        teamService.deactivateMember(saAActor, saB.id),
        teamService.deactivateMember(saBActor, saA.id)
      ]);

      // INVARIANT: At least one active SUPER_ADMIN must remain in the database
      const activeSuperAdmins = await prisma.user.count({
        where: {
          organizationId: ORG_CONCURRENCY_2,
          role: Role.SUPER_ADMIN,
          isActive: true
        }
      });

      expect(activeSuperAdmins).toBeGreaterThanOrEqual(1);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      if (rejected[0].status === 'rejected') {
        const error = rejected[0].reason as TeamServiceError;
        expect(error).toBeInstanceOf(TeamServiceError);
        expect(error.code).toBe(TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED);
        expect(error.statusCode).toBe(409);
      }
    });

    it('mixed concurrent demotion and deactivation preserves active count >= 1', async () => {
      await prisma.organization.create({
        data: { id: ORG_CONCURRENCY_3, name: 'Concurrent Mixed Org' }
      });

      const saX = await prisma.user.create({
        data: {
          organizationId: ORG_CONCURRENCY_3,
          name: 'SuperAdmin X',
          email: 'sax@mixed-org.com',
          role: Role.SUPER_ADMIN as any,
          passwordHash: passHash,
          isActive: true
        }
      });

      const saY = await prisma.user.create({
        data: {
          organizationId: ORG_CONCURRENCY_3,
          name: 'SuperAdmin Y',
          email: 'say@mixed-org.com',
          role: Role.SUPER_ADMIN as any,
          passwordHash: passHash,
          isActive: true
        }
      });

      const saXActor: TeamActorContext = {
        actorId: saX.id,
        organizationId: ORG_CONCURRENCY_3,
        role: Role.SUPER_ADMIN
      };

      const saYActor: TeamActorContext = {
        actorId: saY.id,
        organizationId: ORG_CONCURRENCY_3,
        role: Role.SUPER_ADMIN
      };

      // Mixed: saX tries to demote saY, saY tries to deactivate saX concurrently
      const results = await Promise.allSettled([
        teamService.updateMember(saXActor, saY.id, { role: Role.ADMIN }),
        teamService.deactivateMember(saYActor, saX.id)
      ]);

      // INVARIANT: At least one active SUPER_ADMIN must remain in the database
      const activeSuperAdmins = await prisma.user.count({
        where: {
          organizationId: ORG_CONCURRENCY_3,
          role: Role.SUPER_ADMIN,
          isActive: true
        }
      });

      expect(activeSuperAdmins).toBeGreaterThanOrEqual(1);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      if (rejected[0].status === 'rejected') {
        const error = rejected[0].reason as TeamServiceError;
        expect(error).toBeInstanceOf(TeamServiceError);
        expect(error.code).toBe(TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED);
        expect(error.statusCode).toBe(409);
      }
    });
  });
});
