import { describe, it, expect } from 'vitest';
import {
  FollowUpStatus,
  FOLLOW_UP_STATUS_LABELS,
  ORDERED_FOLLOW_UP_STATUSES,
  createFollowUpRequestSchema,
  updateFollowUpRequestSchema,
  followUpTaskSchema,
  followUpListResponseSchema
} from '../index.js';

describe('M3 Step 5: Shared CRM Follow-Up Task Contracts Verification', () => {
  /* -----------------------------------------------------------------
   * 1. Canonical Follow-Up Statuses & Constants
   * ----------------------------------------------------------------- */
  describe('Canonical FollowUpStatus Enum', () => {
    it('1. Exactly the 3 canonical statuses are defined in FollowUpStatus enum', () => {
      const expectedStatuses = ['PENDING', 'COMPLETED', 'CANCELLED'];
      const actualStatuses = Object.values(FollowUpStatus);
      expect(actualStatuses).toEqual(expectedStatuses);
      expect(actualStatuses).toHaveLength(3);
    });

    it('2. Status labels and ordered list match canonical specifications', () => {
      expect(FOLLOW_UP_STATUS_LABELS[FollowUpStatus.PENDING]).toBe('Pending');
      expect(FOLLOW_UP_STATUS_LABELS[FollowUpStatus.COMPLETED]).toBe('Completed');
      expect(FOLLOW_UP_STATUS_LABELS[FollowUpStatus.CANCELLED]).toBe('Cancelled');
      expect(ORDERED_FOLLOW_UP_STATUSES).toEqual([
        FollowUpStatus.PENDING,
        FollowUpStatus.COMPLETED,
        FollowUpStatus.CANCELLED
      ]);
    });
  });

  /* -----------------------------------------------------------------
   * 2. createFollowUpRequestSchema
   * ----------------------------------------------------------------- */
  describe('createFollowUpRequestSchema', () => {
    it('3. Accepts valid creation payload with valid dueAt datetime string', () => {
      const input = {
        dueAt: '2026-10-15T09:00:00.000Z',
        assignedUserId: 'a0000000-0000-0000-0000-000000000001',
        note: 'Call client about enterprise discount'
      };
      const result = createFollowUpRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dueAt).toBeInstanceOf(Date);
        expect(result.data.assignedUserId).toBe('a0000000-0000-0000-0000-000000000001');
        expect(result.data.note).toBe('Call client about enterprise discount');
      }
    });

    it('4. Allows null or omitted assignedUserId and note', () => {
      const minimalInput = {
        dueAt: '2026-10-15T09:00:00.000Z'
      };
      const result = createFollowUpRequestSchema.safeParse(minimalInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assignedUserId).toBeUndefined();
        expect(result.data.note).toBeNull();
      }

      const nullInput = {
        dueAt: '2026-10-15T09:00:00.000Z',
        assignedUserId: null,
        note: null
      };
      const nullResult = createFollowUpRequestSchema.safeParse(nullInput);
      expect(nullResult.success).toBe(true);
      if (nullResult.success) {
        expect(nullResult.data.assignedUserId).toBeNull();
        expect(nullResult.data.note).toBeNull();
      }
    });

    it('5. Trims note and normalizes empty/whitespace note to null', () => {
      const input = {
        dueAt: '2026-10-15T09:00:00.000Z',
        note: '   '
      };
      const result = createFollowUpRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.note).toBeNull();
      }

      const inputWithSpaces = {
        dueAt: '2026-10-15T09:00:00.000Z',
        note: '  Discuss proposal  '
      };
      const res2 = createFollowUpRequestSchema.safeParse(inputWithSpaces);
      expect(res2.success).toBe(true);
      if (res2.success) {
        expect(res2.data.note).toBe('Discuss proposal');
      }
    });

    it('6. Rejects note exceeding 2000 characters', () => {
      const longNote = 'a'.repeat(2001);
      const input = {
        dueAt: '2026-10-15T09:00:00.000Z',
        note: longNote
      };
      const result = createFollowUpRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('7. Rejects invalid dueAt datetime format', () => {
      const input = {
        dueAt: 'not-a-date'
      };
      const result = createFollowUpRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('8. Rejects invalid assignedUserId UUID', () => {
      const input = {
        dueAt: '2026-10-15T09:00:00.000Z',
        assignedUserId: 'invalid-uuid'
      };
      const result = createFollowUpRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  /* -----------------------------------------------------------------
   * 3. updateFollowUpRequestSchema
   * ----------------------------------------------------------------- */
  describe('updateFollowUpRequestSchema', () => {
    it('9. Accepts partial update payload with dueAt, assignedUserId, note', () => {
      const input = {
        dueAt: '2026-10-20T12:00:00.000Z',
        note: 'Updated meeting agenda'
      };
      const result = updateFollowUpRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dueAt).toBeInstanceOf(Date);
        expect(result.data.note).toBe('Updated meeting agenda');
      }
    });

    it('10. Allows unassigning by passing assignedUserId: null', () => {
      const input = {
        assignedUserId: null
      };
      const result = updateFollowUpRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assignedUserId).toBeNull();
      }
    });

    it('11. Rejects unknown properties due to strict schema', () => {
      const input = {
        status: FollowUpStatus.COMPLETED,
        extraField: 'not-allowed'
      };
      const result = updateFollowUpRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  /* -----------------------------------------------------------------
   * 4. followUpTaskSchema & followUpListResponseSchema
   * ----------------------------------------------------------------- */
  describe('followUpTaskSchema & List Response', () => {
    it('12. Validates complete FollowUpTask object with relations', () => {
      const task = {
        id: '10000000-0000-0000-0000-000000000001',
        leadId: '20000000-0000-0000-0000-000000000001',
        assignedUserId: '30000000-0000-0000-0000-000000000001',
        assignedUser: {
          id: '30000000-0000-0000-0000-000000000001',
          name: 'Tanvir Sales',
          email: 'tanvir@leadmate.test'
        },
        createdByUserId: '40000000-0000-0000-0000-000000000002',
        createdBy: {
          id: '40000000-0000-0000-0000-000000000002',
          name: 'Admin Boss',
          email: 'admin@leadmate.test'
        },
        dueAt: '2026-10-15T09:00:00.000Z',
        note: 'Initial qualification call',
        status: FollowUpStatus.PENDING,
        completedAt: null,
        createdAt: '2026-10-03T10:00:00.000Z',
        updatedAt: '2026-10-03T10:00:00.000Z'
      };

      const result = followUpTaskSchema.safeParse(task);
      expect(result.success).toBe(true);

      const listResult = followUpListResponseSchema.safeParse([task]);
      expect(listResult.success).toBe(true);
      if (listResult.success) {
        expect(listResult.data).toHaveLength(1);
      }
    });

    it('13. Rejects invalid status string', () => {
      const task = {
        id: '10000000-0000-0000-0000-000000000001',
        leadId: '20000000-0000-0000-0000-000000000001',
        assignedUserId: null,
        createdByUserId: '40000000-0000-0000-0000-000000000002',
        dueAt: '2026-10-15T09:00:00.000Z',
        note: null,
        status: 'OVERDUE', // Not in enum
        completedAt: null,
        createdAt: '2026-10-03T10:00:00.000Z',
        updatedAt: '2026-10-03T10:00:00.000Z'
      };

      const result = followUpTaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });
  });
});
