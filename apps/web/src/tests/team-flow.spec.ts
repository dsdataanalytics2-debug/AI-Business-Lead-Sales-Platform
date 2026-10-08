import './setup-test-env.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import prisma from '@leadmate/db';
import { app } from '../../../api/src/app.js';
import { hashPassword } from '../../../api/src/lib/crypto.js';
import { resetLoginRateLimiter } from '../../../api/src/middleware/rate-limiter.js';
import { apiClient, ApiClientError } from '../lib/api-client.js';
import { Role, TeamErrorCode, TeamSortBy } from '@leadmate/shared';
import { ensureTestDatabase } from './helpers/test-db-guard.js';

describe('M7 Step 3: Frontend Team Management API Client Integration Flow', () => {
  let server: http.Server;
  let serverPort: number;

  const orgId = '77777777-7777-7777-7777-777777777777';
  const superAdminEmail = 'team-flow-sa@leadmate.test';
  const superAdminPassword = 'SuperAdminPass123!A';
  let superAdminId: string;

  const adminEmail = 'team-flow-admin@leadmate.test';
  const adminPassword = 'AdminPass123!B';
  let adminId: string;

  let superAdminCookie: string;
  let adminCookie: string;

  async function cleanupDb() {
    await ensureTestDatabase(prisma);
    await prisma.followUpTask.deleteMany({ where: { organizationId: orgId } });
    await prisma.lead.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.session.deleteMany({ where: { user: { organizationId: orgId } } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  }

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          serverPort = addr.port;
          process.env.NEXT_PUBLIC_API_URL = `http://localhost:${serverPort}/api/v1`;
        }
        resolve();
      });
    });

    await cleanupDb();

    await prisma.organization.create({
      data: { id: orgId, name: 'Team Flow Test Org' }
    });

    const saHash = await hashPassword(superAdminPassword);
    const sa = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: superAdminEmail,
        passwordHash: saHash,
        name: 'Super Admin Actor',
        role: Role.SUPER_ADMIN as any,
        isActive: true
      }
    });
    superAdminId = sa.id;

    const admHash = await hashPassword(adminPassword);
    const adm = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: adminEmail,
        passwordHash: admHash,
        name: 'Admin Actor',
        role: Role.ADMIN as any,
        isActive: true
      }
    });
    adminId = adm.id;

    // Login each actor to acquire session cookies for Node test environment
    resetLoginRateLimiter();
    const saLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: superAdminEmail, password: superAdminPassword })
    });
    superAdminCookie = saLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

    resetLoginRateLimiter();
    const admLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    adminCookie = admLoginRes.headers.get('set-cookie')?.split(';')[0] || '';
  });

  afterAll(async () => {
    await cleanupDb();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    resetLoginRateLimiter();
  });

  it('authenticates and lists team members with pagination and filters', async () => {
    const listRes = await apiClient.team.listMembers(
      {
        page: 1,
        limit: 10,
        sortBy: TeamSortBy.NAME,
        sortOrder: 'asc'
      },
      { headers: { Cookie: superAdminCookie } }
    );

    expect(listRes.items.length).toBeGreaterThanOrEqual(2);
    expect(listRes.pagination.total).toBeGreaterThanOrEqual(2);
    expect(listRes.items[0].workload).toBeDefined();
    expect(listRes.items[0].workload.assignedLeadsCount).toBe(0);
  });

  it('creates, reads, updates, deactivates, and activates a team member via apiClient.team', async () => {
    const authOpts = { headers: { Cookie: superAdminCookie } };

    // 1. Create Member
    const newEmail = 'created-member@leadmate.test';
    const created = await apiClient.team.createMember(
      {
        name: 'Created Flow Member',
        email: newEmail,
        role: Role.SALES_EXECUTIVE,
        temporaryPassword: 'ValidTempPassword123!'
      },
      authOpts
    );

    expect(created.id).toBeDefined();
    expect(created.name).toBe('Created Flow Member');
    expect(created.email).toBe(newEmail);
    expect(created.role).toBe(Role.SALES_EXECUTIVE);
    expect(created.isActive).toBe(true);

    // 2. Get Detail
    const detail = await apiClient.team.getMember(created.id, authOpts);
    expect(detail.id).toBe(created.id);
    expect(detail.workload).toBeDefined();
    expect(detail.workload.assignedLeadsCount).toBe(0);

    // 3. Update Member (name and role)
    const updated = await apiClient.team.updateMember(
      created.id,
      {
        name: 'Updated Flow Member',
        role: Role.SALES_MANAGER
      },
      authOpts
    );
    expect(updated.name).toBe('Updated Flow Member');
    expect(updated.role).toBe(Role.SALES_MANAGER);

    // 4. Deactivate Member
    const deactRes = await apiClient.team.deactivateMember(created.id, authOpts);
    expect(deactRes.member.isActive).toBe(false);

    // 4b. Idempotent deactivation
    const deactAgain = await apiClient.team.deactivateMember(created.id, authOpts);
    expect(deactAgain.member.isActive).toBe(false);
    expect(deactAgain.message).toBe('Member is already inactive');

    // 5. Activate Member
    const actRes = await apiClient.team.activateMember(created.id, authOpts);
    expect(actRes.member.isActive).toBe(true);

    // 5b. Idempotent activation
    const actAgain = await apiClient.team.activateMember(created.id, authOpts);
    expect(actAgain.member.isActive).toBe(true);
    expect(actAgain.message).toBe('Member is already active');
  });

  it('handles business rule errors with expected ApiClientError error codes', async () => {
    const saOpts = { headers: { Cookie: superAdminCookie } };
    const admOpts = { headers: { Cookie: adminCookie } };

    // Duplicate email
    try {
      await apiClient.team.createMember(
        {
          name: 'Duplicate Test',
          email: superAdminEmail, // already exists
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'ValidTempPassword123!'
        },
        saOpts
      );
      expect.fail('Should have failed');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect(err.code).toBe(TeamErrorCode.TEAM_MEMBER_EMAIL_EXISTS);
      expect(err.statusCode).toBe(409);
    }

    // Self role change forbidden
    try {
      await apiClient.team.updateMember(
        superAdminId,
        {
          role: Role.ADMIN
        },
        saOpts
      );
      expect.fail('Should have failed');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect(err.code).toBe(TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN);
      expect(err.statusCode).toBe(409);
    }

    // Self deactivation forbidden
    try {
      await apiClient.team.deactivateMember(superAdminId, saOpts);
      expect.fail('Should have failed');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect(err.code).toBe(TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN);
      expect(err.statusCode).toBe(409);
    }

    // Admin cannot modify Admin
    try {
      await apiClient.team.updateMember(
        superAdminId,
        {
          name: 'Admin Attempting Super Admin Edit'
        },
        admOpts
      );
      expect.fail('Should have failed');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect(err.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);
      expect(err.statusCode).toBe(403);
    }
  });
});
