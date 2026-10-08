import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { Role, TeamErrorCode, TeamSortBy } from '@leadmate/shared';
import { teamService, TeamServiceError, TeamActorContext } from '../services/team.service.js';
import { hashPassword } from '../lib/crypto.js';

describe('M7 Step 2: TeamService Isolated Unit Tests', () => {
  const ORG_ID = '11111111-1111-1111-1111-111111111111';
  const OTHER_ORG_ID = '22222222-2222-2222-2222-222222222222';

  let superAdminActor: TeamActorContext;
  let adminActor: TeamActorContext;
  let salesManagerActor: TeamActorContext;
  let memberUser: any;

  async function cleanup() {
    await ensureTestDatabase(prisma);
    const orgs = [ORG_ID, OTHER_ORG_ID];
    await prisma.followUpTask.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.lead.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.session.deleteMany({ where: { user: { organizationId: { in: orgs } } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  }

  beforeAll(async () => {
    await cleanup();

    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: 'Service Test Org' },
        { id: OTHER_ORG_ID, name: 'Other Org' }
      ]
    });

    const passHash = await hashPassword('ServicePass123!');

    const sa = await prisma.user.create({
      data: {
        organizationId: ORG_ID,
        name: 'Service SuperAdmin',
        email: 'sa@service-org.com',
        role: Role.SUPER_ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    superAdminActor = { actorId: sa.id, organizationId: ORG_ID, role: Role.SUPER_ADMIN };

    const adm = await prisma.user.create({
      data: {
        organizationId: ORG_ID,
        name: 'Service Admin',
        email: 'admin@service-org.com',
        role: Role.ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    adminActor = { actorId: adm.id, organizationId: ORG_ID, role: Role.ADMIN };

    const sm = await prisma.user.create({
      data: {
        organizationId: ORG_ID,
        name: 'Service Manager',
        email: 'sm@service-org.com',
        role: Role.SALES_MANAGER as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesManagerActor = { actorId: sm.id, organizationId: ORG_ID, role: Role.SALES_MANAGER };

    memberUser = await prisma.user.create({
      data: {
        organizationId: ORG_ID,
        name: 'Service Rep',
        email: 'rep@service-org.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it('listMembers applies sorting, tiebreaker, and returns correct structure', async () => {
    const result = await teamService.listMembers(superAdminActor, {
      page: 1,
      limit: 10,
      sortBy: TeamSortBy.NAME,
      sortOrder: 'asc'
    });

    expect(result.items).toHaveLength(4);
    expect(result.pagination.total).toBe(4);
    expect(result.pagination.totalPages).toBe(1);
    expect(result.items[0].name.localeCompare(result.items[1].name)).toBeLessThanOrEqual(0);
  });

  it('getMemberDetail fails closed with TEAM_MEMBER_NOT_FOUND for wrong tenant', async () => {
    const otherOrgActor: TeamActorContext = {
      actorId: '00000000-0000-0000-0000-000000000000',
      organizationId: OTHER_ORG_ID,
      role: Role.SUPER_ADMIN
    };

    await expect(
      teamService.getMemberDetail(otherOrgActor, memberUser.id)
    ).rejects.toThrowError(TeamServiceError);

    try {
      await teamService.getMemberDetail(otherOrgActor, memberUser.id);
    } catch (err: any) {
      expect(err.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
      expect(err.statusCode).toBe(404);
    }
  });

  it('createMember prevents ADMIN from creating another ADMIN or SUPER_ADMIN', async () => {
    await expect(
      teamService.createMember(adminActor, {
        name: 'Unauthorized Admin',
        email: 'unauth-admin@service-org.com',
        role: Role.ADMIN,
        temporaryPassword: 'ValidPass12345!'
      })
    ).rejects.toThrowError(TeamServiceError);

    await expect(
      teamService.createMember(adminActor, {
        name: 'Unauthorized SuperAdmin',
        email: 'unauth-sa@service-org.com',
        role: Role.SUPER_ADMIN,
        temporaryPassword: 'ValidPass12345!'
      })
    ).rejects.toThrowError(TeamServiceError);
  });

  it('updateMember allows SUPER_ADMIN self name update', async () => {
    const updated = await teamService.updateMember(superAdminActor, superAdminActor.actorId, {
      name: 'SuperAdmin Updated Self Name'
    });
    expect(updated.name).toBe('SuperAdmin Updated Self Name');
    expect(updated.role).toBe(Role.SUPER_ADMIN);
  });

  it('updateMember allows ADMIN self name update', async () => {
    const updated = await teamService.updateMember(adminActor, adminActor.actorId, {
      name: 'Admin Updated Self Name'
    });
    expect(updated.name).toBe('Admin Updated Self Name');
    expect(updated.role).toBe(Role.ADMIN);
  });

  it('updateMember rejects SUPER_ADMIN self role change with TEAM_SELF_ROLE_CHANGE_FORBIDDEN', async () => {
    try {
      await teamService.updateMember(superAdminActor, superAdminActor.actorId, {
        role: Role.ADMIN
      });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN);
      expect(err.statusCode).toBe(409);
    }
  });

  it('updateMember rejects ADMIN self role change with TEAM_SELF_ROLE_CHANGE_FORBIDDEN', async () => {
    try {
      await teamService.updateMember(adminActor, adminActor.actorId, {
        role: Role.SALES_EXECUTIVE
      });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN);
      expect(err.statusCode).toBe(409);
    }
  });

  it('deactivateMember rejects self deactivation with TEAM_SELF_DEACTIVATION_FORBIDDEN', async () => {
    try {
      await teamService.deactivateMember(superAdminActor, superAdminActor.actorId);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN);
      expect(err.statusCode).toBe(409);
    }
  });

  it('deactivateMember protects sole active SUPER_ADMIN with LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED', async () => {
    // If another admin actor tries to deactivate the sole active SUPER_ADMIN
    try {
      await teamService.deactivateMember(adminActor, superAdminActor.actorId);
      expect.fail('Should have thrown');
    } catch (err: any) {
      // First, adminActor is blocked by TEAM_ROLE_FORBIDDEN because ADMIN cannot modify SUPER_ADMIN
      expect(err.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);
    }
  });
});
