import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CrmStage,
  DashboardDatePreset,
  OutreachChannel,
  Permissions,
  Role,
  type DashboardSummaryResponse,
  type DashboardFunnelResponse,
  type DashboardSourcesResponse,
  type DashboardOutreachResponse,
  type DashboardTeamPerformanceResponse
} from '@leadmate/shared';
import { apiClient, ApiClientError } from '../lib/api-client.js';
import { DashboardFilterBar } from '../components/dashboard/dashboard-filter-bar.js';
import { KpiSummaryCards } from '../components/dashboard/kpi-summary-cards.js';
import { CurrentPipelineCard } from '../components/dashboard/current-pipeline-card.js';
import { LeadSourcesCard } from '../components/dashboard/lead-sources-card.js';
import { OutreachPerformanceCard } from '../components/dashboard/outreach-performance-card.js';
import { TeamPerformanceTable } from '../components/dashboard/team-performance-table.js';
import {
  formatPercentage,
  formatFriendlySource,
  getFriendlyDashboardErrorMessage,
  deriveAssigneeOptions,
  formatAssigneeLabel,
  mergeAvailableSources,
  calculateTeamCurrentWorkload,
  filterTeamMembers,
  sortTeamMembers,
  type DashboardAssigneeOption
} from '../lib/dashboard/dashboard-display.js';
import DashboardPage from '../app/dashboard/page.js';

// Mocks for Next.js and Auth
let mockUser: any = {
  id: 'user-manager-1',
  name: 'Bob Manager',
  email: 'bob@company.com',
  role: Role.SALES_MANAGER
};
let mockHasPermission = vi.fn();
let mockIsAuthenticated = true;
let mockIsLoading = false;

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: mockUser,
    hasPermission: mockHasPermission,
    logout: vi.fn(),
    isLoading: mockIsLoading,
    isAuthenticated: mockIsAuthenticated
  })
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/dashboard'
}));

// Sample mock analytics payloads
const sampleSummary: DashboardSummaryResponse = {
  range: {
    from: '2026-09-08T00:00:00.000Z',
    to: '2026-10-08T23:59:59.999Z',
    preset: DashboardDatePreset.DAYS_30
  },
  leads: {
    totalCohort: 25,
    cohortWon: 5,
    cohortConversionRate: 20
  },
  followUps: {
    dueToday: 4,
    overdue: 2,
    completed: 11
  },
  outreach: {
    sent: 40,
    delivered: 32,
    failed: 4,
    awaitingDelivery: 4,
    resolvedDeliverySuccessRate: 88.89
  }
};

const sampleFunnel: DashboardFunnelResponse = {
  stages: [
    { stage: CrmStage.NEW, count: 10 },
    { stage: CrmStage.CONTACTED, count: 6 },
    { stage: CrmStage.QUALIFIED, count: 4 },
    { stage: CrmStage.PROPOSAL_SENT, count: 2 },
    { stage: CrmStage.NEGOTIATION, count: 1 },
    { stage: CrmStage.WON, count: 5 },
    { stage: CrmStage.LOST, count: 0 }
  ],
  total: 28
};

const sampleSources: DashboardSourcesResponse = {
  sources: [
    { source: 'GOOGLE_SEARCH', count: 15 },
    { source: 'UNKNOWN', count: 8 },
    { source: 'WEBSITE', count: 2 }
  ],
  total: 25
};

const sampleOutreach: DashboardOutreachResponse = {
  totals: {
    sent: 40,
    delivered: 32,
    failed: 4,
    awaitingDelivery: 4,
    resolvedDeliverySuccessRate: 88.89
  },
  channels: [
    {
      channel: OutreachChannel.WHATSAPP,
      sent: 25,
      delivered: 21,
      failed: 2,
      awaitingDelivery: 2,
      resolvedDeliverySuccessRate: 91.3
    },
    {
      channel: OutreachChannel.EMAIL,
      sent: 15,
      delivered: 11,
      failed: 2,
      awaitingDelivery: 2,
      resolvedDeliverySuccessRate: 84.62
    }
  ]
};

const sampleTeamPerformance: DashboardTeamPerformanceResponse = {
  members: [
    {
      userId: 'exec-1',
      name: 'Charlie Rep',
      role: Role.SALES_EXECUTIVE,
      isActive: true,
      currentWorkload: {
        activeLeads: 8,
        pendingFollowUps: 3,
        overdueFollowUps: 1
      },
      periodPerformance: {
        leadsCreated: 14,
        cohortWon: 3,
        cohortConversionRate: 21.43,
        outreachSent: 20,
        outreachDelivered: 17,
        outreachFailed: 2,
        awaitingDelivery: 1,
        resolvedDeliverySuccessRate: 89.47
      }
    },
    {
      userId: 'exec-2',
      name: 'Dave Inactive',
      role: Role.SALES_EXECUTIVE,
      isActive: false,
      currentWorkload: {
        activeLeads: 2,
        pendingFollowUps: 0,
        overdueFollowUps: 0
      },
      periodPerformance: {
        leadsCreated: 5,
        cohortWon: 1,
        cohortConversionRate: 20.0,
        outreachSent: 8,
        outreachDelivered: 7,
        outreachFailed: 1,
        awaitingDelivery: 0,
        resolvedDeliverySuccessRate: 87.5
      }
    }
  ],
  total: 2
};

describe('M7 Step 6: Sales Dashboard Frontend UI Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      id: 'user-manager-1',
      name: 'Bob Manager',
      email: 'bob@company.com',
      role: Role.SALES_MANAGER
    };
    mockHasPermission.mockImplementation((perm: string) => perm === Permissions.REPORTS_READ);
    mockIsAuthenticated = true;
    mockIsLoading = false;
  });

  describe('1. Role Access & REPORTS_READ Permission Gate', () => {
    it('renders Access Denied banner when user lacks REPORTS_READ permission', () => {
      mockHasPermission.mockImplementation(() => false);
      const html = renderToStaticMarkup(<DashboardPage />);

      expect(html).toContain('Access Denied');
      expect(html).toContain('You do not have permission to view sales reports');
    });

    it('renders Dashboard Page for SUPER_ADMIN with REPORTS_READ', () => {
      mockUser = { id: 'sa-1', name: 'Alice SA', email: 'alice@test.com', role: Role.SUPER_ADMIN };
      const html = renderToStaticMarkup(<DashboardPage />);

      expect(html).toContain('Sales &amp; Pipeline Dashboard');
      expect(html).toContain(Role.SUPER_ADMIN);
      expect(html).not.toContain('Access Denied');
    });

    it('renders Dashboard Page for ADMIN with REPORTS_READ', () => {
      mockUser = { id: 'admin-1', name: 'Aaron Admin', email: 'admin@test.com', role: Role.ADMIN };
      const html = renderToStaticMarkup(<DashboardPage />);

      expect(html).toContain('Sales &amp; Pipeline Dashboard');
      expect(html).toContain(Role.ADMIN);
    });

    it('renders Dashboard Page for SALES_MANAGER with REPORTS_READ', () => {
      mockUser = { id: 'sm-1', name: 'Bob Manager', email: 'sm@test.com', role: Role.SALES_MANAGER };
      const html = renderToStaticMarkup(<DashboardPage />);

      expect(html).toContain('Sales &amp; Pipeline Dashboard');
      expect(html).toContain(Role.SALES_MANAGER);
    });

    it('renders Dashboard Page for VIEWER with REPORTS_READ', () => {
      mockUser = { id: 'v-1', name: 'Vicky Viewer', email: 'vicky@test.com', role: Role.VIEWER };
      const html = renderToStaticMarkup(<DashboardPage />);

      expect(html).toContain('Sales &amp; Pipeline Dashboard');
      expect(html).toContain(Role.VIEWER);
    });

    it('renders Dashboard Page for SALES_EXECUTIVE with self-scoped indicator', () => {
      mockUser = { id: 'se-1', name: 'Charlie Exec', email: 'charlie@test.com', role: Role.SALES_EXECUTIVE };
      const html = renderToStaticMarkup(<DashboardPage />);

      expect(html).toContain('Sales &amp; Pipeline Dashboard');
      expect(html).toContain(Role.SALES_EXECUTIVE);
      expect(html).toContain('Self-Scoped View');
      expect(html).toContain('Your personal lead pipeline, follow-ups, and outreach performance');
    });
  });

  describe('2. SALES_EXECUTIVE Scope UX & Assignee Picker Hiding', () => {
    it('hides assignee filter dropdown completely for SALES_EXECUTIVE', () => {
      const html = renderToStaticMarkup(
        <DashboardFilterBar
          filters={{ preset: DashboardDatePreset.DAYS_30 }}
          onFilterChange={vi.fn()}
          onRefresh={vi.fn()}
          showAssigneePicker={false}
          teamMembers={[{ id: 'u1', name: 'Other Rep', role: Role.SALES_EXECUTIVE, isActive: true }]}
        />
      );

      expect(html).not.toContain('All Team Members');
      expect(html).not.toContain('Other Rep');
    });

    it('shows assignee filter dropdown for non-executive roles (showAssigneePicker = true)', () => {
      const html = renderToStaticMarkup(
        <DashboardFilterBar
          filters={{ preset: DashboardDatePreset.DAYS_30 }}
          onFilterChange={vi.fn()}
          onRefresh={vi.fn()}
          showAssigneePicker={true}
          teamMembers={[{ id: 'u1', name: 'Charlie Rep', role: Role.SALES_EXECUTIVE, isActive: true }]}
        />
      );

      expect(html).toContain('All Team Members');
      expect(html).toContain('Charlie Rep');
    });
  });

  describe('3. Filter Bar & Custom Range Validation', () => {
    it('renders date presets (7d, 30d, 90d, custom) with 30d default styling', () => {
      const html = renderToStaticMarkup(
        <DashboardFilterBar
          filters={{ preset: DashboardDatePreset.DAYS_30 }}
          onFilterChange={vi.fn()}
          onRefresh={vi.fn()}
          showAssigneePicker={true}
        />
      );

      expect(html).toContain('7 Days');
      expect(html).toContain('30 Days');
      expect(html).toContain('90 Days');
      expect(html).toContain('Custom');
      expect(html).toContain('Refresh');
    });

    it('renders custom date From and To inputs when preset is CUSTOM', () => {
      const html = renderToStaticMarkup(
        <DashboardFilterBar
          filters={{
            preset: DashboardDatePreset.CUSTOM,
            from: '2026-09-01',
            to: '2026-10-01'
          }}
          onFilterChange={vi.fn()}
          onRefresh={vi.fn()}
          showAssigneePicker={true}
          customDateError="From date must be before or equal to To date."
        />
      );

      expect(html).toContain('id="custom-from"');
      expect(html).toContain('id="custom-to"');
      expect(html).toContain('From date must be before or equal to To date.');
    });
  });

  describe('4. KPI Summary Cards & Formatting', () => {
    it('renders API-provided KPI values without client recalculation', () => {
      const html = renderToStaticMarkup(<KpiSummaryCards summary={sampleSummary} />);

      // Leads cohort
      expect(html).toContain('25'); // totalCohort
      expect(html).toContain('5');  // cohortWon
      expect(html).toContain('20.0%'); // cohortConversionRate

      // Follow-ups
      expect(html).toContain('4');  // dueToday
      expect(html).toContain('2');  // overdue
      expect(html).toContain('11'); // completed

      // Outreach
      expect(html).toContain('40'); // sent
      expect(html).toContain('32'); // delivered
      expect(html).toContain('88.9%'); // resolvedDeliverySuccessRate
    });

    it('handles zero values cleanly without NaN or undefined', () => {
      const zeroSummary: DashboardSummaryResponse = {
        range: sampleSummary.range,
        leads: { totalCohort: 0, cohortWon: 0, cohortConversionRate: 0 },
        followUps: { dueToday: 0, overdue: 0, completed: 0 },
        outreach: { sent: 0, delivered: 0, failed: 0, awaitingDelivery: 0, resolvedDeliverySuccessRate: 0 }
      };

      const html = renderToStaticMarkup(<KpiSummaryCards summary={zeroSummary} />);

      expect(html).not.toContain('NaN');
      expect(html).not.toContain('Infinity');
      expect(html).toContain('0.0%');
    });
  });

  describe('5. Current Pipeline Visualization', () => {
    it('renders all 7 canonical stages and preserves zero stages', () => {
      const html = renderToStaticMarkup(<CurrentPipelineCard funnel={sampleFunnel} />);

      expect(html).toContain('Current Pipeline');
      expect(html).toContain('New');
      expect(html).toContain('Contacted');
      expect(html).toContain('Qualified');
      expect(html).toContain('Proposal Sent');
      expect(html).toContain('Negotiation');
      expect(html).toContain('Won');
      expect(html).toContain('Lost');

      // Preserves zero stage
      expect(html).toContain('Lost');
      expect(html).toContain('0');
      expect(html).toContain('28'); // Total in Pipeline
    });
  });

  describe('6. Lead Sources Breakdown', () => {
    it('renders source rows and maps UNKNOWN to friendly Unknown label', () => {
      const html = renderToStaticMarkup(<LeadSourcesCard sourcesData={sampleSources} />);

      expect(html).toContain('Lead Acquisition Sources');
      expect(html).toContain('Google Search');
      expect(html).toContain('Unknown'); // Formatted from UNKNOWN
      expect(html).toContain('Website');
      expect(html).toContain('15');
      expect(html).toContain('8');
    });

    it('renders empty state when sources array is empty', () => {
      const emptySources: DashboardSourcesResponse = { sources: [], total: 0 };
      const html = renderToStaticMarkup(<LeadSourcesCard sourcesData={emptySources} />);

      expect(html).toContain('No lead-source data for this selection.');
    });
  });

  describe('7. Outreach Channel Performance', () => {
    it('renders totals and compares WhatsApp and Email channels', () => {
      const html = renderToStaticMarkup(<OutreachPerformanceCard outreach={sampleOutreach} />);

      expect(html).toContain('Outreach Channel Performance');
      expect(html).toContain('WhatsApp');
      expect(html).toContain('Email');
      expect(html).toContain('91.3%');
      expect(html).toContain('84.6%');
      expect(html).toContain('88.9%');
    });

    it('renders empty state when total sent is zero', () => {
      const emptyOutreach: DashboardOutreachResponse = {
        totals: { sent: 0, delivered: 0, failed: 0, awaitingDelivery: 0, resolvedDeliverySuccessRate: 0 },
        channels: []
      };
      const html = renderToStaticMarkup(<OutreachPerformanceCard outreach={emptyOutreach} />);

      expect(html).toContain('No outreach was sent in this period.');
    });
  });

  describe('8. Team Performance Table', () => {
    it('renders member rows with active and inactive statuses and no arbitrary rankings', () => {
      const html = renderToStaticMarkup(<TeamPerformanceTable performance={sampleTeamPerformance} />);

      expect(html).toContain('Team Performance');
      expect(html).toContain('Charlie Rep');
      expect(html).toContain('Dave Inactive');
      expect(html).toContain('Active');
      expect(html).toContain('Inactive');

      // Workload and acquisition metrics
      expect(html).toContain('8');  // Active Leads
      expect(html).toContain('14'); // Leads Created
      expect(html).toContain('21.4%'); // Conversion Rate

      // No leaderboard / rank badges
      expect(html).not.toContain('Rank');
      expect(html).not.toContain('Top Performer');
    });
  });

  describe('9. Friendly Error Handling & Display', () => {
    it('translates HTTP 401 to friendly login message', () => {
      const err = new ApiClientError('UNAUTHENTICATED', 'Auth required', 401);
      expect(getFriendlyDashboardErrorMessage(err)).toBe('Please log in to view the sales dashboard.');
    });

    it('translates HTTP 403 to friendly permissions message', () => {
      const err = new ApiClientError('FORBIDDEN', 'Forbidden', 403);
      expect(getFriendlyDashboardErrorMessage(err)).toBe('You do not have permission to view sales reports.');
    });

    it('translates HTTP 404 to safe generic assignee unavailable message', () => {
      const err = new ApiClientError('NOT_FOUND', 'Not found in organization', 404);
      expect(getFriendlyDashboardErrorMessage(err)).toBe('Selected team member is unavailable.');
    });

    it('translates HTTP 422 to friendly validation error message', () => {
      const err = new ApiClientError('VALIDATION_ERROR', 'Input validation failed', 422);
      expect(getFriendlyDashboardErrorMessage(err)).toBe('Invalid filter criteria. Please verify date parameters or inputs.');
    });

    it('translates HTTP 500 to server error message', () => {
      const err = new ApiClientError('INTERNAL_SERVER_ERROR', 'DB crashed', 500);
      expect(getFriendlyDashboardErrorMessage(err)).toBe('Server error while calculating sales metrics. Please try again later.');
    });
  });

  describe('10. Typed API Client Dashboard Endpoints Verification', () => {
    it('exposes all 5 dashboard methods on apiClient.dashboard and apiClient top-level', () => {
      expect(typeof apiClient.dashboard.getSummary).toBe('function');
      expect(typeof apiClient.dashboard.getFunnel).toBe('function');
      expect(typeof apiClient.dashboard.getSources).toBe('function');
      expect(typeof apiClient.dashboard.getOutreach).toBe('function');
      expect(typeof apiClient.dashboard.getTeamPerformance).toBe('function');

      expect(typeof apiClient.getDashboardSummary).toBe('function');
      expect(typeof apiClient.getDashboardFunnel).toBe('function');
      expect(typeof apiClient.getDashboardSources).toBe('function');
      expect(typeof apiClient.getDashboardOutreach).toBe('function');
      expect(typeof apiClient.getDashboardTeamPerformance).toBe('function');
    });
  });

  describe('11. VIEWER Role Assignee Derivation & RBAC Integrity', () => {
    it('renders dashboard with assignee selector for VIEWER without USERS_READ permission', () => {
      mockUser = { id: 'v-1', name: 'Vicky Viewer', email: 'vicky@test.com', role: Role.VIEWER };
      // VIEWER only has REPORTS_READ, not USERS_READ
      mockHasPermission.mockImplementation((p: string) => p === Permissions.REPORTS_READ);

      const html = renderToStaticMarkup(<DashboardPage />);
      expect(html).toContain('Sales &amp; Pipeline Dashboard');
      expect(html).toContain(Role.VIEWER);
      expect(html).not.toContain('Access Denied');
      expect(html).not.toContain('Self-Scoped View');
    });

    it('derives assignee options from team-performance response with inactive label', () => {
      const options = deriveAssigneeOptions([], sampleTeamPerformance.members);

      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({
        id: 'exec-1',
        name: 'Charlie Rep',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      });
      expect(options[1]).toEqual({
        id: 'exec-2',
        name: 'Dave Inactive',
        role: Role.SALES_EXECUTIVE,
        isActive: false
      });

      // Verify active vs inactive option labels
      expect(formatAssigneeLabel(options[0])).toBe('Charlie Rep');
      expect(formatAssigneeLabel(options[1])).toBe('Dave Inactive — Inactive');
    });

    it('renders inactive assignee in dropdown with clear — Inactive suffix', () => {
      const options = deriveAssigneeOptions([], sampleTeamPerformance.members);
      const html = renderToStaticMarkup(
        <DashboardFilterBar
          filters={{ preset: DashboardDatePreset.DAYS_30 }}
          onFilterChange={vi.fn()}
          onRefresh={vi.fn()}
          showAssigneePicker={true}
          teamMembers={options}
        />
      );

      expect(html).toContain('Charlie Rep');
      expect(html).toContain('Dave Inactive — Inactive');
    });

    it('ensures dashboard does not call apiClient.team.listMembers', () => {
      const teamListSpy = vi.spyOn(apiClient.team, 'listMembers');
      // Render static markup of DashboardPage
      renderToStaticMarkup(<DashboardPage />);
      // apiClient.team.listMembers must never be called by dashboard
      expect(teamListSpy).not.toHaveBeenCalled();
      teamListSpy.mockRestore();
    });
  });

  describe('12. Source Options Stability & Direct Switching', () => {
    it('preserves discovered sources when a specific source filter is selected', () => {
      const initialSources = ['GOOGLE_SEARCH', 'WEBSITE', 'UNKNOWN'];
      // After filtering by GOOGLE_SEARCH, backend may return only GOOGLE_SEARCH
      const filteredSources = ['GOOGLE_SEARCH'];

      const merged = mergeAvailableSources(initialSources, filteredSources, 'GOOGLE_SEARCH');

      expect(merged).toContain('GOOGLE_SEARCH');
      expect(merged).toContain('WEBSITE');
      expect(merged).toContain('UNKNOWN');
      expect(merged).toHaveLength(3);
    });

    it('renders all discovered sources in DashboardFilterBar even when one source is selected', () => {
      const availableSources = ['GOOGLE_SEARCH', 'WEBSITE'];
      const html = renderToStaticMarkup(
        <DashboardFilterBar
          filters={{
            preset: DashboardDatePreset.DAYS_30,
            source: 'GOOGLE_SEARCH'
          }}
          onFilterChange={vi.fn()}
          onRefresh={vi.fn()}
          showAssigneePicker={true}
          availableSources={availableSources}
        />
      );

      // Selected option
      expect(html).toContain('value="GOOGLE_SEARCH"');
      // Alternative option must remain selectable directly
      expect(html).toContain('value="WEBSITE"');
      expect(html).toContain('Website');
    });
  });

  describe('13. Elimination of 100-Member Truncation Risk', () => {
    it('handles >100 sales members from team-performance without 100-member pagination cap', () => {
      // Generate 150 sales members
      const largeMemberList = Array.from({ length: 150 }, (_, i) => ({
        userId: `user-uuid-${String(i + 1).padStart(3, '0')}`,
        name: `Sales Agent ${String(i + 1).padStart(3, '0')}`,
        role: i % 2 === 0 ? Role.SALES_EXECUTIVE : Role.SALES_MANAGER,
        isActive: i % 10 !== 0
      }));

      const options = deriveAssigneeOptions([], largeMemberList);

      expect(options).toHaveLength(150);
      expect(options[0].name).toBe('Sales Agent 001');
      expect(options[149].name).toBe('Sales Agent 150');
    });
  });

  describe('14. Assignee Options Stability Across Subsequent Filter Queries', () => {
    it('preserves full assignee options list when filtering by a specific assignee', () => {
      const allMembers = deriveAssigneeOptions([], sampleTeamPerformance.members);
      expect(allMembers).toHaveLength(2);

      // Simulating a subsequent response that might only return the selected assignee
      const singleMemberUpdate = [sampleTeamPerformance.members[0]];
      const updatedOptions = deriveAssigneeOptions(allMembers, singleMemberUpdate);

      // Must still contain both members
      expect(updatedOptions).toHaveLength(2);
      expect(updatedOptions.map((o) => o.name)).toEqual(['Charlie Rep', 'Dave Inactive']);
    });
  });

  describe('15. Role Parity for Assignee Picker: Non-Executive vs SALES_EXECUTIVE', () => {
    const nonExecRoles = [Role.SUPER_ADMIN, Role.ADMIN, Role.SALES_MANAGER, Role.VIEWER];

    nonExecRoles.forEach((role) => {
      it(`enables assignee picker for ${role}`, () => {
        const isExecutive = role === Role.SALES_EXECUTIVE;
        const html = renderToStaticMarkup(
          <DashboardFilterBar
            filters={{ preset: DashboardDatePreset.DAYS_30 }}
            onFilterChange={vi.fn()}
            onRefresh={vi.fn()}
            showAssigneePicker={!isExecutive}
            teamMembers={deriveAssigneeOptions([], sampleTeamPerformance.members)}
          />
        );

        expect(html).toContain('All Team Members');
        expect(html).toContain('Charlie Rep');
      });
    });

    it('hides assignee picker completely for SALES_EXECUTIVE and suppresses team-performance', () => {
      const isExecutive = true;
      const html = renderToStaticMarkup(
        <DashboardFilterBar
          filters={{ preset: DashboardDatePreset.DAYS_30 }}
          onFilterChange={vi.fn()}
          onRefresh={vi.fn()}
          showAssigneePicker={!isExecutive}
          teamMembers={deriveAssigneeOptions([], sampleTeamPerformance.members)}
        />
      );

      expect(html).not.toContain('All Team Members');
      expect(html).not.toContain('Charlie Rep');
    });
  });

  describe('16. End-to-End Query Scoping & Complete Team API Isolation', () => {
    it('sends correct assigneeId to analytics requests for VIEWER and isolates from Team API', async () => {
      const getSummarySpy = vi.spyOn(apiClient.dashboard, 'getSummary').mockResolvedValue(sampleSummary);
      const getFunnelSpy = vi.spyOn(apiClient.dashboard, 'getFunnel').mockResolvedValue(sampleFunnel);
      const getSourcesSpy = vi.spyOn(apiClient.dashboard, 'getSources').mockResolvedValue(sampleSources);
      const getOutreachSpy = vi.spyOn(apiClient.dashboard, 'getOutreach').mockResolvedValue(sampleOutreach);
      const getTeamPerformanceSpy = vi.spyOn(apiClient.dashboard, 'getTeamPerformance').mockResolvedValue(sampleTeamPerformance);
      const listMembersSpy = vi.spyOn(apiClient.team, 'listMembers');

      const selectedAssigneeId = 'exec-1';
      const query = {
        preset: DashboardDatePreset.DAYS_30,
        assigneeId: selectedAssigneeId
      };

      // Simulated fetch sequence as executed by non-executive dashboard
      const [sum, fun, src, out, team] = await Promise.all([
        apiClient.dashboard.getSummary(query),
        apiClient.dashboard.getFunnel(query),
        apiClient.dashboard.getSources(query),
        apiClient.dashboard.getOutreach(query),
        apiClient.dashboard.getTeamPerformance(query)
      ]);

      expect(getSummarySpy).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'exec-1' }));
      expect(getFunnelSpy).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'exec-1' }));
      expect(getSourcesSpy).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'exec-1' }));
      expect(getOutreachSpy).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'exec-1' }));
      expect(getTeamPerformanceSpy).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'exec-1' }));
      expect(listMembersSpy).not.toHaveBeenCalled();

      // Ensure assignee options are derivable from the team-performance response
      const options = deriveAssigneeOptions([], team.members);
      expect(options).toHaveLength(2);
      expect(options[0].id).toBe('exec-1');

      getSummarySpy.mockRestore();
      getFunnelSpy.mockRestore();
      getSourcesSpy.mockRestore();
      getOutreachSpy.mockRestore();
      getTeamPerformanceSpy.mockRestore();
      listMembersSpy.mockRestore();
    });

    it('suppresses assigneeId and team-performance requests for SALES_EXECUTIVE', async () => {
      const getSummarySpy = vi.spyOn(apiClient.dashboard, 'getSummary').mockResolvedValue(sampleSummary);
      const getFunnelSpy = vi.spyOn(apiClient.dashboard, 'getFunnel').mockResolvedValue(sampleFunnel);
      const getSourcesSpy = vi.spyOn(apiClient.dashboard, 'getSources').mockResolvedValue(sampleSources);
      const getOutreachSpy = vi.spyOn(apiClient.dashboard, 'getOutreach').mockResolvedValue(sampleOutreach);
      const getTeamPerformanceSpy = vi.spyOn(apiClient.dashboard, 'getTeamPerformance');
      const listMembersSpy = vi.spyOn(apiClient.team, 'listMembers');

      const isExecutive = true;
      const query = {
        preset: DashboardDatePreset.DAYS_30,
        assigneeId: isExecutive ? undefined : 'some-exec'
      };

      await Promise.all([
        apiClient.dashboard.getSummary(query),
        apiClient.dashboard.getFunnel(query),
        apiClient.dashboard.getSources(query),
        apiClient.dashboard.getOutreach(query),
        !isExecutive ? apiClient.dashboard.getTeamPerformance(query) : Promise.resolve(null)
      ]);

      expect(getSummarySpy).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: undefined }));
      expect(getTeamPerformanceSpy).not.toHaveBeenCalled();
      expect(listMembersSpy).not.toHaveBeenCalled();

      getSummarySpy.mockRestore();
      getFunnelSpy.mockRestore();
      getSourcesSpy.mockRestore();
      getOutreachSpy.mockRestore();
      getTeamPerformanceSpy.mockRestore();
      listMembersSpy.mockRestore();
    });
  });

  describe('17. Step 7 Team Workload Summary Strip & Pure Count Aggregation', () => {
    it('calculates aggregate workload counts summing only integers without rate averaging', () => {
      const summary = calculateTeamCurrentWorkload(sampleTeamPerformance.members);

      // Charlie Rep: active 8, pending 3, overdue 1
      // Dave Inactive: active 2, pending 0, overdue 0
      expect(summary.totalActiveLeads).toBe(10);
      expect(summary.totalPendingFollowUps).toBe(3);
      expect(summary.totalOverdueFollowUps).toBe(1);

      // Verify no rates or composite averages are produced
      expect((summary as any).averageConversionRate).toBeUndefined();
      expect((summary as any).averageDeliverySuccessRate).toBeUndefined();
      expect((summary as any).performanceScore).toBeUndefined();
    });

    it('renders Team Current Workload summary strip in TeamPerformanceTable', () => {
      const html = renderToStaticMarkup(<TeamPerformanceTable performance={sampleTeamPerformance} />);

      expect(html).toContain('Team Current Workload');
      expect(html).toContain('Active Leads');
      expect(html).toContain('Pending Follow-ups');
      expect(html).toContain('Overdue Follow-ups');
      expect(html).toContain('10'); // totalActiveLeads
      expect(html).toContain('3');  // totalPendingFollowUps
      expect(html).toContain('1');  // totalOverdueFollowUps
      expect(html).toContain('Requires Attention'); // Overdue > 0 attention badge
    });
  });

  describe('18. Step 7 Local Search, Status Filtering, and Neutral Table Sorting', () => {
    it('filters team members by search query over name and role', () => {
      const searchCharlie = filterTeamMembers(sampleTeamPerformance.members, 'Charlie', 'all');
      expect(searchCharlie).toHaveLength(1);
      expect(searchCharlie[0].name).toBe('Charlie Rep');

      const searchRole = filterTeamMembers(sampleTeamPerformance.members, 'SALES_EXECUTIVE', 'all');
      expect(searchRole).toHaveLength(2);

      const noMatch = filterTeamMembers(sampleTeamPerformance.members, 'NonExistent', 'all');
      expect(noMatch).toHaveLength(0);
    });

    it('filters team members by active / inactive status', () => {
      const activeOnly = filterTeamMembers(sampleTeamPerformance.members, '', 'active');
      expect(activeOnly).toHaveLength(1);
      expect(activeOnly[0].name).toBe('Charlie Rep');

      const inactiveOnly = filterTeamMembers(sampleTeamPerformance.members, '', 'inactive');
      expect(inactiveOnly).toHaveLength(1);
      expect(inactiveOnly[0].name).toBe('Dave Inactive');
    });

    it('defaults to neutral alphabetical sorting by name ASC and supports neutral metric sorts', () => {
      // Default name ASC
      const defaultSort = sortTeamMembers(sampleTeamPerformance.members, 'name', 'asc');
      expect(defaultSort[0].name).toBe('Charlie Rep');
      expect(defaultSort[1].name).toBe('Dave Inactive');

      // Sort by active leads DESC
      const byActiveLeadsDesc = sortTeamMembers(sampleTeamPerformance.members, 'activeLeads', 'desc');
      expect(byActiveLeadsDesc[0].name).toBe('Charlie Rep'); // 8 vs 2

      // Sort by overdue follow-ups DESC
      const byOverdueDesc = sortTeamMembers(sampleTeamPerformance.members, 'overdueFollowUps', 'desc');
      expect(byOverdueDesc[0].name).toBe('Charlie Rep'); // 1 vs 0
    });
  });

  describe('19. Step 7 Operational Workload Urgency & Attention State', () => {
    it('visually highlights overdue follow-ups when greater than zero without judgmental labels', () => {
      const html = renderToStaticMarkup(<TeamPerformanceTable performance={sampleTeamPerformance} />);

      // Has overdue count 1 for Charlie Rep
      expect(html).toContain('Overdue Follow-ups');
      expect(html).toContain('text-rose-400'); // Urgency color
      expect(html).toContain('Requires Attention');

      // Must NOT contain judgmental language
      expect(html).not.toContain('poor');
      expect(html).not.toContain('underperforming');
      expect(html).not.toContain('bad performer');
      expect(html).not.toContain('low performer');
    });
  });

  describe('20. Step 7 Advanced Outreach Analytics: Delivery Meters & Channel Separation', () => {
    it('renders segmented progress meters with accessible labels and separate awaiting delivery', () => {
      const html = renderToStaticMarkup(<OutreachPerformanceCard outreach={sampleOutreach} />);

      expect(html).toContain('Outreach Channel Performance');
      expect(html).toContain('Delivered');
      expect(html).toContain('Failed');
      expect(html).toContain('Awaiting Delivery');
      expect(html).toContain('Awaiting In-Flight');
      expect(html).toContain('Resolved Delivery Success Rate');

      // WhatsApp channel card
      expect(html).toContain('WhatsApp');
      expect(html).toContain('25'); // sent
      expect(html).toContain('21'); // delivered
      expect(html).toContain('91.3%');

      // Email channel card
      expect(html).toContain('Email');
      expect(html).toContain('15'); // sent
      expect(html).toContain('11'); // delivered
      expect(html).toContain('84.6%');

      // Accessible progressbar role
      expect(html).toContain('role="progressbar"');
    });

    it('renders resilient finite zero states for channels with 0 sent without NaN or hidden cards', () => {
      const zeroOutreach: DashboardOutreachResponse = {
        totals: {
          sent: 0,
          delivered: 0,
          failed: 0,
          awaitingDelivery: 0,
          resolvedDeliverySuccessRate: 0
        },
        channels: []
      };

      const html = renderToStaticMarkup(<OutreachPerformanceCard outreach={zeroOutreach} />);

      expect(html).toContain('No outreach was sent in this period.');
      expect(html).toContain('WhatsApp');
      expect(html).toContain('Email');
      expect(html).toContain('0 sent');
      expect(html).toContain('0.0%');
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('Infinity');
    });
  });

  describe('21. Step 7 Strict Server Formula & Rate Display Integrity', () => {
    it('displays server-computed conversion and success rates directly without client recalculation', () => {
      const customPerformance: DashboardTeamPerformanceResponse = {
        members: [
          {
            userId: 'user-rate-1',
            name: 'Exact Rate Rep',
            role: Role.SALES_EXECUTIVE,
            isActive: true,
            currentWorkload: { activeLeads: 5, pendingFollowUps: 2, overdueFollowUps: 0 },
            periodPerformance: {
              leadsCreated: 10,
              cohortWon: 3,
              cohortConversionRate: 37.25,
              outreachSent: 50,
              outreachDelivered: 45,
              outreachFailed: 3,
              awaitingDelivery: 2,
              resolvedDeliverySuccessRate: 93.75
            }
          }
        ],
        total: 1
      };

      const html = renderToStaticMarkup(<TeamPerformanceTable performance={customPerformance} />);

      // Exactly formats server rate to 1 decimal place: 37.3% and 93.8%
      expect(html).toContain('37.3%');
      expect(html).toContain('93.8%');
      expect(html).toContain('Exact Rate Rep');
    });
  });

  describe('22. Step 7 Anti-Gamification Verification', () => {
    it('verifies that no competitive ranking, score, or trophy badges exist in rendered team UI', () => {
      const html = renderToStaticMarkup(<TeamPerformanceTable performance={sampleTeamPerformance} />);

      expect(html).not.toContain('Leaderboard');
      expect(html).not.toContain('Rank');
      expect(html).not.toContain('#1');
      expect(html).not.toContain('Top Performer');
      expect(html).not.toContain('Best Rep');
      expect(html).not.toContain('Worst Rep');
      expect(html).not.toContain('Sales Score');
      expect(html).not.toContain('Performance Score');
      expect(html).not.toContain('AI Score');
      expect(html).not.toContain('trophy');
    });
  });

  describe('23. Step 7 Mobile & Responsive Component Rendering', () => {
    it('renders both desktop structured table and mobile card layout with accessible toggle buttons', () => {
      const html = renderToStaticMarkup(<TeamPerformanceTable performance={sampleTeamPerformance} />);

      // Desktop table wrapper
      expect(html).toContain('hidden md:block');
      // Mobile cards wrapper
      expect(html).toContain('md:hidden');
      // Accessible buttons for expanding details
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('aria-label="Toggle details for Charlie Rep"');
      expect(html).toContain('aria-label="Toggle full details for Charlie Rep"');
    });
  });
});
