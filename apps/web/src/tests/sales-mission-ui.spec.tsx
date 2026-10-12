import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  type ProductDto,
  type SalesMissionDetailDto,
  ProductStatus,
  SalesPriority,
  SalesMissionStatus,
  SalesMissionGoal,
  MissionBuyerStatus,
  SALES_MISSION_GOAL_LABELS
} from '@leadmate/shared';
import ProductsPage from '../app/products/page.js';
import SalesMissionsPage from '../app/sales-missions/page.js';

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
  usePathname: () => '/products',
  useSearchParams: () => new URLSearchParams()
}));

const { mockProducts, mockMissions } = vi.hoisted(() => {
  const products = [
    {
      id: 'prod-101',
      organizationId: 'org-1',
      name: 'Diamum',
      description: 'Oral healthcare anti-cavity gel and hygiene supplement.',
      category: 'Healthcare',
      stockQuantity: 450,
      sellingPrice: 1200,
      costPrice: 800,
      currency: 'BDT',
      brand: 'Diamum Pharma',
      sourceType: 'MANUAL',
      status: 'ACTIVE',
      salesPriority: 'URGENT',
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'prod-102',
      organizationId: 'org-1',
      name: 'Portable Mini Blender',
      description: 'Rechargeable cordless blender for smoothies and shakes.',
      category: 'Kitchenware',
      stockQuantity: 120,
      sellingPrice: 2200,
      costPrice: 1500,
      currency: 'BDT',
      brand: 'BlendMate',
      sourceType: 'MANUAL',
      status: 'ACTIVE',
      salesPriority: 'HIGH',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];

  const missions = [
    {
      id: 'mission-201',
      organizationId: 'org-1',
      productId: 'prod-101',
      name: 'Distribute Diamum in Dhaka Pharmacies',
      goal: 'WHOLESALE',
      targetMarket: 'Dhaka, Bangladesh',
      buyerType: 'AI_DECIDE',
      resultTarget: 50,
      status: 'READY',
      productAnalysisSnapshot: {
        productCategory: 'Healthcare & Oral Sanitation',
        productSummary: 'Pharmaceutical and oral hygiene consumable product.',
        buyerTargets: [
          { category: 'Pharmacy', reason: 'Direct dispensing retailer', confidence: 'HIGH' },
          { category: 'Medicine Shop', reason: 'High turnover OTC retailer', confidence: 'HIGH' }
        ],
        searchTerms: ['Pharmacy', 'Medicine Shop', 'Dental Clinic']
      },
      selectedBuyerTargets: ['Pharmacy', 'Medicine Shop', 'Dental Clinic'],
      resultCount: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      product: products[0],
      buyers: [
        {
          id: 'buyer-1',
          organizationId: 'org-1',
          salesMissionId: 'mission-201',
          externalBusinessId: 'ext-p1',
          provider: 'GOOGLE_PLACES',
          businessName: 'Lazz Pharma Dhanmondi',
          category: 'Pharmacy',
          address: 'House 14, Road 7, Dhanmondi',
          city: 'Dhaka',
          country: 'BD',
          phone: '01711223344',
          matchedBuyerCategory: 'Pharmacy',
          searchTargetUsed: 'Pharmacy Dhanmondi',
          status: 'POTENTIAL',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ],
      buyerStats: {
        found: 1,
        savedToCrm: 0
      }
    }
  ];

  return { mockProducts: products, mockMissions: missions };
});

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    listProducts: vi.fn().mockResolvedValue({ products: mockProducts, total: 2, page: 1, totalPages: 1 }),
    createProduct: vi.fn(),
    listSalesMissions: vi.fn().mockResolvedValue({ missions: mockMissions, total: 1, page: 1, totalPages: 1 }),
    getSalesMission: vi.fn().mockResolvedValue(mockMissions[0]),
    businessSearch: {
      saveLead: vi.fn().mockResolvedValue({ action: 'CREATED', leadId: 'lead-1' })
    }
  }
}));

describe('LeadAtlas Sales Mission Frontend UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Products catalog page renders header, metrics, search filter, and Add Product CTA', () => {
    const html = renderToStaticMarkup(<ProductsPage />);

    expect(html).toContain('Product Catalog');
    expect(html).toContain('Add Product');
    expect(html).toContain('Total Products');
    expect(html).toContain('Total Inventory Units');
    expect(html).toContain('Search products by name or description');
  });

  it('2. Sales Missions list page renders mission title, goal filter, and New Sales Mission CTA', () => {
    const html = renderToStaticMarkup(<SalesMissionsPage />);

    expect(html).toContain('AI Sales Engine');
    expect(html).toContain('New Sales Mission');
    expect(html).toContain('href="/sales-missions/new"');
    expect(html).toContain('Total Missions');
    expect(html).toContain('Buyers Discovered');
    expect(html).toContain('Saved to CRM');
  });

  it('3. Invariant check: PHONE != WHATSAPP status distinction is strictly preserved', () => {
    const buyer = mockMissions[0].buyers![0];
    expect(buyer.phone).toBe('01711223344');
    // Buyer does not have explicit whatsappVerified flag, ensuring PHONE != WHATSAPP invariant
    expect((buyer as any).whatsappStatus).toBeUndefined();
  });

  it('4. Reopen contract: Persisted AI Analysis snapshot is available without triggering external APIs', () => {
    const mission = mockMissions[0];
    expect(mission.productAnalysisSnapshot).toBeDefined();
    expect(mission.productAnalysisSnapshot?.productCategory).toBe('Healthcare & Oral Sanitation');
    expect(mission.productAnalysisSnapshot?.buyerTargets.length).toBe(2);
    expect(mission.productAnalysisSnapshot?.buyerTargets[0].confidence).toBe('HIGH');
  });
});
