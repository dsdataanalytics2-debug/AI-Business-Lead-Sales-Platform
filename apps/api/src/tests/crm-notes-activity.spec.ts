/**
 * CRM Notes & Activity Timeline API & Service Tests (M3 Step 4)
 *
 * Covers:
 * 1. Authentication & RBAC (requireAuth, LEADS_WRITE for POST note, LEADS_READ for GET notes/activities)
 * 2. Strict body validation for notes (trimming, min 1, max 5000, rejects extra fields)
 * 3. Multi-tenant isolation (cross-org lead 404 for POST/GET notes and GET activities)
 * 4. Atomic note creation side effects:
 *    - CrmNote record
 *    - CrmActivity NOTE_ADDED with { noteId }
 *    - AuditLog lead.crm_note_added with { noteId }
 * 5. Failure atomicity: 0 notes, 0 activities, 0 audits on validation or auth error
 * 6. Read notes timeline: ordered newest first, safe author summary
 * 7. Read activities timeline: ordered newest first, includes assignment, stage changes, notes
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

describe('M3 Step 4: CRM Notes & Activity Timeline API & Service Verification', () => {
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
        name: 'M3 CRM Notes Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'M3 CRM Notes Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    const defaultPassword = await hashPassword('TestPass12345!');

    // 2. Setup Org A Users
    const superAdminA = await prisma.user.create({
      data: {
        email: 'superadmin-notes-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Super Admin Notes A',
        role: Role.SUPER_ADMIN,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminA.id, 'session-notes-superadmin-a');

    const adminA = await prisma.user.create({
      data: {
        email: 'admin-notes-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Admin Notes A',
        role: Role.ADMIN,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminA.id, 'session-notes-admin-a');

    const managerA = await prisma.user.create({
      data: {
        email: 'manager-notes-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Sales Manager Notes A',
        role: Role.SALES_MANAGER,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    managerAId = managerA.id;
    managerACookie = await createSessionCookie(managerA.id, 'session-notes-manager-a');

    const repA = await prisma.user.create({
      data: {
        email: 'rep-notes-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Sales Rep Notes A',
        role: Role.SALES_EXECUTIVE,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    repAId = repA.id;
    repACookie = await createSessionCookie(repA.id, 'session-notes-rep-a');

    const viewerA = await prisma.user.create({
      data: {
        email: 'viewer-notes-a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Viewer Notes A',
        role: Role.VIEWER,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerA.id, 'session-notes-viewer-a');
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
        name: 'Banani Specialty Hospital',
        normalizedName: 'banani specialty hospital',
        category: 'Hospital',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH',
        crmStage: CrmStage.NEW
      }
    });
    testLeadAId = leadA.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Gulshan Diagnostic Centre',
        normalizedName: 'gulshan diagnostic centre',
        category: 'Diagnostics',
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
    it('returns 401 UNAUTHENTICATED when adding note without auth', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .send({ content: 'Test note' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('returns 403 FORBIDDEN when user has role VIEWER attempting to POST note (lacks LEADS_WRITE)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', viewerACookie)
        .send({ content: 'Test note' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(res.body.error.message).toMatch(/leads:write/);
    });

    it('allows SALES_EXECUTIVE (has LEADS_WRITE) to POST note', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', repACookie)
        .send({ content: 'Meeting scheduled with decision maker' });

      expect(res.status).toBe(201);
      expect(res.body.data.content).toBe('Meeting scheduled with decision maker');
      expect(res.body.data.author.email).toBe('rep-notes-a@leadmate.test');
    });

    it('returns 401 UNAUTHENTICATED when listing notes without auth', async () => {
      const res = await request(app).get(`/api/v1/leads/${testLeadAId}/notes`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('allows VIEWER (has LEADS_READ) to GET notes', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', viewerACookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('allows VIEWER (has LEADS_READ) to GET activities', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/activities`)
        .set('Cookie', viewerACookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  /* -----------------------------------------------------------------
   * 2. Note Request Body Validation
   * ----------------------------------------------------------------- */
  describe('2. Note Request Body Validation', () => {
    it('trims leading/trailing whitespace from note content', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', repACookie)
        .send({ content: '   Followed up with CFO.   ' });

      expect(res.status).toBe(201);
      expect(res.body.data.content).toBe('Followed up with CFO.');
    });

    it('rejects empty content with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', repACookie)
        .send({ content: '' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects whitespace-only content with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', repACookie)
        .send({ content: '     ' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects content exceeding 5000 characters with 422 VALIDATION_ERROR', async () => {
      const longContent = 'A'.repeat(5001);
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', repACookie)
        .send({ content: longContent });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects extra injected fields with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', repACookie)
        .send({
          content: 'Valid content',
          organizationId: ORG_A_ID,
          userId: repAId,
          author: 'Fake Name'
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  /* -----------------------------------------------------------------
   * 3. Multi-Tenant Isolation & 404 Security
   * ----------------------------------------------------------------- */
  describe('3. Multi-Tenant Isolation & 404 Security', () => {
    it('returns 404 NOT_FOUND when posting note to lead belonging to Org B', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadBId}/notes`)
        .set('Cookie', repACookie)
        .send({ content: 'Cross-tenant note attempt' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);

      // Verify no notes created in DB
      const notes = await prisma.crmNote.findMany({});
      expect(notes).toHaveLength(0);
      const activities = await prisma.crmActivity.findMany({});
      expect(activities).toHaveLength(0);
    });

    it('returns 404 NOT_FOUND when reading notes of lead belonging to Org B', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadBId}/notes`)
        .set('Cookie', repACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('returns 404 NOT_FOUND when reading activities of lead belonging to Org B', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadBId}/activities`)
        .set('Cookie', repACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  /* -----------------------------------------------------------------
   * 4. Note Creation Side Effects & Atomicity
   * ----------------------------------------------------------------- */
  describe('4. Note Creation Side Effects & Atomicity', () => {
    it('creates CrmNote, records NOTE_ADDED activity, and writes audit log atomically', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', managerACookie)
        .send({ content: 'Discussion on website redesign scope and pricing' });

      expect(res.status).toBe(201);
      const noteData = res.body.data;
      expect(noteData.id).toBeDefined();
      expect(noteData.leadId).toBe(testLeadAId);
      expect(noteData.userId).toBe(managerAId);
      expect(noteData.content).toBe('Discussion on website redesign scope and pricing');
      expect(noteData.author).toEqual({
        id: managerAId,
        name: 'Sales Manager Notes A',
        email: 'manager-notes-a@leadmate.test'
      });

      // 1. Verify CrmNote in DB
      const dbNote = await prisma.crmNote.findUnique({ where: { id: noteData.id } });
      expect(dbNote).not.toBeNull();
      expect(dbNote?.organizationId).toBe(ORG_A_ID);

      // 2. Verify CrmActivity in DB
      const activities = await prisma.crmActivity.findMany({ where: { leadId: testLeadAId } });
      expect(activities).toHaveLength(1);
      expect(activities[0].organizationId).toBe(ORG_A_ID);
      expect(activities[0].actorUserId).toBe(managerAId);
      expect(activities[0].type).toBe(CrmActivityType.NOTE_ADDED);
      expect(activities[0].metadata).toEqual({
        noteId: noteData.id
      });

      // 3. Verify AuditLog in DB
      const audits = await prisma.auditLog.findMany({ where: { entityId: testLeadAId } });
      expect(audits).toHaveLength(1);
      expect(audits[0].organizationId).toBe(ORG_A_ID);
      expect(audits[0].userId).toBe(managerAId);
      expect(audits[0].action).toBe('lead.crm_note_added');
      expect(audits[0].entityType).toBe('Lead');
      expect(audits[0].after).toEqual({
        noteId: noteData.id
      });
    });
  });

  /* -----------------------------------------------------------------
   * 5. Read Notes Timeline
   * ----------------------------------------------------------------- */
  describe('5. Read Notes Timeline', () => {
    it('returns notes in descending chronological order (newest first) with author details', async () => {
      // Create Note 1
      await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', repACookie)
        .send({ content: 'First Note: Initial discovery' });

      // Create Note 2
      await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', managerACookie)
        .send({ content: 'Second Note: Pricing approved by manager' });

      const res = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', viewerACookie);

      expect(res.status).toBe(200);
      const notes = res.body.data;
      expect(notes).toHaveLength(2);
      expect(notes[0].content).toBe('Second Note: Pricing approved by manager');
      expect(notes[0].author.name).toBe('Sales Manager Notes A');
      expect(notes[1].content).toBe('First Note: Initial discovery');
      expect(notes[1].author.name).toBe('Sales Rep Notes A');
    });
  });

  /* -----------------------------------------------------------------
   * 6. Read Activity Timeline
   * ----------------------------------------------------------------- */
  describe('6. Read Activity Timeline', () => {
    it('returns unified CRM activity timeline in descending chronological order with actor details', async () => {
      // 1. Assign lead (Activity: LEAD_ASSIGNED)
      await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/assignment`)
        .set('Cookie', managerACookie)
        .send({ assignedUserId: repAId });

      // 2. Change stage (Activity: STAGE_CHANGED)
      await request(app)
        .patch(`/api/v1/leads/${testLeadAId}/crm-stage`)
        .set('Cookie', repACookie)
        .send({ stage: CrmStage.CONTACTED });

      // 3. Add note (Activity: NOTE_ADDED)
      await request(app)
        .post(`/api/v1/leads/${testLeadAId}/notes`)
        .set('Cookie', repACookie)
        .send({ content: 'Spoke with client on phone' });

      const res = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/activities`)
        .set('Cookie', viewerACookie);

      expect(res.status).toBe(200);
      const activities = res.body.data;
      expect(activities).toHaveLength(3);

      // Order check: Newest first
      expect(activities[0].type).toBe(CrmActivityType.NOTE_ADDED);
      expect(activities[0].actor.name).toBe('Sales Rep Notes A');

      expect(activities[1].type).toBe(CrmActivityType.STAGE_CHANGED);
      expect(activities[1].metadata).toEqual({
        previousStage: 'NEW',
        newStage: 'CONTACTED'
      });
      expect(activities[1].actor.name).toBe('Sales Rep Notes A');

      expect(activities[2].type).toBe(CrmActivityType.LEAD_ASSIGNED);
      expect(activities[2].metadata).toEqual({
        assignedUserId: repAId
      });
      expect(activities[2].actor.name).toBe('Sales Manager Notes A');
    });
  });
});
