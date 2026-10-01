/**
 * Types and Interfaces for Deterministic Duplicate Detection & Merge Service
 */

import {
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  EvidenceType,
  WebsiteStatus,
  OnlinePresenceType,
  DuplicateMatchLevel,
  DuplicateAction
} from '@leadmate/shared';
import type { Prisma, PrismaClient } from '@leadmate/db';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface IncomingContactEvidence {
  sourceName: string;
  sourceUrl?: string | null;
  evidenceType: EvidenceType;
  snippet?: string | null;
}

export interface IncomingContact {
  type: ContactType;
  rawValue: string;
  phoneType?: PhoneType | null;
  whatsappStatus?: WhatsAppStatus;
  isPrimary?: boolean;
  evidence?: IncomingContactEvidence[];
}

export interface IncomingSource {
  sourceName: string;
  sourceExternalId?: string | null;
  sourceUrl?: string | null;
  rawData?: Prisma.InputJsonValue;
}

export interface IncomingLeadData {
  organizationId: string;
  name: string;
  category?: string;
  description?: string | null;
  address?: string | null;
  locality?: string | null;
  city?: string;
  region?: string | null;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
  primaryPhone?: string | null;
  primaryEmail?: string | null;
  website?: string | null;
  websiteStatus?: WebsiteStatus;
  onlinePresenceType?: OnlinePresenceType;
  rating?: number | null;
  reviewCount?: number | null;
  primarySource?: string;
  source?: IncomingSource | null;
  contacts?: IncomingContact[];
}

export type DuplicateMatchReason =
  | 'TIER_1A_PROVIDER_IDENTITY'
  | 'TIER_1B_MOBILE_MATCH'
  | 'TIER_2A_WEBSITE_DOMAIN'
  | 'TIER_2B_NAME_LOCALITY'
  | 'TIER_2B_NAME_CITY'
  | 'DEFINITE_MATCH_CONFLICT'
  | 'NO_MATCH';

export interface DuplicateDetectionResult {
  matchLevel: DuplicateMatchLevel;
  action: DuplicateAction;
  reason: DuplicateMatchReason;
  /** Primary matching lead ID if a single definite or candidate match was identified */
  leadId?: string | null;
  /** All candidate lead IDs if candidate matches were found */
  candidateLeadIds: string[];
  /** Flag indicating whether multiple conflicting definite matches were found */
  isConflict: boolean;
  conflictDetails?: {
    reason: string;
    conflictingLeadIds: string[];
  } | null;
}

export interface PlannedContactEvidence {
  sourceName: string;
  sourceUrl?: string | null;
  evidenceType: EvidenceType;
  snippet?: string | null;
}

export interface PlannedNewContact {
  type: ContactType;
  rawValue: string;
  normalizedValue: string;
  phoneType?: PhoneType | null;
  status: ContactStatus;
  whatsappStatus: WhatsAppStatus;
  isPrimary: boolean;
  evidence: PlannedContactEvidence[];
}

export interface PlannedExistingContactEvidenceAddition {
  contactId: string;
  evidence: PlannedContactEvidence;
}

export interface PlannedExistingContactUpdate {
  contactId: string;
  status?: ContactStatus;
  whatsappStatus?: WhatsAppStatus;
}

export interface MergePlan {
  targetLeadId: string;
  organizationId: string;
  scalarUpdates: Prisma.LeadUpdateInput;
  newContacts: PlannedNewContact[];
  newEvidenceForExistingContacts: PlannedExistingContactEvidenceAddition[];
  contactUpdates?: PlannedExistingContactUpdate[];
  sourceToUpsert?: {
    organizationId: string;
    sourceName: string;
    sourceExternalId: string | null;
    sourceUrl?: string | null;
    rawData?: Prisma.InputJsonValue;
  } | null;
}

export interface MergeExecutionResult {
  success: boolean;
  leadId: string;
  updatedFields: string[];
  addedContactsCount: number;
  addedEvidenceCount: number;
  sourceUpdated: boolean;
}
