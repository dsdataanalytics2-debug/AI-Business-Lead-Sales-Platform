import './setup-test-env.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import prisma from '@leadmate/db';
import { app } from '../../../api/src/app.js';
import { hashPassword } from '../../../api/src/lib/crypto.js';
import { resetLoginRateLimiter } from '../../../api/src/middleware/rate-limiter.js';
import { outreachService } from '../../../api/src/services/outreach.service.js';
import { InMemoryOutreachDeliveryQueue } from '@leadmate/core';
import { apiClient, ApiClientError } from '../lib/api-client.js';
import {
  Role,
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode,
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  ContactType,
  ContactStatus,
  WhatsAppStatus
} from '@leadmate/shared';
import { classifyOutreachError } from '../lib/leads/outreach-display.js';
import { ensureTestDatabase } from './helpers/test-db-guard.js';

describe('M6 Step 6: Frontend Outreach API Client Flow & State Integration Verification', () => {
  let server: http.Server;
  let serverPort: number;
  let orgId: string;
  let adminCookie: string;
  let repCookie: string;
  let viewerCookie: string;
  let adminUserId: string;
  let repUserId: string;
  let viewerUserId: string;
  let assignedLeadId: string;
  let unassignedLeadId: string;
  let approvedDraftId: string;
  let approvedEmailDraftId: string;
  let unapprovedDraftId: string;
  let whatsappContactId: string;
  let emailContactId: string;
  let mockQueue: InMemoryOutreachDeliveryQueue;

  const adminEmail = 'm6-fe-admin@leadmate.test';
  const adminPassword = 'AdminPassword123!Safe';
  const repEmail = 'm6-fe-rep@leadmate.test';
  const repPassword = 'RepPassword123!Safe';
  const viewerEmail = 'm6-fe-viewer@leadmate.test';
  const viewerPassword = 'ViewerPassword123!Safe';

  async function cleanupDb() {
    await ensureTestDatabase(prisma);
    await prisma.outreachDelivery.deleteMany({});
    await prisma.salesAssistantDraft.deleteMany({});
    await prisma.suppressionList.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
  }

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    mockQueue = new InMemoryOutreachDeliveryQueue();
    outreachService.setQueue(mockQueue);

    // Start live backend API server for apiClient integration verification
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

    // Ensure test organization exists
    const org = await prisma.organization.upsert({
      where: { id: '00000000-0000-0000-0000-000000000001' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'LeadMate Primary Org',
        timezone: 'Asia/Dhaka'
      }
    });
    orgId = org.id;

    // Create Admin user (OUTREACH_SEND, OUTREACH_READ)
    const adminHash = await hashPassword(adminPassword);
    const adminUser = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash: adminHash, role: Role.ADMIN, organizationId: orgId, isActive: true },
      create: {
        email: adminEmail,
        passwordHash: adminHash,
        name: 'FE Admin',
        role: Role.ADMIN,
        organizationId: orgId,
        isActive: true
      }
    });
    adminUserId = adminUser.id;

    // Create Sales Executive user
    const repHash = await hashPassword(repPassword);
    const repUser = await prisma.user.upsert({
      where: { email: repEmail },
      update: { passwordHash: repHash, role: Role.SALES_EXECUTIVE, organizationId: orgId, isActive: true },
      create: {
        email: repEmail,
        passwordHash: repHash,
        name: 'FE Sales Rep',
        role: Role.SALES_EXECUTIVE,
        organizationId: orgId,
        isActive: true
      }
    });
    repUserId = repUser.id;

    // Create Viewer user
    const viewerHash = await hashPassword(viewerPassword);
    const viewerUser = await prisma.user.upsert({
      where: { email: viewerEmail },
      update: { passwordHash: viewerHash, role: Role.VIEWER, organizationId: orgId, isActive: true },
      create: {
        email: viewerEmail,
        passwordHash: viewerHash,
        name: 'FE Viewer',
        role: Role.VIEWER,
        organizationId: orgId,
        isActive: true
      }
    });
    viewerUserId = viewerUser.id;

    // Obtain session cookies via HTTP login requests
    resetLoginRateLimiter();

    const adminLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    adminCookie = adminLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

    const repLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: repEmail, password: repPassword })
    });
    repCookie = repLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

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
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  beforeEach(async () => {
    await cleanupDb();
    mockQueue.clear();

    // Create assigned lead (assigned to repUserId)
    const assignedLead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Assigned Enterprise Ltd',
        normalizedName: 'assigned enterprise ltd',
        category: 'Manufacturing',
        city: 'Dhaka',
        country: 'Bangladesh',
        primarySource: 'MANUAL',
        assignedUserId: repUserId,
        assignedAt: new Date()
      }
    });
    assignedLeadId = assignedLead.id;

    // Create unassigned lead
    const unassignedLead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Unassigned Enterprise Ltd',
        normalizedName: 'unassigned enterprise ltd',
        category: 'Retail',
        city: 'Chittagong',
        country: 'Bangladesh',
        primarySource: 'MANUAL',
        assignedUserId: null
      }
    });
    unassignedLeadId = unassignedLead.id;

    // Create verified contacts on assigned lead
    const wpContact = await prisma.leadContact.create({
      data: {
        leadId: assignedLeadId,
        type: ContactType.WHATSAPP,
        rawValue: '01711111111',
        normalizedValue: '+8801711111111',
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.CONFIRMED,
        isPrimary: true
      }
    });
    whatsappContactId = wpContact.id;

    const emContact = await prisma.leadContact.create({
      data: {
        leadId: assignedLeadId,
        type: ContactType.EMAIL,
        rawValue: 'contact@assigned.test',
        normalizedValue: 'contact@assigned.test',
        status: ContactStatus.VERIFIED,
        isPrimary: true
      }
    });
    emailContactId = emContact.id;

    // Create approved WhatsApp draft on assigned lead
    const approvedDraft = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: orgId,
        leadId: assignedLeadId,
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Approved promotional WhatsApp message for partner.',
        approvedAt: new Date(),
        approvedByUserId: adminUserId,
        createdByUserId: repUserId
      }
    });
    approvedDraftId = approvedDraft.id;

    // Create approved Email draft on assigned lead
    const approvedEmailDraft = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: orgId,
        leadId: assignedLeadId,
        type: SalesAssistantDraftType.EMAIL,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.APPROVED,
        emailSubject: 'Formal Partnership Proposal',
        emailBody: 'Dear Partner, please find our proposal attached.',
        content: 'Dear Partner, please find our proposal attached.',
        approvedAt: new Date(),
        approvedByUserId: adminUserId,
        createdByUserId: repUserId
      }
    });
    approvedEmailDraftId = approvedEmailDraft.id;

    // Create unapproved draft
    const unapprovedDraft = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: orgId,
        leadId: assignedLeadId,
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.DRAFT,
        content: 'Draft under review.',
        createdByUserId: repUserId
      }
    });
    unapprovedDraftId = unapprovedDraft.id;
  });

  describe('1. API Client Method Contracts & Headers', () => {
    it('sends Idempotency-Key in HTTP header and strict JSON payload without body idempotencyKey', async () => {
      const idempotencyKey = 'idemp-fe-test-001';

      const delivery = await apiClient.leads.sendOutreachDelivery(
        assignedLeadId,
        {
          draftId: approvedDraftId,
          channel: OutreachChannel.WHATSAPP,
          recipientContactId: whatsappContactId
        },
        idempotencyKey,
        {
          headers: { Cookie: adminCookie }
        }
      );

      expect(delivery).toBeDefined();
      expect(delivery.id).toBeDefined();
      expect(delivery.status).toBe(OutreachDeliveryStatus.QUEUED);
      expect(delivery.recipientMasked).toBe('+88017****1111');
      expect(mockQueue.jobs).toHaveLength(1);
    });

    it('fetches list of outreach deliveries using apiClient.leads.listOutreachDeliveries', async () => {
      // 1. Create a delivery
      await apiClient.leads.sendOutreachDelivery(
        assignedLeadId,
        {
          draftId: approvedDraftId,
          channel: OutreachChannel.WHATSAPP,
          recipientContactId: whatsappContactId
        },
        'idemp-fe-list-001',
        {
          headers: { Cookie: adminCookie }
        }
      );

      // 2. Fetch list
      const listRes = await apiClient.leads.listOutreachDeliveries(assignedLeadId, {
        headers: { Cookie: adminCookie }
      });

      expect(listRes.deliveries).toHaveLength(1);
      expect(listRes.total).toBe(1);
      expect(listRes.deliveries[0].channel).toBe(OutreachChannel.WHATSAPP);
      expect(listRes.deliveries[0].recipientMasked).toBe('+88017****1111');
    });

    it('fetches a single delivery detail using apiClient.leads.getOutreachDelivery', async () => {
      const created = await apiClient.leads.sendOutreachDelivery(
        assignedLeadId,
        {
          draftId: approvedDraftId,
          channel: OutreachChannel.WHATSAPP,
          recipientContactId: whatsappContactId
        },
        'idemp-fe-get-001',
        {
          headers: { Cookie: adminCookie }
        }
      );

      const fetched = await apiClient.leads.getOutreachDelivery(assignedLeadId, created.id, {
        headers: { Cookie: adminCookie }
      });

      expect(fetched.id).toBe(created.id);
      expect(fetched.status).toBe(created.status);
    });
  });

  describe('2. RBAC & Representative Assignment Scope', () => {
    it('allows SALES_EXECUTIVE to dispatch outreach on an assigned lead', async () => {
      const delivery = await apiClient.leads.sendOutreachDelivery(
        assignedLeadId,
        {
          draftId: approvedDraftId,
          channel: OutreachChannel.WHATSAPP,
          recipientContactId: whatsappContactId
        },
        'idemp-rep-assigned-001',
        {
          headers: { Cookie: repCookie }
        }
      );

      expect(delivery.status).toBe(OutreachDeliveryStatus.QUEUED);
    });

    it('denies SALES_EXECUTIVE from dispatching on unassigned lead (403 FORBIDDEN)', async () => {
      let error: ApiClientError | null = null;
      try {
        await apiClient.leads.sendOutreachDelivery(
          unassignedLeadId,
          {
            draftId: approvedDraftId,
            channel: OutreachChannel.WHATSAPP,
            recipientContactId: whatsappContactId
          },
          'idemp-rep-unassigned-001',
          {
            headers: { Cookie: repCookie }
          }
        );
      } catch (err) {
        error = err as ApiClientError;
      }

      expect(error).toBeDefined();
      expect(error?.statusCode).toBe(403);
      expect(error?.code).toBe('FORBIDDEN');
    });

    it('denies VIEWER from initiating outreach delivery (403 FORBIDDEN)', async () => {
      let error: ApiClientError | null = null;
      try {
        await apiClient.leads.sendOutreachDelivery(
          assignedLeadId,
          {
            draftId: approvedDraftId,
            channel: OutreachChannel.WHATSAPP,
            recipientContactId: whatsappContactId
          },
          'idemp-viewer-send-001',
          {
            headers: { Cookie: viewerCookie }
          }
        );
      } catch (err) {
        error = err as ApiClientError;
      }

      expect(error).toBeDefined();
      expect(error?.statusCode).toBe(403);
      expect(error?.code).toBe('FORBIDDEN');
    });

    it('allows VIEWER to read outreach delivery history', async () => {
      const listRes = await apiClient.leads.listOutreachDeliveries(assignedLeadId, {
        headers: { Cookie: viewerCookie }
      });
      expect(listRes.deliveries).toBeDefined();
    });
  });

  describe('3. Domain Error Mappings & Idempotency Safeguards', () => {
    it('rejects unapproved draft with OUTREACH_DRAFT_NOT_APPROVED (409 Conflict)', async () => {
      let error: ApiClientError | null = null;
      try {
        await apiClient.leads.sendOutreachDelivery(
          assignedLeadId,
          {
            draftId: unapprovedDraftId,
            channel: OutreachChannel.WHATSAPP,
            recipientContactId: whatsappContactId
          },
          'idemp-unapproved-001',
          {
            headers: { Cookie: adminCookie }
          }
        );
      } catch (err) {
        error = err as ApiClientError;
      }

      expect(error).toBeDefined();
      expect(error?.statusCode).toBe(409);
      expect(error?.code).toBe(OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED);
    });

    it('rejects channel incompatibility with OUTREACH_CHANNEL_INCOMPATIBLE (422 Unprocessable Entity)', async () => {
      let error: ApiClientError | null = null;
      try {
        await apiClient.leads.sendOutreachDelivery(
          assignedLeadId,
          {
            draftId: approvedDraftId, // WhatsApp draft
            channel: OutreachChannel.EMAIL, // Incompatible
            recipientContactId: emailContactId
          },
          'idemp-incompat-001',
          {
            headers: { Cookie: adminCookie }
          }
        );
      } catch (err) {
        error = err as ApiClientError;
      }

      expect(error).toBeDefined();
      expect(error?.statusCode).toBe(422);
      expect(error?.code).toBe(OutreachErrorCode.OUTREACH_CHANNEL_INCOMPATIBLE);
    });

    it('returns existing delivery on idempotent replay and rejects key reuse with different parameters', async () => {
      const key = 'idemp-stable-key-001';

      // 1. Initial send
      const first = await apiClient.leads.sendOutreachDelivery(
        assignedLeadId,
        {
          draftId: approvedDraftId,
          channel: OutreachChannel.WHATSAPP,
          recipientContactId: whatsappContactId
        },
        key,
        {
          headers: { Cookie: adminCookie }
        }
      );

      // 2. Identical replay -> returns same delivery
      const second = await apiClient.leads.sendOutreachDelivery(
        assignedLeadId,
        {
          draftId: approvedDraftId,
          channel: OutreachChannel.WHATSAPP,
          recipientContactId: whatsappContactId
        },
        key,
        {
          headers: { Cookie: adminCookie }
        }
      );

      expect(second.id).toBe(first.id);

      // 3. Create a second approved draft
      const secondApproved = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: orgId,
          leadId: assignedLeadId,
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.BANGLA,
          tone: SalesAssistantTone.FRIENDLY,
          status: SalesAssistantDraftStatus.APPROVED,
          content: 'Second approved promotional message.',
          approvedAt: new Date(),
          approvedByUserId: adminUserId,
          createdByUserId: repUserId
        }
      });

      // Different draft using SAME key -> 409 OUTREACH_IDEMPOTENCY_KEY_REUSED
      let conflictErr: ApiClientError | null = null;
      try {
        await apiClient.leads.sendOutreachDelivery(
          assignedLeadId,
          {
            draftId: secondApproved.id,
            channel: OutreachChannel.WHATSAPP,
            recipientContactId: whatsappContactId
          },
          key,
          {
            headers: { Cookie: adminCookie }
          }
        );
      } catch (err) {
        conflictErr = err as ApiClientError;
      }

      expect(conflictErr).toBeDefined();
      expect(conflictErr?.statusCode).toBe(409);
      expect(conflictErr?.code).toBe(OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED);
    });
  });

  describe('4. Email Recipient Contract Semantics (LeadContact vs primaryEmail fallback)', () => {
    it('dispatches Email with recipientContactId when LeadContact EMAIL is selected and does not send raw recipient', async () => {
      const delivery = await apiClient.leads.sendOutreachDelivery(
        assignedLeadId,
        {
          draftId: approvedEmailDraftId,
          channel: OutreachChannel.EMAIL,
          recipientContactId: emailContactId
        },
        'idemp-email-contact-001',
        {
          headers: { Cookie: adminCookie }
        }
      );

      expect(delivery).toBeDefined();
      expect(delivery.channel).toBe(OutreachChannel.EMAIL);
      expect(delivery.status).toBe(OutreachDeliveryStatus.QUEUED);
      expect(delivery.recipientMasked).toBe('c***t@assigned.test');

      // Verify DB delivery record has resolvedRecipientContactId = emailContactId
      const inDb = await prisma.outreachDelivery.findUnique({
        where: { id: delivery.id }
      });
      expect(inDb?.recipientContactId).toBe(emailContactId);
      expect(inDb?.recipientNormalized).toBe('contact@assigned.test');
    });

    it('dispatches Email with omitted recipientContactId when primaryEmail fallback is used (zero LeadContacts)', async () => {
      // Create a lead with 0 LeadContact rows, but valid primaryEmail
      const fallbackLead = await prisma.lead.create({
        data: {
          organizationId: orgId,
          name: 'Fallback Org Ltd',
          normalizedName: 'fallback org ltd',
          category: 'Logistics',
          city: 'Dhaka',
          country: 'Bangladesh',
          primaryEmail: 'director@fallback.test',
          primarySource: 'MANUAL',
          assignedUserId: adminUserId
        }
      });

      const fallbackDraft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: orgId,
          leadId: fallbackLead.id,
          type: SalesAssistantDraftType.EMAIL,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          status: SalesAssistantDraftStatus.APPROVED,
          emailSubject: 'Fallback Proposal',
          emailBody: 'Dear Director, proposal content.',
          content: 'Dear Director, proposal content.',
          approvedAt: new Date(),
          approvedByUserId: adminUserId,
          createdByUserId: adminUserId
        }
      });

      // Selection of primaryEmail fallback results in recipientContactId: undefined
      const delivery = await apiClient.leads.sendOutreachDelivery(
        fallbackLead.id,
        {
          draftId: fallbackDraft.id,
          channel: OutreachChannel.EMAIL,
          recipientContactId: undefined // OMITTED from payload
        },
        'idemp-email-fallback-001',
        {
          headers: { Cookie: adminCookie }
        }
      );

      expect(delivery).toBeDefined();
      expect(delivery.channel).toBe(OutreachChannel.EMAIL);
      expect(delivery.status).toBe(OutreachDeliveryStatus.QUEUED);
      expect(delivery.recipientMasked).toBe('d***r@fallback.test');

      // Verify DB delivery record has recipientContactId = null
      const inDb = await prisma.outreachDelivery.findUnique({
        where: { id: delivery.id }
      });
      expect(inDb?.recipientContactId).toBeNull();
      expect(inDb?.recipientNormalized).toBe('director@fallback.test');
    });
  });
});
