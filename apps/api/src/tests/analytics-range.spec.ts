import { describe, it, expect } from 'vitest';
import { DashboardDatePreset } from '@leadmate/shared';
import {
  calculateRate,
  getCalendarDayUtcBounds,
  resolveDashboardRange,
  getTzOffsetMs,
  zonedDateTimeToUtc
} from '../lib/analytics-range.js';

describe('M7 Step 4: Analytics Range & Timezone Pure Helpers', () => {
  describe('calculateRate', () => {
    it('returns 0 when denominator is 0', () => {
      expect(calculateRate(5, 0)).toBe(0);
      expect(calculateRate(0, 0)).toBe(0);
    });

    it('returns 0 on negative, NaN, or non-finite inputs', () => {
      expect(calculateRate(-5, 10)).toBe(0);
      expect(calculateRate(5, -10)).toBe(0);
      expect(calculateRate(NaN, 10)).toBe(0);
      expect(calculateRate(5, Infinity)).toBe(0);
    });

    it('calculates exact integer percentages', () => {
      expect(calculateRate(3, 4)).toBe(75);
      expect(calculateRate(10, 10)).toBe(100);
      expect(calculateRate(1, 2)).toBe(50);
      expect(calculateRate(0, 10)).toBe(0);
    });

    it('rounds non-terminating decimals to exactly 2 decimal places', () => {
      expect(calculateRate(1, 3)).toBe(33.33);
      expect(calculateRate(2, 3)).toBe(66.67);
      expect(calculateRate(1, 6)).toBe(16.67);
      expect(calculateRate(1, 7)).toBe(14.29);
    });

    it('clamps rate at 100', () => {
      expect(calculateRate(15, 10)).toBe(100);
    });
  });

  describe('zonedDateTimeToUtc & getTzOffsetMs', () => {
    it('accurately computes UTC offset for Asia/Dhaka (+06:00)', () => {
      const d = new Date('2026-10-08T12:00:00.000Z');
      const offsetMs = getTzOffsetMs(d, 'Asia/Dhaka');
      expect(offsetMs).toBe(6 * 60 * 60 * 1000); // exactly +6h
    });

    it('handles DST in America/New_York (summer UTC-4 vs winter UTC-5)', () => {
      const summer = new Date('2026-07-15T12:00:00.000Z');
      const winter = new Date('2026-01-15T12:00:00.000Z');

      expect(getTzOffsetMs(summer, 'America/New_York')).toBe(-4 * 60 * 60 * 1000);
      expect(getTzOffsetMs(winter, 'America/New_York')).toBe(-5 * 60 * 60 * 1000);
    });

    it('creates exact UTC Date for zoned date-time', () => {
      const dhakaNoon = zonedDateTimeToUtc(2026, 10, 8, 12, 0, 0, 'Asia/Dhaka');
      expect(dhakaNoon.toISOString()).toBe('2026-10-08T06:00:00.000Z');

      const nySummerNoon = zonedDateTimeToUtc(2026, 7, 15, 12, 0, 0, 'America/New_York');
      expect(nySummerNoon.toISOString()).toBe('2026-07-15T16:00:00.000Z');
    });
  });

  describe('getCalendarDayUtcBounds', () => {
    it('returns exact UTC start of day and next day start for Asia/Dhaka', () => {
      // 2026-10-08 at 15:00 UTC = 21:00 in Dhaka (same calendar day)
      const ref = new Date('2026-10-08T15:00:00.000Z');
      const bounds = getCalendarDayUtcBounds(ref, 'Asia/Dhaka');

      expect(bounds.startOfDayUtc.toISOString()).toBe('2026-10-07T18:00:00.000Z');
      expect(bounds.nextDayStartUtc.toISOString()).toBe('2026-10-08T18:00:00.000Z');
    });

    it('handles cross-midnight boundary for early UTC hours in positive timezone', () => {
      // 2026-10-08 at 02:00 UTC = 08:00 in Dhaka on 2026-10-08
      const ref = new Date('2026-10-08T02:00:00.000Z');
      const bounds = getCalendarDayUtcBounds(ref, 'Asia/Dhaka');

      expect(bounds.startOfDayUtc.toISOString()).toBe('2026-10-07T18:00:00.000Z');
      expect(bounds.nextDayStartUtc.toISOString()).toBe('2026-10-08T18:00:00.000Z');
    });

    it('returns exact UTC bounds for America/New_York across summer and winter', () => {
      const summerRef = new Date('2026-07-15T16:00:00.000Z'); // 12:00 EDT
      const summerBounds = getCalendarDayUtcBounds(summerRef, 'America/New_York');
      expect(summerBounds.startOfDayUtc.toISOString()).toBe('2026-07-15T04:00:00.000Z');
      expect(summerBounds.nextDayStartUtc.toISOString()).toBe('2026-07-16T04:00:00.000Z');

      const winterRef = new Date('2026-01-15T17:00:00.000Z'); // 12:00 EST
      const winterBounds = getCalendarDayUtcBounds(winterRef, 'America/New_York');
      expect(winterBounds.startOfDayUtc.toISOString()).toBe('2026-01-15T05:00:00.000Z');
      expect(winterBounds.nextDayStartUtc.toISOString()).toBe('2026-01-16T05:00:00.000Z');
    });

    it('safely handles UTC timezone', () => {
      const ref = new Date('2026-10-08T12:34:56.000Z');
      const bounds = getCalendarDayUtcBounds(ref, 'UTC');

      expect(bounds.startOfDayUtc.toISOString()).toBe('2026-10-08T00:00:00.000Z');
      expect(bounds.nextDayStartUtc.toISOString()).toBe('2026-10-09T00:00:00.000Z');
    });
  });

  describe('resolveDashboardRange', () => {
    const fixedNow = new Date('2026-10-08T12:00:00.000Z');

    it('resolves 7d preset', () => {
      const range = resolveDashboardRange({ preset: DashboardDatePreset.DAYS_7 }, 'Asia/Dhaka', fixedNow);
      expect(range.preset).toBe(DashboardDatePreset.DAYS_7);
      expect(range.to.getTime()).toBe(fixedNow.getTime());
      expect(range.from.getTime()).toBe(fixedNow.getTime() - 7 * 24 * 60 * 60 * 1000);
    });

    it('resolves 30d preset (default)', () => {
      const range = resolveDashboardRange({ preset: DashboardDatePreset.DAYS_30 }, 'Asia/Dhaka', fixedNow);
      expect(range.preset).toBe(DashboardDatePreset.DAYS_30);
      expect(range.to.getTime()).toBe(fixedNow.getTime());
      expect(range.from.getTime()).toBe(fixedNow.getTime() - 30 * 24 * 60 * 60 * 1000);
    });

    it('resolves 90d preset', () => {
      const range = resolveDashboardRange({ preset: DashboardDatePreset.DAYS_90 }, 'Asia/Dhaka', fixedNow);
      expect(range.preset).toBe(DashboardDatePreset.DAYS_90);
      expect(range.to.getTime()).toBe(fixedNow.getTime());
      expect(range.from.getTime()).toBe(fixedNow.getTime() - 90 * 24 * 60 * 60 * 1000);
    });

    it('resolves custom preset with validated from and to', () => {
      const range = resolveDashboardRange(
        {
          preset: DashboardDatePreset.CUSTOM,
          from: '2026-09-01T00:00:00.000Z',
          to: '2026-09-15T23:59:59.999Z'
        },
        'Asia/Dhaka',
        fixedNow
      );

      expect(range.preset).toBe(DashboardDatePreset.CUSTOM);
      expect(range.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(range.to.toISOString()).toBe('2026-09-15T23:59:59.999Z');
    });

    it('throws if custom preset lacks from or to', () => {
      expect(() =>
        resolveDashboardRange({ preset: DashboardDatePreset.CUSTOM, from: '2026-09-01T00:00:00.000Z' }, 'Asia/Dhaka', fixedNow)
      ).toThrow(/requires both from and to/);
    });
  });
});
