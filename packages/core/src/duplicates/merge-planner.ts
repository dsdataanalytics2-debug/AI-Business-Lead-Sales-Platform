/**
 * Deterministic Merge Planner
 *
 * Computes a non-destructive merge plan between an existing Lead record
 * and new incoming data.
 *
 * SAFETY RULES:
 * 1. Cross-tenant merges are strictly forbidden.
 * 2. Existing non-empty data is never overwritten by empty incoming data.
 * 3. Existing valid primaryPhone / primaryEmail are preserved by default.
 * 4. Existing contacts are never duplicated (new evidence is appended).
 * 5. ContactStatus.VERIFIED is never downgraded to FOUND.
 * 6. Evidence-backed WhatsAppStatus is never downgraded.
 * 7. Source provenance is added or refreshed, never deleted.
 */

import {
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  WebsiteStatus,
  OnlinePresenceType
} from '@leadmate/shared';
import type { Prisma } from '@leadmate/db';
import { normalizeContact } from '../normalization/contact.js';
import { normalizeWebsite } from '../normalization/website.js';
import type {
  IncomingLeadData,
  MergePlan,
  PlannedNewContact,
  PlannedExistingContactEvidenceAddition,
  PlannedExistingContactUpdate
} from './types.js';

export interface ExistingLeadRecord {
  id: string;
  organizationId: string;
  name: string;
  normalizedName: string;
  category: string;
  description?: string | null;
  address?: string | null;
  locality?: string | null;
  city: string;
  region?: string | null;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  primaryPhone?: string | null;
  primaryEmail?: string | null;
  website?: string | null;
  normalizedWebsite?: string | null;
  websiteStatus: WebsiteStatus;
  onlinePresenceType: OnlinePresenceType;
  rating?: number | null;
  reviewCount?: number | null;
  primarySource: string;
  contacts?: Array<{
    id: string;
    leadId: string;
    type: ContactType;
    rawValue: string;
    normalizedValue: string;
    phoneType?: PhoneType | null;
    status: ContactStatus;
    whatsappStatus: WhatsAppStatus;
    isPrimary: boolean;
    evidence?: Array<{
      id: string;
      contactId: string;
      sourceName: string;
      sourceUrl?: string | null;
      evidenceType: string;
      snippet?: string | null;
    }>;
  }>;
  sources?: Array<{
    id: string;
    leadId: string;
    organizationId: string;
    sourceName: string;
    sourceExternalId?: string | null;
    sourceUrl?: string | null;
    rawData?: Prisma.JsonValue | null;
  }>;
}

/**
 * Plans a non-destructive merge into an existing Lead record.
 *
 * @param existing - Current lead in database with its contacts and sources
 * @param incoming - Incoming lead data to merge
 * @returns MergePlan containing exact database updates to perform
 */
export function planMerge(
  existing: ExistingLeadRecord,
  incoming: IncomingLeadData
): MergePlan {
  if (existing.organizationId !== incoming.organizationId) {
    throw new Error(
      `Cross-tenant merge prohibited: Target lead belongs to "${existing.organizationId}" but incoming data is for "${incoming.organizationId}"`
    );
  }

  const scalarUpdates: Prisma.LeadUpdateInput = {};

  // 1. Scalar Field Updates (Non-destructive: populate empty fields only)
  if (!existing.description && incoming.description) {
    scalarUpdates.description = incoming.description;
  }

  if (!existing.address && incoming.address) {
    scalarUpdates.address = incoming.address;
  }

  if (!existing.locality && incoming.locality) {
    scalarUpdates.locality = incoming.locality;
  }

  if (existing.city === 'Dhaka' && incoming.city && incoming.city !== 'Dhaka') {
    scalarUpdates.city = incoming.city;
  }

  if (existing.latitude == null && incoming.latitude != null) {
    scalarUpdates.latitude = incoming.latitude;
  }

  if (existing.longitude == null && incoming.longitude != null) {
    scalarUpdates.longitude = incoming.longitude;
  }

  if (!existing.website && incoming.website) {
    scalarUpdates.website = incoming.website;
    const websiteNorm = normalizeWebsite(incoming.website);
    if (websiteNorm.isValid && websiteNorm.normalizedDomain) {
      scalarUpdates.normalizedWebsite = websiteNorm.normalizedDomain;
    }
  }

  if (
    existing.websiteStatus === WebsiteStatus.UNKNOWN &&
    incoming.websiteStatus &&
    incoming.websiteStatus !== WebsiteStatus.UNKNOWN
  ) {
    scalarUpdates.websiteStatus = incoming.websiteStatus;
  }

  if (
    existing.onlinePresenceType === OnlinePresenceType.UNKNOWN &&
    incoming.onlinePresenceType &&
    incoming.onlinePresenceType !== OnlinePresenceType.UNKNOWN
  ) {
    scalarUpdates.onlinePresenceType = incoming.onlinePresenceType;
  }

  if (existing.rating == null && incoming.rating != null) {
    scalarUpdates.rating = incoming.rating;
  }

  if (
    (existing.reviewCount == null || existing.reviewCount === 0) &&
    incoming.reviewCount != null &&
    incoming.reviewCount > 0
  ) {
    scalarUpdates.reviewCount = incoming.reviewCount;
  }

  // 2. Primary Phone & Email Policy
  // If primary phone is currently empty on existing lead, try to populate from incoming contacts
  const existingContacts = existing.contacts || [];
  let resolvedPrimaryPhone = existing.primaryPhone;

  // Normalize all incoming contacts
  const normalizedIncomingContacts = (incoming.contacts || []).map((c) =>
    normalizeContact(c)
  );

  if (!resolvedPrimaryPhone) {
    const validMobile = normalizedIncomingContacts.find(
      (c) => c.isValid && c.phoneType === PhoneType.MOBILE && c.normalizedValue
    );
    if (validMobile && validMobile.normalizedValue) {
      scalarUpdates.primaryPhone = validMobile.normalizedValue;
      resolvedPrimaryPhone = validMobile.normalizedValue;
    }
  }

  let resolvedPrimaryEmail = existing.primaryEmail;
  if (!resolvedPrimaryEmail) {
    const validEmail = normalizedIncomingContacts.find(
      (c) => c.isValid && c.type === ContactType.EMAIL && c.normalizedValue
    );
    if (validEmail && validEmail.normalizedValue) {
      scalarUpdates.primaryEmail = validEmail.normalizedValue;
      resolvedPrimaryEmail = validEmail.normalizedValue;
    }
  }

  // 3. Contact Merging: Deduplicate existing contacts, append new ones, upgrade status if stronger
  const newContacts: PlannedNewContact[] = [];
  const newEvidenceForExistingContacts: PlannedExistingContactEvidenceAddition[] = [];
  const contactUpdates: PlannedExistingContactUpdate[] = [];

  const CONTACT_STATUS_RANK: Record<ContactStatus, number> = {
    [ContactStatus.INVALID_FORMAT]: 0,
    [ContactStatus.STALE]: 0,
    [ContactStatus.FOUND]: 1,
    [ContactStatus.VERIFIED]: 2
  };

  const WHATSAPP_STATUS_RANK: Record<WhatsAppStatus, number> = {
    [WhatsAppStatus.UNKNOWN]: 1,
    [WhatsAppStatus.PUBLICLY_LISTED]: 2,
    [WhatsAppStatus.CONFIRMED]: 3
  };

  for (let i = 0; i < (incoming.contacts || []).length; i++) {
    const rawIncoming = incoming.contacts![i];
    const normResult = normalizedIncomingContacts[i];

    if (!normResult.isValid || !normResult.normalizedValue) {
      continue;
    }

    // Check if this contact already exists on the target lead (match type + normalizedValue)
    const existingContact = existingContacts.find(
      (ec) =>
        ec.type === normResult.type &&
        ec.normalizedValue === normResult.normalizedValue
    );

    if (existingContact) {
      // Existing contact found: Do NOT create duplicate contact.
      // Check if status should be upgraded without ever downgrading
      let statusToUpdate: ContactStatus | undefined;
      let waStatusToUpdate: WhatsAppStatus | undefined;

      if (CONTACT_STATUS_RANK[normResult.status] > CONTACT_STATUS_RANK[existingContact.status]) {
        statusToUpdate = normResult.status;
      }

      if (WHATSAPP_STATUS_RANK[normResult.whatsappStatus] > WHATSAPP_STATUS_RANK[existingContact.whatsappStatus]) {
        waStatusToUpdate = normResult.whatsappStatus;
      }

      if (statusToUpdate || waStatusToUpdate) {
        contactUpdates.push({
          contactId: existingContact.id,
          status: statusToUpdate,
          whatsappStatus: waStatusToUpdate
        });
      }

      // Check if there is new evidence to attach
      if (rawIncoming.evidence && Array.isArray(rawIncoming.evidence)) {
        const existingEvidenceList = existingContact.evidence || [];
        for (const ev of rawIncoming.evidence) {
          const alreadyHasEvidence = existingEvidenceList.some(
            (ee) =>
              ee.sourceName === ev.sourceName &&
              ee.evidenceType === ev.evidenceType
          );

          if (!alreadyHasEvidence) {
            newEvidenceForExistingContacts.push({
              contactId: existingContact.id,
              evidence: {
                sourceName: ev.sourceName,
                sourceUrl: ev.sourceUrl || null,
                evidenceType: ev.evidenceType,
                snippet: ev.snippet || null
              }
            });
          }
        }
      }
    } else {
      // Brand new contact for this lead: plan creation
      const plannedEvidence = (rawIncoming.evidence || []).map((ev) => ({
        sourceName: ev.sourceName,
        sourceUrl: ev.sourceUrl || null,
        evidenceType: ev.evidenceType,
        snippet: ev.snippet || null
      }));

      newContacts.push({
        type: normResult.type,
        rawValue: normResult.rawValue,
        normalizedValue: normResult.normalizedValue,
        phoneType: normResult.phoneType,
        status: normResult.status,
        whatsappStatus: normResult.whatsappStatus,
        isPrimary: normResult.isPrimary,
        evidence: plannedEvidence
      });
    }
  }

  // 4. Source Merging: Upsert incoming source provenance (preserve existing url/rawData if incoming is empty)
  let sourceToUpsert = null;
  if (incoming.source?.sourceName) {
    const existingSource = (existing.sources || []).find(
      (s) =>
        s.sourceName === incoming.source!.sourceName &&
        s.sourceExternalId === (incoming.source!.sourceExternalId || null)
    );

    const resolvedSourceUrl = incoming.source.sourceUrl
      ? incoming.source.sourceUrl
      : existingSource?.sourceUrl || null;

    const resolvedRawData =
      incoming.source.rawData !== undefined
        ? incoming.source.rawData
        : existingSource?.rawData !== undefined
          ? (existingSource.rawData as Prisma.InputJsonValue)
          : undefined;

    sourceToUpsert = {
      organizationId: existing.organizationId,
      sourceName: incoming.source.sourceName,
      sourceExternalId: incoming.source.sourceExternalId || null,
      sourceUrl: resolvedSourceUrl,
      rawData: resolvedRawData
    };
  }

  return {
    targetLeadId: existing.id,
    organizationId: existing.organizationId,
    scalarUpdates,
    newContacts,
    newEvidenceForExistingContacts,
    contactUpdates,
    sourceToUpsert
  };
}
