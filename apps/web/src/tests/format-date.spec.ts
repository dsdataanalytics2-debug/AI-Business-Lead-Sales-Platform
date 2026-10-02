import { describe, it, expect } from 'vitest';
import { formatDate } from '../lib/format-date.js';

describe('Format Date Utility (Pure Unit Tests)', () => {
  it('1. should format ISO date string in Asia/Dhaka timezone', () => {
    // 2026-10-02T06:00:00.000Z is 12:00 PM in Dhaka (UTC+6)
    const formatted = formatDate('2026-10-02T06:00:00.000Z');
    expect(formatted).toContain('2026');
    expect(formatted).toContain('Oct');
    expect(formatted).toContain('12:00');
  });

  it('2. should format JavaScript Date instance correctly', () => {
    const d = new Date('2026-05-15T04:30:00.000Z');
    const formatted = formatDate(d);
    expect(formatted).toContain('May');
    expect(formatted).toContain('15');
    expect(formatted).toContain('2026');
  });

  it('3. should return "—" for invalid date strings', () => {
    expect(formatDate('invalid-date-string')).toBe('—');
    expect(formatDate('2026-99-99T99:99:99Z')).toBe('—');
  });

  it('4. should return "—" for null, undefined, or empty values', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('5. should support custom formatting options while preserving Asia/Dhaka default', () => {
    const formatted = formatDate('2026-10-02T06:00:00.000Z', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    expect(formatted).toBe('October 2, 2026');
  });
});
