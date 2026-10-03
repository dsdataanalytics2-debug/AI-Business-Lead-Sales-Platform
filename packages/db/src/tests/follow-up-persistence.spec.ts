import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, {
  FollowUpStatus,
  Role,
  WebsiteStatus,
  OnlinePresenceType
} from '../index.js';
import { ensureTestDatabase } from '../test-guard.js';

describe('M3 Step 5: Follow-Up Tasks DB Persistence Layer Verification', () => {
  const orgAId = '00000000-0000-0000-0000-00000000000a';
  const orgBId = '00000000-0000-0000-0000-00000000000b';

  const userA1Id = '11111111-1111-1111-1111-11111111111a';
  const userA2Id = '11111111-1111-1111-1111-11111111112a';
  const userBId = '11111111-1111-1111-1111-11111111111b';

  let leadAId: string;
  let leadBId: string;

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    // Setup Org A & Org B
    await prisma.organization.upsert({
      where: { id: orgAId },
      update: {},
      create: {
        id: orgAId,
        name: 'FollowUp Test Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: orgBId },
      update: {},
      create: {
        id: orgBId,
        name: 'FollowUp Test Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    // Setup Users in Org A & Org B
    await prisma.user.upsert({
      where: { id: userA1Id },
      update: {},
      create: {
        id: userA1Id,
        organizationId: orgAId,
        email: 'sales.exec.a1@followup-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash1',
        name: 'Sales Exec A1',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { id: userA2Id },
      update: {},
      create: {
        id: userA2Id,
        organizationId: orgAId,
        email: 'sales.exec.a2@followup-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash2',
        name: 'Sales Exec A2',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { id: userBId },
      update: {},
      create: {
        id: userBId,
        organizationId: orgBId,
        email: 'sales.exec.b@followup-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashb',
        name: 'Sales Exec B',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });

    // Create Leads
    const leadA = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Lead A Company',
        normalizedName: 'lead a company',
        category: 'Consulting',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    leadAId = leadA.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: orgBId,
        name: 'Lead B Company',
        normalizedName: 'lead b company',
        category: 'Healthcare',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    leadBId = leadB.id;
  });

  afterAll(async () => {
    await ensureTestDatabase(prisma);
    await prisma.followUpTask.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });
    await prisma.lead.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });
    await prisma.user.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } }
    });
  });

  describe('1. Default Fields & Task Creation', () => {
    it('creates follow-up task with default PENDING status and null completedAt', async () => {
      const dueAt = new Date('2026-10-15T10:00:00.000Z');
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: orgAId,
          leadId: leadAId,
          assignedUserId: userA1Id,
          createdByUserId: userA2Id,
          dueAt,
          note: 'Call client to review agreement'
        }
      });

      expect(task.id).toBeTruthy();
      expect(task.organizationId).toBe(orgAId);
      expect(task.leadId).toBe(leadAId);
      expect(task.assignedUserId).toBe(userA1Id);
      expect(task.createdByUserId).toBe(userA2Id);
      expect(task.status).toBe(FollowUpStatus.PENDING);
      expect(task.completedAt).toBeNull();
      expect(task.dueAt.toISOString()).toBe(dueAt.toISOString());
      expect(task.note).toBe('Call client to review agreement');
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.updatedAt).toBeInstanceOf(Date);
    });

    it('allows creating follow-up task with null assignedUserId and null note', async () => {
      const dueAt = new Date('2026-10-20T14:00:00.000Z');
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: orgAId,
          leadId: leadAId,
          assignedUserId: null,
          createdByUserId: userA1Id,
          dueAt,
          note: null
        }
      });

      expect(task.assignedUserId).toBeNull();
      expect(task.note).toBeNull();
      expect(task.status).toBe(FollowUpStatus.PENDING);
    });
  });

  describe('2. Tenant-Safe Foreign Key Constraints', () => {
    it('rejects cross-org lead reference (Task in Org A cannot reference Lead B in Org B)', async () => {
      let crossOrgLeadError: unknown = null;
      try {
        await prisma.followUpTask.create({
          data: {
            organizationId: orgAId,
            leadId: leadBId, // From Org B
            createdByUserId: userA1Id,
            dueAt: new Date()
          }
        });
      } catch (err) {
        crossOrgLeadError = err;
      }

      expect(crossOrgLeadError).toBeTruthy();
      expect(String(crossOrgLeadError)).toContain('Foreign key constraint violated');
    });

    it('rejects cross-org assignee reference (Task in Org A cannot assign to User B in Org B)', async () => {
      let crossOrgAssigneeError: unknown = null;
      try {
        await prisma.followUpTask.create({
          data: {
            organizationId: orgAId,
            leadId: leadAId,
            assignedUserId: userBId, // From Org B
            createdByUserId: userA1Id,
            dueAt: new Date()
          }
        });
      } catch (err) {
        crossOrgAssigneeError = err;
      }

      expect(crossOrgAssigneeError).toBeTruthy();
      expect(String(crossOrgAssigneeError)).toContain('Foreign key constraint violated');
    });

    it('rejects cross-org creator reference (Task in Org A cannot be created by User B in Org B)', async () => {
      let crossOrgCreatorError: unknown = null;
      try {
        await prisma.followUpTask.create({
          data: {
            organizationId: orgAId,
            leadId: leadAId,
            createdByUserId: userBId, // From Org B
            dueAt: new Date()
          }
        });
      } catch (err) {
        crossOrgCreatorError = err;
      }

      expect(crossOrgCreatorError).toBeTruthy();
      expect(String(crossOrgCreatorError)).toContain('Foreign key constraint violated');
    });
  });

  describe('3. Status & Completion Semantics', () => {
    it('persists COMPLETED status and completedAt timestamp', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: orgAId,
          leadId: leadAId,
          createdByUserId: userA1Id,
          dueAt: new Date()
        }
      });

      const completedTime = new Date();
      const completedTask = await prisma.followUpTask.update({
        where: { id: task.id },
        data: {
          status: FollowUpStatus.COMPLETED,
          completedAt: completedTime
        }
      });

      expect(completedTask.status).toBe(FollowUpStatus.COMPLETED);
      expect(completedTask.completedAt).toBeTruthy();
    });

    it('persists CANCELLED status and clears completedAt timestamp', async () => {
      const task = await prisma.followUpTask.create({
        data: {
          organizationId: orgAId,
          leadId: leadAId,
          createdByUserId: userA1Id,
          dueAt: new Date(),
          status: FollowUpStatus.COMPLETED,
          completedAt: new Date()
        }
      });

      const cancelledTask = await prisma.followUpTask.update({
        where: { id: task.id },
        data: {
          status: FollowUpStatus.CANCELLED,
          completedAt: null
        }
      });

      expect(cancelledTask.status).toBe(FollowUpStatus.CANCELLED);
      expect(cancelledTask.completedAt).toBeNull();
    });
  });

  describe('4. Referential Integrity Actions', () => {
    it('cascades and deletes follow-up tasks when parent Lead is deleted', async () => {
      const tempLead = await prisma.lead.create({
        data: {
          organizationId: orgAId,
          name: 'Temp Lead For Cascade',
          normalizedName: 'temp lead for cascade',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      const task = await prisma.followUpTask.create({
        data: {
          organizationId: orgAId,
          leadId: tempLead.id,
          createdByUserId: userA1Id,
          dueAt: new Date()
        }
      });

      // Delete parent lead
      await prisma.lead.delete({
        where: { id: tempLead.id }
      });

      // Confirm follow-up task was cascaded
      const foundTask = await prisma.followUpTask.findUnique({
        where: { id: task.id }
      });
      expect(foundTask).toBeNull();
    });

    it('restricts hard deletion of user referenced in follow-up tasks (onDelete: Restrict)', async () => {
      const tempUser = await prisma.user.create({
        data: {
          organizationId: orgAId,
          email: 'temp.user.delete@followup-test.ai',
          passwordHash: 'dummy',
          name: 'Temp User',
          role: Role.SALES_EXECUTIVE
        }
      });

      await prisma.followUpTask.create({
        data: {
          organizationId: orgAId,
          leadId: leadAId,
          assignedUserId: tempUser.id,
          createdByUserId: userA1Id,
          dueAt: new Date()
        }
      });

      let deleteUserError: unknown = null;
      try {
        await prisma.user.delete({
          where: { id: tempUser.id }
        });
      } catch (err) {
        deleteUserError = err;
      }

      expect(deleteUserError).toBeTruthy();
      expect(String(deleteUserError)).toMatch(/violates RESTRICT setting|foreign key constraint/i);
    });
  });
});
