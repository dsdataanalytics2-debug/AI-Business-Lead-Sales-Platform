import {
  ContactType,
  ContactStatus,
  type LeadContact
} from '@leadmate/shared';

export type AddContactOutcome =
  | 'CREATED'
  | 'ALREADY_EXISTS'
  | 'PROMOTED_TO_PRIMARY'
  | 'CREATED_INVALID_FORMAT';

export interface ManualContactInput {
  type: ContactType;
  rawValue: string;
  isPrimary?: boolean;
}

/**
 * Builds the payload for adding a manual contact to a lead.
 * Security: Sends ONLY { type, rawValue, isPrimary }.
 * Strips client-supplied whatsappStatus, sourceName, or extra properties.
 */
export function buildManualContactPayload(input: {
  type: ContactType;
  rawValue: string;
  isPrimary?: boolean;
}): ManualContactInput {
  return {
    type: input.type,
    rawValue: input.rawValue.trim(),
    isPrimary: Boolean(input.isPrimary)
  };
}

/**
 * Resolves the UI outcome of an add-contact operation:
 * - 'PROMOTED_TO_PRIMARY': if returned contact already exists and was promoted from non-primary to primary
 * - 'ALREADY_EXISTS': if returned contact already exists with no primary status change
 * - 'CREATED_INVALID_FORMAT': if returned contact is newly created with INVALID_FORMAT status
 * - 'CREATED': if returned contact is newly created with valid/unknown status
 */
export function resolveAddContactOutcome(
  existingContacts: LeadContact[],
  returnedContact: LeadContact
): AddContactOutcome {
  const existing = existingContacts.find((c) => c.id === returnedContact.id);
  if (existing) {
    if (returnedContact.isPrimary && !existing.isPrimary) {
      return 'PROMOTED_TO_PRIMARY';
    }
    return 'ALREADY_EXISTS';
  }
  if (returnedContact.status === ContactStatus.INVALID_FORMAT) {
    return 'CREATED_INVALID_FORMAT';
  }
  return 'CREATED';
}
