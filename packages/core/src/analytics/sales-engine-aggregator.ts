/**
 * Sales Engine Analytics Aggregator
 *
 * Pure deterministic domain logic for computing sales engine KPIs,
 * funnel stages, source effectiveness, and learning loop cohorts.
 *
 * Strictly adheres to:
 * 1. APPROVAL != CONTACTED (denominator must be actually contacted buyers)
 * 2. Multi-currency safety (never combine BDT, USD, etc.)
 * 3. Primary vs Assisted source attribution (no multi-crediting of WON)
 * 4. Strictly zero on zero-denominators
 */

import type {
  DashboardSalesKpisDto,
  ProductAnalyticsDto,
  SourceEffectivenessDto,
  LearningCohortObservation,
  CurrencyGroupedTotals,
  AnalyticsProviderStatus
} from '@leadmate/shared';

export interface BuyerAnalyticsRecord {
  id: string;
  organizationId: string;
  salesMissionId: string;
  externalBusinessId: string;
  provider: string;
  businessName: string;
  category?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  phone?: string | null;
  whatsappStatus?: string | null;
  priority?: string | null;
  wholesaleIntent?: string | null;
  matchedBuyerCategory?: string | null;
  conversionStage: string;
  conversionWonEvidence?: {
    dealValue?: number;
    currency?: string;
    closedAt?: string | Date;
    notes?: string;
  } | null;
  conversionLostReason?: string | null;
  sourceEvidences?: Array<{ provider?: string; [key: string]: any }> | null;
  enrichedContacts?: Array<{ type?: string; value?: string; [key: string]: any }> | null;
  // Related relational/interaction data
  interactions?: Array<{
    direction: string;
    channel: string;
    classification?: string | null;
    createdAt?: string | Date;
  }>;
  outreachDrafts?: Array<{
    channel: string;
    status: string;
    aiContextSnapshot?: any;
  }>;
  // Optional product info if joined
  product?: {
    id: string;
    name: string;
    sku?: string | null;
    category?: string | null;
    currency?: string;
    sellingPrice?: number | null;
  } | null;
  targetMarket?: string | null;
}

export const QUALIFYING_INTEREST_CLASSIFICATIONS = new Set([
  'INTERESTED',
  'PRICE_REQUEST',
  'MOQ_REQUEST',
  'PRODUCT_INFO_REQUEST',
  'ORDER_INTENT'
]);

export const CONTACTED_STAGES = new Set([
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'NOT_INTERESTED',
  'FOLLOW_UP',
  'NEGOTIATING',
  'WON',
  'LOST'
]);

export const REPLIED_STAGES = new Set([
  'REPLIED',
  'INTERESTED',
  'NOT_INTERESTED',
  'FOLLOW_UP',
  'NEGOTIATING',
  'WON'
]);

export const INTERESTED_STAGES = new Set([
  'INTERESTED',
  'NEGOTIATING',
  'WON'
]);

/**
 * Evaluates whether a buyer is contactable through verified legitimate channels.
 * PHONE != WHATSAPP strict rule: WhatsApp counts ONLY when EXPLICIT_VERIFIED.
 */
export function isBuyerContactable(buyer: BuyerAnalyticsRecord): boolean {
  if (buyer.phone && buyer.phone.trim().length > 0) {
    return true;
  }
  if (buyer.website && buyer.website.trim().length > 0) {
    return true;
  }
  if (buyer.whatsappStatus === 'EXPLICIT_VERIFIED') {
    return true;
  }
  if (Array.isArray(buyer.enrichedContacts)) {
    const hasContact = buyer.enrichedContacts.some(
      (c) => c && c.value && String(c.value).trim().length > 0
    );
    if (hasContact) return true;
  }
  return false;
}

/**
 * Evaluates whether contact has actually occurred.
 * IMPORTANT: APPROVED or READY_FOR_DISPATCH drafts DO NOT count as contacted!
 */
export function isBuyerContacted(buyer: BuyerAnalyticsRecord): boolean {
  if (buyer.conversionStage && CONTACTED_STAGES.has(buyer.conversionStage)) {
    return true;
  }
  if (Array.isArray(buyer.interactions)) {
    const hasOutbound = buyer.interactions.some((i) => i.direction === 'OUTBOUND');
    if (hasOutbound) return true;
  }
  return false;
}

/**
 * Evaluates whether buyer provided an inbound reply.
 */
export function hasBuyerReplied(buyer: BuyerAnalyticsRecord): boolean {
  if (Array.isArray(buyer.interactions)) {
    const hasInbound = buyer.interactions.some((i) => i.direction === 'INBOUND');
    if (hasInbound) return true;
  }
  if (buyer.conversionStage && REPLIED_STAGES.has(buyer.conversionStage)) {
    return true;
  }
  return false;
}

/**
 * Evaluates whether buyer expressed interest.
 */
export function isBuyerInterested(buyer: BuyerAnalyticsRecord): boolean {
  if (Array.isArray(buyer.interactions)) {
    const hasInterestedInbound = buyer.interactions.some(
      (i) => i.direction === 'INBOUND' && i.classification && QUALIFYING_INTEREST_CLASSIFICATIONS.has(i.classification)
    );
    if (hasInterestedInbound) return true;
  }
  if (buyer.conversionStage && INTERESTED_STAGES.has(buyer.conversionStage)) {
    return true;
  }
  return false;
}

/**
 * Aggregates currency totals safely without cross-currency addition.
 */
export function addCurrencyAmount(
  totals: CurrencyGroupedTotals,
  currency: string | undefined | null,
  amount: number | undefined | null
): void {
  if (!amount || isNaN(amount) || amount <= 0) return;
  const curr = (currency || 'BDT').toUpperCase().trim();
  totals[curr] = (totals[curr] || 0) + Number(amount);
}

/**
 * Computes Average Order Value (AOV) per currency safely.
 */
export function calculateAovPerCurrency(
  totals: CurrencyGroupedTotals,
  wonCounts: Record<string, number>
): CurrencyGroupedTotals {
  const aov: CurrencyGroupedTotals = {};
  for (const [curr, total] of Object.entries(totals)) {
    const count = wonCounts[curr] || 0;
    aov[curr] = count > 0 ? Math.round((total / count) * 100) / 100 : 0;
  }
  return aov;
}

/**
 * Computes dashboard KPIs from verified buyer records.
 */
export function computeDashboardKpis(
  buyers: BuyerAnalyticsRecord[],
  totalProductsCount: number,
  activeMissionsCount: number
): DashboardSalesKpisDto {
  const uniqueBuyerIds = new Set<string>();
  let hotCount = 0;
  let highIntentCount = 0;
  let contactableCount = 0;
  let contactedCount = 0;
  let repliedCount = 0;
  let interestedCount = 0;
  let negotiatingCount = 0;
  let wonCount = 0;
  let lostCount = 0;

  const wonValueByCurrency: CurrencyGroupedTotals = {};
  const wonCountByCurrency: Record<string, number> = {};
  const lossReasonsBreakdown: Record<string, number> = {};

  for (const buyer of buyers) {
    if (uniqueBuyerIds.has(buyer.id)) continue;
    uniqueBuyerIds.add(buyer.id);

    if (buyer.priority === 'HOT') hotCount++;
    if (buyer.wholesaleIntent === 'HIGH') highIntentCount++;

    const contactable = isBuyerContactable(buyer);
    if (contactable) contactableCount++;

    const contacted = isBuyerContacted(buyer);
    if (contacted) contactedCount++;

    const replied = hasBuyerReplied(buyer);
    if (replied) repliedCount++;

    const interested = isBuyerInterested(buyer);
    if (interested) interestedCount++;

    if (buyer.conversionStage === 'NEGOTIATING' || buyer.conversionStage === 'WON') {
      negotiatingCount++;
    }

    if (buyer.conversionStage === 'WON') {
      wonCount++;
      const dealVal = buyer.conversionWonEvidence?.dealValue;
      const dealCurr = (buyer.conversionWonEvidence?.currency || 'BDT').toUpperCase();
      if (dealVal && dealVal > 0) {
        addCurrencyAmount(wonValueByCurrency, dealCurr, dealVal);
        wonCountByCurrency[dealCurr] = (wonCountByCurrency[dealCurr] || 0) + 1;
      }
    }

    if (buyer.conversionStage === 'LOST') {
      lostCount++;
      const reason = buyer.conversionLostReason || 'OTHER';
      lossReasonsBreakdown[reason] = (lossReasonsBreakdown[reason] || 0) + 1;
    }
  }

  const totalBuyers = uniqueBuyerIds.size;
  const contactabilityRate = totalBuyers > 0 ? Math.round((contactableCount / totalBuyers) * 1000) / 1000 : 0;
  // Strict rule: Reply Rate denominator is CONTACTED buyers, never approved drafts!
  const replyRate = contactedCount > 0 ? Math.round((repliedCount / contactedCount) * 1000) / 1000 : 0;
  const interestRate = repliedCount > 0 ? Math.round((interestedCount / repliedCount) * 1000) / 1000 : 0;
  const conversionRate = contactedCount > 0 ? Math.round((wonCount / contactedCount) * 1000) / 1000 : 0;

  const averageDealValueByCurrency = calculateAovPerCurrency(wonValueByCurrency, wonCountByCurrency);

  return {
    totalProducts: totalProductsCount,
    activeMissions: activeMissionsCount,
    uniqueBuyers: totalBuyers,
    hotBuyers: hotCount,
    highIntentBuyers: highIntentCount,
    contactableBuyers: contactableCount,
    contactedBuyers: contactedCount,
    repliedBuyers: repliedCount,
    interestedBuyers: interestedCount,
    negotiatingBuyers: negotiatingCount,
    wonBuyers: wonCount,
    lostBuyers: lostCount,
    contactabilityRate,
    replyRate,
    interestRate,
    conversionRate,
    wonValueByCurrency,
    averageDealValueByCurrency,
    funnel: {
      discovered: totalBuyers,
      contactable: contactableCount,
      contacted: contactedCount,
      replied: repliedCount,
      interested: interestedCount,
      negotiating: negotiatingCount,
      won: wonCount
    },
    lossReasonsBreakdown
  };
}

/**
 * Standard list of providers and their display metadata.
 */
export const KNOWN_PROVIDERS = [
  { key: 'openstreetmap', displayName: 'OpenStreetMap' },
  { key: 'google-places', displayName: 'Google Places' },
  { key: 'company-website', displayName: 'Company Website' },
  { key: 'public-directory', displayName: 'Public Directory' },
  { key: 'rfq', displayName: 'RFQ / Public Buying' },
  { key: 'facebook-business', displayName: 'Facebook Business' },
  { key: 'tiktok-business', displayName: 'TikTok Business' }
];

/**
 * Computes Source Effectiveness with strict PRIMARY vs ASSISTED attribution.
 *
 * Attribution Rule:
 * PRIMARY SOURCE = buyer.provider (original discoverer). Credits: buyersFound, contacted, replied, won, dealValue.
 * ASSISTED SOURCES = secondary providers found in sourceEvidences or enrichedContacts. Credits: assistedBuyerCount.
 * WON is NEVER double-counted across multiple sources.
 */
export function computeSourceEffectiveness(
  buyers: BuyerAnalyticsRecord[],
  configuredProviderStatuses: Record<string, AnalyticsProviderStatus> = {}
): SourceEffectivenessDto[] {
  const result: Record<string, {
    primaryFound: number;
    contactable: number;
    contacted: number;
    replied: number;
    won: number;
    wonValues: CurrencyGroupedTotals;
    assistedCount: number;
    enrichmentCount: number;
  }> = {};

  // Initialize for all known providers
  for (const p of KNOWN_PROVIDERS) {
    result[p.key] = {
      primaryFound: 0,
      contactable: 0,
      contacted: 0,
      replied: 0,
      won: 0,
      wonValues: {},
      assistedCount: 0,
      enrichmentCount: 0
    };
  }

  for (const buyer of buyers) {
    const rawProvider = (buyer.provider || 'unknown').toLowerCase();
    const primaryKey = KNOWN_PROVIDERS.find((kp) => kp.key === rawProvider)?.key || rawProvider;

    if (!result[primaryKey]) {
      result[primaryKey] = {
        primaryFound: 0,
        contactable: 0,
        contacted: 0,
        replied: 0,
        won: 0,
        wonValues: {},
        assistedCount: 0,
        enrichmentCount: 0
      };
    }

    const r = result[primaryKey];
    r.primaryFound++;

    const contactable = isBuyerContactable(buyer);
    if (contactable) r.contactable++;

    const contacted = isBuyerContacted(buyer);
    if (contacted) r.contacted++;

    const replied = hasBuyerReplied(buyer);
    if (replied) r.replied++;

    if (buyer.conversionStage === 'WON') {
      r.won++;
      const dealVal = buyer.conversionWonEvidence?.dealValue;
      const dealCurr = (buyer.conversionWonEvidence?.currency || 'BDT').toUpperCase();
      if (dealVal && dealVal > 0) {
        addCurrencyAmount(r.wonValues, dealCurr, dealVal);
      }
    }

    // Process assisted sources from sourceEvidences
    const assistedSeenForBuyer = new Set<string>();
    if (Array.isArray(buyer.sourceEvidences)) {
      for (const ev of buyer.sourceEvidences) {
        if (!ev || !ev.provider) continue;
        const assistKey = String(ev.provider).toLowerCase();
        if (assistKey !== primaryKey && !assistedSeenForBuyer.has(assistKey)) {
          assistedSeenForBuyer.add(assistKey);
          if (!result[assistKey]) {
            result[assistKey] = {
              primaryFound: 0,
              contactable: 0,
              contacted: 0,
              replied: 0,
              won: 0,
              wonValues: {},
              assistedCount: 0,
              enrichmentCount: 0
            };
          }
          result[assistKey].assistedCount++;
          result[assistKey].enrichmentCount++;
        }
      }
    }
  }

  return KNOWN_PROVIDERS.map((kp) => {
    const data = result[kp.key] || {
      primaryFound: 0,
      contactable: 0,
      contacted: 0,
      replied: 0,
      won: 0,
      wonValues: {},
      assistedCount: 0,
      enrichmentCount: 0
    };

    const status = configuredProviderStatuses[kp.key] || (
      kp.key === 'openstreetmap' || kp.key === 'company-website' || kp.key === 'public-directory'
        ? 'ACTIVE'
        : 'NOT_CONFIGURED'
    );

    const replyRate = data.contacted > 0 ? Math.round((data.replied / data.contacted) * 1000) / 1000 : 0;
    const conversionRate = data.contacted > 0 ? Math.round((data.won / data.contacted) * 1000) / 1000 : 0;

    let statusMessage: string | undefined;
    if (status === 'NOT_CONFIGURED') {
      statusMessage = 'Provider not configured in organization settings. No external API calls made.';
    }

    return {
      provider: kp.key,
      displayName: kp.displayName,
      status,
      statusMessage,
      primaryBuyersFound: data.primaryFound,
      contactableBuyers: data.contactable,
      contactedBuyers: data.contacted,
      buyersReplied: data.replied,
      wonBuyers: data.won,
      replyRate,
      conversionRate,
      wonValueByCurrency: data.wonValues,
      assistedBuyerCount: data.assistedCount,
      enrichmentContributionCount: data.enrichmentCount,
      attributionNote: 'Primary discovery credits conversions and deal values. Supporting sources receive assisted counts.'
    };
  });
}

/**
 * Computes detailed Product Analytics.
 */
export function computeProductAnalytics(
  product: {
    id: string;
    name: string;
    sku?: string | null;
    category?: string | null;
    currency?: string;
    sellingPrice?: number | null;
  },
  buyers: BuyerAnalyticsRecord[]
): ProductAnalyticsDto {
  let hot = 0;
  let warm = 0;
  let cold = 0;
  let contactable = 0;
  let contacted = 0;
  let replied = 0;
  let interested = 0;
  let negotiating = 0;
  let won = 0;
  let lost = 0;

  const wonValueByCurrency: CurrencyGroupedTotals = {};
  const wonCountByCurrency: Record<string, number> = {};
  const lossReasons: Record<string, number> = {};

  for (const b of buyers) {
    if (b.priority === 'HOT') hot++;
    else if (b.priority === 'COLD') cold++;
    else warm++;

    if (isBuyerContactable(b)) contactable++;
    if (isBuyerContacted(b)) contacted++;
    if (hasBuyerReplied(b)) replied++;
    if (isBuyerInterested(b)) interested++;
    if (b.conversionStage === 'NEGOTIATING' || b.conversionStage === 'WON') negotiating++;

    if (b.conversionStage === 'WON') {
      won++;
      const dealVal = b.conversionWonEvidence?.dealValue;
      const dealCurr = (b.conversionWonEvidence?.currency || product.currency || 'BDT').toUpperCase();
      if (dealVal && dealVal > 0) {
        addCurrencyAmount(wonValueByCurrency, dealCurr, dealVal);
        wonCountByCurrency[dealCurr] = (wonCountByCurrency[dealCurr] || 0) + 1;
      }
    }

    if (b.conversionStage === 'LOST') {
      lost++;
      const reason = b.conversionLostReason || 'OTHER';
      lossReasons[reason] = (lossReasons[reason] || 0) + 1;
    }
  }

  const potentialBuyers = buyers.length;
  const contactabilityRate = potentialBuyers > 0 ? Math.round((contactable / potentialBuyers) * 1000) / 1000 : 0;
  const replyRate = contacted > 0 ? Math.round((replied / contacted) * 1000) / 1000 : 0;
  const interestRate = replied > 0 ? Math.round((interested / replied) * 1000) / 1000 : 0;
  const conversionRate = contacted > 0 ? Math.round((won / contacted) * 1000) / 1000 : 0;
  const averageDealValueByCurrency = calculateAovPerCurrency(wonValueByCurrency, wonCountByCurrency);

  return {
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    category: product.category,
    currency: product.currency || 'BDT',
    sellingPrice: product.sellingPrice,
    potentialBuyers,
    priorityBreakdown: { hot, warm, cold },
    contactableBuyers: contactable,
    contactabilityRate,
    contactedBuyers: contacted,
    buyersReplied: replied,
    replyRate,
    interestedBuyers: interested,
    interestRate,
    negotiatingBuyers: negotiating,
    wonBuyers: won,
    conversionRate,
    lostBuyers: lost,
    wonValueByCurrency,
    averageDealValueByCurrency,
    lossReasons
  };
}

/**
 * Groups historical observations across dimensions to build the Learning Loop.
 */
export function aggregateLearningLoopCohorts(
  buyers: BuyerAnalyticsRecord[]
): LearningCohortObservation[] {
  type CohortAccumulator = {
    dimensionType: LearningCohortObservation['dimensionType'];
    dimensionValue: string;
    buyersFound: number;
    contactable: number;
    contacted: number;
    replied: number;
    interested: number;
    negotiating: number;
    won: number;
    lost: number;
    wonValues: CurrencyGroupedTotals;
    wonCounts: Record<string, number>;
  };

  const cohorts = new Map<string, CohortAccumulator>();

  const getOrCreate = (
    dimType: LearningCohortObservation['dimensionType'],
    dimValue: string
  ): CohortAccumulator => {
    const key = `${dimType}:${dimValue.trim()}`;
    let c = cohorts.get(key);
    if (!c) {
      c = {
        dimensionType: dimType,
        dimensionValue: dimValue.trim(),
        buyersFound: 0,
        contactable: 0,
        contacted: 0,
        replied: 0,
        interested: 0,
        negotiating: 0,
        won: 0,
        lost: 0,
        wonValues: {},
        wonCounts: {}
      };
      cohorts.set(key, c);
    }
    return c;
  };

  const recordBuyerToCohort = (c: CohortAccumulator, b: BuyerAnalyticsRecord) => {
    c.buyersFound++;
    if (isBuyerContactable(b)) c.contactable++;
    if (isBuyerContacted(b)) c.contacted++;
    if (hasBuyerReplied(b)) c.replied++;
    if (isBuyerInterested(b)) c.interested++;
    if (b.conversionStage === 'NEGOTIATING' || b.conversionStage === 'WON') c.negotiating++;
    if (b.conversionStage === 'WON') {
      c.won++;
      const dealVal = b.conversionWonEvidence?.dealValue;
      const dealCurr = (b.conversionWonEvidence?.currency || 'BDT').toUpperCase();
      if (dealVal && dealVal > 0) {
        addCurrencyAmount(c.wonValues, dealCurr, dealVal);
        c.wonCounts[dealCurr] = (c.wonCounts[dealCurr] || 0) + 1;
      }
    }
    if (b.conversionStage === 'LOST') c.lost++;
  };

  for (const b of buyers) {
    // 1. Matched Buyer Category
    if (b.matchedBuyerCategory && b.matchedBuyerCategory.trim().length > 0) {
      recordBuyerToCohort(getOrCreate('BUYER_CATEGORY', b.matchedBuyerCategory), b);
    }

    // 2. Location (City or Target Market)
    const loc = b.city || b.targetMarket;
    if (loc && loc.trim().length > 0) {
      recordBuyerToCohort(getOrCreate('LOCATION', loc), b);
    }

    // 3. Sub-area
    if (b.address && b.address.trim().length > 0) {
      recordBuyerToCohort(getOrCreate('SUB_AREA', b.address), b);
    }

    // 4. Primary Source
    if (b.provider && b.provider.trim().length > 0) {
      recordBuyerToCohort(getOrCreate('PRIMARY_SOURCE', b.provider), b);
    }

    // 5. Wholesale Intent
    if (b.wholesaleIntent && b.wholesaleIntent.trim().length > 0) {
      recordBuyerToCohort(getOrCreate('WHOLESALE_INTENT', b.wholesaleIntent), b);
    }

    // 6. Product / Product Category
    if (b.product?.id) {
      recordBuyerToCohort(getOrCreate('PRODUCT', b.product.name || b.product.id), b);
      if (b.product.category) {
        recordBuyerToCohort(getOrCreate('PRODUCT_CATEGORY', b.product.category), b);
      }
    }

    // 7. Channel
    if (Array.isArray(b.outreachDrafts)) {
      for (const d of b.outreachDrafts) {
        if (d.channel) {
          recordBuyerToCohort(getOrCreate('CHANNEL', d.channel), b);
        }
      }
    }
  }

  const results: LearningCohortObservation[] = [];
  for (const [key, c] of cohorts.entries()) {
    const contactabilityRate = c.buyersFound > 0 ? Math.round((c.contactable / c.buyersFound) * 1000) / 1000 : 0;
    const replyRate = c.contacted > 0 ? Math.round((c.replied / c.contacted) * 1000) / 1000 : 0;
    const interestRate = c.replied > 0 ? Math.round((c.interested / c.replied) * 1000) / 1000 : 0;
    const conversionRate = c.contacted > 0 ? Math.round((c.won / c.contacted) * 1000) / 1000 : 0;
    const averageDealValueByCurrency = calculateAovPerCurrency(c.wonValues, c.wonCounts);

    results.push({
      dimensionKey: key,
      dimensionType: c.dimensionType,
      dimensionValue: c.dimensionValue,
      observationCount: c.buyersFound,
      buyersFound: c.buyersFound,
      contactableBuyers: c.contactable,
      contactedBuyers: c.contacted,
      buyersReplied: c.replied,
      interestedBuyers: c.interested,
      negotiatingBuyers: c.negotiating,
      wonBuyers: c.won,
      lostBuyers: c.lost,
      replyRate,
      interestRate,
      conversionRate,
      contactabilityRate,
      dealValueByCurrency: c.wonValues,
      averageDealValueByCurrency
    });
  }

  return results;
}
