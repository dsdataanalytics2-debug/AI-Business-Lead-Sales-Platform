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
