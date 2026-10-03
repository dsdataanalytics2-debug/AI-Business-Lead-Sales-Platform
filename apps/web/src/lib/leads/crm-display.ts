/**
 * CRM Display & Error Mapping Helpers
 *
 * Pure helpers for activity labels, stage transition formatting,
 * actor fallback, client note validation, and canonical error messages.
 */

import {
  CrmStage,
  CRM_STAGE_LABELS,
  CrmActivityType
} from '@leadmate/shared';
import { ApiClientError } from '../api-client.js';

export const CRM_ACTIVITY_LABELS: Record<CrmActivityType, string> = {
  [CrmActivityType.LEAD_ASSIGNED]: 'Lead assigned',
  [CrmActivityType.LEAD_UNASSIGNED]: 'Lead unassigned',
  [CrmActivityType.LEAD_REASSIGNED]: 'Lead reassigned',
  [CrmActivityType.STAGE_CHANGED]: 'CRM stage changed',
  [CrmActivityType.NOTE_ADDED]: 'Note added'
};

export function formatActivityLabel(type: CrmActivityType): string {
  return CRM_ACTIVITY_LABELS[type] || 'Activity recorded';
}

export function formatStageTransition(
  metadata?: Record<string, unknown> | null
): string | null {
  if (!metadata) return null;
  const prev = metadata.previousStage as CrmStage | undefined;
  const next = metadata.newStage as CrmStage | undefined;
  if (!next) return null;

  const prevLabel = prev ? CRM_STAGE_LABELS[prev] || prev : 'None';
  const nextLabel = CRM_STAGE_LABELS[next] || next;
  return `${prevLabel} → ${nextLabel}`;
}

export function formatActorName(
  actor?: { id: string; name?: string; email?: string } | null
): string {
  if (!actor || !actor.name) {
    return 'Unknown user';
  }
  return actor.name;
}

export function validateNoteContent(content: string): {
  isValid: boolean;
  trimmed: string;
  error?: string;
} {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return {
      isValid: false,
      trimmed: '',
      error: 'Note content cannot be empty.'
    };
  }
  if (trimmed.length > 5000) {
    return {
      isValid: false,
      trimmed,
      error: 'Note cannot exceed 5000 characters.'
    };
  }
  return {
    isValid: true,
    trimmed
  };
}

function getErrorStatusCode(err: unknown): number | undefined {
  if (err instanceof ApiClientError) {
    return err.statusCode;
  }
  if (typeof err === 'object' && err !== null && 'statusCode' in err && typeof (err as { statusCode: unknown }).statusCode === 'number') {
    return (err as { statusCode: number }).statusCode;
  }
  return undefined;
}

export function classifyCrmStageError(err: unknown): string {
  const statusCode = getErrorStatusCode(err);
  if (statusCode === 403) {
    return 'You do not have permission to update the CRM stage.';
  }
  if (statusCode === 404) {
    return 'Lead not found.';
  }
  if (statusCode === 422) {
    return 'Invalid CRM stage.';
  }
  return 'CRM stage could not be updated. Please try again.';
}

export function classifyAssignmentError(err: unknown): string {
  const statusCode = getErrorStatusCode(err);
  if (statusCode === 403) {
    return 'You do not have permission to assign this lead.';
  }
  if (statusCode === 404) {
    return 'Lead or assignee was not found.';
  }
  if (statusCode === 422) {
    return 'Selected assignee is unavailable.';
  }
  return 'Lead assignment could not be updated. Please try again.';
}

export function classifyNoteError(err: unknown): string {
  const statusCode = getErrorStatusCode(err);
  if (statusCode === 403) {
    return 'You do not have permission to add CRM notes.';
  }
  if (statusCode === 404) {
    return 'Lead not found.';
  }
  if (statusCode === 422) {
    return 'Please enter a valid CRM note.';
  }
  return 'CRM note could not be added. Please try again.';
}

export function classifyCrmSecondaryLoadError(err: unknown): string {
  return 'CRM data could not be loaded. Please try again.';
}
