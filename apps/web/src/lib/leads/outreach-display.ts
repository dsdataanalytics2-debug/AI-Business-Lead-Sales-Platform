import {
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode,
  SalesAssistantDraftType,
  type OutreachDeliverySummary,
  type LeadDetail,
  type LeadContact,
  ContactType,
  ContactStatus,
  WhatsAppStatus,
  maskRecipient
} from '@leadmate/shared';
import { ApiClientError } from '@/lib/api-client';

/**
 * Notice displayed in confirmation modal reminding the user that delivery is queued, not instant.
 */
export const OUTREACH_DISPATCH_DISCLAIMER =
  'Requesting delivery queues this approved message for background dispatch. It does not mean the message has been physically delivered yet.';

/**
 * Human-readable status labels for OutreachDeliveryStatus.
 */
export const OUTREACH_STATUS_LABELS: Record<OutreachDeliveryStatus, string> = {
  [OutreachDeliveryStatus.REQUESTED]: 'Requested',
  [OutreachDeliveryStatus.QUEUED]: 'Queued',
  [OutreachDeliveryStatus.PROCESSING]: 'Processing',
  [OutreachDeliveryStatus.SENT]: 'Sent to Provider',
  [OutreachDeliveryStatus.DELIVERED]: 'Delivered',
  [OutreachDeliveryStatus.FAILED]: 'Failed',
  [OutreachDeliveryStatus.CANCELLED]: 'Cancelled'
};

export function formatOutreachStatusLabel(status: OutreachDeliveryStatus): string {
  return OUTREACH_STATUS_LABELS[status] ?? status;
}

/**
 * User-facing descriptive state messages.
 */
export const OUTREACH_STATUS_DESCRIPTIONS: Record<OutreachDeliveryStatus, string> = {
  [OutreachDeliveryStatus.REQUESTED]: 'Delivery request created',
  [OutreachDeliveryStatus.QUEUED]: 'Queued for delivery',
  [OutreachDeliveryStatus.PROCESSING]: 'Processing delivery',
  [OutreachDeliveryStatus.SENT]: 'Sent to provider',
  [OutreachDeliveryStatus.DELIVERED]: 'Delivered to recipient',
  [OutreachDeliveryStatus.FAILED]: 'Delivery failed',
  [OutreachDeliveryStatus.CANCELLED]: 'Delivery cancelled'
};

export function formatOutreachStatusDescription(status: OutreachDeliveryStatus): string {
  return OUTREACH_STATUS_DESCRIPTIONS[status] ?? status;
}

/**
 * Styling classes for outreach delivery status badges.
 */
export function getOutreachStatusBadgeClasses(status: OutreachDeliveryStatus): string {
  switch (status) {
    case OutreachDeliveryStatus.REQUESTED:
      return 'bg-sky-950/70 text-sky-300 border-sky-700/60';
    case OutreachDeliveryStatus.QUEUED:
      return 'bg-indigo-950/70 text-indigo-300 border-indigo-700/60';
    case OutreachDeliveryStatus.PROCESSING:
      return 'bg-amber-950/70 text-amber-300 border-amber-700/60';
    case OutreachDeliveryStatus.SENT:
      return 'bg-blue-950/70 text-blue-300 border-blue-700/60';
    case OutreachDeliveryStatus.DELIVERED:
      return 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60';
    case OutreachDeliveryStatus.FAILED:
      return 'bg-rose-950/70 text-rose-300 border-rose-700/60';
    case OutreachDeliveryStatus.CANCELLED:
      return 'bg-slate-900 text-slate-400 border-slate-700';
    default:
      return 'bg-slate-900 text-slate-400 border-slate-700';
  }
}

/**
 * Channel label helper.
 */
export function formatOutreachChannelLabel(channel: OutreachChannel): string {
  switch (channel) {
    case OutreachChannel.WHATSAPP:
      return 'WhatsApp';
    case OutreachChannel.EMAIL:
      return 'Email';
    default:
      return channel;
  }
}

/**
 * Resolved recipient candidate for UI selection.
 */
export interface RecipientCandidate {
  contactId?: string;
  maskedLabel: string;
  rawValue: string;
  type: ContactType;
  isPrimary?: boolean;
}

/**
 * Resolves trusted CRM contacts for a given channel from a LeadDetail object.
 * Strictly enforces PHONE != WHATSAPP (plain PHONE contacts are never returned for WhatsApp).
 *
 * WhatsApp eligibility (matches backend exactly):
 * - contact.type === ContactType.WHATSAPP
 * - AND trusted provenance:
 *     contact.status === ContactStatus.VERIFIED
 *     OR contact.whatsappStatus === WhatsAppStatus.PUBLICLY_LISTED
 *     OR contact.whatsappStatus === WhatsAppStatus.CONFIRMED
 * - AND !contact.isSuppressed
 *
 * Email eligibility (matches backend exactly):
 * - If valid EMAIL contacts exist:
 *     candidates = EMAIL contacts only (each with contactId = contact.id)
 * - Else if valid lead.primaryEmail exists:
 *     candidates = primaryEmail fallback (contactId = undefined)
 * - Else:
 *     no email candidate
 * - DOES NOT invent ContactStatus.VERIFIED requirement
 * - primaryEmail is fallback ONLY when zero valid EMAIL contacts exist
 */
export function resolveRecipientCandidates(
  lead: LeadDetail,
  channel: OutreachChannel
): RecipientCandidate[] {
  const candidates: RecipientCandidate[] = [];

  if (channel === OutreachChannel.WHATSAPP) {
    // Strictly find contacts with type WHATSAPP and verified provenance
    const whatsappContacts = lead.contacts.filter(
      (c) =>
        c.type === ContactType.WHATSAPP &&
        !c.isSuppressed &&
        (c.status === ContactStatus.VERIFIED ||
          c.whatsappStatus === WhatsAppStatus.PUBLICLY_LISTED ||
          c.whatsappStatus === WhatsAppStatus.CONFIRMED)
    );

    for (const contact of whatsappContacts) {
      candidates.push({
        contactId: contact.id,
        maskedLabel: maskRecipient(contact.normalizedValue || contact.rawValue),
        rawValue: contact.rawValue,
        type: ContactType.WHATSAPP,
        isPrimary: contact.isPrimary
      });
    }
  } else if (channel === OutreachChannel.EMAIL) {
    // Find contacts with type EMAIL without requiring ContactStatus.VERIFIED (matching backend rules)
    const emailContacts = lead.contacts.filter(
      (c) =>
        c.type === ContactType.EMAIL &&
        !c.isSuppressed &&
        (c.normalizedValue || c.rawValue).includes('@')
    );

    if (emailContacts.length > 0) {
      // Valid explicit EMAIL contacts exist: candidates = EMAIL contacts only
      for (const contact of emailContacts) {
        candidates.push({
          contactId: contact.id,
          maskedLabel: maskRecipient(contact.normalizedValue || contact.rawValue),
          rawValue: contact.rawValue,
          type: ContactType.EMAIL,
          isPrimary: contact.isPrimary
        });
      }
    } else if (lead.primaryEmail && lead.primaryEmail.trim().length > 0) {
      // primaryEmail is fallback ONLY when zero EMAIL contacts exist
      const trimmedPrimary = lead.primaryEmail.trim();
      if (trimmedPrimary.includes('@')) {
        candidates.push({
          contactId: undefined,
          maskedLabel: maskRecipient(trimmedPrimary),
          rawValue: trimmedPrimary,
          type: ContactType.EMAIL,
          isPrimary: true
        });
      }
    }
  }

  return candidates;
}

export interface ClassifiedOutreachError {
  code: string;
  message: string;
  requestId?: string;
  isRetryableQueueError?: boolean;
}

/**
 * Classifies API errors for outreach deliveries into safe user-facing explanations.
 */
export function classifyOutreachError(err: unknown): ClassifiedOutreachError {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED:
        return {
          code: err.code,
          message: 'This draft must be approved before delivery can be requested.',
          requestId: err.requestId
        };
      case OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED:
        return {
          code: err.code,
          message: 'This delivery request key was already used for a different draft or channel. Please start a new delivery request.',
          requestId: err.requestId
        };
      case OutreachErrorCode.OUTREACH_RECIPIENT_INVALID:
        return {
          code: err.code,
          message: 'Select a valid, verified recipient for the chosen channel.',
          requestId: err.requestId
        };
      case OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED:
        return {
          code: err.code,
          message: 'Delivery is blocked because this recipient is on the suppression list.',
          requestId: err.requestId
        };
      case OutreachErrorCode.OUTREACH_CHANNEL_INCOMPATIBLE:
        return {
          code: err.code,
          message: 'The selected delivery channel is incompatible with this draft type.',
          requestId: err.requestId
        };
      case OutreachErrorCode.OUTREACH_DELIVERY_FAILED:
        return {
          code: err.code,
          message: 'Delivery request was created but could not be queued. Please try again using the same action.',
          requestId: err.requestId,
          isRetryableQueueError: true
        };
      case 'FORBIDDEN':
        return {
          code: 'FORBIDDEN',
          message: 'You do not have permission to initiate or view outreach for this lead.',
          requestId: err.requestId
        };
      case 'NOT_FOUND':
        return {
          code: 'NOT_FOUND',
          message: 'Lead or draft resource was not found.',
          requestId: err.requestId
        };
      case 'VALIDATION_ERROR':
        return {
          code: 'VALIDATION_ERROR',
          message: 'Invalid delivery parameters. Please check your selections and try again.',
          requestId: err.requestId
        };
      case 'UNAUTHENTICATED':
        return {
          code: 'UNAUTHENTICATED',
          message: 'Your session has expired. Please log in again.',
          requestId: err.requestId
        };
      default:
        return {
          code: err.code || 'UNKNOWN_ERROR',
          message: err.message || 'An unexpected error occurred while requesting delivery.',
          requestId: err.requestId
        };
    }
  }

  if (err instanceof Error) {
    return {
      code: 'CLIENT_ERROR',
      message: err.message || 'An unexpected error occurred.'
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred while requesting delivery.'
  };
}
