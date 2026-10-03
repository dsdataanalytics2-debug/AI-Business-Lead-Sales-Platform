import { DemoWebsiteStatus, DemoWebsiteProvider, DEMO_WEBSITE_STATUS_LABELS } from '@leadmate/shared';
import { ApiClientError } from '@/lib/api-client';
import { getSafeExternalUrl } from '@/lib/safe-url';

/**
 * Product Invariant Disclaimer for all generated demo websites
 */
export const DEMO_DISCLAIMER_TEXT = 'DEMO — NOT OFFICIAL';

/**
 * Validates external demo website URL enforcing strict HTTPS protocol requirement.
 * Rejects plain HTTP and unsafe schemes (javascript, data, file, etc.).
 */
export function getSafeDemoWebsiteUrl(url?: string | null): { href: string; label: string } | null {
  const safe = getSafeExternalUrl(url);
  if (!safe) return null;
  try {
    const parsed = new URL(safe.href);
    if (parsed.protocol !== 'https:') {
      return null;
    }
    return safe;
  } catch {
    return null;
  }
}

export function formatDemoStatusLabel(status: DemoWebsiteStatus): string {
  return DEMO_WEBSITE_STATUS_LABELS[status] ?? status;
}

export function getDemoStatusBadgeClasses(status: DemoWebsiteStatus): string {
  switch (status) {
    case DemoWebsiteStatus.READY:
      return 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60';
    case DemoWebsiteStatus.CREATING:
      return 'bg-indigo-950/70 text-indigo-300 border-indigo-700/60';
    case DemoWebsiteStatus.REQUESTED:
      return 'bg-sky-950/70 text-sky-300 border-sky-700/60';
    case DemoWebsiteStatus.EXPIRED:
      return 'bg-amber-950/70 text-amber-300 border-amber-700/60';
    case DemoWebsiteStatus.FAILED:
      return 'bg-rose-950/70 text-rose-300 border-rose-700/60';
    case DemoWebsiteStatus.REMOVED:
    default:
      return 'bg-slate-900 text-slate-400 border-slate-700';
  }
}

export function formatDemoProviderLabel(provider?: DemoWebsiteProvider | string | null): string {
  if (provider === DemoWebsiteProvider.MOCK || provider === 'MOCK') {
    return 'Mock Demo';
  }
  if (provider === DemoWebsiteProvider.STOREMATE || provider === 'STOREMATE') {
    return 'StoreMate';
  }
  return provider ? String(provider) : 'Mock Demo';
}

export interface ClassifiedDemoError {
  message: string;
  isAuth: boolean;
  isForbidden: boolean;
  isNotFound: boolean;
  isValidation: boolean;
  isUnavailable: boolean;
  isNetwork: boolean;
}

export function classifyDemoWebsiteError(err: unknown): ClassifiedDemoError {
  if (err instanceof ApiClientError) {
    if (err.statusCode === 401) {
      return {
        message: 'Session expired. Please sign in again.',
        isAuth: true,
        isForbidden: false,
        isNotFound: false,
        isValidation: false,
        isUnavailable: false,
        isNetwork: false
      };
    }

    if (err.statusCode === 403) {
      return {
        message: 'You do not have permission to perform this demo action.',
        isAuth: false,
        isForbidden: true,
        isNotFound: false,
        isValidation: false,
        isUnavailable: false,
        isNetwork: false
      };
    }

    if (err.statusCode === 404) {
      return {
        message: 'Lead or demo website not found.',
        isAuth: false,
        isForbidden: false,
        isNotFound: true,
        isValidation: false,
        isUnavailable: false,
        isNetwork: false
      };
    }

    if (err.statusCode === 422) {
      return {
        message: err.message || 'Invalid request payload for demo operation.',
        isAuth: false,
        isForbidden: false,
        isNotFound: false,
        isValidation: true,
        isUnavailable: false,
        isNetwork: false
      };
    }

    if (err.statusCode === 503 || err.code === 'STOREMATE_UNAVAILABLE') {
      return {
        message: 'Demo website service is currently unavailable.',
        isAuth: false,
        isForbidden: false,
        isNotFound: false,
        isValidation: false,
        isUnavailable: true,
        isNetwork: false
      };
    }

    return {
      message: err.message || 'An unexpected error occurred while processing demo website.',
      isAuth: false,
      isForbidden: false,
      isNotFound: false,
      isValidation: false,
      isUnavailable: false,
      isNetwork: false
    };
  }

  return {
    message: 'Network error communicating with server. Please check your connection and try again.',
    isAuth: false,
    isForbidden: false,
    isNotFound: false,
    isValidation: false,
    isUnavailable: false,
    isNetwork: true
  };
}
