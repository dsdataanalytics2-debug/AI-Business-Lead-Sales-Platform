import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import prisma, { Role } from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { createApp } from '../app.js';
import { hashPassword } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { SalesMissionGoal, SalesMissionStatus } from '@leadmate/shared';

describe('Production Hardening: RBAC Approval & Rejection Gate', () => {
  const app = createApp();
  let org: any;
  let mission: any;
  let buyer: any;
  let draft: any;

  let executiveCookie: string;
  let managerCookie: string;
  let adminCookie: string;
  let superAdminCookie: string;

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    org = await prisma.organization.create({
      data: { name: `RBAC Hardening Org ${Date.now()}` }
    });

    const passHash = await hashPassword('TestPass12345!');

    // 1. Create Users for each role
    const execUser = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `exec-${Date.now()}@test.local`,
        passwordHash: passHash,
        name: 'Sales Executive',
        role: Role.SALES_EXECUTIVE
      }
    });

    const managerUser = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `manager-${Date.now()}@test.local`,
        passwordHash: passHash,
        name: 'Sales Manager',
        role: Role.SALES_MANAGER
      }
    });

    const adminUser = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `admin-${Date.now()}@test.local`,
        passwordHash: passHash,
        name: 'Admin User',
        role: Role.ADMIN
      }
    });

    const superAdminUser = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `superadmin-${Date.now()}@test.local`,
        passwordHash: passHash,
        name: 'Super Admin User',
        role: Role.SUPER_ADMIN
      }
    });

    // 2. Login each to obtain session cookies
    const login = async (email: string) => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'TestPass12345!' });
      return res.headers['set-cookie'][0];
    };

    executiveCookie = await login(execUser.email);
    managerCookie = await login(managerUser.email);
    adminCookie = await login(adminUser.email);
    superAdminCookie = await login(superAdminUser.email);

    // 3. Create test mission, buyer, and outreach draft
    mission = await prisma.salesMission.create({
      data: {
        organizationId: org.id,
        createdByUserId: managerUser.id,
        name: 'Hardening Mission',
        goal: SalesMissionGoal.WHOLESALE,
        targetMarket: 'Dhaka',
        resultTarget: 10,
        status: SalesMissionStatus.READY
      }
    });

    buyer = await prisma.salesMissionBuyer.create({
      data: {
        organizationId: org.id,
        salesMissionId: mission.id,
        externalBusinessId: `ext-${Date.now()}`,
        provider: 'test-provider',
        businessName: 'Apex Lighting Wholesale'
      }
    });

    draft = await prisma.outreachDraft.create({
      data: {
        organizationId: org.id,
        salesMissionBuyerId: buyer.id,
        salesMissionId: mission.id,
        channel: 'WHATSAPP',
        body: 'Hello, we offer wholesale ambient lamps.',
        status: 'PENDING_APPROVAL'
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. SALES_EXECUTIVE is blocked with 403 on draft approve route', async () => {
    const res = await request(app)
      .post(`/api/v1/sales-missions/${mission.id}/drafts/${draft.id}/approve`)
      .set('Cookie', executiveCookie)
      .send();

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toContain('outreach:manage');
  });

  it('2. SALES_EXECUTIVE is blocked with 403 on draft reject route', async () => {
    const res = await request(app)
      .post(`/api/v1/sales-missions/${mission.id}/drafts/${draft.id}/reject`)
      .set('Cookie', executiveCookie)
      .send({ rejectionReason: 'Executive not allowed' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toContain('outreach:manage');
  });

  it('3. SALES_MANAGER can approve outreach drafts', async () => {
    const res = await request(app)
      .post(`/api/v1/sales-missions/${mission.id}/drafts/${draft.id}/approve`)
      .set('Cookie', managerCookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
  });

  it('4. ADMIN can reject approved/pending drafts', async () => {
    const res = await request(app)
      .post(`/api/v1/sales-missions/${mission.id}/drafts/${draft.id}/reject`)
      .set('Cookie', adminCookie)
      .send({ rejectionReason: 'Admin policy review' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
  });

  it('5. SUPER_ADMIN can approve drafts', async () => {
    // Reset to PENDING_APPROVAL
    await prisma.outreachDraft.update({
      where: { id: draft.id },
      data: { status: 'PENDING_APPROVAL' }
    });

    const res = await request(app)
      .post(`/api/v1/sales-missions/${mission.id}/drafts/${draft.id}/approve`)
      .set('Cookie', superAdminCookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
  });
});
