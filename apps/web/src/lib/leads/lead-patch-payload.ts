import type { LeadDetail, LeadUpdateRequest } from '@leadmate/shared';

export interface EditLeadFormState {
  name: string;
  category: string;
  description: string;
  address: string;
  locality: string;
  city: string;
  website: string;
}

/**
 * Pure builder for PATCH /leads/:id payloads.
 *
 * Rules:
 * - Unchanged fields -> omitted ({})
 * - Changed name, category, city: included only when non-empty after trim (never null or empty string)
 * - description, address, locality, website:
 *   - Cleared or whitespace-only when a value previously existed -> explicitly set to null
 *   - Whitespace-only when previously null/undefined/empty -> omitted
 *   - Non-empty changed value -> set to trimmed string
 * - NEVER includes protected keys (id, organizationId, primaryPhone, primaryEmail, rating, reviewCount, etc.)
 */
export function buildLeadPatchPayload(
  originalLead: LeadDetail,
  form: EditLeadFormState
): LeadUpdateRequest {
  const payload: LeadUpdateRequest = {};

  // Required non-empty string fields
  const trimmedName = form.name?.trim();
  if (trimmedName && trimmedName !== originalLead.name) {
    payload.name = trimmedName;
  }

  const trimmedCategory = form.category?.trim();
  if (trimmedCategory && trimmedCategory !== originalLead.category) {
    payload.category = trimmedCategory;
  }

  const trimmedCity = form.city?.trim();
  if (trimmedCity && trimmedCity !== originalLead.city) {
    payload.city = trimmedCity;
  }

  // Nullable string fields
  const nullableFields = ['description', 'address', 'locality', 'website'] as const;
  for (const field of nullableFields) {
    const formVal = form[field];
    const trimmedVal = typeof formVal === 'string' ? formVal.trim() : '';
    const origVal = originalLead[field];

    if (trimmedVal === '') {
      // Cleared / whitespace-only
      if (origVal !== null && origVal !== undefined && origVal !== '') {
        // Value existed before -> set to null
        payload[field] = null;
      }
      // If origVal was already null/undefined/empty -> do nothing / omit
    } else {
      if (trimmedVal !== origVal) {
        payload[field] = trimmedVal;
      }
    }
  }

  return payload;
}
