import { describe, it, expect } from 'vitest';
import {
  getSubAreasForMarket,
  serializeCoordinate,
  planSearchCombinations
} from '../discovery/deep-coverage.js';

describe('Deep Coverage Engine', () => {
  describe('getSubAreasForMarket', () => {
    it('returns known sub-areas for Dhaka', () => {
      const areas = getSubAreasForMarket('Dhaka');
      expect(areas).toContain('Mirpur');
      expect(areas).toContain('Uttara');
      expect(areas).toContain('Gulshan');
      expect(areas).toContain('Dhanmondi');
    });

    it('returns known sub-areas for Chattogram', () => {
      const areas = getSubAreasForMarket('Chattogram');
      expect(areas).toContain('Agrabad');
      expect(areas).toContain('GEC');
    });

    it('parses comma-delimited custom sub-areas for generic markets', () => {
      const areas = getSubAreasForMarket('Downtown, Uptown, Suburb');
      expect(areas).toEqual(['Downtown', 'Uptown', 'Suburb']);
    });

    it('returns empty array for unknown single markets without throwing', () => {
      const areas = getSubAreasForMarket('Mymensingh');
      expect(areas).toEqual([]);
    });
  });

  describe('serializeCoordinate', () => {
    it('normalizes coordinate strings consistently', () => {
      const key1 = serializeCoordinate('Lighting Store ', ' Dhaka', 'GOOGLE_PLACES');
      const key2 = serializeCoordinate('lighting store', 'dhaka', 'google_places');
      expect(key1).toBe('lighting store::dhaka::google_places');
      expect(key1).toBe(key2);
    });
  });

  describe('planSearchCombinations', () => {
    it('prioritizes primary targets in base market first', () => {
      const plan = planSearchCombinations({
        primaryTargets: ['Lighting Store', 'Home Decor Store'],
        secondaryTargets: ['Furniture Store', 'Gift Shop'],
        baseMarket: 'Dhaka',
        provider: 'GOOGLE_PLACES',
        searchedCombinations: new Set(),
        maxCombinations: 2
      });

      expect(plan).toHaveLength(2);
      expect(plan[0].target).toBe('Lighting Store');
      expect(plan[0].location).toBe('Dhaka');
      expect(plan[0].tier).toBe('PRIMARY_BASE');

      expect(plan[1].target).toBe('Home Decor Store');
      expect(plan[1].location).toBe('Dhaka');
      expect(plan[1].tier).toBe('PRIMARY_BASE');
    });

    it('progresses to sub-areas and secondary targets when base combinations are already searched', () => {
      const searched = new Set([
        serializeCoordinate('Lighting Store', 'Dhaka', 'GOOGLE_PLACES'),
        serializeCoordinate('Home Decor Store', 'Dhaka', 'GOOGLE_PLACES')
      ]);

      const plan = planSearchCombinations({
        primaryTargets: ['Lighting Store', 'Home Decor Store'],
        secondaryTargets: ['Furniture Store'],
        baseMarket: 'Dhaka',
        provider: 'GOOGLE_PLACES',
        searchedCombinations: searched,
        maxCombinations: 3
      });

      expect(plan).toHaveLength(3);
      // Next should be Primary x Sub-areas
      expect(plan[0].target).toBe('Lighting Store');
      expect(plan[0].location).toBe('Mirpur');
      expect(plan[0].tier).toBe('PRIMARY_SUBAREA');

      expect(plan[1].target).toBe('Lighting Store');
      expect(plan[1].location).toBe('Uttara');
      expect(plan[1].tier).toBe('PRIMARY_SUBAREA');

      expect(plan[2].target).toBe('Lighting Store');
      expect(plan[2].location).toBe('Gulshan');
      expect(plan[2].tier).toBe('PRIMARY_SUBAREA');
    });

    it('enforces maximum combinations limit of 2–3', () => {
      const plan = planSearchCombinations({
        primaryTargets: ['T1', 'T2', 'T3', 'T4'],
        baseMarket: 'Dhaka',
        provider: 'OPENSTREETMAP',
        searchedCombinations: new Set(),
        maxCombinations: 3
      });

      expect(plan.length).toBeLessThanOrEqual(3);
    });
  });
});
