import { describe, it, expect } from 'vitest';
import {
  CrmStage,
  CRM_STAGE_LABELS,
  ORDERED_CRM_STAGES,
  CrmActivityType
} from '@leadmate/shared';
import { ApiClientError } from '../lib/api-client.js';
import {
  CRM_ACTIVITY_LABELS,
  formatActivityLabel,
  formatStageTransition,
  formatActorName,
  validateNoteContent,
  classifyCrmStageError,
  classifyAssignmentError,
  classifyNoteError,
  classifyCrmSecondaryLoadError
} from '../lib/leads/crm-display.js';

describe('CRM Display & Error Classifier (Pure Unit Tests)', () => {
  describe('1. Activity Label Formatter & Mappings', () => {
    it('maps all 5 canonical activity types to human-readable strings', () => {
      expect(formatActivityLabel(CrmActivityType.LEAD_ASSIGNED)).toBe('Lead assigned');
      expect(formatActivityLabel(CrmActivityType.LEAD_UNASSIGNED)).toBe('Lead unassigned');
      expect(formatActivityLabel(CrmActivityType.LEAD_REASSIGNED)).toBe('Lead reassigned');
      expect(formatActivityLabel(CrmActivityType.STAGE_CHANGED)).toBe('CRM stage changed');
      expect(formatActivityLabel(CrmActivityType.NOTE_ADDED)).toBe('Note added');
    });

    it('returns fallback for unknown activity type', () => {
      expect(formatActivityLabel('UNKNOWN_TYPE' as unknown as CrmActivityType)).toBe(
        'Activity recorded'
      );
    });

    it('verifies CRM_ACTIVITY_LABELS dictionary completeness', () => {
      expect(Object.keys(CRM_ACTIVITY_LABELS)).toHaveLength(5);
    });
  });

  describe('2. Stage Transition Formatter', () => {
    it('formats stage transition with canonical shared labels', () => {
      const metadata = {
        previousStage: CrmStage.NEW,
        newStage: CrmStage.QUALIFIED
      };
      expect(formatStageTransition(metadata)).toBe('New → Qualified');
    });

    it('formats stage transition with missing previousStage as None', () => {
      const metadata = {
        newStage: CrmStage.PROPOSAL_SENT
      };
      expect(formatStageTransition(metadata)).toBe('None → Proposal Sent');
    });

    it('returns null when metadata is missing or does not contain newStage', () => {
      expect(formatStageTransition(null)).toBeNull();
      expect(formatStageTransition(undefined)).toBeNull();
      expect(formatStageTransition({})).toBeNull();
      expect(formatStageTransition({ previousStage: CrmStage.NEW })).toBeNull();
    });

    it('maps all 7 canonical stages through CRM_STAGE_LABELS', () => {
      for (const stage of ORDERED_CRM_STAGES) {
        const metadata = { newStage: stage };
        expect(formatStageTransition(metadata)).toBe(`None → ${CRM_STAGE_LABELS[stage]}`);
      }
    });
  });

  describe('3. Actor Name Formatter & Fallback', () => {
    it('returns actor name when present', () => {
      expect(formatActorName({ id: 'u1', name: 'Tanvir Ahmed', email: 'tanvir@test.com' })).toBe(
        'Tanvir Ahmed'
      );
    });

    it('returns "Unknown user" when actor is null, undefined, or missing name', () => {
      expect(formatActorName(null)).toBe('Unknown user');
      expect(formatActorName(undefined)).toBe('Unknown user');
      expect(formatActorName({ id: 'u1' })).toBe('Unknown user');
      expect(formatActorName({ id: 'u1', name: '' })).toBe('Unknown user');
    });
  });

  describe('4. Note Content Validation', () => {
    it('rejects empty string', () => {
      const res = validateNoteContent('');
      expect(res.isValid).toBe(false);
      expect(res.trimmed).toBe('');
      expect(res.error).toBe('Note content cannot be empty.');
    });

    it('rejects whitespace-only string', () => {
      const res = validateNoteContent('   \n\t   ');
      expect(res.isValid).toBe(false);
      expect(res.trimmed).toBe('');
      expect(res.error).toBe('Note content cannot be empty.');
    });

    it('rejects note exceeding 5000 characters', () => {
      const longNote = 'a'.repeat(5001);
      const res = validateNoteContent(longNote);
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Note cannot exceed 5000 characters.');
    });

    it('accepts valid note and returns trimmed content', () => {
      const res = validateNoteContent('  Called decision maker. Follow up next Monday.  ');
      expect(res.isValid).toBe(true);
      expect(res.trimmed).toBe('Called decision maker. Follow up next Monday.');
      expect(res.error).toBeUndefined();
    });

    it('accepts note at exact 5000 characters boundary', () => {
      const maxNote = 'a'.repeat(5000);
      const res = validateNoteContent(maxNote);
      expect(res.isValid).toBe(true);
      expect(res.trimmed).toHaveLength(5000);
    });
  });

  describe('5. CRM Stage Error Classifier', () => {
    it('classifies 403 Forbidden', () => {
      const err = new ApiClientError('FORBIDDEN', 'Forbidden', 403);
      expect(classifyCrmStageError(err)).toBe('You do not have permission to update the CRM stage.');
    });

    it('classifies 404 Not Found', () => {
      const err = new ApiClientError('NOT_FOUND', 'Not Found', 404);
      expect(classifyCrmStageError(err)).toBe('Lead not found.');
    });

    it('classifies 422 Unprocessable', () => {
      const err = new ApiClientError('UNPROCESSABLE_ENTITY', 'Unprocessable', 422);
      expect(classifyCrmStageError(err)).toBe('Invalid CRM stage.');
    });

    it('classifies 500 Internal Error and unknown errors safely', () => {
      const err500 = new ApiClientError('INTERNAL_SERVER_ERROR', 'Internal Error', 500);
      expect(classifyCrmStageError(err500)).toBe('CRM stage could not be updated. Please try again.');
      expect(classifyCrmStageError(new Error('network offline'))).toBe(
        'CRM stage could not be updated. Please try again.'
      );
      expect(classifyCrmStageError('raw string error')).toBe(
        'CRM stage could not be updated. Please try again.'
      );
    });
  });

  describe('6. Assignment Error Classifier', () => {
    it('classifies 403 Forbidden', () => {
      const err = new ApiClientError('FORBIDDEN', 'Forbidden', 403);
      expect(classifyAssignmentError(err)).toBe('You do not have permission to assign this lead.');
    });

    it('classifies 404 Not Found', () => {
      const err = new ApiClientError('NOT_FOUND', 'Not Found', 404);
      expect(classifyAssignmentError(err)).toBe('Lead or assignee was not found.');
    });

    it('classifies 422 Unprocessable', () => {
      const err = new ApiClientError('UNPROCESSABLE_ENTITY', 'Unprocessable', 422);
      expect(classifyAssignmentError(err)).toBe('Selected assignee is unavailable.');
    });

    it('classifies 500 Internal Error and unknown errors safely', () => {
      const err500 = new ApiClientError('INTERNAL_SERVER_ERROR', 'Internal Error', 500);
      expect(classifyAssignmentError(err500)).toBe('Lead assignment could not be updated. Please try again.');
      expect(classifyAssignmentError(new Error('timeout'))).toBe(
        'Lead assignment could not be updated. Please try again.'
      );
    });
  });

  describe('7. Note Error Classifier', () => {
    it('classifies 403 Forbidden', () => {
      const err = new ApiClientError('FORBIDDEN', 'Forbidden', 403);
      expect(classifyNoteError(err)).toBe('You do not have permission to add CRM notes.');
    });

    it('classifies 404 Not Found', () => {
      const err = new ApiClientError('NOT_FOUND', 'Not Found', 404);
      expect(classifyNoteError(err)).toBe('Lead not found.');
    });

    it('classifies 422 Unprocessable', () => {
      const err = new ApiClientError('UNPROCESSABLE_ENTITY', 'Unprocessable', 422);
      expect(classifyNoteError(err)).toBe('Please enter a valid CRM note.');
    });

    it('classifies 500 Internal Error and unknown errors safely', () => {
      const err500 = new ApiClientError('INTERNAL_SERVER_ERROR', 'Internal Error', 500);
      expect(classifyNoteError(err500)).toBe('CRM note could not be added. Please try again.');
      expect(classifyNoteError(new Error('abort'))).toBe('CRM note could not be added. Please try again.');
    });
  });

  describe('8. CRM Secondary Load Error Classifier', () => {
    it('classifies any error into safe secondary load error message', () => {
      expect(classifyCrmSecondaryLoadError(new Error('fail'))).toBe(
        'CRM data could not be loaded. Please try again.'
      );
    });
  });
});
