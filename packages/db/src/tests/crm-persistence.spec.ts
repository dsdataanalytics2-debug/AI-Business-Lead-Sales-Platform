import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, {
  CrmStage,
  CrmActivityType,
  Role,
  WebsiteStatus,
  OnlinePresenceType
} from '../index.js';
import {
  CrmStage as SharedCrmStage,
  CrmActivityType as SharedCrmActivityType
} from '@leadmate/shared';
import { ensureTestDatabase } from '../test-guard.js';

describe('M3 Step 2: CRM Persistence Layer Verification', () => {
  const orgAId = '00000000-0000-0000-0000-00000000000a';
  const orgBId = '00000000-0000-0000-0000-00000000000b';

  const userA1Id = '11111111-1111-1111-1111-11111111111a';
  const userA2Id = '11111111-1111-1111-1111-11111111112a';
  const userBId = '11111111-1111-1111-1111-11111111111b';

  let leadA1Id: string;
  let leadA2Id: string;
  let leadBId: string;

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    // Setup Org A & Org B
    await prisma.organization.upsert({
      where: { id: orgAId },
      update: {},
      create: {
        id: orgAId,
        name: 'CRM Test Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: orgBId },
      update: {},
      create: {
        id: orgBId,
        name: 'CRM Test Org B',
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
        email: 'sales.manager.a1@crm-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash1',
        name: 'Sales Manager A1',
        role: Role.SALES_MANAGER,
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { id: userA2Id },
      update: {},
      create: {
        id: userA2Id,
        organizationId: orgAId,
        email: 'sales.exec.a2@crm-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash2',
        name: 'Sales Executive A2',
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
        email: 'sales.exec.b@crm-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash3',
        name: 'Sales Executive B',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });

    // Create Leads in Org A and Org B
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Gulshan Dental Studio',
        normalizedName: 'gulshan dental studio',
        category: 'Dental Clinic',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH',
        websiteStatus: WebsiteStatus.REACHABLE,
        onlinePresenceType: OnlinePresenceType.WEBSITE
      }
    });
    leadA1Id = leadA1.id;

    const leadA2 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Banani Diagnostics',
        normalizedName: 'banani diagnostics',
        category: 'Diagnostic Center',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH',
        websiteStatus: WebsiteStatus.NONE_DETECTED,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED
      }
    });
    leadA2Id = leadA2.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: orgBId,
        name: 'Uttara Fashion House',
        normalizedName: 'uttara fashion house',
        category: 'Clothing Store',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH',
        websiteStatus: WebsiteStatus.NONE_DETECTED,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED
      }
    });
    leadBId = leadB.id;
  });

  afterAll(async () => {
    try {
      await ensureTestDatabase(prisma);

      await prisma.crmActivity.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } }
      }).catch(() => {});

      await prisma.crmNote.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } }
      }).catch(() => {});

      await prisma.lead.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } }
      }).catch(() => {});

      await prisma.user.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } }
      }).catch(() => {});

      await prisma.organization.deleteMany({
        where: { id: { in: [orgAId, orgBId] } }
      }).catch(() => {});
    } finally {
      await prisma.$disconnect();
    }
  });

  /* -----------------------------------------------------------------
   * 1. Enum Alignment Verification
   * ----------------------------------------------------------------- */
  describe('Enum Alignment', () => {
    it('1. Prisma CrmStage enum values match Shared CrmStage enum values exactly', () => {
      expect(Object.values(CrmStage)).toEqual(Object.values(SharedCrmStage));
      expect(Object.values(CrmStage)).toEqual([
        'NEW',
        'CONTACTED',
        'QUALIFIED',
        'PROPOSAL_SENT',
        'NEGOTIATION',
        'WON',
        'LOST'
      ]);
    });

    it('2. Prisma CrmActivityType enum values match Shared CrmActivityType enum values exactly', () => {
      expect(Object.values(CrmActivityType)).toEqual(Object.values(SharedCrmActivityType));
      expect(Object.values(CrmActivityType)).toEqual([
        'LEAD_ASSIGNED',
        'LEAD_UNASSIGNED',
        'LEAD_REASSIGNED',
        'STAGE_CHANGED',
        'NOTE_ADDED'
      ]);
    });
  });

  /* -----------------------------------------------------------------
   * 2. Lead CRM Fields & Defaults
   * ----------------------------------------------------------------- */
  describe('Lead CRM Fields & Defaults', () => {
    it('3. New Lead defaults to crmStage NEW with null assignedUserId and assignedAt', async () => {
      const lead = await prisma.lead.findUnique({
        where: { id: leadA1Id }
      });
      expect(lead).not.toBeNull();
      expect(lead?.crmStage).toBe(CrmStage.NEW);
      expect(lead?.assignedUserId).toBeNull();
      expect(lead?.assignedAt).toBeNull();
    });

    it('4. Lead accepts all 7 canonical CrmStage values in persistence', async () => {
      const stages: CrmStage[] = [
        CrmStage.NEW,
        CrmStage.CONTACTED,
        CrmStage.QUALIFIED,
        CrmStage.PROPOSAL_SENT,
        CrmStage.NEGOTIATION,
        CrmStage.WON,
        CrmStage.LOST
      ];

      for (const stage of stages) {
        const updated = await prisma.lead.update({
          where: { id: leadA1Id },
          data: { crmStage: stage }
        });
        expect(updated.crmStage).toBe(stage);
      }
    });
  });

  /* -----------------------------------------------------------------
   * 3. Lead Assignment & Tenant Isolation
   * ----------------------------------------------------------------- */
  describe('Lead Assignment & Tenant Isolation', () => {
    it('5. Successfully assigns lead to a user in the SAME organization with timestamp', async () => {
      const assignedTime = new Date();
      const updated = await prisma.lead.update({
        where: { id: leadA1Id },
        data: {
          assignedUserId: userA1Id,
          assignedAt: assignedTime
        },
        include: { assignedUser: true }
      });

      expect(updated.assignedUserId).toBe(userA1Id);
      expect(updated.assignedAt).toEqual(assignedTime);
      expect(updated.assignedUser?.id).toBe(userA1Id);
      expect(updated.assignedUser?.name).toBe('Sales Manager A1');
    });

    it('6. Successfully unassigns lead (assignedUserId: null, assignedAt: null)', async () => {
      const unassigned = await prisma.lead.update({
        where: { id: leadA1Id },
        data: {
          assignedUserId: null,
          assignedAt: null
        },
        include: { assignedUser: true }
      });

      expect(unassigned.assignedUserId).toBeNull();
      expect(unassigned.assignedAt).toBeNull();
      expect(unassigned.assignedUser).toBeNull();
    });

    it('7. Reassigns lead to another user in the same organization', async () => {
      const reassignTime = new Date();
      const reassigned = await prisma.lead.update({
        where: { id: leadA1Id },
        data: {
          assignedUserId: userA2Id,
          assignedAt: reassignTime
        },
        include: { assignedUser: true }
      });

      expect(reassigned.assignedUserId).toBe(userA2Id);
      expect(reassigned.assignedUser?.name).toBe('Sales Executive A2');
    });

    it('8. Cross-org assignment rejected: cannot assign Lead A to User B from different org (FK violation)', async () => {
      let crossOrgError: any = null;
      try {
        await prisma.lead.update({
          where: { id: leadA1Id },
          data: {
            assignedUserId: userBId // User B belongs to Org B, Lead A belongs to Org A
          }
        });
      } catch (err) {
        crossOrgError = err;
      }

      expect(crossOrgError).not.toBeNull();
      expect(crossOrgError.message).toMatch(/Foreign key constraint violated|leads_assigned_user_id_organization_id_fkey/);
    });

    it('9. User reverse relation assignedLeads queries leads assigned to that user', async () => {
      // Re-assign leadA1 to userA2 and leadA2 to userA2
      await prisma.lead.update({
        where: { id: leadA1Id },
        data: { assignedUserId: userA2Id }
      });
      await prisma.lead.update({
        where: { id: leadA2Id },
        data: { assignedUserId: userA2Id }
      });

      const userWithLeads = await prisma.user.findUnique({
        where: { id: userA2Id },
        include: { assignedLeads: true }
      });

      expect(userWithLeads?.assignedLeads).toHaveLength(2);
      const leadIds = userWithLeads?.assignedLeads.map((l) => l.id);
      expect(leadIds).toContain(leadA1Id);
      expect(leadIds).toContain(leadA2Id);
    });
  });

  /* -----------------------------------------------------------------
   * 4. CRM Notes & Tenant Isolation
   * ----------------------------------------------------------------- */
  describe('CRM Notes & Tenant Isolation', () => {
    it('10. Successfully creates and persists CrmNote within same organization', async () => {
      const note = await prisma.crmNote.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          userId: userA1Id,
          content: 'Initial discovery call completed with Dr. Rahman. Needs website redesign.'
        },
        include: {
          author: true,
          lead: true
        }
      });

      expect(note.id).toBeDefined();
      expect(note.organizationId).toBe(orgAId);
      expect(note.leadId).toBe(leadA1Id);
      expect(note.userId).toBe(userA1Id);
      expect(note.content).toBe('Initial discovery call completed with Dr. Rahman. Needs website redesign.');
      expect(note.author.name).toBe('Sales Manager A1');
      expect(note.lead.name).toBe('Gulshan Dental Studio');
    });

    it('11. Cross-org note author rejected: Note in Org A cannot reference author User B from Org B', async () => {
      let crossOrgAuthorError: any = null;
      try {
        await prisma.crmNote.create({
          data: {
            organizationId: orgAId,
            leadId: leadA1Id,
            userId: userBId, // User B belongs to Org B
            content: 'Cross tenant note attempt'
          }
        });
      } catch (err) {
        crossOrgAuthorError = err;
      }

      expect(crossOrgAuthorError).not.toBeNull();
      expect(crossOrgAuthorError.message).toMatch(/Foreign key constraint violated|crm_notes_user_id_organization_id_fkey/);
    });

    it('12. Cross-org note lead rejected: Note in Org A cannot reference Lead B from Org B', async () => {
      let crossOrgLeadError: any = null;
      try {
        await prisma.crmNote.create({
          data: {
            organizationId: orgAId,
            leadId: leadBId, // Lead B belongs to Org B
            userId: userA1Id,
            content: 'Cross tenant lead note attempt'
          }
        });
      } catch (err) {
        crossOrgLeadError = err;
      }

      expect(crossOrgLeadError).not.toBeNull();
      expect(crossOrgLeadError.message).toMatch(/Foreign key constraint violated|crm_notes_lead_id_organization_id_fkey/);
    });
  });

  /* -----------------------------------------------------------------
   * 5. CRM Activities & Metadata Round-trip
   * ----------------------------------------------------------------- */
  describe('CRM Activities & Metadata Round-trip', () => {
    it('13. Successfully creates and persists CrmActivity with all canonical activity types', async () => {
      const activityTypes: CrmActivityType[] = [
        CrmActivityType.LEAD_ASSIGNED,
        CrmActivityType.LEAD_UNASSIGNED,
        CrmActivityType.LEAD_REASSIGNED,
        CrmActivityType.STAGE_CHANGED,
        CrmActivityType.NOTE_ADDED
      ];

      for (const type of activityTypes) {
        const activity = await prisma.crmActivity.create({
          data: {
            organizationId: orgAId,
            leadId: leadA1Id,
            actorUserId: userA1Id,
            type,
            metadata: {
              testType: type,
              timestamp: new Date().toISOString()
            }
          }
        });

        expect(activity.type).toBe(type);
        expect(activity.actorUserId).toBe(userA1Id);
      }
    });

    it('14. CRM Activity metadata JSON round-trips structured nested data safely', async () => {
      const complexMetadata = {
        fromStage: 'CONTACTED',
        toStage: 'QUALIFIED',
        reason: 'Customer verified phone and expressed interest in custom domain',
        nestedObj: {
          proposalAmount: 50000,
          currency: 'BDT',
          discountApplied: false
        }
      };

      const activity = await prisma.crmActivity.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          actorUserId: userA1Id,
          type: CrmActivityType.STAGE_CHANGED,
          metadata: complexMetadata
        },
        include: {
          actor: true,
          lead: true
        }
      });

      expect(activity.metadata).toEqual(complexMetadata);
      expect(activity.actor.email).toBe('sales.manager.a1@crm-test.ai');
    });

    it('15. Cross-org activity actor rejected: Activity in Org A cannot reference Actor B from Org B', async () => {
      let crossOrgActorError: any = null;
      try {
        await prisma.crmActivity.create({
          data: {
            organizationId: orgAId,
            leadId: leadA1Id,
            actorUserId: userBId, // User B belongs to Org B
            type: CrmActivityType.STAGE_CHANGED,
            metadata: {}
          }
        });
      } catch (err) {
        crossOrgActorError = err;
      }

      expect(crossOrgActorError).not.toBeNull();
      expect(crossOrgActorError.message).toMatch(/Foreign key constraint violated|crm_activities_actor_user_id_organization_id_fkey/);
    });

    it('16. Cross-org activity lead rejected: Activity in Org A cannot reference Lead B from Org B', async () => {
      let crossOrgLeadError: any = null;
      try {
        await prisma.crmActivity.create({
          data: {
            organizationId: orgAId,
            leadId: leadBId, // Lead B belongs to Org B
            actorUserId: userA1Id,
            type: CrmActivityType.NOTE_ADDED,
            metadata: {}
          }
        });
      } catch (err) {
        crossOrgLeadError = err;
      }

      expect(crossOrgLeadError).not.toBeNull();
      expect(crossOrgLeadError.message).toMatch(/Foreign key constraint violated|crm_activities_lead_id_organization_id_fkey/);
    });
  });

  /* -----------------------------------------------------------------
   * 6. Deletion Cascading Dynamics
   * ----------------------------------------------------------------- */
  describe('Deletion Dynamics', () => {
    it('17. Deleting a lead cascades and deletes all associated CRM notes and activities', async () => {
      // Create a temporary lead in Org A
      const tempLead = await prisma.lead.create({
        data: {
          organizationId: orgAId,
          name: 'Temporary Lead for Cascade Test',
          normalizedName: 'temporary lead for cascade test',
          category: 'Testing',
          city: 'Dhaka',
          primarySource: 'MOCK_SEARCH'
        }
      });

      // Add a note
      const note = await prisma.crmNote.create({
        data: {
          organizationId: orgAId,
          leadId: tempLead.id,
          userId: userA1Id,
          content: 'Note to be deleted on lead cascade'
        }
      });

      // Add an activity
      const activity = await prisma.crmActivity.create({
        data: {
          organizationId: orgAId,
          leadId: tempLead.id,
          actorUserId: userA1Id,
          type: CrmActivityType.NOTE_ADDED,
          metadata: { noteId: note.id }
        }
      });

      // Delete the lead
      await prisma.lead.delete({
        where: { id: tempLead.id }
      });

      // Verify note and activity are cascaded and deleted
      const foundNote = await prisma.crmNote.findUnique({
        where: { id: note.id }
      });
      const foundActivity = await prisma.crmActivity.findUnique({
        where: { id: activity.id }
      });

      expect(foundNote).toBeNull();
      expect(foundActivity).toBeNull();
    });
  });
});
