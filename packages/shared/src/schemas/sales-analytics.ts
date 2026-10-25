import { z } from 'zod';

// ==========================================
// CURRENCY & REVENUE SAFETY
// ==========================================

export type CurrencyGroupedTotals = Record<string, number>;

export const currencyGroupedTotalsSchema = z.record(z.string(), z.number());

// ==========================================
// PROVIDER STATUS & ATTRIBUTION
// ==========================================

export type AnalyticsProviderStatus = 'ACTIVE' | 'NOT_CONFIGURED' | 'DISABLED' | 'ERROR';

export const analyticsProviderStatusSchema = z.enum([
  'ACTIVE',
  'NOT_CONFIGURED',
  'DISABLED',
  'ERROR'
]);

export interface SourceEffectivenessDto {
  provider: string;
  displayName: string;
  status: AnalyticsProviderStatus;
  statusMessage?: string;
  // Primary attribution metrics
  primaryBuyersFound: number;
  contactableBuyers: number;
  contactedBuyers: number;
  buyersReplied: number;
  wonBuyers: number;
  replyRate: number; // buyersReplied / contactedBuyers
  conversionRate: number; // wonBuyers / contactedBuyers
  wonValueByCurrency: CurrencyGroupedTotals;
  // Assisted / enrichment attribution
  assistedBuyerCount: number;
  enrichmentContributionCount: number;
  attributionNote: string;
  sourceType?: 'DISCOVERY' | 'INBOUND_LEADS' | 'ENRICHMENT';
  inboundLeadsCount?: number;
}

// ==========================================
// FUNNEL & GENERAL SALES METRICS
// ==========================================

export interface SalesFunnelStageMetrics {
  discovered: number;
  contactable: number;
  contacted: number;
  replied: number;
  interested: number;
  negotiating: number;
  won: number;
}

export interface DashboardSalesKpisDto {
  totalProducts: number;
  activeMissions: number;
  uniqueBuyers: number;
  hotBuyers: number;
  highIntentBuyers: number;
  contactableBuyers: number;
  contactedBuyers: number;
  repliedBuyers: number;
  interestedBuyers: number;
  negotiatingBuyers: number;
  wonBuyers: number;
  lostBuyers: number;
  // Rates (strictly zero when denominator is 0)
  contactabilityRate: number; // contactable / discovered
  replyRate: number; // replied / contacted (NEVER drafts!)
  interestRate: number; // interested / replied
  conversionRate: number; // won / contacted
  // Revenue grouped strictly by currency
  wonValueByCurrency: CurrencyGroupedTotals;
  averageDealValueByCurrency: CurrencyGroupedTotals;
  funnel: SalesFunnelStageMetrics;
  lossReasonsBreakdown: Record<string, number>;
}

// ==========================================
// PRODUCT ANALYTICS
// ==========================================

export interface ProductAnalyticsDto {
  productId: string;
  productName: string;
  sku?: string | null;
  category?: string | null;
  currency: string;
  sellingPrice?: number | null;
  // Buyer metrics
  potentialBuyers: number;
  priorityBreakdown: {
    hot: number;
    warm: number;
    cold: number;
  };
  contactableBuyers: number;
  contactabilityRate: number;
  contactedBuyers: number;
  buyersReplied: number;
  replyRate: number;
  interestedBuyers: number;
  interestRate: number;
  negotiatingBuyers: number;
  wonBuyers: number;
  conversionRate: number;
  lostBuyers: number;
  wonValueByCurrency: CurrencyGroupedTotals;
  averageDealValueByCurrency: CurrencyGroupedTotals;
  lossReasons: Record<string, number>;
}

// ==========================================
// LEARNING LOOP COHORT OBSERVATION
// ==========================================

export interface LearningCohortObservation {
  dimensionKey: string;
  dimensionType:
    | 'PRODUCT'
    | 'PRODUCT_CATEGORY'
    | 'BUYER_CATEGORY'
    | 'LOCATION'
    | 'SUB_AREA'
    | 'PRIMARY_SOURCE'
    | 'CHANNEL'
    | 'WHOLESALE_INTENT'
    | 'PITCH_ANGLE';
  dimensionValue: string;
  observationCount: number;
  buyersFound: number;
  contactableBuyers: number;
  contactedBuyers: number;
  buyersReplied: number;
  interestedBuyers: number;
  negotiatingBuyers: number;
  wonBuyers: number;
  lostBuyers: number;
  replyRate: number;
  interestRate: number;
  conversionRate: number;
  contactabilityRate: number;
  dealValueByCurrency: CurrencyGroupedTotals;
  averageDealValueByCurrency: CurrencyGroupedTotals;
}

// ==========================================
// RECOMMENDATION ENGINE DTO
// ==========================================

export type DiscoveryRecommendationType =
  | 'BUYER_CATEGORY'
  | 'LOCATION'
  | 'SOURCE'
  | 'PITCH_ANGLE';

export type RecommendationStatus = 'READY' | 'INSUFFICIENT_DATA';

export interface DiscoveryRecommendationDto {
  id: string;
  recommendationType: DiscoveryRecommendationType;
  recommendedValue: string;
  status: RecommendationStatus;
  sampleSize: number; // N
  confidenceScore?: number;
  supportingMetrics: {
    contactedCount?: number;
    replyRate?: number;
    interestRate?: number;
    conversionRate?: number;
    wonCount?: number;
    buyersFound?: number;
  };
  reason: string;
  disclaimer: string;
  aiTargetingFallback?: string | null;
}

export interface RecommendationResponseDto {
  recommendations: DiscoveryRecommendationDto[];
  minimumCohortSize: number; // 5
  evaluatedCohortsCount: number;
  hasSufficientData: boolean;
}
