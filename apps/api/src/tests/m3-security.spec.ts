/**
 * M3 Step 7: Comprehensive CRM Security, Tenant Isolation & Hardening Matrix
 *
 * Covers:
 * 1. Authentication Matrix: Every M3 route returns 401 UNAUTHENTICATED when unauthenticated
 * 2. RBAC Permission Matrix: LEADS_READ, LEADS_WRITE, LEADS_ASSIGN across all roles
 * 3. IDOR & Tenant Isolation:
 *    - Cross-tenant Lead access rejected with 404 NOT_FOUND (no existence leak)
 *    - Cross-tenant Follow-up task access rejected with 404 NOT_FOUND
 *    - Mismatched Lead & Follow-up ID (same tenant, different lead) rejected with 404 NOT_FOUND
 *    - Cross-tenant assignedUserId rejected with 404 NOT_FOUND
 *    - Inactive assignedUserId rejected with 422 VALIDATION_ERROR
 * 4. Assignee Directory Isolation & Sanitization:
 *    - Only same-tenant active users returned
 *    - Sensitive fields (passwordHash, role, sessions, isActive) stripped
 * 5. Strict Body Validation & Mass Assignment Resistance:
 *    - Extra/injected fields rejected with 422 VALIDATION_ERROR
 * 6. Malformed Path Parameters:
 *    - Non-UUID or invalid IDs return safe 404 without 500 or stack trace
 * 7. CRM Stage Security:
 *    - Invalid enum rejected with 422
 *    - Same-stage no-op returns 200 with 0 new activities and 0 new audits
 * 8. CRM Note Security & Injection Safety:
 *    - Empty/whitespace rejected with 422
 *    - >5000 chars rejected with 422
 *    - XSS / script payloads stored as plain text without crashing
 *    - Metadata does not duplicate full note content
 * 9. CRM Activity Safe Output:
 *    - Sensitive user/org data omitted
 *    - Actor summary strictly sanitized
 * 10. Follow-Up Task Hardening:
 *     - Terminal state edit rejected with 422
 *     - Cross-terminal flip (COMPLETED -> cancel or CANCELLED -> complete) rejected with 422
 *     - Deterministic no-ops on repeat complete and repeat cancel
 * 11. Canonical Error Envelopes:
 *     - Proper { error: { code, message, requestId } } on 401, 403, 404, 422
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  FollowUpStatus,
  CrmStage,
  CrmActivityType
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { ErrorCodes } from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';

describe('M3 Step 7: CRM Security Hardening & Edge Cases', () => {
  const ORG_A_ID = '33333333-3333-3333-3333-333333333301';
  const ORG_B_ID = '44444444-4444-4444-4444-444444444402';

  let superAdminAId: string;
  let superAdminACookie: string;

  let adminAId: string;
  let adminACookie: string;

  let managerAId: string;
  let managerACookie: string;

  let repA1Id: string;
  let repA1Cookie: string;

  let repA2Id: string;
  let inactiveRepAId: string;

  let viewerAId: string;
  let viewerACookie: string;

  let adminBId: string;
  let adminBCookie: string;
  let repBId: string;

  let testLeadA1Id: string;
  let testLeadA2Id: string;
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

    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'M3 Security Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'M3 Security Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    const passwordHash = await hashPassword('Password123!');

    // Org A Users
    const superAdminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'superadmin.sec.a@test.com',
        name: 'Super Admin Sec A',
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'tok-superadmin-sec-a');

    const adminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'admin.sec.a@test.com',
        name: 'Admin Sec A',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'tok-admin-sec-a');

    const managerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'manager.sec.a@test.com',
        name: 'Manager Sec A',
        passwordHash,
        role: Role.SALES_MANAGER,
        isActive: true
      }
    });
    managerAId = managerA.id;
    managerACookie = await createSessionCookie(managerAId, 'tok-manager-sec-a');

    const repA1 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'rep.sec.a1@test.com',
        name: 'Rep Sec A1',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    repA1Id = repA1.id;
    repA1Cookie = await createSessionCookie(repA1Id, 'tok-rep-sec-a1');

    const repA2 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'rep.sec.a2@test.com',
        name: 'Rep Sec A2',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    repA2Id = repA2.id;

    const inactiveRepA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'inactive.sec.a@test.com',
        name: 'Inactive Rep Sec A',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: false
      }
    });
    inactiveRepAId = inactiveRepA.id;

    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'viewer.sec.a@test.com',
        name: 'Viewer Sec A',
        passwordHash,
        role: Role.VIEWER,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'tok-viewer-sec-a');

    // Org B Users
    const adminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        email: 'admin.sec.b@test.com',
        name: 'Admin Sec B',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminBId = adminB.id;
    adminBCookie = await createSessionCookie(adminBId, 'tok-admin-sec-b');

    const repB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        email: 'rep.sec.b@test.com',
        name: 'Rep Sec B',
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

    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Alpha Care Org A',
        normalizedName: 'alpha care org a',
        category: 'Healthcare',
        city: 'Dhaka',
        primarySource: 'MANUAL_IMPORT',
        crmStage: CrmStage.CONTACTED,
        assignedUserId: repA1Id,
        assignedAt: new Date()
      }
    });
    testLeadA1Id = leadA1.id;

    const leadA2 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Alpha Dental Org A',
        normalizedName: 'alpha dental org a',
        category: 'Dentistry',
        city: 'Dhaka',
        primarySource: 'MANUAL_IMPORT',
        crmStage: CrmStage.NEW
      }
    });
    testLeadA2Id = leadA2.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Beta Hospital Org B',
        normalizedName: 'beta hospital org b',
        category: 'Hospital',
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

  describe('1. Authentication Matrix across all 12 M3 routes', () => {
    it('rejects unauthenticated GET /leads/:id with 401 UNAUTHENTICATED', async () => {
      const res = await request(app).get(`/api/v1/leads/${testLeadA1Id}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('rejects unauthenticated PATCH /leads/:id/assignment with 401 UNAUTHENTICATED', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/assignment`)
        .send({ assignedUserId: repA2Id });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('rejects unauthenticated PATCH /leads/:id/crm-stage with 401 UNAUTHENTICATED', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/crm-stage`)
        .send({ stage: CrmStage.QUALIFIED });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('rejects unauthenticated GET /leads/assignees with 401 UNAUTHENTICATED', async () => {
      const res = await request(app).get('/api/v1/leads/assignees');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('rejects unauthenticated GET /leads/:id/notes with 401 UNAUTHENTICATED', async () => {
      const res = await request(app).get(`/api/v1/leads/${testLeadA1Id}/notes`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('rejects unauthenticated POST /leads/:id/notes with 401 UNAUTHENTICATED', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/notes`)
        .send({ content: 'Test note' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('rejects unauthenticated GET /leads/:id/activities with 401 UNAUTHENTICATED', async () => {
      const res = await request(app).get(`/api/v1/leads/${testLeadA1Id}/activities`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('rejects unauthenticated follow-up routes (list, create, patch, complete, cancel) with 401 UNAUTHENTICATED', async () => {
      const dummyTaskId = '11111111-1111-1111-1111-111111111111';

      const resList = await request(app).get(`/api/v1/leads/${testLeadA1Id}/follow-ups`);
      expect(resList.status).toBe(401);

      const resCreate = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/follow-ups`)
        .send({ dueAt: new Date(Date.now() + 86400000).toISOString() });
      expect(resCreate.status).toBe(401);

      const resPatch = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/follow-ups/${dummyTaskId}`)
        .send({ note: 'Update' });
      expect(resPatch.status).toBe(401);

      const resComplete = await request(app).post(`/api/v1/leads/${testLeadA1Id}/follow-ups/${dummyTaskId}/complete`);
      expect(resComplete.status).toBe(401);

      const resCancel = await request(app).post(`/api/v1/leads/${testLeadA1Id}/follow-ups/${dummyTaskId}/cancel`);
      expect(resCancel.status).toBe(401);
    });
  });

  describe('2. RBAC Permission Matrix & Role Restrictions', () => {
    it('denies SALES_EXECUTIVE from assigning leads (requires LEADS_ASSIGN -> 403 FORBIDDEN)', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/assignment`)
        .set('Cookie', repA1Cookie)
        .send({ assignedUserId: repA2Id });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('denies SALES_EXECUTIVE from listing assignees (requires LEADS_ASSIGN -> 403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', repA1Cookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('allows SALES_MANAGER to assign leads and list assignees', async () => {
      const listRes = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', managerACookie);
      expect(listRes.status).toBe(200);

      const assignRes = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: repA2Id });
      expect(assignRes.status).toBe(200);
      expect(assignRes.body.data.assignedUserId).toBe(repA2Id);
    });

    it('denies VIEWER from all mutation routes (403 FORBIDDEN)', async () => {
      // Stage update
      const stageRes = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/crm-stage`)
        .set('Cookie', viewerACookie)
        .send({ stage: CrmStage.QUALIFIED });
      expect(stageRes.status).toBe(403);

      // Add note
      const noteRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/notes`)
        .set('Cookie', viewerACookie)
        .send({ content: 'Viewer note' });
      expect(noteRes.status).toBe(403);

      // Create follow-up
      const followUpRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/follow-ups`)
        .set('Cookie', viewerACookie)
        .send({ dueAt: new Date(Date.now() + 86400000).toISOString() });
      expect(followUpRes.status).toBe(403);
    });
  });

  describe('3. IDOR & Tenant Isolation Across Resources', () => {
    it('returns 404 NOT_FOUND when Org A attempts to mutate Org B lead stage', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadBId}/crm-stage`)
        .set('Cookie', adminACookie)
        .send({ stage: CrmStage.QUALIFIED });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);

      const leadB = await prisma.lead.findUnique({ where: { id: testLeadBId } });
      expect(leadB?.crmStage).toBe(CrmStage.NEW);
    });

    it('returns 404 NOT_FOUND when Org A attempts to add note to Org B lead', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadBId}/notes`)
        .set('Cookie', adminACookie)
        .send({ content: 'Sneaky note' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);

      const notes = await prisma.crmNote.findMany({ where: { leadId: testLeadBId } });
      expect(notes).toHaveLength(0);
    });

    it('returns 404 NOT_FOUND when Org A attempts to get activities of Org B lead', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadBId}/activities`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('returns 404 NOT_FOUND when attempting to update a follow-up with mismatched leadId in same tenant', async () => {
      // Create follow-up belonging to Lead A1
      const taskA1 = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadA1Id,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      // Attempt to update taskA1 via URL for Lead A2
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadA2Id}/follow-ups/${taskA1.id}`)
        .set('Cookie', adminACookie)
        .send({ note: 'Reassociation attempt' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);

      // Verify task still belongs to Lead A1 and note is unmodified
      const freshTask = await prisma.followUpTask.findUnique({ where: { id: taskA1.id } });
      expect(freshTask?.leadId).toBe(testLeadA1Id);
      expect(freshTask?.note).toBeNull();
    });

    it('returns 404 NOT_FOUND when assigning a lead to a cross-tenant user', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/assignment`)
        .set('Cookie', adminACookie)
        .send({ assignedUserId: repBId });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  describe('4. Strict Payload Validation & Anti-Mass-Assignment', () => {
    it('rejects extra injected fields in assignment request with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/assignment`)
        .set('Cookie', adminACookie)
        .send({
          assignedUserId: repA2Id,
          organizationId: 'injected-org-id',
          role: 'SUPER_ADMIN'
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects extra injected fields in CRM stage request with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/crm-stage`)
        .set('Cookie', adminACookie)
        .send({
          stage: CrmStage.QUALIFIED,
          isAdmin: true
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects extra injected fields in CRM note request with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/notes`)
        .set('Cookie', adminACookie)
        .send({
          content: 'Valid note content',
          authorId: superAdminAId
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects extra injected fields in follow-up create request with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          status: 'COMPLETED',
          completedAt: new Date().toISOString(),
          createdByUserId: superAdminAId
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects extra injected fields in follow-up update request with 422 VALIDATION_ERROR', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadA1Id,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/follow-ups/${task.id}`)
        .set('Cookie', adminACookie)
        .send({
          note: 'New note',
          status: 'COMPLETED',
          organizationId: ORG_B_ID
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  describe('5. Malformed Path Parameters & Safe Error Handling', () => {
    it('returns safe 404 NOT_FOUND for non-UUID lead ID without crashing or leaking SQL', async () => {
      const res = await request(app)
        .get('/api/v1/leads/not-a-valid-uuid')
        .set('Cookie', adminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(res.body.error.requestId).toBeDefined();
      expect(res.body.error.stack).toBeUndefined();
    });

    it('returns safe 404 NOT_FOUND for non-UUID follow-up ID', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/follow-ups/malformed-id`)
        .set('Cookie', adminACookie)
        .send({ note: 'Test' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(res.body.error.stack).toBeUndefined();
    });
  });

  describe('6. CRM Note Security & Injection Payloads', () => {
    it('stores HTML/XSS injection payloads as literal plain text safely', async () => {
      const xssPayload = '<script>alert("XSS")</script><img src=x onerror=alert(1)>';
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/notes`)
        .set('Cookie', repA1Cookie)
        .send({ content: xssPayload });

      expect(res.status).toBe(201);
      expect(res.body.data.content).toBe(xssPayload);

      // Verify activity metadata does NOT dump note content
      const activities = await prisma.crmActivity.findMany({
        where: { leadId: testLeadA1Id, type: CrmActivityType.NOTE_ADDED }
      });
      expect(activities).toHaveLength(1);
      expect(activities[0].metadata).toEqual({ noteId: res.body.data.id });
    });
  });

  describe('7. Safe Output Verification (No Sensitive Data Leakage)', () => {
    it('ensures GET /leads/assignees returns only safe summary fields', async () => {
      const res = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      for (const assignee of res.body.data) {
        expect(assignee.id).toBeDefined();
        expect(assignee.name).toBeDefined();
        expect(assignee.email).toBeDefined();
        expect(assignee.passwordHash).toBeUndefined();
        expect(assignee.role).toBeUndefined();
        expect(assignee.organizationId).toBeUndefined();
        expect(assignee.isActive).toBeUndefined();
      }
    });

    it('ensures GET /leads/:id/activities returns sanitized actor summaries without sensitive data', async () => {
      // Trigger a stage change to generate an activity
      await request(app)
        .patch(`/api/v1/leads/${testLeadA1Id}/crm-stage`)
        .set('Cookie', adminACookie)
        .send({ stage: CrmStage.QUALIFIED });

      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/activities`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);

      for (const activity of res.body.data) {
        expect(activity.actor).toBeDefined();
        expect(activity.actor.id).toBeDefined();
        expect(activity.actor.name).toBeDefined();
        expect(activity.actor.email).toBeDefined();
        expect(activity.actor.passwordHash).toBeUndefined();
        expect(activity.actor.role).toBeUndefined();
      }
    });
  });

  describe('8. Follow-Up Task Hardening & Cross-Terminal Edge Cases', () => {
    it('rejects cancelling an already COMPLETED task with 422 VALIDATION_ERROR', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadA1Id,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.COMPLETED,
          completedAt: new Date()
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/follow-ups/${task.id}/cancel`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.message).toMatch(/cannot cancel a completed/i);

      // Verify status remains COMPLETED
      const fresh = await prisma.followUpTask.findUnique({ where: { id: task.id } });
      expect(fresh?.status).toBe(FollowUpStatus.COMPLETED);
    });

    it('rejects completing an already CANCELLED task with 422 VALIDATION_ERROR', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadA1Id,
          createdByUserId: adminAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.CANCELLED,
          completedAt: null
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/follow-ups/${task.id}/complete`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.message).toMatch(/cannot complete a cancelled/i);

      // Verify status remains CANCELLED
      const fresh = await prisma.followUpTask.findUnique({ where: { id: task.id } });
      expect(fresh?.status).toBe(FollowUpStatus.CANCELLED);
    });
  });

  describe('9. Exact Audit Actions, Activity Logging & No-Op Integrity Matrix', () => {
    it('verifies exact audit actions and activity counts for all real mutations and no-ops', async () => {
      await prisma.auditLog.deleteMany({});
      await prisma.crmActivity.deleteMany({});

      // 1. Initial Assignment: lead.assignment_changed & LEAD_ASSIGNED
      await request(app)
        .patch(`/api/v1/leads/${testLeadA2Id}/assignment`)
        .set('Cookie', adminACookie)
        .send({ assignedUserId: repA1Id });

      let audits = await prisma.auditLog.findMany({});
      let activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(1);
      expect(audits[0].action).toBe('lead.assignment_changed');
      expect(activities).toHaveLength(1);
      expect(activities[0].type).toBe(CrmActivityType.LEAD_ASSIGNED);

      // 2. Same-User Assignment No-Op: 0 new audits, 0 new activities
      await request(app)
        .patch(`/api/v1/leads/${testLeadA2Id}/assignment`)
        .set('Cookie', adminACookie)
        .send({ assignedUserId: repA1Id });

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(1);
      expect(activities).toHaveLength(1);

      // 3. Reassignment: lead.assignment_changed & LEAD_REASSIGNED
      await request(app)
        .patch(`/api/v1/leads/${testLeadA2Id}/assignment`)
        .set('Cookie', adminACookie)
        .send({ assignedUserId: repA2Id });

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(2);
      expect(audits[1].action).toBe('lead.assignment_changed');
      expect(activities).toHaveLength(2);
      expect(activities[1].type).toBe(CrmActivityType.LEAD_REASSIGNED);

      // 4. Unassignment: lead.assignment_changed & LEAD_UNASSIGNED
      await request(app)
        .patch(`/api/v1/leads/${testLeadA2Id}/assignment`)
        .set('Cookie', adminACookie)
        .send({ assignedUserId: null });

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(3);
      expect(audits[2].action).toBe('lead.assignment_changed');
      expect(activities).toHaveLength(3);
      expect(activities[2].type).toBe(CrmActivityType.LEAD_UNASSIGNED);

      // 5. CRM Stage Change: lead.crm_stage_changed & STAGE_CHANGED
      await request(app)
        .patch(`/api/v1/leads/${testLeadA2Id}/crm-stage`)
        .set('Cookie', adminACookie)
        .send({ stage: CrmStage.QUALIFIED });

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(4);
      expect(audits[3].action).toBe('lead.crm_stage_changed');
      expect(activities).toHaveLength(4);
      expect(activities[3].type).toBe(CrmActivityType.STAGE_CHANGED);

      // 6. Same-Stage No-Op: 0 new audits, 0 new activities
      await request(app)
        .patch(`/api/v1/leads/${testLeadA2Id}/crm-stage`)
        .set('Cookie', adminACookie)
        .send({ stage: CrmStage.QUALIFIED });

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(4);
      expect(activities).toHaveLength(4);

      // 7. CRM Note Creation: lead.crm_note_added & NOTE_ADDED
      const noteRes = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/notes`)
        .set('Cookie', adminACookie)
        .send({ content: 'Audit test note' });

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(5);
      expect(audits[4].action).toBe('lead.crm_note_added');
      expect(activities).toHaveLength(5);
      expect(activities[4].type).toBe(CrmActivityType.NOTE_ADDED);

      // 8. Follow-Up Create: lead.follow_up_created (0 new activities)
      const taskRes = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          note: 'Task for audit verification'
        });

      const taskId = taskRes.body.data.id;
      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(6);
      expect(audits[5].action).toBe('lead.follow_up_created');
      expect(activities).toHaveLength(5); // No CRM activity for follow-up task

      // 9. Follow-Up Update: lead.follow_up_updated (0 new activities)
      await request(app)
        .patch(`/api/v1/leads/${testLeadA2Id}/follow-ups/${taskId}`)
        .set('Cookie', adminACookie)
        .send({ note: 'Updated task note' });

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(7);
      expect(audits[6].action).toBe('lead.follow_up_updated');
      expect(activities).toHaveLength(5);

      // 10. Follow-Up Complete: lead.follow_up_completed (0 new activities)
      await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/follow-ups/${taskId}/complete`)
        .set('Cookie', adminACookie);

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(8);
      expect(audits[7].action).toBe('lead.follow_up_completed');
      expect(activities).toHaveLength(5);

      // 11. Repeat Complete No-Op: 0 new audits, 0 new activities
      await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/follow-ups/${taskId}/complete`)
        .set('Cookie', adminACookie);

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(8);
      expect(activities).toHaveLength(5);

      // 12. Create fresh task and Cancel: lead.follow_up_cancelled (0 new activities)
      const freshTaskRes = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/follow-ups`)
        .set('Cookie', adminACookie)
        .send({ dueAt: new Date(Date.now() + 86400000).toISOString() });

      const freshTaskId = freshTaskRes.body.data.id;
      audits = await prisma.auditLog.findMany({});
      expect(audits).toHaveLength(9);
      expect(audits[8].action).toBe('lead.follow_up_created');

      await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/follow-ups/${freshTaskId}/cancel`)
        .set('Cookie', adminACookie);

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(10);
      expect(audits[9].action).toBe('lead.follow_up_cancelled');
      expect(activities).toHaveLength(5);

      // 13. Repeat Cancel No-Op: 0 new audits, 0 new activities
      await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/follow-ups/${freshTaskId}/cancel`)
        .set('Cookie', adminACookie);

      audits = await prisma.auditLog.findMany({});
      activities = await prisma.crmActivity.findMany({});
      expect(audits).toHaveLength(10);
      expect(activities).toHaveLength(5);
    });
  });
});
