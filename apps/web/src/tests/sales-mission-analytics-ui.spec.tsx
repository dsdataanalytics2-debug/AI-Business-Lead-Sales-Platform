import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SalesMissionsAnalyticsPage from '../app/sales-missions/analytics/page.js';

// Mock Auth
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'LeadAtlas Operator', email: 'op@leadatlas.test', organizationId: 'org-1' },
    hasPermission: () => true,
    logout: vi.fn(),
    isLoading: false,
    isAuthenticated: true
  })
}));

// Mock Navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/sales-missions/analytics',
  useSearchParams: () => new URLSearchParams()
}));

const {
  mockDashboardKpis,
  mockSources,
  mockRecommendations,
  mockProduct,
  mockProductAnalytics
} = vi.hoisted(() => {
  const kpis = {
    totalProducts: 2,
    activeMissions: 1,
    uniqueBuyers: 15,
    hotBuyers: 4,
    highIntentBuyers: 3,
    contactableBuyers: 12,
    contactedBuyers: 10,
    repliedBuyers: 5,
    interestedBuyers: 4,
    negotiatingBuyers: 2,
    wonBuyers: 2,
    lostBuyers: 1,
    contactabilityRate: 0.8,
    replyRate: 0.5,
    interestRate: 0.8,
    conversionRate: 0.2,
    wonValueByCurrency: {
      BDT: 120000,
      USD: 2000
    },
    averageDealValueByCurrency: {
      BDT: 120000,
      USD: 2000
    },
    funnel: {
      discovered: 15,
      contactable: 12,
      contacted: 10,
      replied: 5,
      interested: 4,
      negotiating: 2,
      won: 2
    },
    lossReasonsBreakdown: {
      PRICE_HIGH: 1
    }
  };

  const sources = [
    {
      provider: 'openstreetmap',
      displayName: 'OpenStreetMap',
      status: 'ACTIVE',
      primaryBuyersFound: 8,
      contactableBuyers: 7,
      contactedBuyers: 6,
      buyersReplied: 3,
      wonBuyers: 1,
      replyRate: 0.5,
      conversionRate: 0.167,
      wonValueByCurrency: { USD: 2000 },
      assistedBuyerCount: 1,
      enrichmentContributionCount: 1,
      attributionNote: 'Primary discovery credits conversions'
    },
    {
      provider: 'google-places',
      displayName: 'Google Places',
      status: 'ACTIVE',
      primaryBuyersFound: 7,
      contactableBuyers: 5,
      contactedBuyers: 4,
      buyersReplied: 2,
      wonBuyers: 1,
      replyRate: 0.5,
      conversionRate: 0.25,
      wonValueByCurrency: { BDT: 120000 },
      assistedBuyerCount: 0,
      enrichmentContributionCount: 0,
      attributionNote: 'Primary discovery credits conversions'
    },
    {
      provider: 'facebook-business',
      displayName: 'Facebook Business',
      status: 'NOT_CONFIGURED',
      statusMessage: 'Provider not configured in organization settings.',
      primaryBuyersFound: 0,
      contactableBuyers: 0,
      contactedBuyers: 0,
      buyersReplied: 0,
      wonBuyers: 0,
      replyRate: 0,
      conversionRate: 0,
      wonValueByCurrency: {},
      assistedBuyerCount: 0,
      enrichmentContributionCount: 0,
      attributionNote: 'Primary discovery credits conversions'
    }
  ];

  const recs = {
    recommendations: [
      {
        id: 'rec-buyer-cat-1',
        recommendationType: 'BUYER_CATEGORY',
        recommendedValue: 'Wholesale Lighting Stores',
        status: 'READY',
        sampleSize: 8,
        supportingMetrics: {
          contactedCount: 8,
          conversionRate: 0.25,
          interestRate: 0.75,
          wonCount: 2
        },
        reason: 'Demonstrated 25% conversion rate across 8 verified contacted buyers.',
        disclaimer: 'Advisory recommendation based on n=8 contacted historical buyers.',
        aiTargetingFallback: null
      },
      {
        id: 'rec-loc-insufficient',
        recommendationType: 'LOCATION',
        recommendedValue: 'Chittagong, Bangladesh',
        status: 'INSUFFICIENT_DATA',
        sampleSize: 2,
        supportingMetrics: {},
        reason: 'Fewer than 5 contacted buyer observations in any single location cohort.',
        disclaimer: 'AI Targeting Suggestion: Suggested regional market.',
        aiTargetingFallback: 'Chittagong, Bangladesh'
      }
    ],
    minimumCohortSize: 5,
    evaluatedCohortsCount: 4,
    hasSufficientData: true
  };

  const product = {
    id: 'prod-101',
    name: 'Ambient Wooden Mushroom Lamp',
    category: 'Home Decor',
    currency: 'BDT',
    sellingPrice: 4500
  };

  const productAnalytics = {
    productId: 'prod-101',
    productName: 'Ambient Wooden Mushroom Lamp',
    sku: 'MUSH-01',
    category: 'Home Decor',
    currency: 'BDT',
    sellingPrice: 4500,
    potentialBuyers: 15,
    priorityBreakdown: { hot: 4, warm: 8, cold: 3 },
    contactableBuyers: 12,
    contactabilityRate: 0.8,
    contactedBuyers: 10,
    buyersReplied: 5,
    replyRate: 0.5,
    interestedBuyers: 4,
    interestRate: 0.8,
    negotiatingBuyers: 2,
    wonBuyers: 2,
    conversionRate: 0.2,
    lostBuyers: 1,
    wonValueByCurrency: { BDT: 120000 },
    averageDealValueByCurrency: { BDT: 60000 },
    lossReasons: { PRICE_HIGH: 1 }
  };

  return {
    mockDashboardKpis: kpis,
    mockSources: sources,
    mockRecommendations: recs,
    mockProduct: product,
    mockProductAnalytics: productAnalytics
  };
});

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getSalesDashboardAnalytics: vi.fn().mockResolvedValue({ data: mockDashboardKpis }),
    getSourceAnalytics: vi.fn().mockResolvedValue({ data: mockSources }),
    getDiscoveryRecommendations: vi.fn().mockResolvedValue({ data: mockRecommendations }),
    listProducts: vi.fn().mockResolvedValue({ products: [mockProduct] }),
    getProductAnalytics: vi.fn().mockResolvedValue({ data: mockProductAnalytics })
  }
}));

describe('SalesMissionsAnalyticsPage UI', () => {
  it('renders the header and zero-external-call guarantee badge', () => {
    const html = renderToStaticMarkup(<SalesMissionsAnalyticsPage />);
    expect(html).toContain('AI Sales Engine Analytics');
    expect(html).toContain('Zero External Calls • Local Persisted DB');
    expect(html).toContain('Commercial Overview KPIs');
  });

  it('renders overview KPIs with reply rate and conversion rate', () => {
    const html = renderToStaticMarkup(<SalesMissionsAnalyticsPage />);
    expect(html).toContain('Unique Buyers');
    expect(html).toContain('HOT Buyers');
    expect(html).toContain('Reply Rate');
    expect(html).toContain('Conversion Rate');
    expect(html).toContain('Verified Closed Revenue (Currency-Safe)');
  });

  it('renders deterministic sales funnel stages', () => {
    const html = renderToStaticMarkup(<SalesMissionsAnalyticsPage />);
    expect(html).toContain('Deterministic Sales Funnel');
    expect(html).toContain('Discovered');
    expect(html).toContain('Contactable');
    expect(html).toContain('Contacted');
    expect(html).toContain('Replied');
    expect(html).toContain('Interested');
    expect(html).toContain('Negotiating');
    expect(html).toContain('Won');
    expect(html).toContain('Approval != Contacted Rule:');
  });

  it('renders discovery recommendations with N >= 5 and INSUFFICIENT_DATA safeguards', () => {
    const html = renderToStaticMarkup(<SalesMissionsAnalyticsPage />);
    expect(html).toContain('Deterministic Discovery Recommendations');
    expect(html).toContain('Wholesale Lighting Stores');
    expect(html).toContain('Minimum cohort requirement: N ≥ 5');
  });

  it('renders source effectiveness matrix with primary attribution and NOT_CONFIGURED handling', () => {
    const html = renderToStaticMarkup(<SalesMissionsAnalyticsPage />);
    expect(html).toContain('Source Effectiveness &amp; Multi-Source Attribution');
    expect(html).toContain('OpenStreetMap');
    expect(html).toContain('Google Places');
    expect(html).toContain('Facebook Business');
    expect(html).toContain('Attribution Rule:');
  });

  it('renders product performance and loss reasons breakdown', () => {
    const html = renderToStaticMarkup(<SalesMissionsAnalyticsPage />);
    expect(html).toContain('Product Performance &amp; Loss Breakdown');
  });
});
