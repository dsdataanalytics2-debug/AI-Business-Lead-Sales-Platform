/**
 * Lead Assignment Service & API Integration Tests (M3 Step 3)
 *
 * Comprehensive test matrix verifying:
 * 1. Authentication & RBAC permissions (requireAuth, Permissions.LEADS_ASSIGN)
 * 2. Strict body validation (assignedUserId UUID or null, rejects extra fields)
 * 3. Multi-tenant isolation (cross-org lead 404, cross-org assignee 404, non-existent 404)
 * 4. Active user validation (inactive assignee returns 422 VALIDATION_ERROR)
 * 5. Lifecycle state transitions:
 *    - Assign (null -> user): LEAD_ASSIGNED activity + audit log + assignedAt timestamp
 *    - Reassign (user A -> user B): LEAD_REASSIGNED activity + audit log + updated assignedAt
 *    - Unassign (user B -> null): LEAD_UNASSIGNED activity + audit log + assignedAt null
 * 6. Deterministic No-Ops:
 *    - Same assignee (user A -> user A): 200 OK, preserves assignedAt, NO new activity/audit
 *    - Null to null (null -> null): 200 OK, NO new activity/audit
 * 7. Canonical Error Envelopes:
 *    - Proper format with code, message, requestId for 401, 403, 404, 422
 * 8. Direct Service Integration:
 *    - Unit/integration behavior of leadService.updateAssignment
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  CrmStage,
  CrmActivityType
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { ErrorCodes } from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { leadService } from '../services/lead.service.js';

describe('M3 Step 3: Lead Assignment API & Service Verification', () => {
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
  let repBId: string;
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
    // 0. Safety Guard
    await ensureTestDatabase(prisma);
    await cleanupDatabase();

    // 1. Setup Tenant Organizations
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'M3 Assignment Test Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'M3 Assignment Test Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    const defaultPassword = await hashPassword('TestPass12345!');

    // 2. Setup Org A Users
    const superAdminA = await prisma.user.create({
      data: {
        email: 'superadmin-m3-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Super Admin A',
        role: Role.SUPER_ADMIN,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminA.id, 'session-superadmin-m3-a');

    const adminA = await prisma.user.create({
      data: {
        email: 'admin-m3-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Admin A',
        role: Role.ADMIN,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminA.id, 'session-admin-m3-a');

    const managerA = await prisma.user.create({
      data: {
        email: 'manager-m3-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Sales Manager A',
        role: Role.SALES_MANAGER,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    managerAId = managerA.id;
    managerACookie = await createSessionCookie(managerA.id, 'session-manager-m3-a');

    const repA1 = await prisma.user.create({
      data: {
        email: 'rep1-m3-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Sales Rep A1',
        role: Role.SALES_EXECUTIVE,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    repA1Id = repA1.id;
    repA1Cookie = await createSessionCookie(repA1.id, 'session-rep1-m3-a');

    const repA2 = await prisma.user.create({
      data: {
        email: 'rep2-m3-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Sales Rep A2',
        role: Role.SALES_EXECUTIVE,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    repA2Id = repA2.id;

    const inactiveRepA = await prisma.user.create({
      data: {
        email: 'inactive-rep-m3-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Inactive Rep A',
        role: Role.SALES_EXECUTIVE,
        organizationId: ORG_A_ID,
        isActive: false // INACTIVE
      }
    });
    inactiveRepAId = inactiveRepA.id;

    const viewerA = await prisma.user.create({
      data: {
        email: 'viewer-m3-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Viewer A',
        role: Role.VIEWER,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerA.id, 'session-viewer-m3-a');

    // 3. Setup Org B Users
    const adminB = await prisma.user.create({
      data: {
        email: 'admin-m3-b@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Admin B',
        role: Role.ADMIN,
        organizationId: ORG_B_ID,
        isActive: true
      }
    });
    adminBId = adminB.id;
    adminBCookie = await createSessionCookie(adminB.id, 'session-admin-m3-b');

    const repB = await prisma.user.create({
      data: {
        email: 'rep-m3-b@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Sales Rep B',
        role: Role.SALES_EXECUTIVE,
        organizationId: ORG_B_ID,
        isActive: true
      }
    });
    repBId = repB.id;
  });

  beforeEach(async () => {
    // Clear dynamic records before each test
    await prisma.crmActivity.deleteMany({});
    await prisma.crmNote.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});

    // Create fresh test leads
    const leadA = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Apex Dental Care Dhaka',
        normalizedName: 'apex dental care dhaka',
        category: 'Dentistry',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH',
        crmStage: CrmStage.NEW,
        assignedUserId: null,
        assignedAt: null
      }
    });
    testLeadAId = leadA.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Banani Wellness Center',
        normalizedName: 'banani wellness center',
        category: 'Healthcare',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH',
        crmStage: CrmStage.NEW,
        assignedUserId: null,
        assignedAt: null
      }
    });
    testLeadBId = leadB.id;
  });

  afterAll(async () => {
    await cleanupDatabase();
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
  });

  /* -----------------------------------------------------------------
   * 1. Authentication & RBAC Permission Matrix
   * ----------------------------------------------------------------- */
  describe('1. Authentication & RBAC Permission Matrix', () => {
    it('returns 401 UNAUTHENTICATED when request is unauthenticated', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .send({ assignedUserId: repA1Id });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('returns 403 FORBIDDEN when user has role SALES_EXECUTIVE (lacks LEADS_ASSIGN)', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', repA1Cookie)
        .send({ assignedUserId: repA1Id });

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(res.body.error.message).toMatch(/leads:assign/);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('returns 403 FORBIDDEN when user has role VIEWER (lacks LEADS_ASSIGN)', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', viewerACookie)
        .send({ assignedUserId: repA1Id });

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('allows SUPER_ADMIN (has LEADS_ASSIGN) to assign lead', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', superAdminACookie)
        .send({ assignedUserId: repA1Id });

      expect(res.status).toBe(200);
      expect(res.body.data.assignedUserId).toBe(repA1Id);
    });

    it('allows ADMIN (has LEADS_ASSIGN) to assign lead', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', adminACookie)
        .send({ assignedUserId: repA1Id });

      expect(res.status).toBe(200);
      expect(res.body.data.assignedUserId).toBe(repA1Id);
    });

    it('allows SALES_MANAGER (has LEADS_ASSIGN) to assign lead', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: repA1Id });

      expect(res.status).toBe(200);
      expect(res.body.data.assignedUserId).toBe(repA1Id);
    });
  });

  /* -----------------------------------------------------------------
   * 2. Strict Body Validation
   * ----------------------------------------------------------------- */
  describe('2. Strict Request Body Validation', () => {
    it('rejects empty body ({}) with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('rejects invalid UUID string with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: 'not-a-valid-uuid' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('rejects extra injected fields (organizationId, assignedUserName) with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({
          assignedUserId: repA1Id,
          organizationId: ORG_A_ID,
          assignedUserName: 'Hacked Name'
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  /* -----------------------------------------------------------------
   * 3. Tenant Isolation & 404 Security
   * ----------------------------------------------------------------- */
  describe('3. Multi-Tenant Isolation & 404 Security', () => {
    it('returns 404 NOT_FOUND when Org A manager attempts to assign a lead belonging to Org B', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadBId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: repA1Id });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(res.body.error.message).toMatch(/Lead with ID.*not found/);
      expect(res.body.error.requestId).toBeDefined();

      // Confirm no changes to Org B lead
      const leadB = await prisma.lead.findUnique({ where: { id: testLeadBId } });
      expect(leadB?.assignedUserId).toBeNull();

      // Confirm no activities created
      const activities = await prisma.crmActivity.findMany({});
      expect(activities).toHaveLength(0);
    });

    it('returns 404 NOT_FOUND when assigning an Org A lead to a user belonging to Org B', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: repBId }); // repB belongs to Org B

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(res.body.error.message).toMatch(/Assignee user with ID.*not found/);

      // Confirm no changes to Org A lead
      const leadA = await prisma.lead.findUnique({ where: { id: testLeadAId } });
      expect(leadA?.assignedUserId).toBeNull();
      expect(leadA?.assignedAt).toBeNull();

      // Confirm no activities or audit entries
      const activities = await prisma.crmActivity.findMany({});
      expect(activities).toHaveLength(0);
      const audits = await prisma.auditLog.findMany({});
      expect(audits).toHaveLength(0);
    });

    it('returns 404 NOT_FOUND for completely non-existent lead ID', async () => {
      const nonExistentLeadId = '00000000-0000-0000-0000-000000000999';
      const res = await request(app)
        .patch(`/api/v1/leads/${nonExistentLeadId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: repA1Id });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('returns 404 NOT_FOUND for completely non-existent assignee user ID', async () => {
      const nonExistentUserId = '00000000-0000-0000-0000-000000000888';
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: nonExistentUserId });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  /* -----------------------------------------------------------------
   * 4. Inactive Assignee Validation
   * ----------------------------------------------------------------- */
  describe('4. Inactive Assignee Validation', () => {
    it('rejects assignment to an inactive user in same Org with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: inactiveRepAId });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.message).toBe('Selected assignee is inactive');
      expect(res.body.error.requestId).toBeDefined();

      // Verify no database mutation
      const lead = await prisma.lead.findUnique({ where: { id: testLeadAId } });
      expect(lead?.assignedUserId).toBeNull();
      expect(lead?.assignedAt).toBeNull();

      // Verify no activity or audit records
      const activities = await prisma.crmActivity.findMany({});
      expect(activities).toHaveLength(0);
      const audits = await prisma.auditLog.findMany({});
      expect(audits).toHaveLength(0);
    });
  });

  /* -----------------------------------------------------------------
   * 5. Full Assignment Lifecycle (Assign -> Reassign -> Unassign)
   * ----------------------------------------------------------------- */
  describe('5. Full Assignment Lifecycle Transitions', () => {
    it('A. Assigns an unassigned lead (null -> repA1): records LEAD_ASSIGNED and audit log', async () => {
      const startTime = new Date(Date.now() - 1000);

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: repA1Id });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        leadId: testLeadAId,
        assignedUserId: repA1Id,
        assignedAt: expect.any(String),
        assignedUser: {
          id: repA1Id,
          name: 'Sales Rep A1',
          email: 'rep1-m3-a@leadmate.test'
        }
      });

      const assignedAtDate = new Date(res.body.data.assignedAt);
      expect(assignedAtDate.getTime()).toBeGreaterThanOrEqual(startTime.getTime());

      // 1. Verify Lead in DB
      const dbLead = await prisma.lead.findUnique({
        where: { id: testLeadAId }
      });
      expect(dbLead?.assignedUserId).toBe(repA1Id);
      expect(dbLead?.assignedAt).not.toBeNull();

      // 2. Verify CrmActivity record
      const activities = await prisma.crmActivity.findMany({
        where: { leadId: testLeadAId }
      });
      expect(activities).toHaveLength(1);
      expect(activities[0].organizationId).toBe(ORG_A_ID);
      expect(activities[0].actorUserId).toBe(managerAId);
      expect(activities[0].type).toBe(CrmActivityType.LEAD_ASSIGNED);
      expect(activities[0].metadata).toEqual({
        assignedUserId: repA1Id
      });

      // 3. Verify AuditLog record
      const audits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId }
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].organizationId).toBe(ORG_A_ID);
      expect(audits[0].userId).toBe(managerAId);
      expect(audits[0].action).toBe('lead.assignment_changed');
      expect(audits[0].entityType).toBe('Lead');
      expect(audits[0].before).toEqual({ assignedUserId: null });
      expect(audits[0].after).toEqual({
        assignedUserId: repA1Id,
        operation: 'ASSIGN'
      });
    });

    it('B. Reassigns a lead from repA1 to repA2: records LEAD_REASSIGNED and audit log', async () => {
      // Setup initial assigned state
      const initialAssignedAt = new Date(Date.now() - 60000);
      await prisma.lead.update({
        where: { id: testLeadAId },
        data: {
          assignedUserId: repA1Id,
          assignedAt: initialAssignedAt
        }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: repA2Id });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        leadId: testLeadAId,
        assignedUserId: repA2Id,
        assignedAt: expect.any(String),
        assignedUser: {
          id: repA2Id,
          name: 'Sales Rep A2',
          email: 'rep2-m3-a@leadmate.test'
        }
      });

      const newAssignedAt = new Date(res.body.data.assignedAt);
      expect(newAssignedAt.getTime()).toBeGreaterThan(initialAssignedAt.getTime());

      // 1. Verify Lead in DB
      const dbLead = await prisma.lead.findUnique({
        where: { id: testLeadAId }
      });
      expect(dbLead?.assignedUserId).toBe(repA2Id);

      // 2. Verify CrmActivity record
      const activities = await prisma.crmActivity.findMany({
        where: { leadId: testLeadAId }
      });
      expect(activities).toHaveLength(1);
      expect(activities[0].organizationId).toBe(ORG_A_ID);
      expect(activities[0].actorUserId).toBe(managerAId);
      expect(activities[0].type).toBe(CrmActivityType.LEAD_REASSIGNED);
      expect(activities[0].metadata).toEqual({
        previousAssignedUserId: repA1Id,
        assignedUserId: repA2Id
      });

      // 3. Verify AuditLog record
      const audits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId }
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].organizationId).toBe(ORG_A_ID);
      expect(audits[0].userId).toBe(managerAId);
      expect(audits[0].action).toBe('lead.assignment_changed');
      expect(audits[0].before).toEqual({ assignedUserId: repA1Id });
      expect(audits[0].after).toEqual({
        assignedUserId: repA2Id,
        operation: 'REASSIGN'
      });
    });

    it('C. Unassigns an assigned lead (repA1 -> null): records LEAD_UNASSIGNED and clears assignedAt', async () => {
      // Setup initial assigned state
      await prisma.lead.update({
        where: { id: testLeadAId },
        data: {
          assignedUserId: repA1Id,
          assignedAt: new Date()
        }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: null });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        leadId: testLeadAId,
        assignedUserId: null,
        assignedAt: null,
        assignedUser: null
      });

      // 1. Verify Lead in DB
      const dbLead = await prisma.lead.findUnique({
        where: { id: testLeadAId }
      });
      expect(dbLead?.assignedUserId).toBeNull();
      expect(dbLead?.assignedAt).toBeNull();

      // 2. Verify CrmActivity record
      const activities = await prisma.crmActivity.findMany({
        where: { leadId: testLeadAId }
      });
      expect(activities).toHaveLength(1);
      expect(activities[0].organizationId).toBe(ORG_A_ID);
      expect(activities[0].actorUserId).toBe(managerAId);
      expect(activities[0].type).toBe(CrmActivityType.LEAD_UNASSIGNED);
      expect(activities[0].metadata).toEqual({
        previousAssignedUserId: repA1Id
      });

      // 3. Verify AuditLog record
      const audits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId }
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].organizationId).toBe(ORG_A_ID);
      expect(audits[0].userId).toBe(managerAId);
      expect(audits[0].action).toBe('lead.assignment_changed');
      expect(audits[0].before).toEqual({ assignedUserId: repA1Id });
      expect(audits[0].after).toEqual({
        assignedUserId: null,
        operation: 'UNASSIGN'
      });
    });
  });

  /* -----------------------------------------------------------------
   * 6. Deterministic No-Op Behavior
   * ----------------------------------------------------------------- */
  describe('6. Deterministic No-Op Behavior', () => {
    it('preserves assignedAt and creates NO activity/audit when assigning to same user (repA1 -> repA1)', async () => {
      const originalAssignedAt = new Date('2026-10-01T12:00:00.000Z');
      await prisma.lead.update({
        where: { id: testLeadAId },
        data: {
          assignedUserId: repA1Id,
          assignedAt: originalAssignedAt
        }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: repA1Id });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        leadId: testLeadAId,
        assignedUserId: repA1Id,
        assignedAt: originalAssignedAt.toISOString(),
        assignedUser: {
          id: repA1Id,
          name: 'Sales Rep A1',
          email: 'rep1-m3-a@leadmate.test'
        }
      });

      // Verify DB assignedAt is completely unchanged
      const dbLead = await prisma.lead.findUnique({ where: { id: testLeadAId } });
      expect(dbLead?.assignedAt?.toISOString()).toBe(originalAssignedAt.toISOString());

      // Verify ZERO CrmActivity created
      const activities = await prisma.crmActivity.findMany({});
      expect(activities).toHaveLength(0);

      // Verify ZERO AuditLog created
      const audits = await prisma.auditLog.findMany({});
      expect(audits).toHaveLength(0);
    });

    it('creates NO activity/audit when unassigning already unassigned lead (null -> null)', async () => {
      // testLeadAId is initially unassigned
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: null });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        leadId: testLeadAId,
        assignedUserId: null,
        assignedAt: null,
        assignedUser: null
      });

      // Verify DB remains unassigned
      const dbLead = await prisma.lead.findUnique({ where: { id: testLeadAId } });
      expect(dbLead?.assignedUserId).toBeNull();
      expect(dbLead?.assignedAt).toBeNull();

      // Verify ZERO CrmActivity created
      const activities = await prisma.crmActivity.findMany({});
      expect(activities).toHaveLength(0);

      // Verify ZERO AuditLog created
      const audits = await prisma.auditLog.findMany({});
      expect(audits).toHaveLength(0);
    });
  });

  /* -----------------------------------------------------------------
   * 7. Direct Service-Level Tests
   * ----------------------------------------------------------------- */
  describe('7. Direct Service-Level Tests (leadService.updateAssignment)', () => {
    it('successfully executes updateAssignment directly from service', async () => {
      const context = {
        organizationId: ORG_A_ID,
        userId: managerAId,
        correlationId: 'test-direct-service-correlation'
      };

      const result = await leadService.updateAssignment(
        testLeadAId,
        { assignedUserId: repA2Id },
        context
      );

      expect(result.leadId).toBe(testLeadAId);
      expect(result.assignedUserId).toBe(repA2Id);
      expect(result.assignedUser?.name).toBe('Sales Rep A2');
      expect(result.assignedAt).toBeInstanceOf(Date);
    });

    it('service throws NotFoundError when lead not in organization', async () => {
      const context = {
        organizationId: ORG_A_ID,
        userId: managerAId,
        correlationId: 'test-direct-service-correlation'
      };

      await expect(
        leadService.updateAssignment(
          testLeadBId, // Lead in Org B
          { assignedUserId: repA1Id },
          context
        )
      ).rejects.toThrow(/Lead with ID.*not found/);
    });

    it('service throws ValidationError when target assignee is inactive', async () => {
      const context = {
        organizationId: ORG_A_ID,
        userId: managerAId,
        correlationId: 'test-direct-service-correlation'
      };

      await expect(
        leadService.updateAssignment(
          testLeadAId,
          { assignedUserId: inactiveRepAId },
          context
        )
      ).rejects.toThrow('Selected assignee is inactive');
    });
  });
});
