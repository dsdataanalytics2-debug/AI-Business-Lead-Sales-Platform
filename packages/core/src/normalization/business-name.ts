/**
 * Business Name Normalization Utility
 *
 * Implements deterministic business-name normalization for candidate duplicate detection.
 *
 * RULES:
 * 1. Trim surrounding whitespace and lowercase.
 * 2. Convert Bengali numerical digits to standard ASCII.
 * 3. Collapse multiple whitespace characters, tabs, and newlines into a single space.
 * 4. Conservative: Does NOT strip meaningful words, does NOT guess transliterations, does NOT use fuzzy logic.
 */

import { normalizeBengaliDigits } from './bengali-digits.js';

/**
 * Normalizes a business name deterministically.
 *
 * @param name - Raw business name
 * @returns Clean, normalized name string for indexing and exact-match candidate lookup
 *
 * @example
 * normalizeBusinessName('  Mirpur   Dental Care  ') // 'mirpur dental care'
 * normalizeBusinessName('উত্তরা ব্রাঞ্চ ০১') // 'উত্তরা ব্রাঞ্চ 01'
 */
export function normalizeBusinessName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  // 1. Convert Bengali digits to ASCII
  const asciiDigits = normalizeBengaliDigits(name.trim());

  // 2. Lowercase and collapse repeated spaces
  return asciiDigits
    .toLowerCase()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
