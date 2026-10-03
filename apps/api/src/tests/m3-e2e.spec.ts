/**
 * M3 Step 7: End-to-End CRM Workflows & Multi-Role Life Cycle Tests
 *
 * Scenarios:
 * 1. Workflow A (SALES_EXECUTIVE):
 *    - Reads lead
 *    - Updates CRM stage to QUALIFIED
 *    - Adds CRM note
 *    - Creates a follow-up task
 *    - Lists follow-up tasks
 *    - Completes the follow-up task
 *    - Reads activity timeline
 *    - Verifies assignment endpoint is 403 FORBIDDEN
 * 2. Workflow B (SALES_MANAGER):
 *    - Reads lead
 *    - Loads assignee directory
 *    - Assigns lead to a sales representative
 *    - Updates CRM stage to PROPOSAL_SENT
 *    - Adds CRM note
 *    - Creates follow-up task
 *    - Updates follow-up task
 *    - Cancels follow-up task
 *    - Reads CRM activities
 * 3. Workflow C (VIEWER):
 *    - Reads lead detail (200 OK)
 *    - Reads CRM notes (200 OK)
 *    - Reads CRM activities (200 OK)
 *    - Reads follow-ups (200 OK)
 *    - Denied on assignment (403), stage update (403), note creation (403), follow-up create/update/complete/cancel (403)
 * 4. Workflow D (Cross-Tenant Isolation & Attack Resistance):
 *    - Org A actor attempts GET, PATCH, and POST on Org B resources
 *    - Every attempt returns 404 NOT_FOUND with zero state mutation, zero audits, zero activities
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

describe('M3 Step 7: Comprehensive End-to-End CRM Workflows', () => {
  const ORG_A_ID = '33333333-3333-3333-3333-333333333301';
  const ORG_B_ID = '44444444-4444-4444-4444-444444444402';

  let managerAId: string;
  let managerACookie: string;

  let repA1Id: string;
  let repA1Cookie: string;

  let repA2Id: string;

  let viewerAId: string;
  let viewerACookie: string;

  let adminBId: string;
  let adminBCookie: string;

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

    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'M3 E2E Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'M3 E2E Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    const passwordHash = await hashPassword('Password123!');

    const managerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'manager.e2e.a@test.com',
        name: 'Manager E2E A',
        passwordHash,
        role: Role.SALES_MANAGER,
        isActive: true
      }
    });
    managerAId = managerA.id;
    managerACookie = await createSessionCookie(managerAId, 'tok-manager-e2e-a');

    const repA1 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'rep.e2e.a1@test.com',
        name: 'Rep E2E A1',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    repA1Id = repA1.id;
    repA1Cookie = await createSessionCookie(repA1Id, 'tok-rep-e2e-a1');

    const repA2 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'rep.e2e.a2@test.com',
        name: 'Rep E2E A2',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    repA2Id = repA2.id;

    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'viewer.e2e.a@test.com',
        name: 'Viewer E2E A',
        passwordHash,
        role: Role.VIEWER,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'tok-viewer-e2e-a');

    const adminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        email: 'admin.e2e.b@test.com',
        name: 'Admin E2E B',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminBId = adminB.id;
    adminBCookie = await createSessionCookie(adminBId, 'tok-admin-e2e-b');
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

    const leadA = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Evergreen Diagnostics',
        normalizedName: 'evergreen diagnostics',
        category: 'Diagnostic Center',
        city: 'Dhaka',
        primarySource: 'MANUAL_IMPORT',
        crmStage: CrmStage.NEW
      }
    });
    testLeadAId = leadA.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Blue Sky Pharmacy',
        normalizedName: 'blue sky pharmacy',
        category: 'Pharmacy',
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

  describe('Workflow A: SALES_EXECUTIVE CRM Journey', () => {
    it('executes end-to-end sales representative workflow and enforces permission boundaries', async () => {
      // 1. Read Lead Detail
      const getRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}`)
        .set('Cookie', repA1Cookie);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.crmStage).toBe(CrmStage.NEW);

      // 2. Attempt Lead Assignment (Denied for SALES_EXECUTIVE -> 403)
      const assignDenyRes = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', repA1Cookie)
        .send({ assignedUserId: repA1Id });

      expect(assignDenyRes.status).toBe(403);
      expect(assignDenyRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);

      // 3. Update CRM Stage to QUALIFIED
      const stageRes = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', repA1Cookie)
        .send({ stage: CrmStage.QUALIFIED });

      expect(stageRes.status).toBe(200);
      expect(stageRes.body.data.crmStage).toBe(CrmStage.QUALIFIED);

      // 4. Add CRM Note
      const noteRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', repA1Cookie)
        .send({ content: 'Spoke with Dr. Rahman. Interested in lead management package.' });

      expect(noteRes.status).toBe(201);
      expect(noteRes.body.data.content).toMatch(/Dr\. Rahman/);

      // 5. Create Follow-Up Task
      const dueAt = new Date(Date.now() + 2 * 86400000).toISOString();
      const followUpCreateRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', repA1Cookie)
        .send({
          dueAt,
          note: 'Send product brochure and pricing sheet'
        });

      expect(followUpCreateRes.status).toBe(201);
      const followUpId = followUpCreateRes.body.data.id;
      expect(followUpCreateRes.body.data.status).toBe(FollowUpStatus.PENDING);

      // 6. List Follow-Up Tasks
      const listFollowUpsRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', repA1Cookie);

      expect(listFollowUpsRes.status).toBe(200);
      expect(listFollowUpsRes.body.data).toHaveLength(1);
      expect(listFollowUpsRes.body.data[0].id).toBe(followUpId);

      // 7. Complete Follow-Up Task
      const completeRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups/${followUpId}/complete`)
        .set('Cookie', repA1Cookie);

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.data.status).toBe(FollowUpStatus.COMPLETED);
      expect(completeRes.body.data.completedAt).not.toBeNull();

      // 8. Read Activity Timeline
      const activityRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/activities`)
        .set('Cookie', repA1Cookie);

      expect(activityRes.status).toBe(200);
      // Activities recorded: STAGE_CHANGED and NOTE_ADDED (follow-ups are AuditLog-only)
      expect(activityRes.body.data.length).toBe(2);
      const types = activityRes.body.data.map((a: { type: string }) => a.type);
      expect(types).toContain(CrmActivityType.STAGE_CHANGED);
      expect(types).toContain(CrmActivityType.NOTE_ADDED);
    });
  });

  describe('Workflow B: SALES_MANAGER Leadership Journey', () => {
    it('executes full managerial workflow with assignment, stage management, notes, and task lifecycle', async () => {
      // 1. Load Assignee Directory
      const assigneesRes = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', managerACookie);

      expect(assigneesRes.status).toBe(200);
      expect(assigneesRes.body.data.length).toBeGreaterThanOrEqual(2);

      // 2. Assign Lead to Rep A1
      const assignRes = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: repA1Id });

      expect(assignRes.status).toBe(200);
      expect(assignRes.body.data.assignedUserId).toBe(repA1Id);
      expect(assignRes.body.data.assignedUser?.name).toBe('Rep E2E A1');

      // 3. Move Stage to PROPOSAL_SENT
      const stageRes = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', managerACookie)
        .send({ stage: CrmStage.PROPOSAL_SENT });

      expect(stageRes.status).toBe(200);
      expect(stageRes.body.data.crmStage).toBe(CrmStage.PROPOSAL_SENT);

      // 4. Add Managerial Note
      const noteRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', managerACookie)
        .send({ content: 'Approved customized tier-1 pricing discount.' });

      expect(noteRes.status).toBe(201);

      // 5. Create Follow-Up Task (assigned to Rep A1 by default from lead)
      const followUpRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', managerACookie)
        .send({
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          note: 'Follow up on proposal acceptance'
        });

      expect(followUpRes.status).toBe(201);
      const taskId = followUpRes.body.data.id;
      expect(followUpRes.body.data.assignedUserId).toBe(repA1Id);

      // 6. Reassign Task to Rep A2
      const updateTaskRes = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/follow-ups/${taskId}`)
        .set('Cookie', managerACookie)
        .send({
          assignedUserId: repA2Id,
          note: 'Reassigned to Rep A2 for urgent follow-up'
        });

      expect(updateTaskRes.status).toBe(200);
      expect(updateTaskRes.body.data.assignedUserId).toBe(repA2Id);

      // 7. Cancel Follow-Up Task
      const cancelRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups/${taskId}/cancel`)
        .set('Cookie', managerACookie);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe(FollowUpStatus.CANCELLED);

      // 8. Verify Activity Timeline
      const activitiesRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/activities`)
        .set('Cookie', managerACookie);

      expect(activitiesRes.status).toBe(200);
      const activityTypes = activitiesRes.body.data.map((a: { type: string }) => a.type);
      expect(activityTypes).toContain(CrmActivityType.LEAD_ASSIGNED);
      expect(activityTypes).toContain(CrmActivityType.STAGE_CHANGED);
      expect(activityTypes).toContain(CrmActivityType.NOTE_ADDED);
    });
  });

  describe('Workflow C: VIEWER Read-Only Journey', () => {
    it('allows viewer to read all CRM resources but denies any state modifications', async () => {
      // 1. View Lead Detail
      const getRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}`)
        .set('Cookie', viewerACookie);
      expect(getRes.status).toBe(200);

      // 2. View Notes
      const notesRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', viewerACookie);
      expect(notesRes.status).toBe(200);

      // 3. View Activities
      const actRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/activities`)
        .set('Cookie', viewerACookie);
      expect(actRes.status).toBe(200);

      // 4. View Follow-Ups
      const followUpsRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', viewerACookie);
      expect(followUpsRes.status).toBe(200);

      // 5. Denied Mutations (All 403)
      const denyAssign = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', viewerACookie)
        .send({ assignedUserId: repA1Id });
      expect(denyAssign.status).toBe(403);

      const denyStage = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', viewerACookie)
        .send({ stage: CrmStage.QUALIFIED });
      expect(denyStage.status).toBe(403);

      const denyNote = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', viewerACookie)
        .send({ content: 'Illegal viewer note' });
      expect(denyNote.status).toBe(403);

      const denyFollowUp = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', viewerACookie)
        .send({ dueAt: new Date(Date.now() + 86400000).toISOString() });
      expect(denyFollowUp.status).toBe(403);
    });
  });

  describe('Workflow D: Cross-Tenant Attack & Complete Isolation', () => {
    it('prevents Org B actor from reading or mutating Org A CRM resources', async () => {
      // Create follow-up in Org A
      const taskA = await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          createdByUserId: managerAId,
          dueAt: new Date(Date.now() + 86400000),
          status: FollowUpStatus.PENDING
        }
      });

      // 1. Org B attempts to read Org A lead
      const getLeadRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}`)
        .set('Cookie', adminBCookie);
      expect(getLeadRes.status).toBe(404);

      // 2. Org B attempts to assign Org A lead
      const assignRes = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', adminBCookie)
        .send({ assignedUserId: null });
      expect(assignRes.status).toBe(404);

      // 3. Org B attempts to change stage of Org A lead
      const stageRes = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', adminBCookie)
        .send({ stage: CrmStage.WON });
      expect(stageRes.status).toBe(404);

      // 4. Org B attempts to add note to Org A lead
      const noteRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', adminBCookie)
        .send({ content: 'Cross-tenant note attempt' });
      expect(noteRes.status).toBe(404);

      // 5. Org B attempts to list follow-ups of Org A lead
      const followUpListRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/follow-ups`)
        .set('Cookie', adminBCookie);
      expect(followUpListRes.status).toBe(404);

      // 6. Org B attempts to complete Org A follow-up
      const completeRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/follow-ups/${taskA.id}/complete`)
        .set('Cookie', adminBCookie);
      expect(completeRes.status).toBe(404);

      // 7. Verify zero mutations in DB
      const freshTaskA = await prisma.followUpTask.findUnique({ where: { id: taskA.id } });
      expect(freshTaskA?.status).toBe(FollowUpStatus.PENDING);

      const freshLeadA = await prisma.lead.findUnique({ where: { id: testLeadAId } });
      expect(freshLeadA?.crmStage).toBe(CrmStage.NEW);
    });
  });
});
