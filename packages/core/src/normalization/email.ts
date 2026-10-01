/**
 * Email Normalization Utility
 *
 * Implements conservative business-email validation and normalization.
 *
 * CRITICAL RULES:
 * 1. Trims whitespace and lowercases domain part only.
 * 2. Preserves local-part case and content (does NOT strip Gmail dots, does NOT remove plus aliases).
 * 3. Normalization is NOT verification (valid syntax returns ContactStatus.FOUND, never VERIFIED).
 * 4. Malformed email returns ContactStatus.INVALID_FORMAT with normalizedValue = null.
 */

import { ContactStatus } from '@leadmate/shared';

export interface EmailNormalizationResult {
  rawValue: string;
  normalizedValue: string | null;
  status: ContactStatus;
  isValid: boolean;
  localPart: string | null;
  domain: string | null;
  error: string | null;
}

// Conservative business-email local-part regex
const LOCAL_PART_REGEX = /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

// Domain label regex: alphanumeric, can contain hyphens in middle, 1-63 chars
const DOMAIN_LABEL_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

// TLD regex: at least 2 alphabetical characters
const TLD_REGEX = /^[a-zA-Z]{2,63}$/;

/**
 * Normalizes an email address.
 *
 * @param input - Raw email string (e.g. ' Contact@Example.COM ')
 * @returns Structured email normalization result
 *
 * @example
 * normalizeEmail(' User@Example.COM ') // normalizedValue: 'User@example.com', status: 'FOUND'
 * normalizeEmail('user.name+tag@gmail.com') // normalizedValue: 'user.name+tag@gmail.com' (dots & tag preserved)
 */
export function normalizeEmail(input: string): EmailNormalizationResult {
  const rawValue = typeof input === 'string' ? input : '';
  const trimmed = rawValue.trim();

  // 1. Check for empty string or internal whitespace
  if (!trimmed) {
    return {
      rawValue,
      normalizedValue: null,
      status: ContactStatus.INVALID_FORMAT,
      isValid: false,
      localPart: null,
      domain: null,
      error: 'Empty email address'
    };
  }

  if (/\s/.test(trimmed)) {
    return {
      rawValue,
      normalizedValue: null,
      status: ContactStatus.INVALID_FORMAT,
      isValid: false,
      localPart: null,
      domain: null,
      error: 'Email address contains whitespace'
    };
  }

  // 2. Split into local-part and domain
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return {
      rawValue,
      normalizedValue: null,
      status: ContactStatus.INVALID_FORMAT,
      isValid: false,
      localPart: null,
      domain: null,
      error: 'Missing or misplaced @ symbol'
    };
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);

  // 3. Validate local-part (max 64 chars, valid format, no leading/trailing/consecutive dots)
  if (localPart.length > 64 || !LOCAL_PART_REGEX.test(localPart)) {
    return {
      rawValue,
      normalizedValue: null,
      status: ContactStatus.INVALID_FORMAT,
      isValid: false,
      localPart: null,
      domain: null,
      error: 'Invalid email local-part syntax'
    };
  }

  // 4. Validate domain (max 255 chars, must have labels and valid TLD)
  if (domainPart.length > 255) {
    return {
      rawValue,
      normalizedValue: null,
      status: ContactStatus.INVALID_FORMAT,
      isValid: false,
      localPart: null,
      domain: null,
      error: 'Domain name is too long'
    };
  }

  const domainLabels = domainPart.split('.');
  if (domainLabels.length < 2) {
    return {
      rawValue,
      normalizedValue: null,
      status: ContactStatus.INVALID_FORMAT,
      isValid: false,
      localPart: null,
      domain: null,
      error: 'Domain must contain at least one dot separating labels and TLD'
    };
  }

  for (const label of domainLabels) {
    if (!DOMAIN_LABEL_REGEX.test(label)) {
      return {
        rawValue,
        normalizedValue: null,
        status: ContactStatus.INVALID_FORMAT,
        isValid: false,
        localPart: null,
        domain: null,
        error: `Invalid domain label syntax: "${label}"`
      };
    }
  }

  const tld = domainLabels[domainLabels.length - 1];
  if (!TLD_REGEX.test(tld)) {
    return {
      rawValue,
      normalizedValue: null,
      status: ContactStatus.INVALID_FORMAT,
      isValid: false,
      localPart: null,
      domain: null,
      error: `Invalid top-level domain (TLD): "${tld}"`
    };
  }

  // 5. Construct canonical email (preserve localPart case & dots/tags, lowercase domain)
  const canonicalDomain = domainPart.toLowerCase();
  const normalizedValue = `${localPart}@${canonicalDomain}`;

  return {
    rawValue,
    normalizedValue,
    status: ContactStatus.FOUND, // Normalization is NOT verification
    isValid: true,
    localPart,
    domain: canonicalDomain,
    error: null
  };
}
