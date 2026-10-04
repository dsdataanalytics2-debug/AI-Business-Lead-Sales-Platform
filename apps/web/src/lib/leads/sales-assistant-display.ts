import {
  SalesAssistantDraftStatus,
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantWarning,
  type SalesAssistantDraftSummary
} from '@leadmate/shared';
import { ApiClientError } from '@/lib/api-client';

/**
 * Human approval notice text required for all drafts
 */
export const SALES_ASSISTANT_APPROVAL_NOTICE =
  'Human approval required. Approval does not send the message automatically.';

export const SALES_ASSISTANT_UNVERIFIED_WHATSAPP_NOTICE =
  'No verified WhatsApp contact is available for this lead. This draft is for review only.';

/**
 * Maps system warning codes to clear, user-facing explanations.
 */
export const SALES_ASSISTANT_WARNING_MESSAGES: Record<SalesAssistantWarning, string> = {
  [SalesAssistantWarning.MISSING_PRODUCT_CONTEXT]: 'Product/service context is limited.',
  [SalesAssistantWarning.MISSING_PRICE_CONTEXT]: 'Verified pricing information is unavailable.',
  [SalesAssistantWarning.UNVERIFIED_WHATSAPP]:
    'No verified/public WhatsApp contact is available.',
  [SalesAssistantWarning.UNSUPPORTED_CLAIM_REMOVED]:
    'An unsupported claim was removed from the draft.',
  [SalesAssistantWarning.LIMITED_LEAD_CONTEXT]: 'This lead has limited verified context.'
};

export function getSalesAssistantWarningMessage(warning: SalesAssistantWarning): string {
  return SALES_ASSISTANT_WARNING_MESSAGES[warning] ?? warning;
}

export function formatSalesAssistantDraftTypeLabel(type: SalesAssistantDraftType): string {
  switch (type) {
    case SalesAssistantDraftType.WHATSAPP:
      return 'WhatsApp';
    case SalesAssistantDraftType.EMAIL:
      return 'Email';
    case SalesAssistantDraftType.CALL_SCRIPT:
      return 'Call Script';
    case SalesAssistantDraftType.PROPOSAL:
      return 'Proposal';
    case SalesAssistantDraftType.FOLLOW_UP:
      return 'Follow-up';
    default:
      return type;
  }
}

export function formatSalesAssistantLanguageLabel(language: SalesAssistantLanguage): string {
  switch (language) {
    case SalesAssistantLanguage.BANGLA:
      return 'Bangla';
    case SalesAssistantLanguage.ENGLISH:
      return 'English';
    case SalesAssistantLanguage.MIXED:
      return 'Mixed (Banglish)';
    default:
      return language;
  }
}

export function formatSalesAssistantToneLabel(tone: SalesAssistantTone): string {
  switch (tone) {
    case SalesAssistantTone.PROFESSIONAL:
      return 'Professional';
    case SalesAssistantTone.FRIENDLY:
      return 'Friendly';
    case SalesAssistantTone.CONCISE:
      return 'Concise';
    case SalesAssistantTone.PERSUASIVE:
      return 'Persuasive';
    default:
      return tone;
  }
}

export function getSalesAssistantStatusBadgeClasses(status: SalesAssistantDraftStatus): string {
  switch (status) {
    case SalesAssistantDraftStatus.DRAFT:
      return 'bg-amber-950/70 text-amber-300 border-amber-700/60';
    case SalesAssistantDraftStatus.APPROVED:
      return 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60';
    case SalesAssistantDraftStatus.REJECTED:
      return 'bg-rose-950/70 text-rose-300 border-rose-700/60';
    default:
      return 'bg-slate-900 text-slate-400 border-slate-700';
  }
}

/**
 * Formats draft content for clipboard copy.
 * Email drafts include subject and body; others include prose content.
 */
export function formatDraftForClipboard(draft: SalesAssistantDraftSummary): string {
  if (draft.type === SalesAssistantDraftType.EMAIL) {
    const subject = draft.emailSubject ? `Subject: ${draft.emailSubject}\n\n` : '';
    const body = draft.emailBody || '';
    return `${subject}${body}`.trim();
  }
  return (draft.content || '').trim();
}

export interface ClassifiedSalesAssistantError {
  message: string;
  isConflict: boolean;
  isRateLimited: boolean;
  isForbidden: boolean;
  isNotFound: boolean;
  isValidation: boolean;
  isTimeout: boolean;
  isUnavailable: boolean;
}

export function classifySalesAssistantError(err: unknown): ClassifiedSalesAssistantError {
  if (err instanceof ApiClientError) {
    if (err.statusCode === 409 || err.code === 'CONFLICT') {
      return {
        message: 'This draft has already been reviewed. Refreshing its latest status.',
        isConflict: true,
        isRateLimited: false,
        isForbidden: false,
        isNotFound: false,
        isValidation: false,
        isTimeout: false,
        isUnavailable: false
      };
    }

    if (
      err.statusCode === 429 ||
      err.code === 'RATE_LIMITED' ||
      err.code === 'AI_PROVIDER_RATE_LIMITED'
    ) {
      return {
        message: 'Too many requests. Please wait a moment and try again.',
        isConflict: false,
        isRateLimited: true,
        isForbidden: false,
        isNotFound: false,
        isValidation: false,
        isTimeout: false,
        isUnavailable: false
      };
    }

    if (err.statusCode === 504 || err.code === 'AI_PROVIDER_TIMEOUT') {
      return {
        message: 'AI provider timed out. Please wait a moment and try again.',
        isConflict: false,
        isRateLimited: false,
        isForbidden: false,
        isNotFound: false,
        isValidation: false,
        isTimeout: true,
        isUnavailable: false
      };
    }

    if (err.statusCode === 503 || err.code === 'AI_PROVIDER_UNAVAILABLE') {
      return {
        message: 'AI sales assistant is temporarily unavailable. Please try again shortly.',
        isConflict: false,
        isRateLimited: false,
        isForbidden: false,
        isNotFound: false,
        isValidation: false,
        isTimeout: false,
        isUnavailable: true
      };
    }

    if (err.statusCode === 502 || err.code === 'AI_PROVIDER_BAD_GATEWAY') {
      return {
        message: 'AI provider returned an invalid response. Please try again.',
        isConflict: false,
        isRateLimited: false,
        isForbidden: false,
        isNotFound: false,
        isValidation: false,
        isTimeout: false,
        isUnavailable: false
      };
    }

    if (err.statusCode === 403 || err.code === 'FORBIDDEN') {
      return {
        message: 'You do not have permission to perform this sales assistant action.',
        isConflict: false,
        isRateLimited: false,
        isForbidden: true,
        isNotFound: false,
        isValidation: false,
        isTimeout: false,
        isUnavailable: false
      };
    }

    if (err.statusCode === 404 || err.code === 'NOT_FOUND') {
      return {
        message: 'Lead or sales assistant draft not found.',
        isConflict: false,
        isRateLimited: false,
        isForbidden: false,
        isNotFound: true,
        isValidation: false,
        isTimeout: false,
        isUnavailable: false
      };
    }

    if (err.statusCode === 422 || err.code === 'VALIDATION_ERROR') {
      return {
        message: err.message || 'Input validation failed. Please check your entries.',
        isConflict: false,
        isRateLimited: false,
        isForbidden: false,
        isNotFound: false,
        isValidation: true,
        isTimeout: false,
        isUnavailable: false
      };
    }

    return {
      message: err.message || 'Failed to process sales assistant request. Please try again.',
      isConflict: false,
      isRateLimited: false,
      isForbidden: false,
      isNotFound: false,
      isValidation: false,
      isTimeout: false,
      isUnavailable: false
    };
  }

  if (err instanceof Error) {
    return {
      message: err.message || 'An unexpected error occurred.',
      isConflict: false,
      isRateLimited: false,
      isForbidden: false,
      isNotFound: false,
      isValidation: false,
      isTimeout: false,
      isUnavailable: false
    };
  }

  return {
    message: 'An unknown error occurred.',
    isConflict: false,
    isRateLimited: false,
    isForbidden: false,
    isNotFound: false,
    isValidation: false,
    isTimeout: false,
    isUnavailable: false
  };
}
