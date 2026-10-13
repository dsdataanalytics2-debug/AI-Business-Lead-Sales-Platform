/**
 * Deep Coverage & Search Combination Engine
 *
 * Implements structured, multi-dimensional query expansion across:
 * - Primary vs. Secondary buyer categories
 * - Base markets and generic commercial sub-areas
 * - Search coordinate tracking (target + location + provider)
 *
 * INVARIANTS:
 * - Pure functions: Zero I/O, zero network calls.
 * - Bounded: Limits each planning run to at most 2–3 NEW combinations.
 * - Zero redundant searches: Checks previously searched coordinates before queuing.
 * - Generic: Not Dhaka-only; supports regional hubs and flexible market inputs.
 */

export interface SearchCombination {
  target: string;
  location: string;
  provider: string;
  tier: 'PRIMARY_BASE' | 'PRIMARY_SUBAREA' | 'SECONDARY_BASE' | 'SECONDARY_SUBAREA';
  coordinateKey: string;
}

export interface PlanCombinationsParams {
  primaryTargets: string[];
  secondaryTargets?: string[];
  baseMarket: string;
  subAreas?: string[];
  provider: string;
  searchedCombinations: Set<string> | string[];
  maxCombinations?: number; // Defaults to 3
}

/**
 * Known commercial sub-areas for regional hubs.
 * Keys are normalized lowercase.
 */
const KNOWN_MARKET_SUB_AREAS: Record<string, string[]> = {
  dhaka: ['Mirpur', 'Uttara', 'Gulshan', 'Dhanmondi', 'Mohammadpur', 'Old Dhaka', 'Banani', 'Badda'],
  chattogram: ['Agrabad', 'Nasirabad', 'Panchlaish', 'GEC', 'Halishahar'],
  chittagong: ['Agrabad', 'Nasirabad', 'Panchlaish', 'GEC', 'Halishahar'],
  sylhet: ['Zindabazar', 'Amberkhana', 'Shibgonj', 'Upashahar'],
  rajshahi: ['Saheb Bazar', 'Motihar', 'Boalia'],
  khulna: ['Daulatpur', 'Khalishpur', 'Sonadanga'],
  gazipur: ['Tongi', 'Joydebpur', 'Chowrasta'],
  narayanganj: ['Chashara', 'Tanbazar', 'Fatullah']
};

/**
 * Returns relevant commercial sub-areas for a given market location.
 * Generic: returns predefined sub-areas if known, or parsed sub-regions if comma-separated.
 */
export function getSubAreasForMarket(market: string): string[] {
  if (!market) return [];
  const normalized = market.toLowerCase().trim();

  // Direct lookup
  for (const [key, areas] of Object.entries(KNOWN_MARKET_SUB_AREAS)) {
    if (normalized === key || normalized.includes(key)) {
      return [...areas];
    }
  }

  // If input contains multiple comma-separated locations, extract sub-tokens
  if (market.includes(',')) {
    const parts = market
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length > 1) {
      return parts;
    }
  }

  return [];
}

/**
 * Generates a canonical coordinate key for tracking.
 */
export function serializeCoordinate(
  target: string,
  location: string,
  provider: string
): string {
  return `${target.toLowerCase().trim()}::${location.toLowerCase().trim()}::${provider.toLowerCase().trim()}`;
}

/**
 * Plans the next best NEW search combinations.
 * Respects strict execution limit (max 2–3 new combinations) to avoid API fan-out.
 */
export function planSearchCombinations(
  params: PlanCombinationsParams
): SearchCombination[] {
  const {
    primaryTargets,
    secondaryTargets = [],
    baseMarket,
    provider,
    searchedCombinations,
    maxCombinations = 3
  } = params;

  const searchedSet =
    searchedCombinations instanceof Set
      ? searchedCombinations
      : new Set(searchedCombinations.map((k) => k.toLowerCase().trim()));

  const subAreas =
    params.subAreas && params.subAreas.length > 0
      ? params.subAreas
      : getSubAreasForMarket(baseMarket);

  const cleanPrimary = Array.from(new Set(primaryTargets.map((t) => t.trim()).filter(Boolean)));
  const cleanSecondary = Array.from(new Set(secondaryTargets.map((t) => t.trim()).filter(Boolean)));
  const cleanBase = baseMarket.trim();

  const candidateCombinations: SearchCombination[] = [];

  // Tier 1: Primary Targets x Base Market
  for (const target of cleanPrimary) {
    const coordKey = serializeCoordinate(target, cleanBase, provider);
    candidateCombinations.push({
      target,
      location: cleanBase,
      provider,
      tier: 'PRIMARY_BASE',
      coordinateKey: coordKey
    });
  }

  // Tier 2: Primary Targets x Sub-Areas
  for (const target of cleanPrimary) {
    for (const subArea of subAreas) {
      const coordKey = serializeCoordinate(target, subArea, provider);
      candidateCombinations.push({
        target,
        location: subArea,
        provider,
        tier: 'PRIMARY_SUBAREA',
        coordinateKey: coordKey
      });
    }
  }

  // Tier 3: Secondary Targets x Base Market
  for (const target of cleanSecondary) {
    const coordKey = serializeCoordinate(target, cleanBase, provider);
    candidateCombinations.push({
      target,
      location: cleanBase,
      provider,
      tier: 'SECONDARY_BASE',
      coordinateKey: coordKey
    });
  }

  // Tier 4: Secondary Targets x Sub-Areas
  for (const target of cleanSecondary) {
    for (const subArea of subAreas) {
      const coordKey = serializeCoordinate(target, subArea, provider);
      candidateCombinations.push({
        target,
        location: subArea,
        provider,
        tier: 'SECONDARY_SUBAREA',
        coordinateKey: coordKey
      });
    }
  }

  // Filter out already searched combinations
  const unsearched: SearchCombination[] = [];
  const seenInPlan = new Set<string>();

  for (const candidate of candidateCombinations) {
    if (searchedSet.has(candidate.coordinateKey)) {
      continue;
    }
    if (seenInPlan.has(candidate.coordinateKey)) {
      continue;
    }
    seenInPlan.add(candidate.coordinateKey);
    unsearched.push(candidate);

    if (unsearched.length >= maxCombinations) {
      break;
    }
  }

  return unsearched;
}
