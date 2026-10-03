import './setup-test-env.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import prisma from '@leadmate/db';
import { app } from '../../../api/src/app.js';
import { hashPassword } from '../../../api/src/lib/crypto.js';
import { resetLoginRateLimiter } from '../../../api/src/middleware/rate-limiter.js';
import { apiClient, ApiClientError } from '../lib/api-client.js';
import {
  Role,
  CrmStage,
  CrmActivityType,
  OnlinePresenceType,
  WebsiteStatus
} from '@leadmate/shared';
import { ensureTestDatabase } from './helpers/test-db-guard.js';

describe('M3 Step 6: Frontend CRM API Client Integration Flow', () => {
  let server: http.Server;
  let serverPort: number;
  let orgId: string;
  let adminCookie: string;
  let memberCookie: string;
  let viewerCookie: string;
  let adminUserId: string;
  let memberUserId: string;

  const adminEmail = 'crm-fe-admin@leadmate.test';
  const adminPassword = 'AdminPassword12345!A';
  const memberEmail = 'crm-fe-member@leadmate.test';
  const memberPassword = 'MemberPassword12345!M';
  const viewerEmail = 'crm-fe-viewer@leadmate.test';
  const viewerPassword = 'ViewerPassword12345!V';

  async function cleanupDb() {
    await ensureTestDatabase(prisma);
    await prisma.crmActivity.deleteMany({});
    await prisma.crmNote.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.auditLog.deleteMany({});
  }

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    // Start live backend API server
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

    // Ensure Organization exists
    const org = await prisma.organization.upsert({
      where: { id: '00000000-0000-0000-0000-000000000001' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'LeadMate CRM Test Org',
        timezone: 'Asia/Dhaka'
      }
    });
    orgId = org.id;

    // Create Admin user (LEADS_READ, LEADS_WRITE, LEADS_ASSIGN)
    const adminHash = await hashPassword(adminPassword);
    const adminUser = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash: adminHash, role: Role.ADMIN, organizationId: orgId, isActive: true },
      create: {
        email: adminEmail,
        passwordHash: adminHash,
        name: 'CRM Admin',
        role: Role.ADMIN,
        organizationId: orgId,
        isActive: true
      }
    });
    adminUserId = adminUser.id;

    // Create Sales Executive user (LEADS_READ, LEADS_WRITE - lacks LEADS_ASSIGN)
    const memberHash = await hashPassword(memberPassword);
    const memberUser = await prisma.user.upsert({
      where: { email: memberEmail },
      update: { passwordHash: memberHash, role: Role.SALES_EXECUTIVE, organizationId: orgId, isActive: true },
      create: {
        email: memberEmail,
        passwordHash: memberHash,
        name: 'CRM Sales Rep',
        role: Role.SALES_EXECUTIVE,
        organizationId: orgId,
        isActive: true
      }
    });
    memberUserId = memberUser.id;

    // Create Viewer user (LEADS_READ only)
    const viewerHash = await hashPassword(viewerPassword);
    await prisma.user.upsert({
      where: { email: viewerEmail },
      update: { passwordHash: viewerHash, role: Role.VIEWER, organizationId: orgId, isActive: true },
      create: {
        email: viewerEmail,
        passwordHash: viewerHash,
        name: 'CRM Viewer',
        role: Role.VIEWER,
        organizationId: orgId,
        isActive: true
      }
    });

    // Login each user to acquire session cookies
    resetLoginRateLimiter();
    const adminLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    adminCookie = adminLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

    resetLoginRateLimiter();
    const memberLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberEmail, password: memberPassword })
    });
    memberCookie = memberLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

    resetLoginRateLimiter();
    const viewerLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: viewerEmail, password: viewerPassword })
    });
    viewerCookie = viewerLoginRes.headers.get('set-cookie')?.split(';')[0] || '';
  });

  afterAll(async () => {
    await cleanupDb();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(async () => {
    await cleanupDb();
  });

  async function createTestLead() {
    return prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Gulshan Diagnostic Lab',
        normalizedName: 'gulshan diagnostic lab',
        category: 'Diagnostic Center',
        locality: 'Gulshan-2',
        city: 'Dhaka',
        region: 'Dhaka',
        country: 'BD',
        website: 'https://gulshandiagnostic.bd',
        websiteStatus: WebsiteStatus.REACHABLE,
        onlinePresenceType: OnlinePresenceType.WEBSITE,
        primarySource: 'MANUAL',
        crmStage: CrmStage.NEW
      }
    });
  }

  describe('1. Assignees Directory API Flow (GET /api/v1/leads/assignees)', () => {
    it('Admin with LEADS_ASSIGN permission can fetch assignee directory', async () => {
      const assignees = await apiClient.leads.getAssignees({
        headers: { Cookie: adminCookie }
      });

      expect(Array.isArray(assignees)).toBe(true);
      expect(assignees.length).toBeGreaterThanOrEqual(2);
      const adminEntry = assignees.find((u) => u.id === adminUserId);
      expect(adminEntry).toBeDefined();
      expect(adminEntry?.name).toBe('CRM Admin');
    });

    it('Sales Executive and Viewer without LEADS_ASSIGN receive 403 Forbidden', async () => {
      try {
        await apiClient.leads.getAssignees({
          headers: { Cookie: memberCookie }
        });
        expect.unreachable('Should have thrown 403');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).statusCode).toBe(403);
      }

      try {
        await apiClient.leads.getAssignees({
          headers: { Cookie: viewerCookie }
        });
        expect.unreachable('Should have thrown 403');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).statusCode).toBe(403);
      }
    });
  });

  describe('2. CRM Stage Update Flow (PATCH /api/v1/leads/:id/crm-stage)', () => {
    it('User with LEADS_WRITE can update stage and observe updated stage and activity', async () => {
      const lead = await createTestLead();

      const updated = await apiClient.leads.updateCrmStage(lead.id, CrmStage.QUALIFIED, {
        headers: { Cookie: memberCookie }
      });
      expect(updated.leadId).toBe(lead.id);
      expect(updated.crmStage).toBe(CrmStage.QUALIFIED);

      // Verify activity timeline recorded stage change
      const activities = await apiClient.leads.getActivities(lead.id, {
        headers: { Cookie: memberCookie }
      });
      expect(activities.length).toBeGreaterThanOrEqual(1);
      const stageAct = activities.find((a) => a.type === CrmActivityType.STAGE_CHANGED);
      expect(stageAct).toBeDefined();
      expect(stageAct?.metadata).toEqual({
        previousStage: CrmStage.NEW,
        newStage: CrmStage.QUALIFIED
      });
      expect(stageAct?.actor?.id).toBe(memberUserId);
    });

    it('Viewer without LEADS_WRITE receives 403 Forbidden on stage update', async () => {
      const lead = await createTestLead();

      try {
        await apiClient.leads.updateCrmStage(lead.id, CrmStage.CONTACTED, {
          headers: { Cookie: viewerCookie }
        });
        expect.unreachable('Should have thrown 403');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).statusCode).toBe(403);
      }
    });

    it('Returns 404 for non-existent lead ID', async () => {
      try {
        await apiClient.leads.updateCrmStage(
          '00000000-0000-0000-0000-000000000999',
          CrmStage.WON,
          {
            headers: { Cookie: adminCookie }
          }
        );
        expect.unreachable('Should have thrown 404');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).statusCode).toBe(404);
      }
    });
  });

  describe('3. Assignment Update Flow (PATCH /api/v1/leads/:id/assignment)', () => {
    it('User with LEADS_ASSIGN can assign, reassign, and unassign a lead', async () => {
      const lead = await createTestLead();

      // 1. Assign to Sales Executive
      const assigned = await apiClient.leads.updateAssignment(lead.id, memberUserId, {
        headers: { Cookie: adminCookie }
      });
      expect(assigned.assignedUserId).toBe(memberUserId);
      expect(assigned.assignedUser?.id).toBe(memberUserId);
      expect(assigned.assignedUser?.name).toBe('CRM Sales Rep');
      expect(assigned.assignedAt).toBeTruthy();

      // 2. Reassign to Admin
      const reassigned = await apiClient.leads.updateAssignment(lead.id, adminUserId, {
        headers: { Cookie: adminCookie }
      });
      expect(reassigned.assignedUserId).toBe(adminUserId);
      expect(reassigned.assignedUser?.name).toBe('CRM Admin');

      // 3. Unassign with null
      const unassigned = await apiClient.leads.updateAssignment(lead.id, null, {
        headers: { Cookie: adminCookie }
      });
      expect(unassigned.assignedUserId).toBeNull();
      expect(unassigned.assignedUser).toBeNull();
      expect(unassigned.assignedAt).toBeNull();

      // Verify activity timeline recorded all assignment events
      const activities = await apiClient.leads.getActivities(lead.id, {
        headers: { Cookie: adminCookie }
      });
      expect(activities.some((a) => a.type === CrmActivityType.LEAD_ASSIGNED)).toBe(true);
      expect(activities.some((a) => a.type === CrmActivityType.LEAD_REASSIGNED)).toBe(true);
      expect(activities.some((a) => a.type === CrmActivityType.LEAD_UNASSIGNED)).toBe(true);
    });

    it('Sales Executive without LEADS_ASSIGN receives 403 Forbidden', async () => {
      const lead = await createTestLead();

      try {
        await apiClient.leads.updateAssignment(lead.id, memberUserId, {
          headers: { Cookie: memberCookie }
        });
        expect.unreachable('Should have thrown 403');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).statusCode).toBe(403);
      }
    });
  });

  describe('4. CRM Notes Flow (GET/POST /api/v1/leads/:id/notes)', () => {
    it('User with LEADS_WRITE can add notes and read notes feed', async () => {
      const lead = await createTestLead();

      const note = await apiClient.leads.addNote(
        lead.id,
        { content: 'First client briefing completed successfully.' },
        {
          headers: { Cookie: memberCookie }
        }
      );
      expect(note.id).toBeTruthy();
      expect(note.content).toBe('First client briefing completed successfully.');
      expect(note.author?.id).toBe(memberUserId);
      expect(note.author?.name).toBe('CRM Sales Rep');

      const notes = await apiClient.leads.getNotes(lead.id, {
        headers: { Cookie: viewerCookie }
      });
      expect(notes).toHaveLength(1);
      expect(notes[0]?.id).toBe(note.id);
      expect(notes[0]?.content).toBe('First client briefing completed successfully.');
    });

    it('Viewer without LEADS_WRITE receives 403 Forbidden on adding note', async () => {
      const lead = await createTestLead();

      try {
        await apiClient.leads.addNote(
          lead.id,
          { content: 'Unauthorized note' },
          {
            headers: { Cookie: viewerCookie }
          }
        );
        expect.unreachable('Should have thrown 403');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).statusCode).toBe(403);
      }
    });
  });

  describe('5. Activity Timeline Flow (GET /api/v1/leads/:id/activities)', () => {
    it('Reads activities in reverse chronological order', async () => {
      const lead = await createTestLead();

      await apiClient.leads.addNote(
        lead.id,
        { content: 'Note 1' },
        {
          headers: { Cookie: memberCookie }
        }
      );
      await apiClient.leads.updateCrmStage(lead.id, CrmStage.CONTACTED, {
        headers: { Cookie: memberCookie }
      });

      const activities = await apiClient.leads.getActivities(lead.id, {
        headers: { Cookie: viewerCookie }
      });
      expect(activities.length).toBeGreaterThanOrEqual(2);
      // Newest first
      expect(activities[0]?.type).toBe(CrmActivityType.STAGE_CHANGED);
      expect(activities[1]?.type).toBe(CrmActivityType.NOTE_ADDED);
    });
  });
});
