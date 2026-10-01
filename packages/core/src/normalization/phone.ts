/**
 * Bangladesh Phone Normalization Utility
 *
 * Implements strict, deterministic normalization for Bangladesh mobile and landline numbers.
 * Converts Bengali and ASCII representations to canonical E.164-style (+8801XXXXXXXXX) and display formats.
 *
 * ACCEPTED PHONE FORMS (and Bengali equivalents):
 * 1. 01XXXXXXXXX (11 digits local)
 * 2. 8801XXXXXXXXX (13 digits with country code)
 * 3. +8801XXXXXXXXX (14 characters E.164)
 * 4. Conservative Dhaka landlines: 02XXXXXXX(X), 8802XXXXXXX(X), +8802XXXXXXX(X)
 *
 * EXPLICITLY REJECTED:
 * - 00880... prefixes
 * - Invalid operator prefixes (010, 011, 012)
 * - Foreign country codes (+1, +44, +91, etc.)
 * - Alphabetic corruption (never silently stripped)
 * - Too short / too long numbers
 */

import { PhoneType, ContactStatus } from '@leadmate/shared';
import { normalizeBengaliDigits } from './bengali-digits.js';

export interface PhoneNormalizationResult {
  rawValue: string;
  normalizedValue: string | null;
  displayValue: string | null;
  phoneType: PhoneType;
  status: ContactStatus;
  isValid: boolean;
  countryCode: string | null;
  operatorPrefix: string | null;
  error: string | null;
}

// Regex matching allowed separator/formatting characters (spaces, hyphens, dashes, dots, parens, slashes, plus)
const ALLOWED_CHARS_REGEX = /^[\s\d০-৯+\-–—()./]+$/;

// Valid Bangladesh Mobile local form: exactly 11 digits starting with 013, 014, 015, 016, 017, 018, 019
const BD_MOBILE_LOCAL_REGEX = /^01[3-9]\d{8}$/;

// Conservative Bangladesh Dhaka Landline local form: 02 followed by 7 or 8 digits (total 9-10 digits)
const BD_DHAKA_LANDLINE_LOCAL_REGEX = /^02\d{7,8}$/;

/**
 * Normalizes an input string to a validated Bangladesh phone record.
 *
 * @param input - Raw phone string (e.g. '01712345678', '+880 1712-345678', '8801712345678', '০১৭১২৩৪৫৬৭৮')
 * @returns Structured normalization result with canonical and display representations.
 */
export function normalizePhone(input: string): PhoneNormalizationResult {
  const rawValue = typeof input === 'string' ? input : '';
  const trimmed = rawValue.trim();

  // 1. Check for empty input
  if (!trimmed) {
    return {
      rawValue,
      normalizedValue: null,
      displayValue: null,
      phoneType: PhoneType.UNKNOWN,
      status: ContactStatus.INVALID_FORMAT,
      isValid: false,
      countryCode: null,
      operatorPrefix: null,
      error: 'Empty phone number'
    };
  }

  // 2. Reject inputs with illegal characters (e.g. letters, symbols like @, $, etc.)
  if (!ALLOWED_CHARS_REGEX.test(trimmed)) {
    return {
      rawValue,
      normalizedValue: null,
      displayValue: null,
      phoneType: PhoneType.UNKNOWN,
      status: ContactStatus.INVALID_FORMAT,
      isValid: false,
      countryCode: null,
      operatorPrefix: null,
      error: 'Contains illegal characters or alphabetic corruption'
    };
  }

  // 3. Normalize Bengali digits to ASCII
  const asciiInput = normalizeBengaliDigits(trimmed);

  // 4. Strip allowed formatting characters (spaces, hyphens, dashes, dots, parens, slashes)
  const cleanString = asciiInput.replace(/[\s\-–—()./]/g, '');

  // 5. Convert accepted prefix formats to canonical local representation:
  // Accepted:
  // - "+8801..." -> "01..."
  // - "8801..."  -> "01..."
  // - "01..."    -> "01..."
  // - "+8802..." -> "02..."
  // - "8802..."  -> "02..."
  // - "02..."    -> "02..."
  // (Note: 00880, +88, or other prefixes are strictly NOT supported)
  let localDigits: string | null = null;

  if (cleanString.startsWith('+8801') && cleanString.length === 14) {
    localDigits = '0' + cleanString.slice(4);
  } else if (cleanString.startsWith('8801') && cleanString.length === 13) {
    localDigits = '0' + cleanString.slice(3);
  } else if (cleanString.startsWith('01') && cleanString.length === 11) {
    localDigits = cleanString;
  } else if (cleanString.startsWith('+8802') && (cleanString.length === 12 || cleanString.length === 13)) {
    localDigits = '0' + cleanString.slice(4);
  } else if (cleanString.startsWith('8802') && (cleanString.length === 11 || cleanString.length === 12)) {
    localDigits = '0' + cleanString.slice(3);
  } else if (cleanString.startsWith('02') && (cleanString.length === 9 || cleanString.length === 10)) {
    localDigits = cleanString;
  }

  // 6. If local form was recognized, validate against strict patterns
  if (localDigits) {
    // Check mobile
    if (BD_MOBILE_LOCAL_REGEX.test(localDigits)) {
      const operatorPrefix = localDigits.substring(0, 3);
      const canonical = '+880' + localDigits.substring(1);

      return {
        rawValue,
        normalizedValue: canonical,
        displayValue: localDigits,
        phoneType: PhoneType.MOBILE,
        status: ContactStatus.FOUND, // NEVER set to VERIFIED on syntax alone
        isValid: true,
        countryCode: 'BD',
        operatorPrefix,
        error: null
      };
    }

    // Check Dhaka landline
    if (BD_DHAKA_LANDLINE_LOCAL_REGEX.test(localDigits)) {
      const canonical = '+880' + localDigits.substring(1);

      return {
        rawValue,
        normalizedValue: canonical,
        displayValue: localDigits,
        phoneType: PhoneType.LANDLINE,
        status: ContactStatus.FOUND, // NEVER set to VERIFIED on syntax alone
        isValid: true,
        countryCode: 'BD',
        operatorPrefix: '02',
        error: null
      };
    }
  }

  // 7. Determine descriptive error for invalid input
  let specificError = 'Invalid Bangladesh phone number format';
  if (cleanString.startsWith('00880')) {
    specificError = 'Unsupported 00880 prefix (use +8801, 8801, or 01)';
  } else if (cleanString.startsWith('+') && !cleanString.startsWith('+880')) {
    specificError = 'Unsupported international country code';
  } else if (cleanString.startsWith('011') || cleanString.startsWith('012') || cleanString.startsWith('010') ||
             cleanString.startsWith('+88011') || cleanString.startsWith('+88012') || cleanString.startsWith('+88010') ||
             cleanString.startsWith('88011') || cleanString.startsWith('88012') || cleanString.startsWith('88010')) {
    specificError = 'Invalid mobile operator prefix';
  } else if (cleanString.length < 9) {
    specificError = 'Phone number is too short';
  } else if (cleanString.length > 14) {
    specificError = 'Phone number is too long';
  }

  return {
    rawValue,
    normalizedValue: null,
    displayValue: null,
    phoneType: PhoneType.UNKNOWN,
    status: ContactStatus.INVALID_FORMAT,
    isValid: false,
    countryCode: null,
    operatorPrefix: null,
    error: specificError
  };
}
