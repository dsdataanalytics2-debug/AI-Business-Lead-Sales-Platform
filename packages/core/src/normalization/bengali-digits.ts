/**
 * Bengali Digit Normalization Utility
 *
 * Converts Bengali numerical digits (০-৯) to standard ASCII Arabic numerals (0-9).
 * Preserves all non-digit and non-Bengali characters unchanged.
 */

const BENGALI_TO_ASCII_MAP: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9'
};

const BENGALI_DIGITS_REGEX = /[০-৯]/g;

/**
 * Normalizes Bengali digits in a string to standard ASCII digits.
 *
 * @param input - Any input string containing Bengali digits or mixed digits
 * @returns String with all Bengali digits converted to ASCII numerals (0-9)
 *
 * @example
 * normalizeBengaliDigits('০১৭১২৩৪৫৬৭৮') // '01712345678'
 * normalizeBengaliDigits('+৮৮০ ১৭১২-৩৪৫৬৭৮') // '+880 1712-345678'
 * normalizeBengaliDigits('০১৭১234৫৬78') // '01712345678'
 */
export function normalizeBengaliDigits(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }
  return input.replace(BENGALI_DIGITS_REGEX, (char) => BENGALI_TO_ASCII_MAP[char] || char);
}
