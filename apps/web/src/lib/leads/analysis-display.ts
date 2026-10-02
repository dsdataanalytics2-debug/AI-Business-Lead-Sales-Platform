/**
 * Online Presence Analysis UI Display & Label Mapping Utilities
 *
 * Strict invariants:
 * - 100% deterministic display mapping
 * - Frontend NEVER recalculates scores or derives reasons
 * - Never throws on unknown future reason codes (falls back gracefully)
 * - Safe error message classification without leaking stack traces
 */

import {
  AnalysisWebsiteStatus,
  CampaignType,
  QualificationReasonCode,
  OnlinePresenceType
} from '@leadmate/shared';
import { ApiClientError } from '../api-client.js';

/**
 * Maps raw backend AnalysisWebsiteStatus to human-friendly display label.
 */
export function formatWebsiteStatusLabel(status?: AnalysisWebsiteStatus | string | null): string {
  if (!status) return 'Not available';

  switch (status) {
    case AnalysisWebsiteStatus.NOT_APPLICABLE:
    case 'NOT_APPLICABLE':
      return 'No Website';
    case AnalysisWebsiteStatus.REACHABLE:
    case 'REACHABLE':
      return 'Reachable';
    case AnalysisWebsiteStatus.UNREACHABLE:
    case 'UNREACHABLE':
      return 'Unreachable';
    case AnalysisWebsiteStatus.TIMEOUT:
    case 'TIMEOUT':
      return 'Timed Out';
    case AnalysisWebsiteStatus.ACCESS_RESTRICTED:
    case 'ACCESS_RESTRICTED':
      return 'Access Restricted';
    case AnalysisWebsiteStatus.BLOCKED_SSRF:
    case 'BLOCKED_SSRF':
      return 'Blocked for Safety';
    case AnalysisWebsiteStatus.INVALID_URL:
    case 'INVALID_URL':
      return 'Invalid URL';
    case AnalysisWebsiteStatus.NON_HTML:
    case 'NON_HTML':
      return 'Non-HTML Website';
    default:
      return String(status).replace(/_/g, ' ');
  }
}

/**
 * Returns Tailwind CSS badge color classes based on website status.
 */
export function getWebsiteStatusBadgeClasses(status?: AnalysisWebsiteStatus | string | null): string {
  switch (status) {
    case AnalysisWebsiteStatus.REACHABLE:
    case 'REACHABLE':
      return 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50';
    case AnalysisWebsiteStatus.NOT_APPLICABLE:
    case 'NOT_APPLICABLE':
      return 'bg-slate-900 text-slate-400 border-slate-700';
    case AnalysisWebsiteStatus.UNREACHABLE:
    case 'UNREACHABLE':
    case AnalysisWebsiteStatus.TIMEOUT:
    case 'TIMEOUT':
      return 'bg-red-950/60 text-red-300 border-red-800/50';
    case AnalysisWebsiteStatus.BLOCKED_SSRF:
    case 'BLOCKED_SSRF':
    case AnalysisWebsiteStatus.ACCESS_RESTRICTED:
    case 'ACCESS_RESTRICTED':
    case AnalysisWebsiteStatus.INVALID_URL:
    case 'INVALID_URL':
    case AnalysisWebsiteStatus.NON_HTML:
    case 'NON_HTML':
      return 'bg-amber-950/60 text-amber-300 border-amber-800/50';
    default:
      return 'bg-slate-900 text-slate-300 border-slate-700';
  }
}

/**
 * Maps CampaignType enum to human display title.
 */
export function formatCampaignTypeLabel(type?: CampaignType | string | null): string {
  if (!type) return 'Unknown Campaign';

  switch (type) {
    case CampaignType.WEBSITE_ACQUISITION:
    case 'WEBSITE_ACQUISITION':
      return 'Website Acquisition';
    case CampaignType.WEBSITE_REDESIGN:
    case 'WEBSITE_REDESIGN':
      return 'Website Redesign';
    case CampaignType.ONLINE_PRESENCE_IMPROVEMENT:
    case 'ONLINE_PRESENCE_IMPROVEMENT':
      return 'Online Presence Improvement';
    default:
      return String(type).replace(/_/g, ' ');
  }
}

/**
 * Maps QualificationReasonCode enum to exact required human-friendly label.
 */
export function formatReasonCodeLabel(code?: QualificationReasonCode | string | null): string {
  if (!code) return 'Unknown signal';

  switch (code) {
    case QualificationReasonCode.NO_WEBSITE:
    case 'NO_WEBSITE':
      return 'No website detected';
    case QualificationReasonCode.WEBSITE_UNREACHABLE:
    case 'WEBSITE_UNREACHABLE':
      return 'Website unreachable';
    case QualificationReasonCode.WEBSITE_TIMEOUT:
    case 'WEBSITE_TIMEOUT':
      return 'Website timed out';
    case QualificationReasonCode.NO_HTTPS:
    case 'NO_HTTPS':
      return 'HTTPS not enabled';
    case QualificationReasonCode.NO_META_DESCRIPTION:
    case 'NO_META_DESCRIPTION':
      return 'Meta description missing';
    case QualificationReasonCode.SHORT_PAGE_TITLE:
    case 'SHORT_PAGE_TITLE':
      return 'Page title is too short';
    case QualificationReasonCode.SLOW_RESPONSE:
    case 'SLOW_RESPONSE':
      return 'Slow website response';
    case QualificationReasonCode.FACEBOOK_ONLY:
    case 'FACEBOOK_ONLY':
      return 'Facebook presence without standalone website';
    case QualificationReasonCode.INSTAGRAM_ONLY:
    case 'INSTAGRAM_ONLY':
      return 'Instagram presence without standalone website';
    case QualificationReasonCode.MULTI_CHANNEL_PRESENCE:
    case 'MULTI_CHANNEL_PRESENCE':
      return 'Multiple online channels detected';
    case QualificationReasonCode.HIGH_RATING_NO_WEB:
    case 'HIGH_RATING_NO_WEB':
      return 'Strong rating but no working website';
    case QualificationReasonCode.HAS_ESTABLISHED_REVIEWS:
    case 'HAS_ESTABLISHED_REVIEWS':
      return 'Established customer reviews';
    case QualificationReasonCode.HAS_MOBILE_PHONE:
    case 'HAS_MOBILE_PHONE':
      return 'Mobile phone available';
    case QualificationReasonCode.HAS_PRIMARY_EMAIL:
    case 'HAS_PRIMARY_EMAIL':
      return 'Primary email available';
    case QualificationReasonCode.HAS_WHATSAPP:
    case 'HAS_WHATSAPP':
      return 'WhatsApp contact available';
    default:
      // Fallback for future/unknown reason codes: gracefully humanize without crashing
      return String(code)
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

/**
 * Maps OnlinePresenceType enum to human display label.
 */
export function formatOnlinePresenceTypeLabel(type?: OnlinePresenceType | string | null): string {
  if (!type) return 'Unknown';

  switch (type) {
    case OnlinePresenceType.WEBSITE:
    case 'WEBSITE':
      return 'Website';
    case OnlinePresenceType.FACEBOOK_ONLY:
    case 'FACEBOOK_ONLY':
      return 'Facebook Only';
    case OnlinePresenceType.INSTAGRAM_ONLY:
    case 'INSTAGRAM_ONLY':
      return 'Instagram Only';
    case OnlinePresenceType.MARKETPLACE_ONLY:
    case 'MARKETPLACE_ONLY':
      return 'Marketplace Only';
    case OnlinePresenceType.NONE_DETECTED:
    case 'NONE_DETECTED':
      return 'None Detected';
    case OnlinePresenceType.UNKNOWN:
    case 'UNKNOWN':
    default:
      return 'Unknown';
  }
}

export interface ClassifiedAnalysisError {
  message: string;
  statusCode?: number;
  code?: string;
  requestId?: string;
  isConflict: boolean;
  isRateLimit: boolean;
  isForbidden: boolean;
  isNotFound: boolean;
}

/**
 * Classifies API error for safe, user-friendly UI display.
 */
export function classifyAnalysisError(err: unknown): ClassifiedAnalysisError {
  if (err instanceof ApiClientError) {
    if (err.statusCode === 409 || err.code === 'CONFLICT') {
      return {
        message: 'Lead information changed during analysis. Please try again.',
        statusCode: 409,
        code: err.code,
        requestId: err.requestId,
        isConflict: true,
        isRateLimit: false,
        isForbidden: false,
        isNotFound: false
      };
    }

    if (err.statusCode === 429 || err.code === 'RATE_LIMITED') {
      return {
        message: 'Too many analysis requests. Please wait and try again.',
        statusCode: 429,
        code: err.code,
        requestId: err.requestId,
        isConflict: false,
        isRateLimit: true,
        isForbidden: false,
        isNotFound: false
      };
    }

    if (err.statusCode === 403 || err.code === 'FORBIDDEN') {
      return {
        message: 'You do not have permission to analyze this lead.',
        statusCode: 403,
        code: err.code,
        requestId: err.requestId,
        isConflict: false,
        isRateLimit: false,
        isForbidden: true,
        isNotFound: false
      };
    }

    if (err.statusCode === 404 || err.code === 'NOT_FOUND') {
      return {
        message: 'Lead not found.',
        statusCode: 404,
        code: err.code,
        requestId: err.requestId,
        isConflict: false,
        isRateLimit: false,
        isForbidden: false,
        isNotFound: true
      };
    }

    if (err.statusCode === 422 || err.code === 'VALIDATION_ERROR') {
      return {
        message: 'Invalid analysis request parameters.',
        statusCode: 422,
        code: err.code,
        requestId: err.requestId,
        isConflict: false,
        isRateLimit: false,
        isForbidden: false,
        isNotFound: false
      };
    }

    return {
      message: 'Analysis could not be completed. Please try again.',
      statusCode: err.statusCode,
      code: err.code,
      requestId: err.requestId,
      isConflict: false,
      isRateLimit: false,
      isForbidden: false,
      isNotFound: false
    };
  }

  return {
    message: 'Analysis could not be completed. Please try again.',
    isConflict: false,
    isRateLimit: false,
    isForbidden: false,
    isNotFound: false
  };
}
