/**
 * Wholesale Intent Detection Engine
 *
 * Implements deterministic evidence-based wholesale intent detection for commercial buyers.
 *
 * INVARIANTS:
 * - Evidence-backed ONLY: Evaluates concrete text from source evidences, verified categories, and query snippets.
 * - Strict Zero-Hallucination: If no explicit signal is found in evidence, returns level 'NONE'.
 * - Pure Function: Zero side-effects, zero network calls, zero LLMs.
 * - Never invent intent.
 */

import type { WholesaleIntentLevel, WholesaleIntentEvidence, SourceEvidence } from '@leadmate/shared';

export interface WholesaleIntentInput {
  businessName?: string | null;
  category?: string | null;
  matchedBuyerCategory?: string | null;
  sourceEvidences?: Array<Partial<SourceEvidence>> | null;
  sourceData?: any;
}

export interface WholesaleIntentResult {
  level: WholesaleIntentLevel;
  signals: string[];
  matchedSnippets: string[];
  evaluatedAt: Date;
}

// Explicit High-Priority Intent Keywords & Patterns
const HIGH_INTENT_PATTERNS: Array<{ pattern: RegExp; signal: string }> = [
  { pattern: /\b(?:rfq|request for quotation|request for quote)\b/i, signal: 'RFQ' },
  { pattern: /\b(?:procurement|public buying request|tender)\b/i, signal: 'procurement' },
  { pattern: /\bwholesale\s+price\b/i, signal: 'wholesale price' },
  { pattern: /\bbulk\s+price\b/i, signal: 'bulk price' },
  { pattern: /\bdealer\s+inquiry\b/i, signal: 'dealer inquiry' },
  { pattern: /\bdistributor\s+wanted\b/i, signal: 'distributor wanted' },
  { pattern: /\bsupplier\s+wanted\b/i, signal: 'supplier wanted' },
  { pattern: /\blooking\s+for\s+(?:supplier|distributor|dealer|manufacturer)\b/i, signal: 'supplier wanted' },
  { pattern: /\b(?:b2b\s+buying|commercial\s+buyer)\b/i, signal: 'public buying request' }
];

// Medium-Priority Intent Keywords & Patterns (reseller / trade indicators)
const MEDIUM_INTENT_PATTERNS: Array<{ pattern: RegExp; signal: string }> = [
  { pattern: /\breseller\s+wanted\b/i, signal: 'reseller wanted' },
  { pattern: /\bstock\s+inquiry\b/i, signal: 'stock inquiry' },
  { pattern: /\b(?:wholesaler|wholesale\s+store|wholesale\s+distributor)\b/i, signal: 'wholesaler' },
  { pattern: /\b(?:authorized\s+distributor|dealer\s+network)\b/i, signal: 'distributor' },
  { pattern: /\b(?:b2b\s+supplier|bulk\s+orders?)\b/i, signal: 'bulk order' },
  { pattern: /\b(?:importer\s+and\s+distributor|trade\s+importer)\b/i, signal: 'trade importer' }
];

// Low-Priority Intent Keywords (broad commercial trade mention)
const LOW_INTENT_PATTERNS: Array<{ pattern: RegExp; signal: string }> = [
  { pattern: /\b(?:commercial\s+trade|traders?|general\s+trading)\b/i, signal: 'commercial trade' },
  { pattern: /\b(?:reseller|retailer\s+and\s+wholesaler)\b/i, signal: 'reseller' }
];

/**
 * Extracts searchable text blocks from evidence objects.
 */
function extractEvidenceText(input: WholesaleIntentInput): string[] {
  const blocks: string[] = [];

  // Check sourceEvidences snippets, sourceNames, and evidenceTypes
  if (Array.isArray(input.sourceEvidences)) {
    for (const ev of input.sourceEvidences) {
      if (ev.snippet) blocks.push(ev.snippet);
      if (ev.sourceName) blocks.push(ev.sourceName);
      if (ev.evidenceType) {
        if (ev.evidenceType === 'PUBLIC_RFQ') {
          blocks.push('Public RFQ procurement tender');
        } else {
          blocks.push(ev.evidenceType);
        }
      }
    }
  }

  // Check sourceData fields (e.g. description, notes, categories)
  if (input.sourceData && typeof input.sourceData === 'object') {
    if (typeof input.sourceData.description === 'string') {
      blocks.push(input.sourceData.description);
    }
    if (typeof input.sourceData.rfqTitle === 'string') {
      blocks.push(input.sourceData.rfqTitle);
    }
    if (typeof input.sourceData.type === 'string') {
      blocks.push(input.sourceData.type);
    }
  }

  // Include category and matchedBuyerCategory
  if (input.category) blocks.push(input.category);
  if (input.matchedBuyerCategory) blocks.push(input.matchedBuyerCategory);

  return blocks.filter(Boolean);
}

/**
 * Detects wholesale buying intent strictly from provided evidence.
 */
export function detectWholesaleIntent(input: WholesaleIntentInput): WholesaleIntentResult {
  const evidenceBlocks = extractEvidenceText(input);
  const now = new Date();

  // If zero evidence text exists, return NONE immediately
  if (evidenceBlocks.length === 0) {
    return {
      level: 'NONE',
      signals: [],
      matchedSnippets: [],
      evaluatedAt: now
    };
  }

  const combinedText = evidenceBlocks.join(' | ');

  const matchedHigh: Array<{ signal: string; snippet: string }> = [];
  for (const item of HIGH_INTENT_PATTERNS) {
    const match = item.pattern.exec(combinedText);
    if (match) {
      matchedHigh.push({
        signal: item.signal,
        snippet: match[0]
      });
    }
  }

  if (matchedHigh.length > 0) {
    return {
      level: 'HIGH',
      signals: Array.from(new Set(matchedHigh.map((m) => m.signal))),
      matchedSnippets: Array.from(new Set(matchedHigh.map((m) => m.snippet))),
      evaluatedAt: now
    };
  }

  const matchedMedium: Array<{ signal: string; snippet: string }> = [];
  for (const item of MEDIUM_INTENT_PATTERNS) {
    const match = item.pattern.exec(combinedText);
    if (match) {
      matchedMedium.push({
        signal: item.signal,
        snippet: match[0]
      });
    }
  }

  if (matchedMedium.length > 0) {
    return {
      level: 'MEDIUM',
      signals: Array.from(new Set(matchedMedium.map((m) => m.signal))),
      matchedSnippets: Array.from(new Set(matchedMedium.map((m) => m.snippet))),
      evaluatedAt: now
    };
  }

  const matchedLow: Array<{ signal: string; snippet: string }> = [];
  for (const item of LOW_INTENT_PATTERNS) {
    const match = item.pattern.exec(combinedText);
    if (match) {
      matchedLow.push({
        signal: item.signal,
        snippet: match[0]
      });
    }
  }

  if (matchedLow.length > 0) {
    return {
      level: 'LOW',
      signals: Array.from(new Set(matchedLow.map((m) => m.signal))),
      matchedSnippets: Array.from(new Set(matchedLow.map((m) => m.snippet))),
      evaluatedAt: now
    };
  }

  // Strict: No evidence matched
  return {
    level: 'NONE',
    signals: [],
    matchedSnippets: [],
    evaluatedAt: now
  };
}
