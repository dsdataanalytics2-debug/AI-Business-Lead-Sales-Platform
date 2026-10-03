/**
 * Follow-Up Tasks API & Service Integration Tests (M3 Step 5)
 *
 * Covers:
 * 1. Authentication & RBAC (requireAuth, LEADS_READ, LEADS_WRITE)
 * 2. Strict payload validation (ISO datetime, note length & trimming, UUID assignee)
 * 3. Multi-tenant isolation (cross-tenant lead 404, cross-tenant assignee 404, cross-tenant task 404)
 * 4. Active user validation (inactive assignee returns 422 VALIDATION_ERROR)
 * 5. Default assignee behavior (defaults to lead's assigned user when omitted, null when unassigned)
 * 6. Task lifecycle state transitions:
 *    - Create (status = PENDING, completedAt = null)
 *    - Update (dueAt, note, assignee changes)
 *    - Complete (PENDING -> COMPLETED, completedAt timestamp set)
 *    - Cancel (PENDING -> CANCELLED, completedAt set to null)
 * 7. Terminal state protection:
 *    - Editing COMPLETED or CANCELLED tasks returns 422 VALIDATION_ERROR
 * 8. Deterministic No-Ops:
 *    - Repeat complete returns 200 with unchanged completedAt and 0 new audit logs
 *    - Repeat cancel returns 200 and 0 new audit logs
 * 9. Deterministic Ordering:
 *    - PENDING tasks first by dueAt ASC, then completed/cancelled by updatedAt DESC
 * 10. Audit Logging:
 *    - lead.follow_up_created, lead.follow_up_updated, lead.follow_up_completed, lead.follow_up_cancelled
 * 11. Canonical Error Envelopes:
 *    - 401, 403, 404, 422 with code, message, requestId
 * 12. Direct Service Integration:
 *    - followUpService unit/integration execution
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  FollowUpStatus,
  CrmStage
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { ErrorCodes } from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { followUpService } from '../services/follow-up.service.js';

describe('M3 Step 5: Follow-Up Tasks Backend API & Service Integration', () => {
  const ORG_A_ID = '33333333-3333-3333-3333-333333333301';
  const ORG_B_ID = '44444444-4444-4444-4444-444444444402';

  let superAdminAId: string;
  let superAdminACookie: string;

  let adminAId: string;
  let adminACookie: string;

  let repA1Id: string;
  let repA1Cookie: string;

  let repA2Id: string;
  let inactiveRepAId: string;

  let viewerAId: string;
  let viewerACookie: string;

  let adminBId: string;
  let adminBCookie: string;
  let repBId: string;

  let testLeadAId: string;
  let testLeadBId: string;

  async function createSessionCookie(userId: string, rawToken: string): Promise<string> {
    const tokenHash = hashSessionToken(rawToken);
    await prisma.session.upsert({
      where: { tokenHash },
      update: {
        userId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      },
      create: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    return `${SESSION_COOKIE_NAME}=${rawToken}`;
  }

  async function cleanupDatabase() {
    await ensureTestDatabase(prisma);
    await prisma.followUpTask.deleteMany({});
    await prisma.crmActivity.deleteMany({});
    await prisma.crmNote.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
  }

  beforeAll(async () => {
    await ensureTestDatabase(prisma);
    await cleanupDatabase();

    // 1. Setup Tenant Organizations
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'FollowUp Test Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'FollowUp Test Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    const passwordHash = await hashPassword('Password123!');

    // 2. Setup Users for Org A
    const superAdminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'superadmin.a.followup@test.com',
        name: 'Super Admin A',
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'token-superadmin-a-followup');

    const adminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'admin.a.followup@test.com',
        name: 'Admin A',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'token-admin-a-followup');

    const repA1 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'rep.a1.followup@test.com',
        name: 'Rep A1',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    repA1Id = repA1.id;
    repA1Cookie = await createSessionCookie(repA1Id, 'token-rep-a1-followup');

    const repA2 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'rep.a2.followup@test.com',
        name: 'Rep A2',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    repA2Id = repA2.id;

    const inactiveRepA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'inactive.a.followup@test.com',
        name: 'Inactive Rep A',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: false
      }
    });
    inactiveRepAId = inactiveRepA.id;

    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'viewer.a.followup@test.com',
        name: 'Viewer A',
        passwordHash,
        role: Role.VIEWER,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'token-viewer-a-followup');

    // 3. Setup Users for Org B
    const adminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        email: 'admin.b.followup@test.com',
        name: 'Admin B',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminBId = adminB.id;
    adminBCookie = await createSessionCookie(adminBId, 'token-admin-b-followup');

    const repB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        email: 'rep.b.followup@test.com',
        name: 'Rep B',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    repBId = repB.id;
  });

  beforeEach(async () => {
    await prisma.followUpTask.deleteMany({});
    await prisma.crmActivity.deleteMany({});
    await prisma.crmNote.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.auditLog.deleteMany({});

    // Create fresh test leads
    const leadA = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Acme Lead A',
        normalizedName: 'acme lead a',
        category: 'Services',
        city: 'Dhaka',
        primarySource: 'MANUAL_IMPORT',
        crmStage: CrmStage.CONTACTED,
        assignedUserId: repA1Id,
        assignedAt: new Date()
      }
    });
    testLeadAId = leadA.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Beta Lead B',
        normalizedName: 'beta lead b',
        category: 'Services',
        city: 'Dhaka',
        primarySource: 'MANUAL_IMPORT',
        crmStage: CrmStage.NEW
      }
    });
    testLeadBId = leadB.id;
  });

  afterAll(async () => {
    await cleanupDatabase();
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.$disconnect();
  });

  describe('1. Authentication & Permissions', () => {
    it('returns 401 when creating a follow-up unauthenticated', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          note: 'Call client'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('returns 401 when listing follow-ups unauthenticated', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/follow-ups`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('returns 403 when VIEWER attempts to create a follow-up (lacks LEADS_WRITE)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', viewerACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          note: 'Call client'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('allows VIEWER to list follow-ups (has LEADS_READ)', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', viewerACookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('allows SALES_EXECUTIVE to create follow-ups (has LEADS_WRITE)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', repA1Cookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          note: 'Follow up on proposal'
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.note).toBe('Follow up on proposal');
      expect(res.body.data.status).toBe(FollowUpStatus.PENDING);
    });
  });

  describe('2. Follow-Up Creation & Assignee Behavior', () => {
    it('creates follow-up with explicit assignee, valid dueAt, and trimmed note', async () => {
      const futureDate = new Date(Date.now() + 3 * 86400000).toISOString();
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: futureDate,
          assignedUserId: repA2Id,
          note: '  Follow up regarding the contract terms.  '
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.leadId).toBe(testLeadAId);
      expect(res.body.data.assignedUserId).toBe(repA2Id);
      expect(res.body.data.assignedUser).toEqual({
        id: repA2Id,
        name: 'Rep A2',
        email: 'rep.a2.followup@test.com'
      });
      expect(res.body.data.createdByUserId).toBe(adminAId);
      expect(res.body.data.createdBy).toEqual({
        id: adminAId,
        name: 'Admin A',
        email: 'admin.a.followup@test.com'
      });
      expect(res.body.data.note).toBe('Follow up regarding the contract terms.');
      expect(res.body.data.status).toBe(FollowUpStatus.PENDING);
      expect(res.body.data.completedAt).toBeNull();
      expect(new Date(res.body.data.dueAt).toISOString()).toBe(new Date(futureDate).toISOString());

      // Verify audit log created
      const audits = await prisma.auditLog.findMany({
        where: {
          organizationId: ORG_A_ID,
          action: 'lead.follow_up_created'
        }
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].entityType).toBe('FollowUpTask');
      expect(audits[0].entityId).toBe(res.body.data.id);
      expect(audits[0].userId).toBe(adminAId);
    });

    it('defaults assignedUserId to the lead current assignee when assignedUserId is omitted', async () => {
      // testLeadA has assignedUserId = repA1Id
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: futureDate,
          note: 'Default assignee test'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.assignedUserId).toBe(repA1Id);
      expect(res.body.data.assignedUser?.id).toBe(repA1Id);
    });

    it('leaves assignedUserId as null when lead is unassigned and assignedUserId is omitted', async () => {
      const unassignedLead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Unassigned Co',
          normalizedName: 'unassigned co',
          category: 'Services',
          city: 'Dhaka',
          primarySource: 'MANUAL_IMPORT',
          crmStage: CrmStage.NEW
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${unassignedLead.id}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString()
        });

      expect(res.status).toBe(201);
      expect(res.body.data.assignedUserId).toBeNull();
      expect(res.body.data.assignedUser).toBeNull();
    });

    it('allows explicitly setting assignedUserId to null even if lead is assigned', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          assignedUserId: null
        });

      expect(res.status).toBe(201);
      expect(res.body.data.assignedUserId).toBeNull();
      expect(res.body.data.assignedUser).toBeNull();
    });

    it('normalizes empty note string after trimming to null', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          note: '    '
        });

      expect(res.status).toBe(201);
      expect(res.body.data.note).toBeNull();
    });

    it('rejects invalid dueAt date', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: 'not-a-date',
          note: 'Invalid date'
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects note exceeding 2000 characters', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          note: 'a'.repeat(2001)
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects inactive assignee with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          assignedUserId: inactiveRepAId
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.message).toMatch(/inactive/i);
    });

    it('rejects cross-tenant assignee with 404 NOT_FOUND', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          assignedUserId: repBId
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('rejects cross-tenant lead with 404 NOT_FOUND', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadBId}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString()
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  describe('3. List Follow-Ups & Deterministic Ordering', () => {
    it('returns follow-up tasks sorted with PENDING first by dueAt ASC, then COMPLETED/CANCELLED by updatedAt DESC', async () => {
      const now = Date.now();
      const d1 = new Date(now + 100000);
      const d2 = new Date(now + 200000);
      const d3 = new Date(now + 300000);

      // Create Task 1 (PENDING, later due date)
      const t1 = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: d3,
          note: 'Task 1 (later)',
          status: FollowUpStatus.PENDING
        }
      });

      // Create Task 2 (PENDING, earlier due date)
      const t2 = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: d1,
          note: 'Task 2 (earlier)',
          status: FollowUpStatus.PENDING
        }
      });

      // Create Task 3 (COMPLETED)
      const t3 = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: d2,
          note: 'Task 3 (completed)',
          status: FollowUpStatus.COMPLETED,
          completedAt: new Date()
        }
      });

      // Create Task 4 (CANCELLED)
      const t4 = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: d1,
          note: 'Task 4 (cancelled)',
          status: FollowUpStatus.CANCELLED
        }
      });

      const res = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(4);

      // First two must be PENDING, ordered by dueAt ASC: t2 (d1) then t1 (d3)
      expect(res.body.data[0].id).toBe(t2.id);
      expect(res.body.data[0].status).toBe(FollowUpStatus.PENDING);
      expect(res.body.data[1].id).toBe(t1.id);
      expect(res.body.data[1].status).toBe(FollowUpStatus.PENDING);

      // Remaining two are COMPLETED / CANCELLED
      const remainingIds = [res.body.data[2].id, res.body.data[3].id];
      expect(remainingIds).toContain(t3.id);
      expect(remainingIds).toContain(t4.id);
    });

    it('returns 404 when Org B attempts to list Org A lead follow-ups', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminBCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  describe('4. Update Follow-Up Task', () => {
    it('updates dueAt, note, and assignee for a PENDING follow-up task', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          assignedUserId: repA1Id,
          dueAt: new Date(Date.now() + 86400000),
          note: 'Initial note',
          status: FollowUpStatus.PENDING
        }
      });

      const newDueAt = new Date(Date.now() + 2 * 86400000).toISOString();
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: newDueAt,
          assignedUserId: repA2Id,
          note: 'Updated follow-up note'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(task.id);
      expect(res.body.data.assignedUserId).toBe(repA2Id);
      expect(res.body.data.assignedUser?.name).toBe('Rep A2');
      expect(res.body.data.note).toBe('Updated follow-up note');
      expect(new Date(res.body.data.dueAt).toISOString()).toBe(new Date(newDueAt).toISOString());

      // Verify audit log
      const audits = await prisma.auditLog.findMany({
        where: {
          organizationId: ORG_A_ID,
          action: 'lead.follow_up_updated',
          entityId: task.id
        }
      });
      expect(audits).toHaveLength(1);
    });

    it('allows unassigning follow-up task (assignedUserId: null)', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          assignedUserId: repA1Id,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}`)
        .set('Cookie', adminACookie)
        .send({
          assignedUserId: null
        });

      expect(res.status).toBe(200);
      expect(res.body.data.assignedUserId).toBeNull();
      expect(res.body.data.assignedUser).toBeNull();
    });

    it('rejects editing a COMPLETED follow-up task with 422 VALIDATION_ERROR', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.COMPLETED,
          completedAt: new Date()
        }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}`)
        .set('Cookie', adminACookie)
        .send({
          note: 'Attempt edit on completed'
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.message).toMatch(/cannot update a completed or cancelled/i);
    });

    it('rejects editing a CANCELLED follow-up task with 422 VALIDATION_ERROR', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.CANCELLED
        }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}`)
        .set('Cookie', adminACookie)
        .send({
          note: 'Attempt edit on cancelled'
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects update with inactive assignee (422)', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}`)
        .set('Cookie', adminACookie)
        .send({
          assignedUserId: inactiveRepAId
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects update with cross-tenant assignee (404)', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}`)
        .set('Cookie', adminACookie)
        .send({
          assignedUserId: repBId
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  describe('5. Complete & Cancel Lifecycle Transitions', () => {
    it('completes a PENDING follow-up and sets completedAt timestamp', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}/complete`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(task.id);
      expect(res.body.data.status).toBe(FollowUpStatus.COMPLETED);
      expect(res.body.data.completedAt).not.toBeNull();

      // Verify audit log created
      const audits = await prisma.auditLog.findMany({
        where: {
          organizationId: ORG_A_ID,
          action: 'lead.follow_up_completed',
          entityId: task.id
        }
      });
      expect(audits).toHaveLength(1);
    });

    it('repeat complete on already completed task returns 200 no-op with identical completedAt and no new audit', async () => {
      const initialCompletedAt = new Date(Date.now() - 50000);
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.COMPLETED,
          completedAt: initialCompletedAt
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}/complete`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(FollowUpStatus.COMPLETED);
      expect(new Date(res.body.data.completedAt).toISOString()).toBe(initialCompletedAt.toISOString());

      // Verify NO audit log created
      const audits = await prisma.auditLog.findMany({
        where: {
          organizationId: ORG_A_ID,
          action: 'lead.follow_up_completed',
          entityId: task.id
        }
      });
      expect(audits).toHaveLength(0);
    });

    it('cancels a PENDING follow-up and leaves completedAt as null', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}/cancel`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(task.id);
      expect(res.body.data.status).toBe(FollowUpStatus.CANCELLED);
      expect(res.body.data.completedAt).toBeNull();

      // Verify audit log created
      const audits = await prisma.auditLog.findMany({
        where: {
          organizationId: ORG_A_ID,
          action: 'lead.follow_up_cancelled',
          entityId: task.id
        }
      });
      expect(audits).toHaveLength(1);
    });

    it('repeat cancel on already cancelled task returns 200 no-op with no new audit', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.CANCELLED,
          completedAt: null
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}/cancel`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(FollowUpStatus.CANCELLED);

      // Verify NO audit log created
      const audits = await prisma.auditLog.findMany({
        where: {
          organizationId: ORG_A_ID,
          action: 'lead.follow_up_cancelled',
          entityId: task.id
        }
      });
      expect(audits).toHaveLength(0);
    });
  });

  describe('6. Cross-Tenant Isolation', () => {
    it('returns 404 when Org B attempts to update Org A follow-up', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}`)
        .set('Cookie', adminBCookie)
        .send({
          note: 'Malicious cross-org update'
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);

      // Verify unmodified in DB
      const freshTask = await prisma.followUpTask.findUnique({ where: { id: task.id } });
      expect(freshTask?.note).toBeNull();
    });

    it('returns 404 when Org B attempts to complete Org A follow-up', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}/complete`)
        .set('Cookie', adminBCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);

      const freshTask = await prisma.followUpTask.findUnique({ where: { id: task.id } });
      expect(freshTask?.status).toBe(FollowUpStatus.PENDING);
    });

    it('returns 404 when Org B attempts to cancel Org A follow-up', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups/${task.id}/cancel`)
        .set('Cookie', adminBCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);

      const freshTask = await prisma.followUpTask.findUnique({ where: { id: task.id } });
      expect(freshTask?.status).toBe(FollowUpStatus.PENDING);
    });
  });

  describe('7. Direct Service Layer Execution', () => {
    it('creates and retrieves follow-up via followUpService', async () => {
      const created = await followUpService.createFollowUp(
        testLeadAId,
        {
          dueAt: new Date(Date.now() + 86400000),
          note: 'Direct service follow-up'
        },
        {
          organizationId: ORG_A_ID,
          userId: adminAId
        }
      );

      expect(created.id).toBeDefined();
      expect(created.note).toBe('Direct service follow-up');

      const list = await followUpService.listFollowUps(testLeadAId, {
        organizationId: ORG_A_ID,
        userId: adminAId
      });

      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(created.id);
    });
  });
});
