import { DashboardDatePreset, type DashboardFilterQuery } from '@leadmate/shared';

/**
 * Calculates timezone offset in milliseconds for a specific UTC date and IANA timezone.
 */
export function getTzOffsetMs(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    }).formatToParts(date);

    const p: Record<string, string> = {};
    for (const part of parts) {
      p[part.type] = part.value;
    }

    const year = parseInt(p.year, 10);
    const month = parseInt(p.month, 10);
    const day = parseInt(p.day, 10);
    const hour = p.hour === '24' ? 0 : parseInt(p.hour, 10);
    const minute = parseInt(p.minute, 10);
    const second = parseInt(p.second, 10);

    const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    return asUtc - date.getTime();
  } catch {
    // Fallback to UTC if timezone is invalid
    return 0;
  }
}

/**
 * Converts a zoned calendar date-time (year, month, day, hour, minute, second)
 * in the specified IANA timezone to an exact UTC Date object.
 * Correctly accounts for Daylight Saving Time (DST) shifts.
 */
export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = new Date(targetLocalMs);
  let offset = getTzOffsetMs(guess, timeZone);
  const utcMs = targetLocalMs - offset;
  // Second pass handles DST boundary jumps
  offset = getTzOffsetMs(new Date(utcMs), timeZone);
  return new Date(targetLocalMs - offset);
}

/**
 * Returns the exact UTC start of day (00:00:00.000) and next day start (00:00:00.000)
 * for a reference timestamp within an organization's authoritative IANA timezone.
 */
export function getCalendarDayUtcBounds(
  date: Date,
  timeZone: string
): { startOfDayUtc: Date; nextDayStartUtc: Date } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour12: false
    }).formatToParts(date);

    const p: Record<string, string> = {};
    for (const part of parts) {
      p[part.type] = part.value;
    }

    const year = parseInt(p.year, 10);
    const month = parseInt(p.month, 10);
    const day = parseInt(p.day, 10);

    const startOfDayUtc = zonedDateTimeToUtc(year, month, day, 0, 0, 0, timeZone);
    // Next day start
    const nextDayStartUtc = zonedDateTimeToUtc(year, month, day + 1, 0, 0, 0, timeZone);

    return { startOfDayUtc, nextDayStartUtc };
  } catch {
    // Safe UTC fallback
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
    const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { startOfDayUtc: start, nextDayStartUtc: next };
  }
}

/**
 * Resolves query filter preset or custom date range into deterministic UTC Date boundaries.
 * Injected `now` parameter allows reproducible, deterministic testing.
 */
export function resolveDashboardRange(
  query: Pick<DashboardFilterQuery, 'preset' | 'from' | 'to'>,
  _timeZone: string,
  now: Date = new Date()
): { from: Date; to: Date; preset: DashboardDatePreset } {
  const preset = query.preset ?? DashboardDatePreset.DAYS_30;

  if (preset === DashboardDatePreset.CUSTOM) {
    if (!query.from || !query.to) {
      throw new Error('Custom preset requires both from and to timestamps');
    }
    return {
      from: new Date(query.from),
      to: new Date(query.to),
      preset: DashboardDatePreset.CUSTOM
    };
  }

  const nowMs = now.getTime();
  let days = 30;
  if (preset === DashboardDatePreset.DAYS_7) {
    days = 7;
  } else if (preset === DashboardDatePreset.DAYS_90) {
    days = 90;
  }

  const from = new Date(nowMs - days * 24 * 60 * 60 * 1000);
  const to = new Date(nowMs);

  return { from, to, preset };
}

/**
 * Deterministic rate percentage calculation.
 * Returns finite number between 0 and 100 rounded to 2 decimal places.
 * Safely yields 0 on zero denominator or non-finite inputs.
 */
export function calculateRate(numerator: number, denominator: number): number {
  if (denominator <= 0 || !Number.isFinite(denominator) || !Number.isFinite(numerator) || numerator <= 0) {
    return 0;
  }
  const rate = (numerator / denominator) * 100;
  const clamped = Math.max(0, Math.min(100, rate));
  return Math.round(clamped * 100) / 100;
}
