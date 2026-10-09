import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Role, OutreachChannel } from '@leadmate/shared';
import CampaignsPage from '../app/campaigns/page.js';

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Admin', role: Role.ADMIN },
    hasPermission: () => true,
    logout: vi.fn(),
    isLoading: false,
    isAuthenticated: true
  })
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/campaigns'
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getCampaigns: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'camp-1',
          name: 'Gulshan Dental Clinics Outreach',
          status: 'READY',
          channel: OutreachChannel.WHATSAPP,
          leadCount: 15,
          draftCount: 15,
          approvedCount: 8,
          sentCount: 0,
          failedCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    }),
    leads: {
      list: vi.fn().mockResolvedValue({ data: [] })
    },
    createCampaign: vi.fn()
  }
}));


describe('Campaigns Page UI', () => {
  it('1. Renders Campaigns header and Approval != Dispatch safeguard banner', () => {
    const html = renderToStaticMarkup(<CampaignsPage />);
    expect(html).toContain('Outreach Campaigns');
    expect(html).toContain('New Campaign');
    expect(html).toContain('Strict Policy Invariant: Approval != Dispatch');
  });

  it('2. Renders campaign metrics and table columns', () => {
    const html = renderToStaticMarkup(<CampaignsPage />);
    expect(html).toContain('Campaign Name');
    expect(html).toContain('Channel');
    expect(html).toContain('Status');
    expect(html).toContain('Target Leads');
    expect(html).toContain('AI Drafts');
    expect(html).toContain('Approved');
    expect(html).toContain('Sent');
  });
});
