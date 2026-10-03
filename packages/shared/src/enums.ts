export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  SALES_MANAGER = 'SALES_MANAGER',
  SALES_EXECUTIVE = 'SALES_EXECUTIVE',
  VIEWER = 'VIEWER'
}

export enum ContactType {
  PHONE = 'PHONE',
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL'
}

export enum PhoneType {
  MOBILE = 'MOBILE',
  LANDLINE = 'LANDLINE',
  UNKNOWN = 'UNKNOWN'
}

export enum ContactStatus {
  FOUND = 'FOUND',
  INVALID_FORMAT = 'INVALID_FORMAT',
  VERIFIED = 'VERIFIED',
  STALE = 'STALE'
}

export enum WhatsAppStatus {
  UNKNOWN = 'UNKNOWN',
  PUBLICLY_LISTED = 'PUBLICLY_LISTED',
  CONFIRMED = 'CONFIRMED'
}

export enum EvidenceType {
  WA_ME_LINK = 'WA_ME_LINK',
  LISTING_FIELD = 'LISTING_FIELD',
  OFFICIAL_PAGE_TEXT = 'OFFICIAL_PAGE_TEXT',
  AUTHORIZED_API = 'AUTHORIZED_API',
  MANUAL_CONFIRMED = 'MANUAL_CONFIRMED'
}

export enum WebsiteStatus {
  UNKNOWN = 'UNKNOWN',
  NONE_DETECTED = 'NONE_DETECTED',
  REACHABLE = 'REACHABLE',
  UNREACHABLE = 'UNREACHABLE'
}

export enum OnlinePresenceType {
  WEBSITE = 'WEBSITE',
  FACEBOOK_ONLY = 'FACEBOOK_ONLY',
  INSTAGRAM_ONLY = 'INSTAGRAM_ONLY',
  MARKETPLACE_ONLY = 'MARKETPLACE_ONLY',
  NONE_DETECTED = 'NONE_DETECTED',
  UNKNOWN = 'UNKNOWN'
}

export enum CrmStage {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  QUALIFIED = 'QUALIFIED',
  PROPOSAL_SENT = 'PROPOSAL_SENT',
  NEGOTIATION = 'NEGOTIATION',
  WON = 'WON',
  LOST = 'LOST'
}

export enum CrmActivityType {
  LEAD_ASSIGNED = 'LEAD_ASSIGNED',
  LEAD_UNASSIGNED = 'LEAD_UNASSIGNED',
  LEAD_REASSIGNED = 'LEAD_REASSIGNED',
  STAGE_CHANGED = 'STAGE_CHANGED',
  NOTE_ADDED = 'NOTE_ADDED'
}

export const CRM_STAGE_ORDER: Record<CrmStage, number> = {
  [CrmStage.NEW]: 10,
  [CrmStage.CONTACTED]: 20,
  [CrmStage.QUALIFIED]: 30,
  [CrmStage.PROPOSAL_SENT]: 40,
  [CrmStage.NEGOTIATION]: 50,
  [CrmStage.WON]: 60,
  [CrmStage.LOST]: 70
} as const;

export const ORDERED_CRM_STAGES: readonly CrmStage[] = [
  CrmStage.NEW,
  CrmStage.CONTACTED,
  CrmStage.QUALIFIED,
  CrmStage.PROPOSAL_SENT,
  CrmStage.NEGOTIATION,
  CrmStage.WON,
  CrmStage.LOST
] as const;

export const CRM_STAGE_LABELS: Record<CrmStage, string> = {
  [CrmStage.NEW]: 'New',
  [CrmStage.CONTACTED]: 'Contacted',
  [CrmStage.QUALIFIED]: 'Qualified',
  [CrmStage.PROPOSAL_SENT]: 'Proposal Sent',
  [CrmStage.NEGOTIATION]: 'Negotiation',
  [CrmStage.WON]: 'Won',
  [CrmStage.LOST]: 'Lost'
} as const;

export const TERMINAL_CRM_STAGES: readonly CrmStage[] = [
  CrmStage.WON,
  CrmStage.LOST
] as const;

export function getCrmStageOrder(stage: CrmStage): number {
  return CRM_STAGE_ORDER[stage];
}

export function getCrmStageLabel(stage: CrmStage): string {
  return CRM_STAGE_LABELS[stage] ?? stage;
}

export function isTerminalCrmStage(stage: CrmStage): boolean {
  return stage === CrmStage.WON || stage === CrmStage.LOST;
}

export enum CrmOutcome {
  NONE = 'NONE',
  LOST = 'LOST',
  NO_RESPONSE = 'NO_RESPONSE',
  NOT_INTERESTED = 'NOT_INTERESTED',
  INVALID_LEAD = 'INVALID_LEAD'
}

/* =========================================================
 * M3: CRM Follow-Up Task Enums
 * ========================================================= */

export enum FollowUpStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  [FollowUpStatus.PENDING]: 'Pending',
  [FollowUpStatus.COMPLETED]: 'Completed',
  [FollowUpStatus.CANCELLED]: 'Cancelled'
};

export const ORDERED_FOLLOW_UP_STATUSES: readonly FollowUpStatus[] = [
  FollowUpStatus.PENDING,
  FollowUpStatus.COMPLETED,
  FollowUpStatus.CANCELLED
] as const;


export enum JobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
  CANCELLED = 'CANCELLED'
}

export enum DemoStatus {
  QUEUED = 'QUEUED',
  CREATING = 'CREATING',
  READY = 'READY',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  DISABLED = 'DISABLED',
  DELETED = 'DELETED'
}

/* =========================================================
 * M4: StoreMate Demo Website Enums & Lifecycle
 * ========================================================= */

export enum DemoWebsiteStatus {
  REQUESTED = 'REQUESTED',
  CREATING = 'CREATING',
  READY = 'READY',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  REMOVED = 'REMOVED'
}

export const DEMO_WEBSITE_STATUS_LABELS: Record<DemoWebsiteStatus, string> = {
  [DemoWebsiteStatus.REQUESTED]: 'Requested',
  [DemoWebsiteStatus.CREATING]: 'Creating',
  [DemoWebsiteStatus.READY]: 'Ready',
  [DemoWebsiteStatus.FAILED]: 'Failed',
  [DemoWebsiteStatus.EXPIRED]: 'Expired',
  [DemoWebsiteStatus.REMOVED]: 'Removed'
} as const;

export const ORDERED_DEMO_WEBSITE_STATUSES: readonly DemoWebsiteStatus[] = [
  DemoWebsiteStatus.REQUESTED,
  DemoWebsiteStatus.CREATING,
  DemoWebsiteStatus.READY,
  DemoWebsiteStatus.FAILED,
  DemoWebsiteStatus.EXPIRED,
  DemoWebsiteStatus.REMOVED
] as const;

export function getDemoWebsiteStatusLabel(status: DemoWebsiteStatus): string {
  return DEMO_WEBSITE_STATUS_LABELS[status] ?? status;
}

export const ALLOWED_DEMO_WEBSITE_TRANSITIONS: Record<DemoWebsiteStatus, readonly DemoWebsiteStatus[]> = {
  [DemoWebsiteStatus.REQUESTED]: [
    DemoWebsiteStatus.CREATING,
    DemoWebsiteStatus.FAILED,
    DemoWebsiteStatus.REMOVED
  ],
  [DemoWebsiteStatus.CREATING]: [
    DemoWebsiteStatus.READY,
    DemoWebsiteStatus.FAILED,
    DemoWebsiteStatus.REMOVED
  ],
  [DemoWebsiteStatus.READY]: [
    DemoWebsiteStatus.REQUESTED,
    DemoWebsiteStatus.CREATING,
    DemoWebsiteStatus.EXPIRED,
    DemoWebsiteStatus.REMOVED
  ],
  [DemoWebsiteStatus.FAILED]: [
    DemoWebsiteStatus.REQUESTED,
    DemoWebsiteStatus.CREATING,
    DemoWebsiteStatus.REMOVED
  ],
  [DemoWebsiteStatus.EXPIRED]: [
    DemoWebsiteStatus.REQUESTED,
    DemoWebsiteStatus.CREATING,
    DemoWebsiteStatus.REMOVED
  ],
  [DemoWebsiteStatus.REMOVED]: []
} as const;

export function isValidDemoWebsiteTransition(from: DemoWebsiteStatus, to: DemoWebsiteStatus): boolean {
  const allowed = ALLOWED_DEMO_WEBSITE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export enum DemoWebsiteProvider {
  STOREMATE = 'STOREMATE',
  MOCK = 'MOCK'
}

export enum DemoWebsiteErrorCode {
  STOREMATE_TIMEOUT = 'STOREMATE_TIMEOUT',
  STOREMATE_UNAVAILABLE = 'STOREMATE_UNAVAILABLE',
  STOREMATE_INVALID_RESPONSE = 'STOREMATE_INVALID_RESPONSE',
  STOREMATE_AUTH_FAILED = 'STOREMATE_AUTH_FAILED',
  STOREMATE_RATE_LIMITED = 'STOREMATE_RATE_LIMITED',
  PAYLOAD_VALIDATION_FAILED = 'PAYLOAD_VALIDATION_FAILED',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

export enum DataSourceStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  RESTRICTED = 'RESTRICTED',
  REJECTED = 'REJECTED'
}

export enum DataSourceRole {
  DISCOVERY = 'DISCOVERY',
  ENRICHMENT = 'ENRICHMENT',
  BOTH = 'BOTH'
}

export enum SuppressionType {
  PHONE = 'PHONE',
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
  DOMAIN = 'DOMAIN',
  BUSINESS = 'BUSINESS'
}

export enum SuppressionReason {
  OPT_OUT = 'OPT_OUT',
  DO_NOT_CONTACT = 'DO_NOT_CONTACT',
  COMPLAINT = 'COMPLAINT',
  INVALID = 'INVALID',
  LEGAL = 'LEGAL',
  INTERNAL_POLICY = 'INTERNAL_POLICY'
}

export enum ChannelScope {
  ALL = 'ALL',
  CALL = 'CALL',
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL'
}

export enum Priority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  NONE = 'NONE'
}

export enum DuplicateMatchLevel {
  NONE = 'NONE',
  DEFINITE = 'DEFINITE',
  CANDIDATE = 'CANDIDATE'
}

export enum DuplicateAction {
  CREATED = 'CREATED',
  MERGED = 'MERGED',
  CANDIDATE_REQUIRES_CONFIRMATION = 'CANDIDATE_REQUIRES_CONFIRMATION'
}

/* =========================================================
 * M2: Online Presence Analysis & Qualification Enums
 * ========================================================= */

export enum AnalysisWebsiteStatus {
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  REACHABLE = 'REACHABLE',
  UNREACHABLE = 'UNREACHABLE',
  TIMEOUT = 'TIMEOUT',
  ACCESS_RESTRICTED = 'ACCESS_RESTRICTED',
  BLOCKED_SSRF = 'BLOCKED_SSRF',
  INVALID_URL = 'INVALID_URL',
  NON_HTML = 'NON_HTML'
}

export enum CampaignType {
  WEBSITE_ACQUISITION = 'WEBSITE_ACQUISITION',
  WEBSITE_REDESIGN = 'WEBSITE_REDESIGN',
  ONLINE_PRESENCE_IMPROVEMENT = 'ONLINE_PRESENCE_IMPROVEMENT'
}

export enum QualificationReasonCode {
  // Website signals
  NO_WEBSITE = 'NO_WEBSITE',
  WEBSITE_UNREACHABLE = 'WEBSITE_UNREACHABLE',
  WEBSITE_TIMEOUT = 'WEBSITE_TIMEOUT',

  // Technical quality signals
  NO_HTTPS = 'NO_HTTPS',
  NO_META_DESCRIPTION = 'NO_META_DESCRIPTION',
  SHORT_PAGE_TITLE = 'SHORT_PAGE_TITLE',
  SLOW_RESPONSE = 'SLOW_RESPONSE',

  // Presence signals
  FACEBOOK_ONLY = 'FACEBOOK_ONLY',
  INSTAGRAM_ONLY = 'INSTAGRAM_ONLY',
  MULTI_CHANNEL_PRESENCE = 'MULTI_CHANNEL_PRESENCE',

  // Business viability signals
  HIGH_RATING_NO_WEB = 'HIGH_RATING_NO_WEB',
  HAS_ESTABLISHED_REVIEWS = 'HAS_ESTABLISHED_REVIEWS',

  // Contact signals
  HAS_MOBILE_PHONE = 'HAS_MOBILE_PHONE',
  HAS_PRIMARY_EMAIL = 'HAS_PRIMARY_EMAIL',
  HAS_WHATSAPP = 'HAS_WHATSAPP'
}

/* =========================================================
 * M5: AI Sales Assistant Enums
 * ========================================================= */

/**
 * Supported V1 AI Sales Assistant draft types.
 * Content is text only: no sending, calling, scheduling, or PDF generation.
 */
export enum SalesAssistantDraftType {
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
  CALL_SCRIPT = 'CALL_SCRIPT',
  PROPOSAL = 'PROPOSAL',
  FOLLOW_UP = 'FOLLOW_UP'
}

/**
 * Output language for generated sales content.
 * MIXED means practical Bangla + English business communication.
 */
export enum SalesAssistantLanguage {
  BANGLA = 'BANGLA',
  ENGLISH = 'ENGLISH',
  MIXED = 'MIXED'
}

/**
 * Tone of generated sales content.
 * PERSUASIVE must never mean deceptive, manipulative, false urgency, or false scarcity.
 */
export enum SalesAssistantTone {
  PROFESSIONAL = 'PROFESSIONAL',
  FRIENDLY = 'FRIENDLY',
  CONCISE = 'CONCISE',
  PERSUASIVE = 'PERSUASIVE'
}

/**
 * Draft lifecycle. Deliberately has NO "SENT" status:
 * external sending belongs to a later milestone (M6) and requires human approval.
 */
export enum SalesAssistantDraftStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

/**
 * Non-fatal warnings attached to a generated draft.
 */
export enum SalesAssistantWarning {
  MISSING_PRODUCT_CONTEXT = 'MISSING_PRODUCT_CONTEXT',
  MISSING_PRICE_CONTEXT = 'MISSING_PRICE_CONTEXT',
  UNVERIFIED_WHATSAPP = 'UNVERIFIED_WHATSAPP',
  UNSUPPORTED_CLAIM_REMOVED = 'UNSUPPORTED_CLAIM_REMOVED',
  LIMITED_LEAD_CONTEXT = 'LIMITED_LEAD_CONTEXT'
}