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
  { pattern: /\b(?:rfq|request for quotation|request for quote|need\s+quotation|quotation\s+for\s+\d+)\b/i, signal: 'RFQ' },
  { pattern: /\b(?:procurement|public buying request|tender)\b/i, signal: 'procurement' },
  { pattern: /\bwholesale\s+(?:price|prices|pricing)\b/i, signal: 'wholesale price' },
  { pattern: /\bbulk\s+(?:price|prices|pricing)(?:\s+for\s+\d+(?:\s*(?:pcs|pieces|units|qty))?)?\b/i, signal: 'bulk price' },
  { pattern: /\b(?:dealer|dealership)\s+(?:pricing|price|inquiry|terms)\b/i, signal: 'dealer pricing' },
  { pattern: /\bdistributor\s+wanted\b/i, signal: 'distributor wanted' },
  { pattern: /\bsupplier\s+wanted\b/i, signal: 'supplier wanted' },
  { pattern: /\b(?:distributor\s*\/\s*supplier|supplier\s*\/\s*distributor)\b/i, signal: 'distributor/supplier wanted' },
  { pattern: /\b(?:looking\s+for|need|we\s+need)\s+(?:a\s+)?(?:supplier|distributor|dealer|manufacturer)\b/i, signal: 'supplier wanted' },
  { pattern: /\b(?:b2b\s+buying|commercial\s+buyer)\b/i, signal: 'public buying request' }
];

// Medium-Priority Intent Keywords & Patterns (reseller / trade indicators)
const MEDIUM_INTENT_PATTERNS: Array<{ pattern: RegExp; signal: string }> = [
  { pattern: /\b(?:moq|minimum\s+order\s+quantity)\b/i, signal: 'MOQ inquiry' },
  { pattern: /\bwholesale\s+catalog\b/i, signal: 'wholesale catalog' },
  { pattern: /\b(?:do\s+you\s+offer|offer|provide)\s+wholesale\b/i, signal: 'wholesale offer inquiry' },
  { pattern: /\breseller\s+wanted\b/i, signal: 'reseller wanted' },
  { pattern: /\b(?:stock|reseller)\s+inquiry\b/i, signal: 'stock inquiry' },
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

  const collectStrings = (obj: any, maxDepth = 4) => {
    if (!obj || maxDepth <= 0) return;
    if (typeof obj === 'string') {
      const trimmed = obj.trim();
      if (trimmed) blocks.push(trimmed);
      return;
    }
    if (typeof obj === 'number') {
      blocks.push(String(obj));
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        collectStrings(item, maxDepth - 1);
      }
      return;
    }
    if (typeof obj === 'object') {
      for (const val of Object.values(obj)) {
        collectStrings(val, maxDepth - 1);
      }
    }
  };

  // Check sourceEvidences snippets, sourceNames, notes, and metadata
  if (Array.isArray(input.sourceEvidences)) {
    for (const ev of input.sourceEvidences) {
      if (ev.snippet) blocks.push(ev.snippet);
      if (ev.sourceName) blocks.push(ev.sourceName);
      if ((ev as any).notes) blocks.push((ev as any).notes);
      if (ev.evidenceType === 'PUBLIC_RFQ') {
        blocks.push('Public RFQ procurement tender');
      }
      if ((ev as any).metadata) {
        collectStrings((ev as any).metadata);
      }
    }
  }

  // Check sourceData fields (e.g. description, notes, categories, inquiry, answers, requested quantity)
  if (input.sourceData && typeof input.sourceData === 'object') {
    collectStrings(input.sourceData);
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
