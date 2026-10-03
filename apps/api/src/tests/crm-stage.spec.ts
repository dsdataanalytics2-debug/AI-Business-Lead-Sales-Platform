/**
 * CRM Stage Movement API & Service Tests (M3 Step 4)
 *
 * Covers:
 * 1. Authentication & RBAC (requireAuth, Permissions.LEADS_WRITE)
 * 2. Strict body validation (CrmStage enum, rejects extra/invalid fields)
 * 3. Multi-tenant isolation (cross-org lead 404, non-existent lead 404)
 * 4. State transitions:
 *    - Forward and backward movement (NEW -> CONTACTED -> QUALIFIED)
 *    - Terminal stage reopening (WON -> QUALIFIED, LOST -> CONTACTED)
 * 5. Side effects:
 *    - CrmActivity STAGE_CHANGED creation with previousStage and newStage
 *    - AuditLog lead.crm_stage_changed creation
 * 6. Deterministic No-Op:
 *    - Same stage (QUALIFIED -> QUALIFIED) returns 200, 0 new activities, 0 new audits
 * 7. Canonical Error Envelopes:
 *    - 401, 403, 404, 422 with code, message, and requestId
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

describe('M3 Step 4: CRM Stage Movement API & Service Verification', () => {
  const ORG_A_ID = '33333333-3333-3333-3333-333333333301';
  const ORG_B_ID = '44444444-4444-4444-4444-444444444402';

  let superAdminAId: string;
  let superAdminACookie: string;

  let adminAId: string;
  let adminACookie: string;

  let managerAId: string;
  let managerACookie: string;

  let repAId: string;
  let repACookie: string;

  let viewerAId: string;
  let viewerACookie: string;

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
    await ensureTestDatabase(prisma);
    await cleanupDatabase();

    // 1. Setup Tenant Organizations
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'M3 CRM Stage Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'M3 CRM Stage Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    const defaultPassword = await hashPassword('TestPass12345!');

    // 2. Setup Org A Users with distinct roles
    const superAdminA = await prisma.user.create({
      data: {
        email: 'superadmin-stage-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Super Admin A',
        role: Role.SUPER_ADMIN,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminA.id, 'session-stage-superadmin-a');

    const adminA = await prisma.user.create({
      data: {
        email: 'admin-stage-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Admin A',
        role: Role.ADMIN,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminA.id, 'session-stage-admin-a');

    const managerA = await prisma.user.create({
      data: {
        email: 'manager-stage-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Sales Manager A',
        role: Role.SALES_MANAGER,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    managerAId = managerA.id;
    managerACookie = await createSessionCookie(managerA.id, 'session-stage-manager-a');

    const repA = await prisma.user.create({
      data: {
        email: 'rep-stage-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Sales Rep A',
        role: Role.SALES_EXECUTIVE,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    repAId = repA.id;
    repACookie = await createSessionCookie(repA.id, 'session-stage-rep-a');

    const viewerA = await prisma.user.create({
      data: {
        email: 'viewer-stage-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Viewer A',
        role: Role.VIEWER,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerA.id, 'session-stage-viewer-a');
  });

  beforeEach(async () => {
    await prisma.crmActivity.deleteMany({});
    await prisma.crmNote.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});

    const leadA = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Dhanmondi Dental Clinic',
        normalizedName: 'dhanmondi dental clinic',
        category: 'Dentistry',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH',
        crmStage: CrmStage.NEW
      }
    });
    testLeadAId = leadA.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Uttara Skin Care',
        normalizedName: 'uttara skin care',
        category: 'Dermatology',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH',
        crmStage: CrmStage.NEW
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
   * 1. Authentication & RBAC Permissions
   * ----------------------------------------------------------------- */
  describe('1. Authentication & RBAC Permissions', () => {
    it('returns 401 UNAUTHENTICATED when request is unauthenticated', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .send({ stage: CrmStage.CONTACTED });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('returns 403 FORBIDDEN when user has role VIEWER (lacks LEADS_WRITE)', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', viewerACookie)
        .send({ stage: CrmStage.CONTACTED });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(res.body.error.message).toMatch(/leads:write/);
    });

    it('allows SUPER_ADMIN to update CRM stage', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', superAdminACookie)
        .send({ stage: CrmStage.CONTACTED });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        leadId: testLeadAId,
        crmStage: CrmStage.CONTACTED
      });
    });

    it('allows ADMIN to update CRM stage', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', adminACookie)
        .send({ stage: CrmStage.QUALIFIED });

      expect(res.status).toBe(200);
      expect(res.body.data.crmStage).toBe(CrmStage.QUALIFIED);
    });

    it('allows SALES_MANAGER to update CRM stage', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', managerACookie)
        .send({ stage: CrmStage.PROPOSAL_SENT });

      expect(res.status).toBe(200);
      expect(res.body.data.crmStage).toBe(CrmStage.PROPOSAL_SENT);
    });

    it('allows SALES_EXECUTIVE (has LEADS_WRITE) to update CRM stage', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', repACookie)
        .send({ stage: CrmStage.NEGOTIATION });

      expect(res.status).toBe(200);
      expect(res.body.data.crmStage).toBe(CrmStage.NEGOTIATION);
    });
  });

  /* -----------------------------------------------------------------
   * 2. Strict Request Body Validation
   * ----------------------------------------------------------------- */
  describe('2. Strict Request Body Validation', () => {
    it('rejects invalid / unknown CRM stage with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', repACookie)
        .send({ stage: 'INVALID_STAGE_NAME' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('rejects empty body with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', repACookie)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects extra injected fields with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', repACookie)
        .send({
          stage: CrmStage.QUALIFIED,
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          score: 99
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  /* -----------------------------------------------------------------
   * 3. Multi-Tenant Isolation & 404 Security
   * ----------------------------------------------------------------- */
  describe('3. Multi-Tenant Isolation & 404 Security', () => {
    it('returns 404 NOT_FOUND when updating stage on lead belonging to Org B', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadBId}/crm-stage`)
        .set('Cookie', repACookie)
        .send({ stage: CrmStage.CONTACTED });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(res.body.error.message).toMatch(/Lead with ID.*not found/);

      // Verify Org B lead is unchanged
      const leadB = await prisma.lead.findUnique({ where: { id: testLeadBId } });
      expect(leadB?.crmStage).toBe(CrmStage.NEW);

      // Verify no activities created
      const activities = await prisma.crmActivity.findMany({});
      expect(activities).toHaveLength(0);
    });

    it('returns 404 NOT_FOUND for non-existent lead ID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000999';
      const res = await request(app)
        .patch(`/api/v1/leads/${nonExistentId}/crm-stage`)
        .set('Cookie', repACookie)
        .send({ stage: CrmStage.CONTACTED });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  /* -----------------------------------------------------------------
   * 4. Stage Transitions & Side Effects
   * ----------------------------------------------------------------- */
  describe('4. Stage Transitions & Side Effects', () => {
    it('updates stage NEW -> CONTACTED and records atomic STAGE_CHANGED activity and audit log', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', repACookie)
        .send({ stage: CrmStage.CONTACTED });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        leadId: testLeadAId,
        crmStage: CrmStage.CONTACTED
      });

      // 1. Verify Lead in DB
      const dbLead = await prisma.lead.findUnique({ where: { id: testLeadAId } });
      expect(dbLead?.crmStage).toBe(CrmStage.CONTACTED);

      // 2. Verify CrmActivity
      const activities = await prisma.crmActivity.findMany({ where: { leadId: testLeadAId } });
      expect(activities).toHaveLength(1);
      expect(activities[0].organizationId).toBe(ORG_A_ID);
      expect(activities[0].actorUserId).toBe(repAId);
      expect(activities[0].type).toBe(CrmActivityType.STAGE_CHANGED);
      expect(activities[0].metadata).toEqual({
        previousStage: 'NEW',
        newStage: 'CONTACTED'
      });

      // 3. Verify AuditLog
      const audits = await prisma.auditLog.findMany({ where: { entityId: testLeadAId } });
      expect(audits).toHaveLength(1);
      expect(audits[0].organizationId).toBe(ORG_A_ID);
      expect(audits[0].userId).toBe(repAId);
      expect(audits[0].action).toBe('lead.crm_stage_changed');
      expect(audits[0].entityType).toBe('Lead');
      expect(audits[0].before).toEqual({ crmStage: 'NEW' });
      expect(audits[0].after).toEqual({ crmStage: 'CONTACTED' });
    });

    it('allows terminal stage reopening (WON -> QUALIFIED and LOST -> CONTACTED)', async () => {
      // Set to WON
      await prisma.lead.update({
        where: { id: testLeadAId },
        data: { crmStage: CrmStage.WON }
      });

      // Reopen WON -> QUALIFIED
      const resWon = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', managerACookie)
        .send({ stage: CrmStage.QUALIFIED });

      expect(resWon.status).toBe(200);
      expect(resWon.body.data.crmStage).toBe(CrmStage.QUALIFIED);

      // Set to LOST
      await prisma.lead.update({
        where: { id: testLeadAId },
        data: { crmStage: CrmStage.LOST }
      });

      // Reopen LOST -> CONTACTED
      const resLost = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', managerACookie)
        .send({ stage: CrmStage.CONTACTED });

      expect(resLost.status).toBe(200);
      expect(resLost.body.data.crmStage).toBe(CrmStage.CONTACTED);
    });
  });

  /* -----------------------------------------------------------------
   * 5. Deterministic No-Op Behavior
   * ----------------------------------------------------------------- */
  describe('5. Deterministic No-Op Behavior', () => {
    it('returns 200 with unchanged stage and creates 0 activities and 0 audits when stage is unchanged', async () => {
      await prisma.lead.update({
        where: { id: testLeadAId },
        data: { crmStage: CrmStage.QUALIFIED }
      });

      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', repACookie)
        .send({ stage: CrmStage.QUALIFIED });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        leadId: testLeadAId,
        crmStage: CrmStage.QUALIFIED
      });

      // Verify ZERO CrmActivity created
      const activities = await prisma.crmActivity.findMany({});
      expect(activities).toHaveLength(0);

      // Verify ZERO AuditLog created
      const audits = await prisma.auditLog.findMany({});
      expect(audits).toHaveLength(0);
    });
  });
});
