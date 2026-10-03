import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, {
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  SalesAssistantWarning,
  Role,
  WebsiteStatus,
  OnlinePresenceType
} from '../index.js';
import { ensureTestDatabase } from '../test-guard.js';

describe('M5 Step 2: SalesAssistantDraft DB Persistence Layer Verification', () => {
  const orgAId = '00000000-0000-0000-0000-0000000000a5';
  const orgBId = '00000000-0000-0000-0000-0000000000b5';
  const userA1Id = '55555555-5555-5555-5555-5555555551a5';
  const userA2Id = '55555555-5555-5555-5555-5555555552a5';
  const userBId  = '55555555-5555-5555-5555-5555555553b5';
  let leadA1Id: string;
  let leadA2Id: string;
  let leadBId: string;

  beforeAll(async () => {
    await ensureTestDatabase(prisma);
    await prisma.organization.upsert({ where: { id: orgAId }, update: {}, create: { id: orgAId, name: 'SalesDraft Test Org A', timezone: 'Asia/Dhaka' } });
    await prisma.organization.upsert({ where: { id: orgBId }, update: {}, create: { id: orgBId, name: 'SalesDraft Test Org B', timezone: 'Asia/Dhaka' } });
    await prisma.user.upsert({ where: { id: userA1Id }, update: {}, create: { id: userA1Id, organizationId: orgAId, email: 'sales.a1@salesdraft-test.ai', passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashA1', name: 'Sales A1', role: Role.SALES_EXECUTIVE, isActive: true } });
    await prisma.user.upsert({ where: { id: userA2Id }, update: {}, create: { id: userA2Id, organizationId: orgAId, email: 'sales.a2@salesdraft-test.ai', passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashA2', name: 'Sales A2', role: Role.SALES_EXECUTIVE, isActive: true } });
    await prisma.user.upsert({ where: { id: userBId }, update: {}, create: { id: userBId, organizationId: orgBId, email: 'sales.b@salesdraft-test.ai', passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashB', name: 'Sales B', role: Role.SALES_EXECUTIVE, isActive: true } });
    await prisma.salesAssistantDraft.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    const leadA1 = await prisma.lead.create({ data: { organizationId: orgAId, name: 'Lead A1 Pharmacy', normalizedName: 'lead a1 pharmacy', category: 'Healthcare', primarySource: 'MANUAL', websiteStatus: WebsiteStatus.UNKNOWN, onlinePresenceType: OnlinePresenceType.UNKNOWN } });
    leadA1Id = leadA1.id;
    const leadA2 = await prisma.lead.create({ data: { organizationId: orgAId, name: 'Lead A2 Clothing Shop', normalizedName: 'lead a2 clothing shop', category: 'Retail', primarySource: 'MANUAL', websiteStatus: WebsiteStatus.UNKNOWN, onlinePresenceType: OnlinePresenceType.UNKNOWN } });
    leadA2Id = leadA2.id;
    const leadB = await prisma.lead.create({ data: { organizationId: orgBId, name: 'Lead B Electronics', normalizedName: 'lead b electronics', category: 'Electronics', primarySource: 'MANUAL', websiteStatus: WebsiteStatus.UNKNOWN, onlinePresenceType: OnlinePresenceType.UNKNOWN } });
    leadBId = leadB.id;
  });

  afterAll(async () => {
    await prisma.salesAssistantDraft.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await prisma.lead.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  });

  describe('1. Enums and Schema Structure', () => {
    it('verifies SalesAssistantDraftType enum values match shared specification', () => {
      expect(SalesAssistantDraftType.WHATSAPP).toBe('WHATSAPP');
      expect(SalesAssistantDraftType.EMAIL).toBe('EMAIL');
      expect(SalesAssistantDraftType.CALL_SCRIPT).toBe('CALL_SCRIPT');
      expect(SalesAssistantDraftType.PROPOSAL).toBe('PROPOSAL');
      expect(SalesAssistantDraftType.FOLLOW_UP).toBe('FOLLOW_UP');
      expect(Object.values(SalesAssistantDraftType)).toHaveLength(5);
    });
    it('verifies SalesAssistantLanguage enum values', () => {
      expect(SalesAssistantLanguage.BANGLA).toBe('BANGLA');
      expect(SalesAssistantLanguage.ENGLISH).toBe('ENGLISH');
      expect(SalesAssistantLanguage.MIXED).toBe('MIXED');
      expect(Object.values(SalesAssistantLanguage)).toHaveLength(3);
    });
    it('verifies SalesAssistantTone enum values', () => {
      expect(SalesAssistantTone.PROFESSIONAL).toBe('PROFESSIONAL');
      expect(SalesAssistantTone.FRIENDLY).toBe('FRIENDLY');
      expect(SalesAssistantTone.CONCISE).toBe('CONCISE');
      expect(SalesAssistantTone.PERSUASIVE).toBe('PERSUASIVE');
      expect(Object.values(SalesAssistantTone)).toHaveLength(4);
    });
    it('verifies SalesAssistantDraftStatus has DRAFT, APPROVED, REJECTED but no SENT', () => {
      expect(SalesAssistantDraftStatus.DRAFT).toBe('DRAFT');
      expect(SalesAssistantDraftStatus.APPROVED).toBe('APPROVED');
      expect(SalesAssistantDraftStatus.REJECTED).toBe('REJECTED');
      expect(Object.values(SalesAssistantDraftStatus)).not.toContain('SENT');
      expect(Object.values(SalesAssistantDraftStatus)).toHaveLength(3);
    });
    it('verifies SalesAssistantWarning enum values', () => {
      expect(SalesAssistantWarning.MISSING_PRODUCT_CONTEXT).toBe('MISSING_PRODUCT_CONTEXT');
      expect(SalesAssistantWarning.MISSING_PRICE_CONTEXT).toBe('MISSING_PRICE_CONTEXT');
      expect(SalesAssistantWarning.UNVERIFIED_WHATSAPP).toBe('UNVERIFIED_WHATSAPP');
      expect(SalesAssistantWarning.UNSUPPORTED_CLAIM_REMOVED).toBe('UNSUPPORTED_CLAIM_REMOVED');
      expect(SalesAssistantWarning.LIMITED_LEAD_CONTEXT).toBe('LIMITED_LEAD_CONTEXT');
      expect(Object.values(SalesAssistantWarning)).toHaveLength(5);
    });
    it('confirms schema has no raw-provider or secret fields (data minimization)', () => {
      const draftKeys = Object.keys(prisma.salesAssistantDraft.fields);
      const forbidden = ['rawProviderRequest','rawProviderResponse','systemPrompt','chainOfThought','apiKey','authorizationHeader','sessionToken','hiddenReasoning','provider','model','tokenCount','finishReason'];
      for (const field of forbidden) { expect(draftKeys).not.toContain(field); }
    });
  });

  describe('2. Basic CRUD & Defaults', () => {
    it('creates a WhatsApp draft with DRAFT default status', async () => {
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type: SalesAssistantDraftType.WHATSAPP, language: SalesAssistantLanguage.BANGLA, tone: SalesAssistantTone.PROFESSIONAL, content: 'Hello from WhatsApp draft' } });
      expect(draft.id).toBeDefined();
      expect(draft.organizationId).toBe(orgAId);
      expect(draft.leadId).toBe(leadA1Id);
      expect(draft.createdByUserId).toBe(userA1Id);
      expect(draft.type).toBe(SalesAssistantDraftType.WHATSAPP);
      expect(draft.language).toBe(SalesAssistantLanguage.BANGLA);
      expect(draft.tone).toBe(SalesAssistantTone.PROFESSIONAL);
      expect(draft.status).toBe(SalesAssistantDraftStatus.DRAFT);
      expect(draft.content).toBe('Hello from WhatsApp draft');
      expect(draft.emailSubject).toBeNull();
      expect(draft.emailBody).toBeNull();
      expect(draft.objective).toBeNull();
      expect(draft.customInstruction).toBeNull();
      expect(draft.warnings).toEqual([]);
      expect(draft.approvedAt).toBeNull();
      expect(draft.approvedByUserId).toBeNull();
      expect(draft.rejectedAt).toBeNull();
      expect(draft.rejectedByUserId).toBeNull();
      expect(draft.createdAt).toBeInstanceOf(Date);
      expect(draft.updatedAt).toBeInstanceOf(Date);
    });
    it('defaults warnings to an empty array when omitted by caller (@default([]))', async () => {
      const draft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          createdByUserId: userA1Id,
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.CONCISE,
          content: 'No warnings draft test',
        }
      });
      expect(draft.warnings).toEqual([]);
      const fetched = await prisma.salesAssistantDraft.findUnique({ where: { id: draft.id } });
      expect(fetched?.warnings).toEqual([]);
    });
    it('stores objective and customInstruction as plain user-authored text', async () => {
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type: SalesAssistantDraftType.CALL_SCRIPT, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.FRIENDLY, content: 'Hello, calling from LeadMate...', objective: 'Schedule a demo', customInstruction: 'Keep it under 3 minutes' } });
      expect(draft.objective).toBe('Schedule a demo');
      expect(draft.customInstruction).toBe('Keep it under 3 minutes');
    });
    it('can transition to APPROVED with attribution', async () => {
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type: SalesAssistantDraftType.FOLLOW_UP, language: SalesAssistantLanguage.MIXED, tone: SalesAssistantTone.CONCISE, content: 'Following up on our conversation.' } });
      const approvedAt = new Date();
      const updated = await prisma.salesAssistantDraft.update({ where: { id: draft.id }, data: { status: SalesAssistantDraftStatus.APPROVED, approvedAt, approvedByUserId: userA2Id } });
      expect(updated.status).toBe(SalesAssistantDraftStatus.APPROVED);
      expect(updated.approvedByUserId).toBe(userA2Id);
      expect(updated.approvedAt?.getTime()).toBe(approvedAt.getTime());
      expect(updated.rejectedAt).toBeNull();
    });
    it('can transition to REJECTED with attribution', async () => {
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type: SalesAssistantDraftType.PROPOSAL, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.PERSUASIVE, content: 'Our proposal for your business...' } });
      const rejectedAt = new Date();
      const updated = await prisma.salesAssistantDraft.update({ where: { id: draft.id }, data: { status: SalesAssistantDraftStatus.REJECTED, rejectedAt, rejectedByUserId: userA2Id } });
      expect(updated.status).toBe(SalesAssistantDraftStatus.REJECTED);
      expect(updated.rejectedByUserId).toBe(userA2Id);
      expect(updated.rejectedAt?.getTime()).toBe(rejectedAt.getTime());
      expect(updated.approvedAt).toBeNull();
    });
  });

  describe('3. Email Draft Storage', () => {
    it('stores EMAIL draft with separate emailSubject and emailBody and null content', async () => {
      const subject = 'Introducing LeadMate for your pharmacy';
      const body = 'Dear Manager,\n\nWe are pleased to introduce our AI-powered sales assistant.\n\nBest regards,\nSales Team';
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type: SalesAssistantDraftType.EMAIL, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.PROFESSIONAL, emailSubject: subject, emailBody: body } });
      expect(draft.type).toBe(SalesAssistantDraftType.EMAIL);
      expect(draft.emailSubject).toBe(subject);
      expect(draft.emailBody).toBe(body);
      expect(draft.content).toBeNull();
    });
    it('email subject and body survive a full round-trip read', async () => {
      const longBody = 'Line content.\n'.repeat(200);
      const subject = 'Test Email Round Trip';
      const created = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA2Id, createdByUserId: userA2Id, type: SalesAssistantDraftType.EMAIL, language: SalesAssistantLanguage.MIXED, tone: SalesAssistantTone.FRIENDLY, emailSubject: subject, emailBody: longBody } });
      const found = await prisma.salesAssistantDraft.findUniqueOrThrow({ where: { id: created.id } });
      expect(found.emailSubject).toBe(subject);
      expect(found.emailBody).toBe(longBody);
      expect(found.content).toBeNull();
    });
  });

  describe('4. Non-Email Draft Types (content field)', () => {
    it.each([
      [SalesAssistantDraftType.WHATSAPP, 'WhatsApp message content'],
      [SalesAssistantDraftType.CALL_SCRIPT, 'Call script content'],
      [SalesAssistantDraftType.PROPOSAL, 'Proposal content'],
      [SalesAssistantDraftType.FOLLOW_UP, 'Follow-up content']
    ])('persists %s type with content field', async (type, contentText) => {
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.CONCISE, content: contentText } });
      expect(draft.type).toBe(type);
      expect(draft.content).toBe(contentText);
      expect(draft.emailSubject).toBeNull();
      expect(draft.emailBody).toBeNull();
    });
  });

  describe('5. Multiple Drafts Per Lead', () => {
    it('allows multiple drafts for same (organizationId, leadId) without uniqueness conflict', async () => {
      const base = { organizationId: orgAId, leadId: leadA2Id, createdByUserId: userA2Id, language: SalesAssistantLanguage.BANGLA, tone: SalesAssistantTone.PROFESSIONAL };
      const d1 = await prisma.salesAssistantDraft.create({ data: { ...base, type: SalesAssistantDraftType.WHATSAPP, content: 'Draft 1' } });
      const d2 = await prisma.salesAssistantDraft.create({ data: { ...base, type: SalesAssistantDraftType.WHATSAPP, content: 'Draft 2 (regenerated)' } });
      const d3 = await prisma.salesAssistantDraft.create({ data: { ...base, type: SalesAssistantDraftType.EMAIL, emailSubject: 'Email subject', emailBody: 'Email body' } });
      expect(d1.id).not.toBe(d2.id);
      expect(d2.id).not.toBe(d3.id);
      const all = await prisma.salesAssistantDraft.findMany({ where: { organizationId: orgAId, leadId: leadA2Id } });
      expect(all.length).toBeGreaterThanOrEqual(3);
    });
    it('tenant-scopes listing — Org B cannot see Org A drafts for the same leadId', async () => {
      const orgBDrafts = await prisma.salesAssistantDraft.findMany({ where: { organizationId: orgBId, leadId: leadA2Id } });
      expect(orgBDrafts).toHaveLength(0);
    });
  });

  describe('6. Warnings Persistence', () => {
    it('persists all SalesAssistantWarning values and reads them back exactly', async () => {
      const allWarnings = Object.values(SalesAssistantWarning);
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type: SalesAssistantDraftType.WHATSAPP, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.PROFESSIONAL, content: 'All warnings', warnings: allWarnings } });
      const found = await prisma.salesAssistantDraft.findUniqueOrThrow({ where: { id: draft.id } });
      expect(found.warnings).toHaveLength(allWarnings.length);
      for (const w of allWarnings) { expect(found.warnings).toContain(w); }
    });
    it('persists empty warnings array (default)', async () => {
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type: SalesAssistantDraftType.FOLLOW_UP, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.CONCISE, content: 'No warnings' } });
      expect(draft.warnings).toEqual([]);
    });
    it('persists a partial subset of warnings correctly', async () => {
      const subset = [SalesAssistantWarning.UNVERIFIED_WHATSAPP, SalesAssistantWarning.LIMITED_LEAD_CONTEXT];
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type: SalesAssistantDraftType.WHATSAPP, language: SalesAssistantLanguage.BANGLA, tone: SalesAssistantTone.FRIENDLY, content: 'Partial warnings', warnings: subset } });
      const found = await prisma.salesAssistantDraft.findUniqueOrThrow({ where: { id: draft.id } });
      expect(found.warnings).toHaveLength(2);
      expect(found.warnings).toContain(SalesAssistantWarning.UNVERIFIED_WHATSAPP);
      expect(found.warnings).toContain(SalesAssistantWarning.LIMITED_LEAD_CONTEXT);
    });
  });

  describe('7. Tenant-Safe Composite Foreign Keys', () => {
    it('rejects cross-tenant lead (Org A draft referencing Org B lead)', async () => {
      let err: unknown = null;
      try { await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadBId, createdByUserId: userA1Id, type: SalesAssistantDraftType.WHATSAPP, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.PROFESSIONAL, content: 'Cross-tenant' } }); } catch (e) { err = e; }
      expect(err).toBeTruthy();
      expect(String(err)).toMatch(/foreign key constraint/i);
    });
    it('rejects cross-tenant creator (Org A draft created by Org B user)', async () => {
      const tempLead = await prisma.lead.create({ data: { organizationId: orgAId, name: 'Temp Cross Creator', normalizedName: 'temp cross creator', category: 'Retail', primarySource: 'MANUAL', websiteStatus: WebsiteStatus.UNKNOWN, onlinePresenceType: OnlinePresenceType.UNKNOWN } });
      let err: unknown = null;
      try { await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: tempLead.id, createdByUserId: userBId, type: SalesAssistantDraftType.WHATSAPP, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.PROFESSIONAL, content: 'Cross-creator' } }); } catch (e) { err = e; }
      expect(err).toBeTruthy();
      expect(String(err)).toMatch(/foreign key constraint/i);
      await prisma.lead.delete({ where: { id: tempLead.id } });
    });
    it('rejects cross-tenant approvedByUser (Org A draft approved by Org B user)', async () => {
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type: SalesAssistantDraftType.WHATSAPP, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.CONCISE, content: 'Approver tenant test' } });
      let err: unknown = null;
      try { await prisma.salesAssistantDraft.update({ where: { id: draft.id }, data: { status: SalesAssistantDraftStatus.APPROVED, approvedByUserId: userBId, approvedAt: new Date() } }); } catch (e) { err = e; }
      expect(err).toBeTruthy();
      expect(String(err)).toMatch(/foreign key constraint/i);
      await prisma.salesAssistantDraft.delete({ where: { id: draft.id } });
    });
    it('rejects cross-tenant rejectedByUser (Org A draft rejected by Org B user)', async () => {
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: leadA1Id, createdByUserId: userA1Id, type: SalesAssistantDraftType.FOLLOW_UP, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.FRIENDLY, content: 'Rejector tenant test' } });
      let err: unknown = null;
      try { await prisma.salesAssistantDraft.update({ where: { id: draft.id }, data: { status: SalesAssistantDraftStatus.REJECTED, rejectedByUserId: userBId, rejectedAt: new Date() } }); } catch (e) { err = e; }
      expect(err).toBeTruthy();
      expect(String(err)).toMatch(/foreign key constraint/i);
      await prisma.salesAssistantDraft.delete({ where: { id: draft.id } });
    });
  });

  describe('8. Referential Integrity & Delete Behavior', () => {
    it('cascades all drafts when parent Lead is hard deleted', async () => {
      const tempLead = await prisma.lead.create({ data: { organizationId: orgAId, name: 'Temp Cascade Lead', normalizedName: 'temp cascade lead', category: 'Retail', primarySource: 'MANUAL', websiteStatus: WebsiteStatus.UNKNOWN, onlinePresenceType: OnlinePresenceType.UNKNOWN } });
      const d1 = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: tempLead.id, createdByUserId: userA1Id, type: SalesAssistantDraftType.WHATSAPP, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.PROFESSIONAL, content: 'Cascade 1' } });
      const d2 = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: tempLead.id, createdByUserId: userA1Id, type: SalesAssistantDraftType.EMAIL, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.FRIENDLY, emailSubject: 'S', emailBody: 'B' } });
      await prisma.lead.delete({ where: { id: tempLead.id } });
      expect(await prisma.salesAssistantDraft.findUnique({ where: { id: d1.id } })).toBeNull();
      expect(await prisma.salesAssistantDraft.findUnique({ where: { id: d2.id } })).toBeNull();
    });
    it('restricts hard deletion of creator user when referenced by draft (onDelete: Restrict)', async () => {
      const tempUser = await prisma.user.create({ data: { organizationId: orgAId, email: 'temp.restrict.creator@salesdraft-test.ai', passwordHash: 'dummy', name: 'Temp Creator', role: Role.SALES_EXECUTIVE } });
      const tempLead = await prisma.lead.create({ data: { organizationId: orgAId, name: 'Temp Restrict Lead', normalizedName: 'temp restrict lead', category: 'Retail', primarySource: 'MANUAL', websiteStatus: WebsiteStatus.UNKNOWN, onlinePresenceType: OnlinePresenceType.UNKNOWN } });
      await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: tempLead.id, createdByUserId: tempUser.id, type: SalesAssistantDraftType.WHATSAPP, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.PROFESSIONAL, content: 'Restrict test' } });
      let err: unknown = null;
      try { await prisma.user.delete({ where: { id: tempUser.id } }); } catch (e) { err = e; }
      expect(err).toBeTruthy();
      expect(String(err)).toMatch(/violates RESTRICT setting|foreign key constraint/i);
      await prisma.lead.delete({ where: { id: tempLead.id } });
      await prisma.user.delete({ where: { id: tempUser.id } });
    });
    it('allows user soft-deactivation (isActive = false) while preserving drafts', async () => {
      const tempUser = await prisma.user.create({ data: { organizationId: orgAId, email: 'temp.softdeact.m5s2@salesdraft-test.ai', passwordHash: 'dummy', name: 'Soft Deact User', role: Role.SALES_EXECUTIVE } });
      const tempLead = await prisma.lead.create({ data: { organizationId: orgAId, name: 'Temp Soft Deact Lead M5S2', normalizedName: 'temp soft deact lead m5s2', category: 'Retail', primarySource: 'MANUAL', websiteStatus: WebsiteStatus.UNKNOWN, onlinePresenceType: OnlinePresenceType.UNKNOWN } });
      const draft = await prisma.salesAssistantDraft.create({ data: { organizationId: orgAId, leadId: tempLead.id, createdByUserId: tempUser.id, type: SalesAssistantDraftType.CALL_SCRIPT, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.CONCISE, content: 'Soft deact draft' } });
      await prisma.user.update({ where: { id: tempUser.id }, data: { isActive: false } });
      const found = await prisma.salesAssistantDraft.findUnique({ where: { id: draft.id }, include: { createdByUser: true } });
      expect(found).not.toBeNull();
      expect(found?.createdByUser.isActive).toBe(false);
      await prisma.lead.delete({ where: { id: tempLead.id } });
      await prisma.user.delete({ where: { id: tempUser.id } });
    });
    it('cascades all drafts when parent Organization is deleted', async () => {
      const isolatedOrgId = '00000000-0000-0000-0000-0000000000c5';
      const isolatedUserId = '55555555-5555-5555-5555-5555555554c5';
      await prisma.organization.create({ data: { id: isolatedOrgId, name: 'Isolated Org M5 S2', timezone: 'Asia/Dhaka' } });
      await prisma.user.create({ data: { id: isolatedUserId, organizationId: isolatedOrgId, email: 'isolated.m5s2@salesdraft-test.ai', passwordHash: 'dummy', name: 'Isolated', role: Role.SALES_EXECUTIVE } });
      const isoLead = await prisma.lead.create({ data: { organizationId: isolatedOrgId, name: 'Isolated Lead M5 S2', normalizedName: 'isolated lead m5 s2', category: 'Retail', primarySource: 'MANUAL', websiteStatus: WebsiteStatus.UNKNOWN, onlinePresenceType: OnlinePresenceType.UNKNOWN } });
      const isoDraft = await prisma.salesAssistantDraft.create({ data: { organizationId: isolatedOrgId, leadId: isoLead.id, createdByUserId: isolatedUserId, type: SalesAssistantDraftType.WHATSAPP, language: SalesAssistantLanguage.ENGLISH, tone: SalesAssistantTone.PROFESSIONAL, content: 'Org cascade test' } });
      await prisma.organization.delete({ where: { id: isolatedOrgId } });
      expect(await prisma.salesAssistantDraft.findUnique({ where: { id: isoDraft.id } })).toBeNull();
    });
  });

  describe('9. Enum Parity with @leadmate/shared', () => {
    it('Prisma SalesAssistantDraftType matches shared', async () => {
      const shared = await import('@leadmate/shared');
      expect(Object.values(SalesAssistantDraftType).sort()).toEqual(Object.values(shared.SalesAssistantDraftType).sort());
    });
    it('Prisma SalesAssistantLanguage matches shared', async () => {
      const shared = await import('@leadmate/shared');
      expect(Object.values(SalesAssistantLanguage).sort()).toEqual(Object.values(shared.SalesAssistantLanguage).sort());
    });
    it('Prisma SalesAssistantTone matches shared', async () => {
      const shared = await import('@leadmate/shared');
      expect(Object.values(SalesAssistantTone).sort()).toEqual(Object.values(shared.SalesAssistantTone).sort());
    });
    it('Prisma SalesAssistantDraftStatus matches shared (and no SENT)', async () => {
      const shared = await import('@leadmate/shared');
      const prismaVals = Object.values(SalesAssistantDraftStatus).sort();
      expect(prismaVals).toEqual(Object.values(shared.SalesAssistantDraftStatus).sort());
      expect(prismaVals).not.toContain('SENT');
    });
    it('Prisma SalesAssistantWarning matches shared', async () => {
      const shared = await import('@leadmate/shared');
      expect(Object.values(SalesAssistantWarning).sort()).toEqual(Object.values(shared.SalesAssistantWarning).sort());
    });
  });
});