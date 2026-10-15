import {
  ApiErrorResponse,
  ApiSuccessResponse,
  AuthUser,
  Permission,
  DuplicateAction,
  ContactType,
  type BusinessSearchResult,
  type SaveLeadRequest,
  type BusinessSearchSessionSummary,
  type BusinessSearchSessionDetail,
  type CreateBusinessSearchSessionInput,
  type LeadSummary,
  type LeadDetail,
  type LeadContact,
  type LeadListQuery,
  type LeadUpdateRequest,
  type LeadAnalysisResponse,
  CrmStage,
  type AssigneeSummary,
  type LeadAssignmentResponse,
  type CrmStageUpdateResponse,
  type CrmNote,
  type CrmActivity,
  type CreateDemoWebsiteRequest,
  type DemoWebsiteSummary,
  type GenerateSalesAssistantDraftRequest,
  type SalesAssistantDraftSummary,
  type SendOutreachDeliveryRequest,
  type OutreachDeliverySummary,
  type TeamMemberListQuery,
  type TeamMemberListResponse,
  type TeamMemberDetail,
  type TeamMemberActionResponse,
  type CreateTeamMemberRequest,
  type UpdateTeamMemberRequest,
  type DashboardFilterQuery,
  type DashboardSummaryResponse,
  type DashboardFunnelResponse,
  type DashboardSourcesResponse,
  type DashboardOutreachResponse,
  type DashboardTeamPerformanceResponse,
  type DataSourcesListResponse,
  type DataSourceCardStatus,
  type DemoCatalogItem,
  type CampaignSummary,
  type CreateCampaignRequest,
  type ProductDto,
  type CreateProductInput,
  type UpdateProductInput,
  type SalesMissionDetailDto,
  type SalesMissionBuyerDto,
  type CreateSalesMissionInput,
  type UpdateSalesMissionInput,
  type AiProductAnalysisResult,
  type AnalyzeProductInput,
  type AnalyzeProductRequest
} from '@leadmate/shared';


function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
}

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly fields?: Record<string, string>;
  public readonly requestId?: string;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: unknown,
    requestId?: string,
    fields?: Record<string, string>
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.fields = fields;
    this.requestId = requestId;
  }
}

export interface AuthSessionData {
  user: AuthUser;
  permissions: Permission[];
}

export interface BusinessSearchQueryParams {
  q: string;
  location: string;
  category?: string;
  buyerType?: string;
  limit?: number;
  provider?: string;
  targetCategories?: string[] | string;
}

export interface LocationSuggestionItem {
  id: string;
  label: string;
  primaryText: string;
  secondaryText?: string;
}

export interface SaveLeadResponse {
  action: DuplicateAction;
  leadId: string;
  matchReason?: string;
}

export interface LeadListResponse {
  data: LeadSummary[];
  meta: {
    nextCursor: string | null;
    total: number;
    hasMore: boolean;
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  // Strictly enforce httpOnly cookie credentials inclusion
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    if (data && (data as ApiErrorResponse).error) {
      const { code, message, details, requestId, fields } = (data as any).error;
      const topFields = (data as any).fields || fields;
      let displayMessage = message;
      if (topFields && typeof topFields === 'object' && Object.keys(topFields).length > 0) {
        const firstKey = Object.keys(topFields)[0];
        displayMessage = topFields[firstKey] || message;
      } else if (Array.isArray(details) && details.length > 0 && details[0]?.message) {
        displayMessage = details[0].message;
      }
      throw new ApiClientError(code, displayMessage, res.status, details, requestId, topFields);
    }
    throw new ApiClientError('HTTP_ERROR', res.statusText || 'An error occurred', res.status);
  }

  return ((data as ApiSuccessResponse<T>)?.data !== undefined ? (data as ApiSuccessResponse<T>).data : data) as T;
}

async function requestEnvelope<T, M = Record<string, unknown>>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T; meta?: M }> {
  const url = `${getApiBaseUrl()}${path}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    if (data && (data as ApiErrorResponse).error) {
      const { code, message, details, requestId } = (data as ApiErrorResponse).error;
      throw new ApiClientError(code, message, res.status, details, requestId);
    }
    throw new ApiClientError('HTTP_ERROR', res.statusText || 'An error occurred', res.status);
  }

  return {
    data: (data?.data !== undefined ? data.data : data) as T,
    meta: data?.meta as M | undefined
  };
}

export const apiClient = {
  auth: {
    login: (email: string, password: string): Promise<AuthSessionData> =>
      request<AuthSessionData>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      }),
    logout: (): Promise<{ success: boolean }> =>
      request<{ success: boolean }>('/auth/logout', {
        method: 'POST'
      }),
    me: (): Promise<AuthSessionData> =>
      request<AuthSessionData>('/auth/me', {
        method: 'GET'
      })
  },
  businessSearch: {
    search: (params: BusinessSearchQueryParams): Promise<BusinessSearchResult[]> => {
      const searchParams = new URLSearchParams();
      searchParams.set('q', params.q);
      searchParams.set('location', params.location);
      if (params.category) searchParams.set('category', params.category);
      if (params.buyerType) searchParams.set('buyerType', params.buyerType);
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
      if (params.provider) searchParams.set('provider', params.provider);
      if (params.targetCategories) {
        if (Array.isArray(params.targetCategories)) {
          searchParams.set('targetCategories', params.targetCategories.join(','));
        } else {
          searchParams.set('targetCategories', params.targetCategories);
        }
      }

      return request<BusinessSearchResult[]>(`/business-search?${searchParams.toString()}`, {
        method: 'GET'
      });
    },
    saveLead: (input: SaveLeadRequest): Promise<SaveLeadResponse> =>
      request<SaveLeadResponse>('/business-search/save-lead', {
        method: 'POST',
        body: JSON.stringify(input)
      }),
    getHistory: (limit = 20, options: RequestInit = {}): Promise<BusinessSearchSessionSummary[]> =>
      request<BusinessSearchSessionSummary[]>(`/business-search/history?limit=${limit}`, {
        ...options,
        method: 'GET'
      }),
    getLatestSession: async (options: RequestInit = {}): Promise<BusinessSearchSessionDetail | null> => {
      const res = await request<BusinessSearchSessionDetail | null>('/business-search/history/latest', {
        ...options,
        method: 'GET'
      });
      return res || null;
    },
    getSession: (id: string, options: RequestInit = {}): Promise<BusinessSearchSessionDetail> =>
      request<BusinessSearchSessionDetail>(`/business-search/history/${encodeURIComponent(id)}`, {
        ...options,
        method: 'GET'
      }),
    saveSession: (
      input: CreateBusinessSearchSessionInput,
      options: RequestInit = {}
    ): Promise<BusinessSearchSessionDetail> =>
      request<BusinessSearchSessionDetail>('/business-search/history', {
        ...options,
        method: 'POST',
        body: JSON.stringify(input)
      }),
    deleteSession: (id: string, options: RequestInit = {}): Promise<{ success: boolean }> =>
      request<{ success: boolean }>(`/business-search/history/${encodeURIComponent(id)}`, {
        ...options,
        method: 'DELETE'
      }),
    clearHistory: (options: RequestInit = {}): Promise<{ success: boolean; count: number }> =>
      request<{ success: boolean; count: number }>('/business-search/history', {
        ...options,
        method: 'DELETE'
      })
  },
  locations: {
    suggest: async (
      q: string,
      limit = 5,
      options: RequestInit = {}
    ): Promise<LocationSuggestionItem[]> => {
      const searchParams = new URLSearchParams();
      searchParams.set('q', q);
      if (limit) searchParams.set('limit', String(limit));
      const res = await request<LocationSuggestionItem[] | { data: LocationSuggestionItem[] }>(
        `/locations/suggest?${searchParams.toString()}`,
        {
          ...options,
          method: 'GET'
        }
      );
      if (Array.isArray(res)) return res;
      if (res && Array.isArray((res as any).data)) return (res as any).data;
      return [];
    }
  },
  leads: {
    list: async (params: Partial<LeadListQuery> = {}, options: RequestInit = {}): Promise<LeadListResponse> => {
      const searchParams = new URLSearchParams();
      if (params.search) searchParams.set('search', params.search);
      if (params.city) searchParams.set('city', params.city);
      if (params.category) searchParams.set('category', params.category);
      if (params.websiteStatus) searchParams.set('websiteStatus', params.websiteStatus);
      if (params.onlinePresence) searchParams.set('onlinePresence', params.onlinePresence);
      if (params.hasPhone !== undefined) searchParams.set('hasPhone', String(params.hasPhone));
      if (params.hasEmail !== undefined) searchParams.set('hasEmail', String(params.hasEmail));
      if (params.hasWhatsApp !== undefined) searchParams.set('hasWhatsApp', String(params.hasWhatsApp));
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
      if (params.cursor) searchParams.set('cursor', params.cursor);

      const queryStr = searchParams.toString();
      const path = queryStr ? `/leads?${queryStr}` : '/leads';
      const res = await requestEnvelope<LeadSummary[], { nextCursor: string | null; total: number; hasMore: boolean }>(path, {
        ...options,
        method: 'GET'
      });

      return {
        data: res.data || [],
        meta: {
          nextCursor: res.meta?.nextCursor ?? null,
          total: res.meta?.total ?? (res.data?.length || 0),
          hasMore: res.meta?.hasMore ?? false
        }
      };
    },
    get: (id: string, options: RequestInit = {}): Promise<LeadDetail> =>
      request<LeadDetail>(`/leads/${encodeURIComponent(id)}`, {
        ...options,
        method: 'GET'
      }),
    update: (id: string, input: LeadUpdateRequest, options: RequestInit = {}): Promise<LeadDetail> =>
      request<LeadDetail>(`/leads/${encodeURIComponent(id)}`, {
        ...options,
        method: 'PATCH',
        body: JSON.stringify(input)
      }),
    addContact: (
      id: string,
      input: { type: ContactType; rawValue: string; isPrimary?: boolean },
      options: RequestInit = {}
    ): Promise<LeadContact> =>
      request<LeadContact>(`/leads/${encodeURIComponent(id)}/contacts`, {
        ...options,
        method: 'POST',
        body: JSON.stringify(input)
      }),
    getAnalysis: (id: string, options: RequestInit = {}): Promise<LeadAnalysisResponse | null> =>
      request<LeadAnalysisResponse | null>(`/leads/${encodeURIComponent(id)}/analysis`, {
        ...options,
        method: 'GET'
      }),
    analyze: (id: string, options: RequestInit = {}): Promise<LeadAnalysisResponse> =>
      request<LeadAnalysisResponse>(`/leads/${encodeURIComponent(id)}/analyze`, {
        ...options,
        method: 'POST'
      }),
    getAssignees: (options: RequestInit = {}): Promise<AssigneeSummary[]> =>
      request<AssigneeSummary[]>('/leads/assignees', {
        ...options,
        method: 'GET'
      }),
    updateCrmStage: (
      id: string,
      stage: CrmStage,
      options: RequestInit = {}
    ): Promise<CrmStageUpdateResponse> =>
      request<CrmStageUpdateResponse>(`/leads/${encodeURIComponent(id)}/crm-stage`, {
        ...options,
        method: 'PATCH',
        body: JSON.stringify({ stage })
      }),
    updateAssignment: (
      id: string,
      assignedUserId: string | null,
      options: RequestInit = {}
    ): Promise<LeadAssignmentResponse> =>
      request<LeadAssignmentResponse>(`/leads/${encodeURIComponent(id)}/assignment`, {
        ...options,
        method: 'PATCH',
        body: JSON.stringify({ assignedUserId })
      }),
    getNotes: (id: string, options: RequestInit = {}): Promise<CrmNote[]> =>
      request<CrmNote[]>(`/leads/${encodeURIComponent(id)}/notes`, {
        ...options,
        method: 'GET'
      }),
    addNote: (
      id: string,
      input: { content: string },
      options: RequestInit = {}
    ): Promise<CrmNote> =>
      request<CrmNote>(`/leads/${encodeURIComponent(id)}/notes`, {
        ...options,
        method: 'POST',
        body: JSON.stringify(input)
      }),
    getActivities: (id: string, options: RequestInit = {}): Promise<CrmActivity[]> =>
      request<CrmActivity[]>(`/leads/${encodeURIComponent(id)}/activities`, {
        ...options,
        method: 'GET'
      }),
    getDemo: async (id: string, options: RequestInit = {}): Promise<DemoWebsiteSummary | null> => {
      try {
        return await request<DemoWebsiteSummary>(`/leads/${encodeURIComponent(id)}/demo`, {
          ...options,
          method: 'GET'
        });
      } catch (err) {
        if (err instanceof ApiClientError && err.statusCode === 404) {
          return null;
        }
        throw err;
      }
    },
    createDemo: (
      id: string,
      input?: Partial<CreateDemoWebsiteRequest>,
      options: RequestInit = {}
    ): Promise<DemoWebsiteSummary> =>
      request<DemoWebsiteSummary>(`/leads/${encodeURIComponent(id)}/demo`, {
        ...options,
        method: 'POST',
        body: JSON.stringify(input || {})
      }),
    regenerateDemo: (
      id: string,
      input?: Partial<CreateDemoWebsiteRequest>,
      options: RequestInit = {}
    ): Promise<DemoWebsiteSummary> =>
      request<DemoWebsiteSummary>(`/leads/${encodeURIComponent(id)}/demo/regenerate`, {
        ...options,
        method: 'POST',
        body: JSON.stringify(input || {})
      }),
    expireDemo: (id: string, options: RequestInit = {}): Promise<DemoWebsiteSummary> =>
      request<DemoWebsiteSummary>(`/leads/${encodeURIComponent(id)}/demo/expire`, {
        ...options,
        method: 'POST',
        body: JSON.stringify({})
      }),
    removeDemo: (id: string, options: RequestInit = {}): Promise<DemoWebsiteSummary> =>
      request<DemoWebsiteSummary>(`/leads/${encodeURIComponent(id)}/demo/remove`, {
        ...options,
        method: 'POST',
        body: JSON.stringify({})
      }),
    generateSalesAssistantDraft: (
      id: string,
      input: GenerateSalesAssistantDraftRequest,
      options: RequestInit = {}
    ): Promise<SalesAssistantDraftSummary> =>
      request<SalesAssistantDraftSummary>(`/leads/${encodeURIComponent(id)}/sales-assistant/drafts`, {
        ...options,
        method: 'POST',
        body: JSON.stringify(input)
      }),
    listSalesAssistantDrafts: (
      id: string,
      options: RequestInit = {}
    ): Promise<SalesAssistantDraftSummary[]> =>
      request<SalesAssistantDraftSummary[]>(`/leads/${encodeURIComponent(id)}/sales-assistant/drafts`, {
        ...options,
        method: 'GET'
      }),
    getSalesAssistantDraft: (
      id: string,
      draftId: string,
      options: RequestInit = {}
    ): Promise<SalesAssistantDraftSummary> =>
      request<SalesAssistantDraftSummary>(
        `/leads/${encodeURIComponent(id)}/sales-assistant/drafts/${encodeURIComponent(draftId)}`,
        {
          ...options,
          method: 'GET'
        }
      ),
    approveSalesAssistantDraft: (
      id: string,
      draftId: string,
      options: RequestInit = {}
    ): Promise<SalesAssistantDraftSummary> =>
      request<SalesAssistantDraftSummary>(
        `/leads/${encodeURIComponent(id)}/sales-assistant/drafts/${encodeURIComponent(draftId)}/approve`,
        {
          ...options,
          method: 'POST',
          body: JSON.stringify({})
        }
      ),
    rejectSalesAssistantDraft: (
      id: string,
      draftId: string,
      options: RequestInit = {}
    ): Promise<SalesAssistantDraftSummary> =>
      request<SalesAssistantDraftSummary>(
        `/leads/${encodeURIComponent(id)}/sales-assistant/drafts/${encodeURIComponent(draftId)}/reject`,
        {
          ...options,
          method: 'POST',
          body: JSON.stringify({})
        }
      ),
    sendOutreachDelivery: (
      id: string,
      input: SendOutreachDeliveryRequest,
      idempotencyKey: string,
      options: RequestInit = {}
    ): Promise<OutreachDeliverySummary> => {
      const headers = new Headers(options.headers || {});
      headers.set('Idempotency-Key', idempotencyKey);
      return request<OutreachDeliverySummary>(
        `/leads/${encodeURIComponent(id)}/outreach/deliveries`,
        {
          ...options,
          method: 'POST',
          headers,
          body: JSON.stringify(input)
        }
      );
    },
    listOutreachDeliveries: (
      id: string,
      options: RequestInit = {}
    ): Promise<{ deliveries: OutreachDeliverySummary[]; total: number }> =>
      request<{ deliveries: OutreachDeliverySummary[]; total: number }>(
        `/leads/${encodeURIComponent(id)}/outreach/deliveries`,
        {
          ...options,
          method: 'GET'
        }
      ),
    getOutreachDelivery: (
      id: string,
      deliveryId: string,
      options: RequestInit = {}
    ): Promise<OutreachDeliverySummary> =>
      request<OutreachDeliverySummary>(
        `/leads/${encodeURIComponent(id)}/outreach/deliveries/${encodeURIComponent(deliveryId)}`,
        {
          ...options,
          method: 'GET'
        }
      )
  },
  team: {
    listMembers: (
      query: Partial<TeamMemberListQuery> = {},
      options: RequestInit = {}
    ): Promise<TeamMemberListResponse> => {
      const searchParams = new URLSearchParams();
      if (query.page !== undefined) searchParams.set('page', String(query.page));
      if (query.limit !== undefined) searchParams.set('limit', String(query.limit));
      if (query.sortBy) searchParams.set('sortBy', query.sortBy);
      if (query.sortOrder) searchParams.set('sortOrder', query.sortOrder);
      if (query.search) searchParams.set('search', query.search);
      if (query.role) searchParams.set('role', query.role);
      if (query.isActive !== undefined) searchParams.set('isActive', String(query.isActive));
      const qs = searchParams.toString();
      return request<TeamMemberListResponse>(`/team/members${qs ? `?${qs}` : ''}`, {
        ...options,
        method: 'GET'
      });
    },
    getMember: (
      userId: string,
      options: RequestInit = {}
    ): Promise<TeamMemberDetail> =>
      request<TeamMemberDetail>(`/team/members/${encodeURIComponent(userId)}`, {
        ...options,
        method: 'GET'
      }),
    createMember: (
      input: CreateTeamMemberRequest,
      options: RequestInit = {}
    ): Promise<TeamMemberDetail> =>
      request<TeamMemberDetail>('/team/members', {
        ...options,
        method: 'POST',
        body: JSON.stringify(input)
      }),
    updateMember: (
      userId: string,
      input: UpdateTeamMemberRequest,
      options: RequestInit = {}
    ): Promise<TeamMemberDetail> =>
      request<TeamMemberDetail>(`/team/members/${encodeURIComponent(userId)}`, {
        ...options,
        method: 'PATCH',
        body: JSON.stringify(input)
      }),
    activateMember: (
      userId: string,
      options: RequestInit = {}
    ): Promise<TeamMemberActionResponse> =>
      request<TeamMemberActionResponse>(`/team/members/${encodeURIComponent(userId)}/activate`, {
        ...options,
        method: 'POST',
        body: JSON.stringify({})
      }),
    deactivateMember: (
      userId: string,
      options: RequestInit = {}
    ): Promise<TeamMemberActionResponse> =>
      request<TeamMemberActionResponse>(`/team/members/${encodeURIComponent(userId)}/deactivate`, {
        ...options,
        method: 'POST',
        body: JSON.stringify({})
      })
  },
  dashboard: {
    getSummary: (
      query: Partial<DashboardFilterQuery> = {},
      options: RequestInit = {}
    ): Promise<DashboardSummaryResponse> =>
      request<DashboardSummaryResponse>(`/dashboard/summary${buildDashboardSearchParams(query)}`, {
        ...options,
        method: 'GET'
      }),
    getFunnel: (
      query: Partial<DashboardFilterQuery> = {},
      options: RequestInit = {}
    ): Promise<DashboardFunnelResponse> =>
      request<DashboardFunnelResponse>(`/dashboard/funnel${buildDashboardSearchParams(query)}`, {
        ...options,
        method: 'GET'
      }),
    getSources: (
      query: Partial<DashboardFilterQuery> = {},
      options: RequestInit = {}
    ): Promise<DashboardSourcesResponse> =>
      request<DashboardSourcesResponse>(`/dashboard/sources${buildDashboardSearchParams(query)}`, {
        ...options,
        method: 'GET'
      }),
    getOutreach: (
      query: Partial<DashboardFilterQuery> = {},
      options: RequestInit = {}
    ): Promise<DashboardOutreachResponse> =>
      request<DashboardOutreachResponse>(`/dashboard/outreach${buildDashboardSearchParams(query)}`, {
        ...options,
        method: 'GET'
      }),
    getTeamPerformance: (
      query: Partial<DashboardFilterQuery> = {},
      options: RequestInit = {}
    ): Promise<DashboardTeamPerformanceResponse> =>
      request<DashboardTeamPerformanceResponse>(`/dashboard/team-performance${buildDashboardSearchParams(query)}`, {
        ...options,
        method: 'GET'
      })
  },
  getDashboardSummary: (
    query: Partial<DashboardFilterQuery> = {},
    options: RequestInit = {}
  ): Promise<DashboardSummaryResponse> =>
    request<DashboardSummaryResponse>(`/dashboard/summary${buildDashboardSearchParams(query)}`, {
      ...options,
      method: 'GET'
    }),
  getDashboardFunnel: (
    query: Partial<DashboardFilterQuery> = {},
    options: RequestInit = {}
  ): Promise<DashboardFunnelResponse> =>
    request<DashboardFunnelResponse>(`/dashboard/funnel${buildDashboardSearchParams(query)}`, {
      ...options,
      method: 'GET'
    }),
  getDashboardSources: (
    query: Partial<DashboardFilterQuery> = {},
    options: RequestInit = {}
  ): Promise<DashboardSourcesResponse> =>
    request<DashboardSourcesResponse>(`/dashboard/sources${buildDashboardSearchParams(query)}`, {
      ...options,
      method: 'GET'
    }),
  getDashboardOutreach: (
    query: Partial<DashboardFilterQuery> = {},
    options: RequestInit = {}
  ): Promise<DashboardOutreachResponse> =>
    request<DashboardOutreachResponse>(`/dashboard/outreach${buildDashboardSearchParams(query)}`, {
      ...options,
      method: 'GET'
    }),
  getDashboardTeamPerformance: (
    query: Partial<DashboardFilterQuery> = {},
    options: RequestInit = {}
  ): Promise<DashboardTeamPerformanceResponse> =>
    request<DashboardTeamPerformanceResponse>(`/dashboard/team-performance${buildDashboardSearchParams(query)}`, {
      ...options,
      method: 'GET'
    }),

  // Data Sources Settings
  getDataSources: (options: RequestInit = {}): Promise<DataSourcesListResponse> =>
    request<DataSourcesListResponse>('/settings/data-sources', {
      ...options,
      method: 'GET'
    }),
  configureGooglePlaces: (apiKey: string): Promise<{ success: boolean; credentialMasked: string; credentialLastFour: string; status: DataSourceCardStatus }> =>
    request('/settings/data-sources/google-places/configure', {
      method: 'POST',
      body: JSON.stringify({ apiKey })
    }),
  testGooglePlaces: (apiKey?: string): Promise<{ connected: boolean; provider: string; message: string }> =>
    request('/settings/data-sources/google-places/test', {
      method: 'POST',
      body: JSON.stringify({ apiKey })
    }),
  testProvider: (provider: string): Promise<{ connected: boolean; provider: string; message: string }> =>
    request(`/settings/data-sources/${encodeURIComponent(provider)}/test`, {
      method: 'POST'
    }),
  setActiveProvider: (provider: string): Promise<{ success: boolean; activeProvider: string }> =>
    request(`/settings/data-sources/${encodeURIComponent(provider)}/set-active`, {
      method: 'POST'
    }),
  toggleProviderEnabled: (provider: string, enabled: boolean): Promise<{ success: boolean; isEnabled: boolean }> =>
    request(`/settings/data-sources/${encodeURIComponent(provider)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled })
    }),

  // Demos Catalog
  getDemos: async (options: RequestInit = {}): Promise<{ data: DemoCatalogItem[] }> => {
    const res = await request<DemoCatalogItem[] | { data: DemoCatalogItem[] }>('/demos', {
      ...options,
      method: 'GET'
    });
    return { data: Array.isArray(res) ? res : ((res as any)?.data || []) };
  },

  // Campaigns
  getCampaigns: async (options: RequestInit = {}): Promise<{ data: CampaignSummary[] }> => {
    const res = await request<CampaignSummary[] | { data: CampaignSummary[] }>('/campaigns', {
      ...options,
      method: 'GET'
    });
    return { data: Array.isArray(res) ? res : ((res as any)?.data || []) };
  },
  createCampaign: async (payload: CreateCampaignRequest): Promise<{ data: CampaignSummary }> => {
    const res = await request<CampaignSummary | { data: CampaignSummary }>('/campaigns', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return { data: (res as any)?.data ?? res };
  },

  // AI Providers & Models Settings
  getAiProviders: async (): Promise<{ providers: any[] }> => {
    const res = await request<{ providers: any[] } | any[]>('/settings/ai-models', {
      method: 'GET'
    });
    if (Array.isArray(res)) return { providers: res };
    return { providers: (res as any)?.providers || [] };
  },
  configureAiProvider: (provider: string, data: { apiKey: string; model?: string }): Promise<{ success: boolean; config: any }> =>
    request(`/settings/ai-models/${encodeURIComponent(provider)}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  testAiProvider: (provider: string, data: { apiKey?: string; model?: string } = {}): Promise<{ connected: boolean; message: string; model?: string; latencyMs?: number }> =>
    request(`/settings/ai-models/${encodeURIComponent(provider)}/test`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  updateAiModel: (provider: string, model: string): Promise<{ success: boolean; model: string }> =>
    request(`/settings/ai-models/${encodeURIComponent(provider)}/model`, {
      method: 'POST',
      body: JSON.stringify({ model })
    }),
  toggleAiProvider: (provider: string, enabled: boolean): Promise<{ success: boolean; isEnabled: boolean }> =>
    request(`/settings/ai-models/${encodeURIComponent(provider)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled })
    }),

  // AI Buyer Discovery
  suggestBuyerTargets: async (data: { product: string; location?: string; count?: number; model?: string; buyerType?: string }): Promise<any> => {
    return request('/ai/buyer-discovery/suggest-targets', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  explainBuyerFit: async (data: { businessName: string; category?: string; product?: string; query?: string; location?: string; signals?: string[]; model?: string }): Promise<any> => {
    const payload = {
      ...data,
      product: data.product || data.query || 'General Business',
      category: data.category || 'Retail Store'
    };
    return request('/ai/buyer-discovery/explain-fit', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // Products
  listProducts: (query?: { page?: number; limit?: number; search?: string; category?: string; status?: string }): Promise<{ products: ProductDto[]; total: number; page: number; totalPages: number }> => {
    const params = new URLSearchParams();
    if (query?.page) params.set('page', String(query.page));
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.search) params.set('search', query.search);
    if (query?.category) params.set('category', query.category);
    if (query?.status) params.set('status', query.status);
    const qs = params.toString();
    return request(`/products${qs ? `?${qs}` : ''}`);
  },
  createProduct: (data: CreateProductInput): Promise<ProductDto> =>
    request('/products', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  getProduct: (id: string): Promise<ProductDto> =>
    request(`/products/${encodeURIComponent(id)}`),
  updateProduct: (id: string, data: UpdateProductInput): Promise<ProductDto> =>
    request(`/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),

  // Sales Missions
  listSalesMissions: (query?: { page?: number; limit?: number; search?: string; productId?: string; status?: string }): Promise<{ missions: SalesMissionDetailDto[]; total: number; page: number; totalPages: number }> => {
    const params = new URLSearchParams();
    if (query?.page) params.set('page', String(query.page));
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.search) params.set('search', query.search);
    if (query?.productId) params.set('productId', query.productId);
    if (query?.status) params.set('status', query.status);
    const qs = params.toString();
    return request(`/sales-missions${qs ? `?${qs}` : ''}`);
  },
  createSalesMission: (data: CreateSalesMissionInput): Promise<SalesMissionDetailDto> =>
    request('/sales-missions', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  getSalesMission: (id: string): Promise<SalesMissionDetailDto> =>
    request(`/sales-missions/${encodeURIComponent(id)}`),
  analyzeMission: (id: string): Promise<SalesMissionDetailDto> =>
    request(`/sales-missions/${encodeURIComponent(id)}/analyze`, {
      method: 'POST'
    }),
  analyzeProductDirect: (data: AnalyzeProductRequest | AnalyzeProductInput): Promise<AiProductAnalysisResult> =>
    request('/sales-missions/analyze-product', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  discoverMissionBuyers: (id: string, targetCategories?: string[]): Promise<SalesMissionDetailDto> =>
    request(`/sales-missions/${encodeURIComponent(id)}/discover`, {
      method: 'POST',
      body: JSON.stringify(targetCategories ? { targetCategories } : {})
    }),
  refreshMission: (id: string): Promise<SalesMissionDetailDto> =>
    request(`/sales-missions/${encodeURIComponent(id)}/refresh`, {
      method: 'POST'
    }),

  // Location autocomplete — reuses GET /api/v1/locations/suggest
  suggestLocations: async (
    q: string,
    limit = 6,
    options: RequestInit = {}
  ): Promise<{ data: LocationSuggestionItem[] }> => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    const res = await request<any>(`/locations/suggest?${params.toString()}`, options);
    const items = Array.isArray(res) ? res : (res?.data || []);
    return { data: items };
  },

  // Sub-Phase C: Outreach Governance & Conversion Tracking
  generateOutreachDraft: (missionId: string, buyerId: string, input: { channel?: string; language?: string }): Promise<{ data: any }> =>
    request(`/sales-missions/${encodeURIComponent(missionId)}/buyers/${encodeURIComponent(buyerId)}/drafts`, {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  listOutreachDrafts: (missionId: string, buyerId: string): Promise<{ data: any[] }> =>
    request(`/sales-missions/${encodeURIComponent(missionId)}/buyers/${encodeURIComponent(buyerId)}/drafts`),
  editOutreachDraft: (missionId: string, draftId: string, input: { subject?: string | null; body: string }): Promise<{ data: any }> =>
    request(`/sales-missions/${encodeURIComponent(missionId)}/drafts/${encodeURIComponent(draftId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    }),
  submitDraftForApproval: (missionId: string, draftId: string): Promise<{ data: any }> =>
    request(`/sales-missions/${encodeURIComponent(missionId)}/drafts/${encodeURIComponent(draftId)}/submit-approval`, {
      method: 'POST'
    }),
  approveOutreachDraft: (missionId: string, draftId: string): Promise<{ data: any }> =>
    request(`/sales-missions/${encodeURIComponent(missionId)}/drafts/${encodeURIComponent(draftId)}/approve`, {
      method: 'POST'
    }),
  rejectOutreachDraft: (missionId: string, draftId: string, input: { rejectionReason: string }): Promise<{ data: any }> =>
    request(`/sales-missions/${encodeURIComponent(missionId)}/drafts/${encodeURIComponent(draftId)}/reject`, {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  markDraftReadyForDispatch: (missionId: string, draftId: string): Promise<{ data: any }> =>
    request(`/sales-missions/${encodeURIComponent(missionId)}/drafts/${encodeURIComponent(draftId)}/ready-for-dispatch`, {
      method: 'POST'
    }),
  processBuyerReply: (missionId: string, buyerId: string, input: { content: string; channel?: string; senderPhone?: string; senderEmail?: string }): Promise<{ data: any }> =>
    request(`/sales-missions/${encodeURIComponent(missionId)}/buyers/${encodeURIComponent(buyerId)}/replies`, {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  transitionBuyerStage: (missionId: string, buyerId: string, input: { stage: string; wonEvidence?: any; lostReason?: string; notes?: string }): Promise<{ data: any }> =>
    request(`/sales-missions/${encodeURIComponent(missionId)}/buyers/${encodeURIComponent(buyerId)}/conversion-stage`, {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  suppressBuyer: (missionId: string, buyerId: string, input?: { reason?: string }): Promise<{ data: any }> =>
    request(`/sales-missions/${encodeURIComponent(missionId)}/buyers/${encodeURIComponent(buyerId)}/suppress`, {
      method: 'POST',
      body: JSON.stringify(input || {})
    })
};


function buildDashboardSearchParams(query: Partial<DashboardFilterQuery> = {}): string {
  const params = new URLSearchParams();
  if (query.preset) {
    params.set('preset', query.preset);
  }
  if (query.from) {
    params.set('from', query.from);
  }
  if (query.to) {
    params.set('to', query.to);
  }
  if (query.assigneeId) {
    params.set('assigneeId', query.assigneeId);
  }
  if (query.source) {
    params.set('source', query.source);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
