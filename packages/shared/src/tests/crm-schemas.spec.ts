import { describe, it, expect } from 'vitest';
import {
  CrmStage,
  CrmActivityType,
  CRM_STAGE_ORDER,
  ORDERED_CRM_STAGES,
  CRM_STAGE_LABELS,
  TERMINAL_CRM_STAGES,
  getCrmStageOrder,
  getCrmStageLabel,
  isTerminalCrmStage,
  assigneeSummarySchema,
  leadAssignmentRequestSchema,
  crmStageUpdateRequestSchema,
  crmNoteRequestSchema,
  crmNoteSchema,
  crmActivitySchema,
  crmLeadSummaryFragmentSchema,
  Role,
  Permissions,
  hasPermission
} from '../index.js';

describe('M3 Step 1: Shared CRM Contracts & Pipeline Stages Verification', () => {
  /* -----------------------------------------------------------------
   * 1. Canonical CRM Pipeline Stages & Constants
   * ----------------------------------------------------------------- */
  describe('Canonical CRM Pipeline Stages', () => {
    it('1. Exactly the 7 canonical stages are defined in CrmStage enum', () => {
      const expectedStages = [
        'NEW',
        'CONTACTED',
        'QUALIFIED',
        'PROPOSAL_SENT',
        'NEGOTIATION',
        'WON',
        'LOST'
      ];
      const actualStages = Object.values(CrmStage);
      expect(actualStages).toEqual(expectedStages);
      expect(actualStages).toHaveLength(7);
    });

    it('2. Stage ordering constants and helper getCrmStageOrder return exact order numbers', () => {
      expect(CRM_STAGE_ORDER[CrmStage.NEW]).toBe(10);
      expect(CRM_STAGE_ORDER[CrmStage.CONTACTED]).toBe(20);
      expect(CRM_STAGE_ORDER[CrmStage.QUALIFIED]).toBe(30);
      expect(CRM_STAGE_ORDER[CrmStage.PROPOSAL_SENT]).toBe(40);
      expect(CRM_STAGE_ORDER[CrmStage.NEGOTIATION]).toBe(50);
      expect(CRM_STAGE_ORDER[CrmStage.WON]).toBe(60);
      expect(CRM_STAGE_ORDER[CrmStage.LOST]).toBe(70);

      expect(getCrmStageOrder(CrmStage.NEW)).toBe(10);
      expect(getCrmStageOrder(CrmStage.CONTACTED)).toBe(20);
      expect(getCrmStageOrder(CrmStage.QUALIFIED)).toBe(30);
      expect(getCrmStageOrder(CrmStage.PROPOSAL_SENT)).toBe(40);
      expect(getCrmStageOrder(CrmStage.NEGOTIATION)).toBe(50);
      expect(getCrmStageOrder(CrmStage.WON)).toBe(60);
      expect(getCrmStageOrder(CrmStage.LOST)).toBe(70);

      expect(ORDERED_CRM_STAGES).toEqual([
        CrmStage.NEW,
        CrmStage.CONTACTED,
        CrmStage.QUALIFIED,
        CrmStage.PROPOSAL_SENT,
        CrmStage.NEGOTIATION,
        CrmStage.WON,
        CrmStage.LOST
      ]);
    });

    it('3. Display labels map and helper getCrmStageLabel return deterministic labels', () => {
      expect(getCrmStageLabel(CrmStage.NEW)).toBe('New');
      expect(getCrmStageLabel(CrmStage.CONTACTED)).toBe('Contacted');
      expect(getCrmStageLabel(CrmStage.QUALIFIED)).toBe('Qualified');
      expect(getCrmStageLabel(CrmStage.PROPOSAL_SENT)).toBe('Proposal Sent');
      expect(getCrmStageLabel(CrmStage.NEGOTIATION)).toBe('Negotiation');
      expect(getCrmStageLabel(CrmStage.WON)).toBe('Won');
      expect(getCrmStageLabel(CrmStage.LOST)).toBe('Lost');

      expect(CRM_STAGE_LABELS[CrmStage.NEW]).toBe('New');
      expect(CRM_STAGE_LABELS[CrmStage.CONTACTED]).toBe('Contacted');
      expect(CRM_STAGE_LABELS[CrmStage.QUALIFIED]).toBe('Qualified');
      expect(CRM_STAGE_LABELS[CrmStage.PROPOSAL_SENT]).toBe('Proposal Sent');
      expect(CRM_STAGE_LABELS[CrmStage.NEGOTIATION]).toBe('Negotiation');
      expect(CRM_STAGE_LABELS[CrmStage.WON]).toBe('Won');
      expect(CRM_STAGE_LABELS[CrmStage.LOST]).toBe('Lost');
    });

    it('4. Terminal stages helper isTerminalCrmStage correctly identifies WON and LOST as terminal and others as non-terminal', () => {
      expect(TERMINAL_CRM_STAGES).toEqual([CrmStage.WON, CrmStage.LOST]);

      expect(isTerminalCrmStage(CrmStage.WON)).toBe(true);
      expect(isTerminalCrmStage(CrmStage.LOST)).toBe(true);

      expect(isTerminalCrmStage(CrmStage.NEW)).toBe(false);
      expect(isTerminalCrmStage(CrmStage.CONTACTED)).toBe(false);
      expect(isTerminalCrmStage(CrmStage.QUALIFIED)).toBe(false);
      expect(isTerminalCrmStage(CrmStage.PROPOSAL_SENT)).toBe(false);
      expect(isTerminalCrmStage(CrmStage.NEGOTIATION)).toBe(false);
    });
  });

  /* -----------------------------------------------------------------
   * 2. Lead Assignment Request Contract
   * ----------------------------------------------------------------- */
  describe('Lead Assignment Request Contract', () => {
    it('5. Valid UUID string accepted for lead assignment / reassignment', () => {
      const valid = {
        assignedUserId: '123e4567-e89b-12d3-a456-426614174000'
      };
      const parsed = leadAssignmentRequestSchema.parse(valid);
      expect(parsed.assignedUserId).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('6. null accepted for unassigning lead', () => {
      const valid = {
        assignedUserId: null
      };
      const parsed = leadAssignmentRequestSchema.parse(valid);
      expect(parsed.assignedUserId).toBeNull();
    });

    it('7. Non-UUID string rejected for assignedUserId', () => {
      const invalid = {
        assignedUserId: 'not-a-uuid'
      };
      expect(() => leadAssignmentRequestSchema.parse(invalid)).toThrow();
    });

    it('8. Missing assignedUserId rejected', () => {
      expect(() => leadAssignmentRequestSchema.parse({})).toThrow();
    });

    it('9. Strict schema rejects extra authoritative fields (role, email, organizationId, assignedUserName)', () => {
      const injected = {
        assignedUserId: '123e4567-e89b-12d3-a456-426614174000',
        role: 'ADMIN',
        email: 'sales@example.com',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
        assignedUserName: 'John Doe'
      };
      expect(() => leadAssignmentRequestSchema.parse(injected)).toThrow();
    });
  });

  /* -----------------------------------------------------------------
   * 3. CRM Stage Update Request Contract
   * ----------------------------------------------------------------- */
  describe('CRM Stage Update Request Contract', () => {
    it('10. All 7 valid CRM stages accepted in stage update request', () => {
      for (const stage of Object.values(CrmStage)) {
        const parsed = crmStageUpdateRequestSchema.parse({ stage });
        expect(parsed.stage).toBe(stage);
      }
    });

    it('11. Unknown / invalid CRM stage string rejected', () => {
      const invalid = { stage: 'UNKNOWN_STAGE' };
      expect(() => crmStageUpdateRequestSchema.parse(invalid)).toThrow();
    });

    it('12. Missing stage rejected', () => {
      expect(() => crmStageUpdateRequestSchema.parse({})).toThrow();
    });

    it('13. Strict schema rejects extra fields (organizationId, leadId, changedBy, createdAt, score)', () => {
      const injected = {
        stage: CrmStage.QUALIFIED,
        organizationId: '123e4567-e89b-12d3-a456-426614174000',
        leadId: '223e4567-e89b-12d3-a456-426614174000',
        changedBy: 'user-123',
        createdAt: new Date().toISOString(),
        score: 95
      };
      expect(() => crmStageUpdateRequestSchema.parse(injected)).toThrow();
    });
  });

  /* -----------------------------------------------------------------
   * 4. CRM Note Request & Response Contract
   * ----------------------------------------------------------------- */
  describe('CRM Note Request & Response Contract', () => {
    it('14. Valid plain text content accepted and whitespace trimmed', () => {
      const input = {
        content: '   Spoke with the owner. They are interested in a website revamp next month.   '
      };
      const parsed = crmNoteRequestSchema.parse(input);
      expect(parsed.content).toBe(
        'Spoke with the owner. They are interested in a website revamp next month.'
      );
    });

    it('15. Empty note content rejected', () => {
      expect(() => crmNoteRequestSchema.parse({ content: '' })).toThrow();
    });

    it('16. Whitespace-only note content rejected after trimming', () => {
      expect(() => crmNoteRequestSchema.parse({ content: '     ' })).toThrow();
    });

    it('17. 5000 character note content accepted', () => {
      const validLong = {
        content: 'a'.repeat(5000)
      };
      const parsed = crmNoteRequestSchema.parse(validLong);
      expect(parsed.content).toHaveLength(5000);
    });

    it('18. Note content exceeding 5000 characters (>5000) rejected', () => {
      const invalidLong = {
        content: 'a'.repeat(5001)
      };
      expect(() => crmNoteRequestSchema.parse(invalidLong)).toThrow();
    });

    it('19. Strict note request rejects injected authoritative fields (userId, organizationId, leadId, createdAt)', () => {
      const injected = {
        content: 'Meeting notes',
        userId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '223e4567-e89b-12d3-a456-426614174000',
        leadId: '323e4567-e89b-12d3-a456-426614174000',
        createdAt: new Date().toISOString()
      };
      expect(() => crmNoteRequestSchema.parse(injected)).toThrow();
    });

    it('20. Valid full CRM Note response model parses successfully', () => {
      const validNote = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        leadId: '223e4567-e89b-12d3-a456-426614174000',
        userId: '323e4567-e89b-12d3-a456-426614174000',
        author: {
          id: '323e4567-e89b-12d3-a456-426614174000',
          name: 'Jane Sales',
          email: 'jane@leadmate.ai'
        },
        content: 'Called customer, scheduled follow-up on Tuesday.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const parsed = crmNoteSchema.parse(validNote);
      expect(parsed.id).toBe(validNote.id);
      expect(parsed.author?.name).toBe('Jane Sales');
      expect(parsed.content).toBe(validNote.content);
    });
  });

  /* -----------------------------------------------------------------
   * 5. CRM Activity Types & Schema
   * ----------------------------------------------------------------- */
  describe('CRM Activity Types & Activity Contract', () => {
    it('21. Exactly the 5 canonical activity types are defined in CrmActivityType', () => {
      const expectedActivities = [
        'LEAD_ASSIGNED',
        'LEAD_UNASSIGNED',
        'LEAD_REASSIGNED',
        'STAGE_CHANGED',
        'NOTE_ADDED'
      ];
      const actualActivities = Object.values(CrmActivityType);
      expect(actualActivities).toEqual(expectedActivities);
      expect(actualActivities).toHaveLength(5);
    });

    it('22. Valid CRM Activity contract parses successfully with metadata', () => {
      const validActivity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        leadId: '223e4567-e89b-12d3-a456-426614174000',
        type: CrmActivityType.STAGE_CHANGED,
        actorUserId: '323e4567-e89b-12d3-a456-426614174000',
        actor: {
          id: '323e4567-e89b-12d3-a456-426614174000',
          name: 'Jane Sales',
          email: 'jane@leadmate.ai'
        },
        metadata: {
          fromStage: CrmStage.NEW,
          toStage: CrmStage.CONTACTED
        },
        createdAt: new Date().toISOString()
      };
      const parsed = crmActivitySchema.parse(validActivity);
      expect(parsed.type).toBe(CrmActivityType.STAGE_CHANGED);
      expect(parsed.actor?.email).toBe('jane@leadmate.ai');
      expect(parsed.metadata).toEqual({
        fromStage: CrmStage.NEW,
        toStage: CrmStage.CONTACTED
      });
    });

    it('23. Invalid CRM activity type rejected', () => {
      const invalid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        leadId: '223e4567-e89b-12d3-a456-426614174000',
        type: 'INVALID_ACTIVITY_TYPE',
        metadata: {},
        createdAt: new Date().toISOString()
      };
      expect(() => crmActivitySchema.parse(invalid)).toThrow();
    });
  });

  /* -----------------------------------------------------------------
   * 6. Assignee Summary & Lead Summary Fragment Contracts
   * ----------------------------------------------------------------- */
  describe('Assignee Summary & CRM Lead Fragment Contracts', () => {
    it('24. Valid AssigneeSummary parses and normalizes email', () => {
      const valid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: '  Alex Smith  ',
        email: '  ALEX@leadmate.ai  '
      };
      const parsed = assigneeSummarySchema.parse(valid);
      expect(parsed.id).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(parsed.name).toBe('Alex Smith');
      expect(parsed.email).toBe('alex@leadmate.ai');
    });

    it('25. AssigneeSummary strictly rejects passwordHash or session tokens', () => {
      const injected = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Alex Smith',
        email: 'alex@leadmate.ai',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
        sessionToken: 'secret-token'
      };
      expect(() => assigneeSummarySchema.parse(injected)).toThrow();
    });

    it('26. Valid CRM Lead Summary Fragment parses successfully', () => {
      const validFragment = {
        crmStage: CrmStage.PROPOSAL_SENT,
        assignedUserId: '123e4567-e89b-12d3-a456-426614174000',
        assignedUser: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Sarah Connor',
          email: 'sarah@leadmate.ai'
        },
        assignedAt: new Date().toISOString()
      };
      const parsed = crmLeadSummaryFragmentSchema.parse(validFragment);
      expect(parsed.crmStage).toBe(CrmStage.PROPOSAL_SENT);
      expect(parsed.assignedUser?.name).toBe('Sarah Connor');
    });

    it('27. CRM Lead Summary Fragment allows null/unassigned state', () => {
      const unassignedFragment = {
        crmStage: CrmStage.NEW,
        assignedUserId: null,
        assignedUser: null,
        assignedAt: null
      };
      const parsed = crmLeadSummaryFragmentSchema.parse(unassignedFragment);
      expect(parsed.crmStage).toBe(CrmStage.NEW);
      expect(parsed.assignedUserId).toBeNull();
      expect(parsed.assignedUser).toBeNull();
      expect(parsed.assignedAt).toBeNull();
    });
  });

  /* -----------------------------------------------------------------
   * 7. CRM Permission Model Verification
   * ----------------------------------------------------------------- */
  describe('CRM Permission Model Verification', () => {
    it('28. Canonical permissions exist for CRM capabilities (LEADS_READ, LEADS_WRITE, LEADS_ASSIGN)', () => {
      expect(Permissions.LEADS_READ).toBe('leads:read');
      expect(Permissions.LEADS_WRITE).toBe('leads:write');
      expect(Permissions.LEADS_ASSIGN).toBe('leads:assign');
    });

    it('29. Roles have expected granular permissions according to M3 V1 permission model', () => {
      // SUPER_ADMIN has read, write, and assign
      expect(hasPermission(Role.SUPER_ADMIN, Permissions.LEADS_READ)).toBe(true);
      expect(hasPermission(Role.SUPER_ADMIN, Permissions.LEADS_WRITE)).toBe(true);
      expect(hasPermission(Role.SUPER_ADMIN, Permissions.LEADS_ASSIGN)).toBe(true);

      // ADMIN has read, write, and assign
      expect(hasPermission(Role.ADMIN, Permissions.LEADS_READ)).toBe(true);
      expect(hasPermission(Role.ADMIN, Permissions.LEADS_WRITE)).toBe(true);
      expect(hasPermission(Role.ADMIN, Permissions.LEADS_ASSIGN)).toBe(true);

      // SALES_MANAGER has read, write, and assign
      expect(hasPermission(Role.SALES_MANAGER, Permissions.LEADS_READ)).toBe(true);
      expect(hasPermission(Role.SALES_MANAGER, Permissions.LEADS_WRITE)).toBe(true);
      expect(hasPermission(Role.SALES_MANAGER, Permissions.LEADS_ASSIGN)).toBe(true);

      // SALES_EXECUTIVE has read and write (stage/note) but NOT assign
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.LEADS_READ)).toBe(true);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.LEADS_WRITE)).toBe(true);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.LEADS_ASSIGN)).toBe(false);

      // VIEWER has read only, cannot write or assign
      expect(hasPermission(Role.VIEWER, Permissions.LEADS_READ)).toBe(true);
      expect(hasPermission(Role.VIEWER, Permissions.LEADS_WRITE)).toBe(false);
      expect(hasPermission(Role.VIEWER, Permissions.LEADS_ASSIGN)).toBe(false);
    });
  });
});
