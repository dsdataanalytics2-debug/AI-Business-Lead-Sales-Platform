import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Role, Permissions, CrmStage, CRM_STAGE_LABELS, ORDERED_CRM_STAGES } from '@leadmate/shared';
import PipelinePage from '../app/pipeline/page.js';

let mockUser: any = { id: 'u1', name: 'Test Sales Lead', email: 'sales@leadmate.ai', role: Role.ADMIN };

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: mockUser,
    hasPermission: () => true,
    logout: vi.fn(),
    isLoading: false,
    isAuthenticated: true
  })
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/pipeline'
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    leads: {
      list: vi.fn().mockResolvedValue({
        data: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            name: 'Apex Dental Care',
            category: 'Dental Clinic',
            city: 'Dhaka',
            country: 'BD',
            primaryPhone: '+8801711223344',
            crmStage: CrmStage.NEW
          },
          {
            id: '22222222-2222-2222-2222-222222222222',
            name: 'Gulshan Pharmacy',
            category: 'Pharmacy',
            city: 'Dhaka',
            country: 'BD',
            primaryPhone: '+8801811223344',
            crmStage: CrmStage.WON
          }
        ]
      }),
      updateCrmStage: vi.fn().mockResolvedValue({ stage: CrmStage.QUALIFIED })
    }
  }
}));


describe('CRM Pipeline Route & Board Rendering', () => {
  it('1. Renders all 7 canonical CrmStage columns in the board', () => {
    const html = renderToStaticMarkup(<PipelinePage />);

    expect(html).toContain('CRM Pipeline');
    // All 7 stage labels must be present
    for (const stage of ORDERED_CRM_STAGES) {
      expect(html).toContain(CRM_STAGE_LABELS[stage]);
    }
  });

  it('2. Renders search input and city filter dropdown', () => {
    const html = renderToStaticMarkup(<PipelinePage />);
    expect(html).toContain('placeholder="Search leads by business name, category, or phone..."');
    expect(html).toContain('All Cities');
  });
});
