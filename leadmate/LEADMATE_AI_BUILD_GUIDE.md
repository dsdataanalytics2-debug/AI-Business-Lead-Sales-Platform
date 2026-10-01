# LeadMate — AI Build Guide

> **READ FIRST:** `master-prompt.md` (repo root). It defines the session-start protocol, hard rules, protected paths, and the task playbooks. Read it before this file, every session.
> **Audience:** an AI coding agent (Codex, Claude Code, Cursor, etc.) that will build this project.
> **Companion document:** `AI_Business_Lead_Sales_Platform_PRD_v1.1.md` (full product reasoning). If this guide and the PRD conflict, **this guide wins for implementation**; flag the conflict in your final message.
> **Version:** 1.0 (matches PRD v1.1)

---

## 0. How To Use This File

0. **Read `master-prompt.md` first** and follow its Session Start Protocol (section 0 there). Use its playbooks (plan mode, spec-first, build sequence, debugging, security audit, commit, etc.) for each kind of task.
1. Read sections 1–5 fully before writing any code. They are global rules.
2. Build **one milestone at a time** (section 8). Never start milestone N+1 before N meets its acceptance criteria.
3. For the current milestone: restate the plan briefly, implement, write tests, run tests/lint/typecheck, then report using the format in section 9.
4. If something is ambiguous, pick the default stated in section 11 ("Decided Defaults") and note the assumption. Do not stop to ask unless the item is marked **BLOCKED-ON-HUMAN**.
5. Never invent: data sources, provider terms, API endpoints of StoreMate, legal claims, or business facts. Use the mock/adapter patterns in this guide until a human supplies the real details.

---

## 1. Product Summary

**LeadMate** is an internal web platform for a Bangladesh-based web/AI services company. It:

1. Discovers business leads (any category/location, not only "no website").
2. Collects and enriches **business** contact data from permitted/authorized sources, tracking the source of every value.
3. Analyzes websites and online presence; scores leads per campaign type.
4. Lets salespeople manage leads in a CRM and generate a **StoreMate demo website** with one click (Demo Lite).
5. Tracks cost per lead and cost per qualified lead.

**Principle:** AI finds and analyzes opportunities; humans build relationships and close sales. No automatic outbound messaging in v1.

### Non-goals (do NOT build)

- Automatic sending of WhatsApp/email/SMS.
- Scraping that bypasses a site's terms, login-based scraping, or circumventing access controls.
- Collecting private personal phone numbers/emails of individuals.
- Multi-tenant SaaS, billing, white-label (data model includes `organizationId` only to keep this possible).
- Payment gateway integrations (bKash/Nagad) — post-MVP.
- Industry-specific StoreMate templates — post-MVP.
- Review management, competitor monitoring — later.

---

## 2. Hard Rules (MUST / MUST NOT)

### Data & compliance
- **MUST** store `source`, `fetchedAt` (and `evidenceUrl` where relevant) for every contact value.
- **MUST NOT** label a phone number as WhatsApp unless there is stored evidence (see 5.3).
- **MUST** check the `SuppressionList` (5.5) before: draft generation, demo generation, CRM stage change to any outreach stage, and export marked "for outreach".
- **MUST** access external data only through a `DataSourceAdapter` (5.8). No ad-hoc HTTP calls to data providers elsewhere.
- **MUST NOT** enable a data source whose `DataSourceConfig.status !== 'APPROVED'` in non-development environments.
- **MUST** store only fields allowed by that source's `persistencePolicy`.
- Facebook/Instagram data: **only** links found on an official business website, authorized API, or manual input. No scraping.

### Security
- **MUST** enforce RBAC on the backend for every route (UI hiding is not security).
- **MUST NOT** put secrets in code, logs, or frontend bundles. Use environment variables; encrypt integration credentials at rest.
- **MUST** protect any server-side fetch of a user/lead-supplied URL against SSRF (5.9).
- **MUST** validate all input with Zod and sanitize imported data.
- **MUST** write an `AuditLog` row for the actions listed in 5.10.

### Engineering
- **MUST** put business logic in `packages/core` as pure, unit-tested functions; keep controllers/workers thin.
- **MUST** make jobs idempotent and safe to retry (no duplicate leads/demos/ledger rows on retry).
- **MUST** write a `UsageLedger` row for every paid or quota-limited external call (data source, AI, StoreMate).
- **MUST NOT** perform long-running work (audits, AI calls, collection, enrichment, demo creation) inside an HTTP request. Enqueue a job.
- **MUST NOT** use an LLM for: dedupe, phone normalization, filtering, scoring, status rules. LLMs are only for summaries, explanations, drafts, demo copy.
- **MUST** keep AI output clearly separated from detected facts (store `evidence` and `aiInterpretation` separately).

---

## 3. Tech Stack & Conventions (Decided)

| Area | Choice |
|---|---|
| Package manager / monorepo | pnpm workspaces |
| Language | TypeScript (strict) everywhere |
| Frontend | Next.js (App Router), Tailwind CSS, TanStack Query |
| Backend | Node.js + Express + TypeScript (REST, `/api/v1`) |
| Validation | Zod (schemas shared via `packages/shared`) |
| Database | PostgreSQL + Prisma |
| Queue | Redis + BullMQ |
| Auth | Email + password (argon2), server-side sessions in httpOnly, SameSite=Lax, Secure cookie |
| Logging | pino (JSON), request IDs |
| Tests | Vitest (unit/integration), Supertest (API), Playwright (later E2E) |
| Lint/format | ESLint + Prettier, `tsc --noEmit` in CI |
| Local dev | Docker Compose (postgres, redis) |
| CI | GitHub Actions: install, lint, typecheck, test |

### Repository layout

```text
leadmate/
├─ apps/
│  ├─ web/            # Next.js UI
│  ├─ api/            # Express REST API
│  └─ worker/         # BullMQ workers
├─ packages/
│  ├─ core/           # PURE domain logic: phone, dedupe, scoring, crm, suppression, demo-lifecycle
│  ├─ db/             # Prisma schema, client, migrations, seeds
│  ├─ shared/         # Zod schemas, enums, types, error codes, permission constants
│  ├─ datasources/    # DataSourceAdapter interface + adapters (mock, csv, real ones later)
│  ├─ ai/             # AIService interface + provider implementations + prompts
│  └─ storemate/      # StoreMateClient interface + mock + real client (after contract)
├─ docs/
│  ├─ prd/            # full PRD
│  ├─ data-source-matrix.md        # filled by humans (Section 8, M0 task H1)
│  ├─ storemate-api-contract.md    # filled by humans (M0 task H2)
│  └─ build-specs/                 # one file per milestone
├─ docker-compose.yml
├─ .env.example
├─ master-prompt.md   # READ FIRST: protocol, hard rules, playbooks
├─ AGENTS.md          # pointer -> master-prompt.md (Codex and others)
└─ CLAUDE.md          # pointer -> master-prompt.md (Claude Code)
```

### Global conventions

- **IDs:** UUID strings (`@default(uuid())`).
- **Time:** store UTC (`timestamptz`); display in `Asia/Dhaka` by default (org-configurable).
- **Money:** integer minor units + ISO currency code. Default currency `BDT`.
- **Naming:** DB tables `snake_case` via Prisma `@@map`; TS `camelCase`; enums `UPPER_SNAKE`.
- **Soft delete:** leads use `deletedAt`; never hard-delete leads from the UI.
- **Pagination:** cursor-based: `?limit=50&cursor=<id>` → `{ data: [], nextCursor: string|null }`.
- **API success:** `{ data: ... }`. **API error:**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": {}, "requestId": "..." } }
```

- **Error codes (minimum):** `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `SUPPRESSED_CONTACT`, `SOURCE_NOT_APPROVED`, `BUDGET_EXCEEDED`, `RATE_LIMITED`, `EXTERNAL_SERVICE_ERROR`, `INTERNAL_ERROR`.
- **Permissions:** string constants in `packages/shared`, e.g. `leads:read`, `leads:write`, `leads:export`, `leads:assign`, `campaigns:manage`, `demos:generate`, `demos:manage`, `suppression:manage`, `datasources:manage`, `scoring:manage`, `costs:read`, `users:manage`, `integrations:manage`, `reports:read`.

### Roles → permissions (seed)

| Role | Permissions |
|---|---|
| SUPER_ADMIN | all |
| ADMIN | all except `integrations:manage` secrets viewing |
| SALES_MANAGER | `leads:*`, `campaigns:manage`, `demos:*`, `reports:read`, `costs:read`, `suppression:manage` |
| SALES_EXECUTIVE | `leads:read` (assigned only), `leads:write` (assigned only), `demos:generate` |
| VIEWER | `leads:read`, `reports:read` |

---

## 4. Domain Model

Schema below is the **minimum**. Add indexes and relations as needed. Use Prisma.

### Enums

```text
Role:               SUPER_ADMIN | ADMIN | SALES_MANAGER | SALES_EXECUTIVE | VIEWER
ContactType:        PHONE | WHATSAPP | EMAIL
PhoneType:          MOBILE | LANDLINE | UNKNOWN
ContactStatus:      FOUND | INVALID_FORMAT | VERIFIED | STALE
WhatsAppStatus:     UNKNOWN | PUBLICLY_LISTED | CONFIRMED
EvidenceType:       WA_ME_LINK | LISTING_FIELD | OFFICIAL_PAGE_TEXT | AUTHORIZED_API | MANUAL_CONFIRMED
WebsiteStatus:      UNKNOWN | NONE_DETECTED | REACHABLE | UNREACHABLE
OnlinePresenceType: WEBSITE | FACEBOOK_ONLY | INSTAGRAM_ONLY | MARKETPLACE_ONLY | NONE_DETECTED | UNKNOWN
CrmStage:           NEW | ANALYZED | CONTACTED | REPLIED | INTERESTED | DEMO_SENT | MEETING | PROPOSAL | WON
CrmOutcome:         NONE | LOST | NO_RESPONSE | NOT_INTERESTED | INVALID_LEAD
JobStatus:          QUEUED | RUNNING | COMPLETED | FAILED | RETRYING | CANCELLED
DemoStatus:         QUEUED | CREATING | READY | FAILED | EXPIRED | DISABLED | DELETED
DataSourceStatus:   PENDING | APPROVED | RESTRICTED | REJECTED
DataSourceRole:     DISCOVERY | ENRICHMENT | BOTH
SuppressionType:    PHONE | WHATSAPP | EMAIL | DOMAIN | BUSINESS
SuppressionReason:  OPT_OUT | DO_NOT_CONTACT | COMPLAINT | INVALID | LEGAL | INTERNAL_POLICY
ChannelScope:       ALL | CALL | WHATSAPP | EMAIL
Priority:           HIGH | MEDIUM | LOW | NONE
```

### Core models (Prisma sketch)

```prisma
model Organization { id String @id @default(uuid()); name String; timezone String @default("Asia/Dhaka"); workingDays Int[]; workStart String @default("10:00"); workEnd String @default("18:00") }

model User { id String @id @default(uuid()); organizationId String; email String @unique; passwordHash String; name String; role Role; isActive Boolean @default(true) }

model Lead {
  id String @id @default(uuid())
  organizationId String
  businessName String
  normalizedName String
  category String?
  address String?
  area String?
  city String?
  country String @default("BD")
  latitude Float?
  longitude Float?
  rating Float?
  reviewCount Int?
  websiteUrl String?
  websiteDomain String?            // normalized, excludes social/directory domains
  websiteStatus WebsiteStatus @default(UNKNOWN)
  onlinePresenceType OnlinePresenceType @default(UNKNOWN)
  crmStage CrmStage @default(NEW)
  crmOutcome CrmOutcome @default(NONE)
  assignedUserId String?
  campaignId String?
  isSuppressed Boolean @default(false)   // denormalized flag, recomputed on suppression changes
  deletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model LeadSource {            // every provider sighting of a lead
  id String @id @default(uuid()); leadId String; dataSourceId String
  externalId String?; sourceUrl String?; fetchedAt DateTime; expiresAt DateTime?
  rawPayloadRef String?       // only if persistencePolicy allows
  @@unique([dataSourceId, externalId])
}

model LeadContact {
  id String @id @default(uuid()); leadId String
  type ContactType
  value String                // as found
  normalizedValue String      // canonical (E.164 for phones, lowercase for emails)
  phoneType PhoneType?
  status ContactStatus @default(FOUND)
  whatsappStatus WhatsAppStatus?   // only for WHATSAPP rows
  evidenceType EvidenceType?
  evidenceUrl String?
  sourceId String             // -> LeadSource or DataSourceConfig reference
  isPrimary Boolean @default(false)
  fetchedAt DateTime; verifiedAt DateTime?
  @@unique([leadId, type, normalizedValue])
}

model LeadSocialLink { id String @id @default(uuid()); leadId String; platform String; url String; sourceId String; fetchedAt DateTime }

model LeadWebsiteAudit { id String @id @default(uuid()); leadId String; checkedAt DateTime; checks Json; /* detected facts */ summary Json? }

model LeadAnalysis { id String @id @default(uuid()); leadId String; evidence Json; aiSummary String?; aiOpportunities Json?; inputHash String; model String; createdAt DateTime @default(now()) }

model ScoringProfile { id String @id @default(uuid()); name String; version Int; isActive Boolean; serviceId String?; highMin Int; mediumMin Int }
model ScoringRule    { id String @id @default(uuid()); profileId String; signalKey String; operator String; thresholdValue Json?; weight Int; isGate Boolean @default(false) }
model LeadScore      { id String @id @default(uuid()); leadId String; profileId String; profileVersion Int; score Int; priority Priority; isEligible Boolean; computedAt DateTime @default(now()) }
model LeadScoreEvent { id String @id @default(uuid()); leadScoreId String; signalKey String; points Int; detail Json? }

model Campaign { id String @id @default(uuid()); organizationId String; name String; criteria Json; scoringProfileIds String[]; budgetCapMinor Int?; budgetCurrency String @default("BDT"); status String }

model SearchJob / CollectionJob / EnrichmentJob   // share fields: id, campaignId?, status JobStatus, params Json, startedAt, finishedAt, error String?, attempt Int, idempotencyKey String @unique

model Service { id String @id @default(uuid()); name String; code String @unique; isActive Boolean }
model ServiceRecommendation { id String @id @default(uuid()); leadId String; serviceId String; reason String; evidenceRefs Json }

model LeadActivity { id String @id @default(uuid()); leadId String; userId String?; type String; payload Json; createdAt DateTime @default(now()) }
model LeadNote { id String @id @default(uuid()); leadId String; userId String; body String; createdAt DateTime @default(now()) }
model FollowUp { id String @id @default(uuid()); leadId String; assignedUserId String; dueAt DateTime; doneAt DateTime?; note String? }

model DemoSite {
  id String @id @default(uuid()); leadId String
  status DemoStatus @default(QUEUED)
  templateKey String @default("generic-local-business")
  contentJson Json; contentHash String
  storemateDemoId String?; demoUrl String?
  idempotencyKey String @unique
  expiresAt DateTime?; disabledAt DateTime?; deleteAfter DateTime?
  error String?; createdBy String; createdAt DateTime @default(now())
  // DB constraint: at most ONE demo per lead with status in (QUEUED, CREATING, READY) -> partial unique index
}

model SuppressionList {
  id String @id @default(uuid()); organizationId String
  type SuppressionType; normalizedValue String; channelScope ChannelScope @default(ALL)
  reason SuppressionReason; sourceNote String?; addedBy String; addedAt DateTime @default(now()); expiresAt DateTime?
  @@unique([organizationId, type, normalizedValue, channelScope])
}

model UsageLedger {
  id String @id @default(uuid()); organizationId String
  jobId String?; campaignId String?; leadId String?
  provider String; operation String
  units Float; unitType String
  costAmountMinor Int; currency String; exchangeRateToBdt Float?; isEstimate Boolean @default(true)
  createdAt DateTime @default(now())
}

model DataSourceConfig {
  id String @id @default(uuid()); name String @unique
  role DataSourceRole; status DataSourceStatus @default(PENDING); isEnabled Boolean @default(false)
  termsUrl String?; termsVerifiedAt DateTime?; termsVerifiedBy String?
  persistencePolicy Json    // { persistFields: string[], ttlDays?: number, idOnly?: boolean }
  refreshPolicy Json        // { refreshAfterDays?: number }
  rateLimit Json            // { perSecond?: number, perDay?: number }
  pricing Json              // { unitCostMinor, currency, per: "request"|"1000_requests" }
}

model AuditLog { id String @id @default(uuid()); organizationId String; userId String?; action String; entityType String; entityId String?; before Json?; after Json?; ip String?; createdAt DateTime @default(now()) }
model Notification { id String @id @default(uuid()); userId String; type String; payload Json; readAt DateTime?; createdAt DateTime @default(now()) }
model DuplicateCandidate { id String @id @default(uuid()); leadAId String; leadBId String; similarity Float; reason String; status String @default("OPEN") /* OPEN | MERGED | DISMISSED */; resolvedBy String?; createdAt DateTime @default(now()) }
model Communication { id String @id @default(uuid()); leadId String; userId String; channel String /* WHATSAPP | EMAIL | CALL_SCRIPT | PROPOSAL */; language String; body String; status String @default("DRAFT") /* DRAFT | MARKED_SENT | DISCARDED */; needsReview Boolean @default(false); createdAt DateTime @default(now()) }
```

---

## 5. Core Logic Specifications

All of the following live in `packages/core` as pure functions with unit tests.

### 5.1 Phone normalization (Bangladesh-first)

```ts
normalizePhone(input: string | null | undefined, opts?: { defaultCountry?: 'BD' }): {
  ok: boolean;
  e164?: string;            // canonical, e.g. "+8801712345678"
  local?: string;           // display, e.g. "01712345678" (BD only)
  type: 'MOBILE' | 'LANDLINE' | 'UNKNOWN';
  country: 'BD' | 'OTHER';
  status: 'FOUND' | 'INVALID_FORMAT';
  reason?: string;
}
```

Algorithm:
1. Trim. Convert Bangla digits `০১২৩৪৫৬৭৮৯` → `0123456789`.
2. Remove spaces, dashes, dots, parentheses, slashes.
3. If it starts with `+880` or `880`, convert to `0` + remainder. (`+8801712345678` → `01712345678`.)
4. **Mobile rule (BD):** exactly 11 digits matching `^01[3-9]\d{8}$` → `ok`, `type=MOBILE`, `e164 = "+880" + digits.slice(1)`.
5. **Landline (best effort):** starts with `0`, not matching mobile, 9–11 digits total → `type=LANDLINE`, `e164 = "+880" + digits.slice(1)`. Mark low confidence (no strict validation).
6. Starts with `+` and a non-880 country code → `country=OTHER`, keep digits as E.164 if length 8–15.
7. Anything else → `ok=false`, `status=INVALID_FORMAT`, with `reason`.
8. **Do not auto-fix** numbers missing the leading `0` (e.g. `1712345678`) — mark invalid with reason `MISSING_LEADING_ZERO` (configurable later).
9. The mobile prefix rule must live in one config constant so it can be updated against the current Bangladesh numbering plan. **BLOCKED-ON-HUMAN:** confirm current numbering plan before production.

**Required test fixtures:**

| Input | e164 | type | ok |
|---|---|---|---|
| `01712345678` | `+8801712345678` | MOBILE | true |
| `+8801712345678` | `+8801712345678` | MOBILE | true |
| `8801712345678` | `+8801712345678` | MOBILE | true |
| `+880 1712-345678` | `+8801712345678` | MOBILE | true |
| `017 1234 5678` | `+8801712345678` | MOBILE | true |
| `০১৭১২৩৪৫৬৭৮` | `+8801712345678` | MOBILE | true |
| `01912345678` | `+8801912345678` | MOBILE | true |
| `01212345678` | — | — | false (prefix not allowed) |
| `0171234567` (10 digits) | — | — | false |
| `1712345678` | — | — | false (`MISSING_LEADING_ZERO`) |
| `02-9876543` | `+88029876543` | LANDLINE | true |
| `+1 415 555 2671` | `+14155552671` | UNKNOWN (country OTHER) | true |
| `""`, `null`, `"abc"` | — | — | false |

Phone numbers equal after normalization are the **same contact** for dedupe and suppression.

### 5.2 Email & domain normalization

- Email: trim, lowercase; reject if not RFC-reasonable (use a well-known validator); ignore obvious role-less junk (`example.com`, `test@`).
- Domain: lowercase, strip protocol/`www.`/path/query. **Exclude** social/directory/marketplace domains from `websiteDomain` (facebook.com, instagram.com, linktr.ee, google.com/maps, etc.); these go to `LeadSocialLink` or are ignored, and drive `onlinePresenceType`.

### 5.3 WhatsApp status rules

- Default `UNKNOWN`. A phone number's existence **never** implies WhatsApp.
- `PUBLICLY_LISTED` requires **both** `evidenceType` and `evidenceUrl` (e.g. a `wa.me/<number>` or `api.whatsapp.com/send?phone=` link found on the official website, or a provider field explicitly named WhatsApp).
- `CONFIRMED` requires `MANUAL_CONFIRMED` or `AUTHORIZED_API` evidence, set by an authorized user/integration.
- Unit test: constructing a `PUBLICLY_LISTED` contact without evidence must throw.

### 5.4 Duplicate detection & merge

Match keys, in priority order:
1. Same `(dataSourceId, externalId)` → **auto-merge**.
2. Same normalized phone **and** name similarity ≥ 0.6 → **auto-merge**.
3. Same `websiteDomain` (non-excluded domain) → **auto-merge**.
4. Name similarity ≥ 0.85 (normalized lowercase, trigram) **and** same area/city → **create `DuplicateCandidate`** for manual review (do not auto-merge).

Merge rules:
- Keep the oldest lead id. Union contacts/links/sources (preserve each source row).
- Never overwrite a non-null value with null. On conflict keep both values as contacts; choose primary by source priority then recency.
- Record a `LeadActivity` of type `MERGED`.
- Merge must be **idempotent**: re-running the same job cannot create new leads.

### 5.5 Suppression check

```ts
isSuppressed(lead, contacts, suppressionEntries, channel): { suppressed: boolean; matches: SuppressionEntry[] }
```

- Match on normalized phone/WhatsApp/email, `websiteDomain`, and business-level entries.
- Respect `channelScope` and `expiresAt`.
- On any SuppressionList change, recompute `Lead.isSuppressed` for affected leads (background job).
- Blocked actions return `409 SUPPRESSED_CONTACT`.
- Re-importing or re-collecting a suppressed contact must not clear the suppression.

### 5.6 Scoring engine

Pure function, no I/O:

```ts
scoreLead(signals: LeadSignals, profile: ScoringProfile & { rules: ScoringRule[] }): {
  score: number;          // 0..100
  priority: 'HIGH'|'MEDIUM'|'LOW'|'NONE';
  isEligible: boolean;    // false if any gate fails
  events: { signalKey: string; points: number; detail?: unknown }[];
}
```

- Operators: `IS_TRUE`, `IS_FALSE`, `EQ`, `GTE`, `LTE`, `IN`.
- A failed **gate** rule → `isEligible=false`, `score=0`, `priority=NONE`.
- Sum of `events[].points` MUST equal `score` (property test). Cap at 100.
- Priority from `profile.highMin` / `mediumMin`.
- Signals are derived from stored facts (contacts, audit, ratings, online presence). Signal keys: `NO_WEBSITE`, `HAS_WEBSITE`, `WEBSITE_UNREACHABLE`, `NO_HTTPS`, `POOR_MOBILE`, `SLOW_PERFORMANCE`, `NO_CONTACT_CTA`, `NO_BOOKING`, `REACHABLE_PHONE`, `PUBLIC_WHATSAPP`, `EMAIL_AVAILABLE`, `SOCIAL_PRESENCE`, `BUSINESS_ACTIVE`, `RATING_AT_LEAST`, `REVIEWS_AT_LEAST`, `CATEGORY_FIT`.
- Seed profiles (weights are starting hypotheses, editable in DB):

**Website Acquisition** — `NO_WEBSITE`+25, `REACHABLE_PHONE`+15, `BUSINESS_ACTIVE`+10, `RATING_AT_LEAST`(≥4.0)+10, `REVIEWS_AT_LEAST`(≥50)+10, `PUBLIC_WHATSAPP`or`EMAIL_AVAILABLE`+10, `SOCIAL_PRESENCE`+10, `CATEGORY_FIT`+10. Gate: not suppressed, not invalid. `highMin=70`, `mediumMin=40`.

**Website Redesign** — gate `HAS_WEBSITE`; `NO_HTTPS`+15, `POOR_MOBILE`+20, `SLOW_PERFORMANCE`+15, `NO_CONTACT_CTA`+10, contact info hard to find+10, `REACHABLE_PHONE`or`EMAIL_AVAILABLE`+15, `BUSINESS_ACTIVE`+5, `REVIEWS_AT_LEAST`(≥50)+10. `highMin=70`, `mediumMin=40`.

### 5.7 Online presence type

Derived (pure function) from stored facts:
- Has non-excluded `websiteDomain` and website reachable → `WEBSITE`.
- No website, has Facebook link only → `FACEBOOK_ONLY`; Instagram only → `INSTAGRAM_ONLY`.
- Only marketplace/directory links → `MARKETPLACE_ONLY`.
- Enrichment ran and found nothing → `NONE_DETECTED`.
- Enrichment not run yet / social source unavailable → `UNKNOWN` (never guess).

### 5.8 DataSourceAdapter interface

```ts
interface DataSourceAdapter {
  id: string;
  role: 'DISCOVERY' | 'ENRICHMENT' | 'BOTH';
  search(params: SearchParams, ctx: AdapterContext): AsyncIterable<RawBusiness>;   // discovery
  enrich?(lead: LeadRef, ctx: AdapterContext): Promise<RawContactData>;            // enrichment
  estimateCost(params: SearchParams): CostEstimate;
}
```

- `AdapterContext` provides: config (`DataSourceConfig`), rate limiter, ledger writer, abort signal, logger.
- The framework (not the adapter) enforces: status/enabled check, rate limits, budget cap, persistence-policy field filtering, ledger writes.
- Ship **two adapters first**: `MockAdapter` (deterministic fake Bangladeshi businesses incl. Bangla names, invalid phones, duplicates) and `CsvAdapter` (imports). Real provider adapters are added only after a human marks the source `APPROVED` in `docs/data-source-matrix.md`.

### 5.9 Safe URL fetching (SSRF protection)

`safeFetch(url)` is the **only** way to fetch external URLs:
- Allow only `http`/`https`; ports 80/443 by default.
- Resolve DNS and reject private/loopback/link-local/metadata IP ranges (re-check after redirects; max 3 redirects).
- Timeout (default 10s), max response size (default 2 MB), content-type allowlist (HTML/JSON/text).
- Honor `robots.txt` for crawler-style fetching; set a clear `User-Agent`.
- Per-domain rate limit and concurrency cap.

### 5.10 Audit log events (minimum)

`LEAD_CREATED`, `LEAD_IMPORTED`, `LEAD_EDITED`, `LEAD_MERGED`, `ASSIGNMENT_CHANGED`, `CRM_STAGE_CHANGED`, `CONTACT_CHANGED`, `EXPORT_PERFORMED`, `DEMO_CREATED`, `DEMO_EXTENDED`, `DEMO_DISABLED`, `DEMO_DELETED`, `SUPPRESSION_ADDED`, `SUPPRESSION_REMOVED`, `USER_CREATED`, `ROLE_CHANGED`, `DATASOURCE_CHANGED`, `SCORING_PROFILE_CHANGED`, `INTEGRATION_CHANGED`.

### 5.11 CRM transitions

- Main flow: `NEW → ANALYZED → CONTACTED → REPLIED → INTERESTED → DEMO_SENT → MEETING → PROPOSAL → WON`.
- Forward skips allowed (e.g. `INTERESTED → PROPOSAL`). Backward moves require `SALES_MANAGER+`.
- `crmOutcome` (`LOST`, `NO_RESPONSE`, `NOT_INTERESTED`, `INVALID_LEAD`) can be set from any stage with a required reason.
- Moving to `CONTACTED` or later requires `isSuppressed === false` for the contact channel used.
- `WON` requires a recorded won-reason; outcomes require a lost-reason.
- Every change writes `LeadActivity` + `AuditLog`.

### 5.12 Demo lifecycle

```text
QUEUED → CREATING → READY → EXPIRED → DELETED
              ↘ FAILED
READY/EXPIRED → DISABLED (manual / suppression / takedown)
```

- Only one demo per lead in `QUEUED|CREATING|READY` (partial unique index).
- `idempotencyKey = sha256(leadId + contentHash)`; same key returns the existing demo.
- `expiresAt` default now + 14 days (config). A cron job moves `READY → EXPIRED` and calls StoreMate to disable; after `deleteAfter` (default +30 days from expiry) moves `→ DELETED` and calls StoreMate delete.
- Suppressing a lead, or a takedown request, disables its demo immediately.
- Demo content rules: verified data only; no invented services/reviews/owner info; contact forms disabled; call/WhatsApp buttons only from stored public contacts (WhatsApp button only if status is `PUBLICLY_LISTED`/`CONFIRMED`).
- Every demo MUST carry visible `DEMO — NOT OFFICIAL`, `noindex,nofollow` (meta + `X-Robots-Tag`), and unguessable URL slug. Verify via automated test against the content payload sent to StoreMate.

### 5.13 Job framework

- Queues: `lead-collection`, `contact-enrichment`, `website-audit`, `ai-analysis`, `scoring`, `demo-generation`, `maintenance` (cron: demo lifecycle, suppression recompute, stale-contact marking).
- Each job row has `idempotencyKey`; handlers must upsert, not blindly insert.
- Retries: exponential backoff, max 3 attempts (configurable); permanent errors (4xx validation, `SOURCE_NOT_APPROVED`, `BUDGET_EXCEEDED`) do not retry.
- Concurrency and per-provider rate limits are configurable via env/`DataSourceConfig`.
- Every failure stores a human-readable `error` and is visible in the UI.

### 5.14 Cost tracking & budget caps

- Wrap every provider/AI/StoreMate call with `recordUsage(...)` → `UsageLedger`.
- Before starting/continuing a collection job: if `campaign.budgetCapMinor` is set, compute spent from ledger; if estimated next batch exceeds the cap, pause the job (`BUDGET_EXCEEDED`) and create a notification. Alert at 80%.
- Metrics (SQL/service functions): cost per 100 leads, cost per 1,000 leads, cost per qualified lead (qualified = not duplicate, not suppressed, required contacts present, priority HIGH in the campaign's profile).

### 5.15 AI service interface

```ts
interface AIService {
  analyzeLead(input: { evidence: LeadEvidence; language: 'bn'|'en'|'bn-en' }): Promise<LeadAnalysisResult>;
  generateWebsiteDraft(input: { verifiedBusiness: VerifiedBusinessData; language: Lang }): Promise<DemoContent>;
  generateSalesMessage(input: { lead: LeadContext; channel: 'whatsapp'|'email'; language: Lang }): Promise<Draft>;
  generateCallScript(...): Promise<Draft>;
  generateFollowUp(...): Promise<Draft>;
  generateProposal(...): Promise<Draft>;
}
```

- Provider-independent (adapter pattern). Provide a `MockAIService` for tests and local dev (deterministic).
- Prompts live in `packages/ai/prompts/` as versioned templates.
- System-level instructions for every prompt: use only supplied evidence; do not invent services/owners/facts; mark assumptions; never claim a phone is WhatsApp without evidence; output JSON matching a Zod schema.
- Cache results by `inputHash`; re-run only when underlying data changes.
- Record token usage in `UsageLedger`.
- Bangla output requires a **human review** flag (`needsReview=true`) until approved by a user.

---

## 6. API Surface (REST, `/api/v1`)

All routes require auth except `/auth/login`. Each route declares required permission. Group by module:

```text
/auth            POST login | POST logout | GET me
/users           CRUD (users:manage)
/leads           GET list (filters, cursor) | GET :id | POST | PATCH :id | DELETE :id (soft)
/leads/import    POST (CSV/Excel upload -> import job)
/leads/export    POST (filters -> CSV; audit-logged)
/lead-contacts   POST | PATCH | DELETE (manual add/confirm; WhatsApp confirm requires evidence)
/campaigns       CRUD; POST :id/run
/search-jobs     POST | GET | POST :id/cancel
/enrichment      POST /leads/:id/enrich | POST /campaigns/:id/enrich
/website-audits  POST /leads/:id/audit | GET /leads/:id/audits
/ai-analysis     POST /leads/:id/analyze | GET /leads/:id/analysis
/scoring-profiles CRUD (scoring:manage) | POST :id/rescore
/lead-scores     GET /leads/:id/scores (with events)
/services        CRUD
/crm             POST /leads/:id/stage | POST /leads/:id/outcome | POST /leads/:id/assign | POST /leads/bulk-assign
/follow-ups      CRUD; GET due
/demos           POST /leads/:id/demos | GET :id | POST :id/extend | POST :id/disable | DELETE :id
/proposals       CRUD (post-MVP+)
/drafts          POST /leads/:id/drafts  {type, channel, language}
/suppression     CRUD (suppression:manage); POST /check
/data-sources    CRUD (datasources:manage); POST :id/test
/usage-costs     GET summary | GET by-campaign | GET by-source (costs:read)
/reports         GET funnel | campaign | salesperson | cost
/notifications   GET | POST :id/read
/audit-logs      GET (admin)
/health          GET
```

Rules: validate with Zod; return `409 SUPPRESSED_CONTACT` / `403 FORBIDDEN` / `422 VALIDATION_ERROR` consistently; every list endpoint supports cursor pagination.

### Lead list filters (query params)

`country, city, area, category, q, hasPhone, hasWhatsapp, hasEmail, hasWebsite, noWebsite, onlinePresenceType, ratingMin, ratingMax, reviewsMin, scoreProfileId, scoreMin, scoreMax, priority, serviceId, crmStage, crmOutcome, assignedUserId, demoStatus, contacted, followUpDue, dataSourceId, campaignId, suppressed, createdFrom, createdTo`. Sales executives are always restricted to their assigned leads server-side.

---

## 7. UI Pages (Next.js App Router)

```text
/login
/dashboard                  role-aware (manager KPIs vs sales "today's work")
/discover                   search form -> creates search job; job progress
/campaigns, /campaigns/[id]
/leads                      table + filters + bulk actions (assign, export)
/leads/[id]                 tabs: Business | Contacts | Analysis | Website Audit | Demo | Activity | Notes | Follow-ups
/leads/import
/pipeline                   kanban by CrmStage
/follow-ups
/demos, /demos/[id]
/reports
/team, /users
/settings/scoring           profiles + rules editor (weights)
/settings/services
/settings/data-sources      matrix view (status, terms verified date, cost)
/settings/suppression
/settings/integrations
/settings/storemate
/settings/costs             usage/cost reports
```

UI rules:
- Every contact shows **value, status, source, fetchedAt**; WhatsApp shows its status badge (`UNKNOWN`/`PUBLICLY_LISTED`/`CONFIRMED`) and evidence link.
- Lead detail shows **per-profile scores with breakdown** (from `LeadScoreEvent`).
- Detected facts and AI interpretation are visually separated.
- Suppressed leads show a clear banner and disable outreach/demo buttons.
- Generated Bangla content shows a "Needs review" badge until approved.
- English UI for v1; all user-facing data fields must render Bangla Unicode correctly.

---

## 8. Milestones (Build Order)

Each milestone: **Goal → Scope → Out of scope → Tasks → Acceptance criteria → Tests**. Create `docs/build-specs/Mx-<name>.md` for each before coding it (copy the template in 9.3).

> **H-tasks (human)** can't be completed by an AI. Continue building with mocks and mark them **BLOCKED-ON-HUMAN** in the report.

---

### M0 — Foundation

**Goal:** a running skeleton with auth, RBAC, DB, queue, CI.

**Tasks**
- pnpm monorepo per section 3; `docker-compose.yml` (postgres, redis); `.env.example`.
- Prisma setup + initial migration (Organization, User, AuditLog, Notification, DataSourceConfig, SuppressionList, UsageLedger skeleton tables).
- Auth: login/logout/me, argon2, session cookie, login rate limit.
- RBAC middleware + permission constants + role seeds + seed script (super admin from env).
- pino logging with request IDs; central error handler using the error format.
- BullMQ setup, one `maintenance` queue + health job; `apps/worker` boots.
- `/health` endpoint; CI workflow (lint, typecheck, test).
- `AGENTS.md` pointing to this guide.
- **H1 (human):** fill `docs/data-source-matrix.md` (template in 11.3) and run the validation spike.
- **H2 (human):** fill `docs/storemate-api-contract.md` (template in 11.4).

**Acceptance criteria**
- `pnpm install && pnpm dev` starts web, api, worker with Docker services.
- A user can log in; protected routes return 401/403 correctly for each role (test per role).
- A queued maintenance job runs in the worker.
- CI passes on a clean clone.

---

### M1 — Core Domain: Phone, Suppression, Ledger, Data Sources

**Goal:** the foundational pure logic and tables everything else depends on.

**Tasks**
- Full Prisma models from section 4; migrations.
- `packages/core`: `normalizePhone` (5.1 incl. all fixtures), email/domain normalization (5.2), WhatsApp status guard (5.3), `isSuppressed` (5.5), `recordUsage` helper.
- Suppression API + UI page (add/remove, audit-logged); recompute-flags job.
- DataSourceConfig API + settings page (admin enables/disables; status field).
- `UsageLedger` write helper + `GET /usage-costs/summary`.

**Acceptance criteria**
- All fixtures in 5.1 pass; property test: normalize(normalize(x).e164) is stable.
- Creating a `PUBLICLY_LISTED` WhatsApp contact without evidence is rejected.
- `01712345678` and `+8801712345678` are matched as the same suppression entry.
- Suppression add/remove writes `AuditLog`.

---

### M2 — Lead Collection (Mock + CSV first)

**Goal:** collect, store, and dedupe leads end-to-end without depending on an approved real provider.

**Tasks**
- `DataSourceAdapter` interface + framework enforcement (5.8): status check, rate limit, budget cap, persistence filtering, ledger.
- `MockAdapter` and `CsvAdapter`.
- Discover UI + `POST /search-jobs`; `lead-collection` worker with idempotency and progress.
- Lead storage with `LeadSource`, `LeadContact` (normalized), `LeadSocialLink`.
- Dedupe + merge (5.4) + `DuplicateCandidate` review list.
- `/leads` table, filters (section 6), `/leads/[id]` basic Business + Contacts tabs.
- CSV import pipeline: validate → normalize → dedupe → store. CSV export (audit-logged).
- Campaign CRUD (saved criteria) + budget cap field.
- Baseline report endpoint/page: phone rate, WhatsApp rate, email rate, website rate, duplicate rate, invalid rate, cost per 100/1,000 leads (per campaign/source).
- **H3 (human):** after matrix approval, implement the first real adapter in a separate PR following the same interface.

**Acceptance criteria**
- Re-running or retrying the same search job creates no duplicate leads (test).
- Mock data containing duplicates and invalid phones is deduped/flagged correctly.
- Contacts always show source + `fetchedAt`.
- A disabled or non-`APPROVED` source cannot run outside development (`SOURCE_NOT_APPROVED`).
- Budget cap pauses a job with `BUDGET_EXCEEDED` (test with mock costs).
- Sales executives only see assigned leads via API (test).

---

### M3 — Contact Enrichment

**Goal:** fill missing contact data from permitted places.

**Tasks**
- `safeFetch` (5.9) with tests (private IPs, redirects, size/timeouts blocked).
- Enrichment worker: for leads with `websiteUrl`, fetch homepage + contact/about pages (respect robots.txt, rate limits); extract phones (normalized), emails, `wa.me` links, social links.
- Store each value with source URL and `fetchedAt`; WhatsApp from `wa.me` links → `PUBLICLY_LISTED` with `EvidenceType=WA_ME_LINK` and `evidenceUrl`.
- Compute `onlinePresenceType` (5.7).
- Re-run suppression check after enrichment.

**Acceptance criteria**
- Fixture HTML pages (store in `tests/fixtures/`) yield the expected phones/emails/WhatsApp/social links.
- A plain phone on a page is **not** labelled WhatsApp.
- SSRF tests: `http://127.0.0.1`, `http://169.254.169.254`, redirects to private IPs are rejected.
- Enrichment is idempotent (no duplicate contacts on re-run).

---

### M4 — Website & Online Presence Analyzer

**Goal:** repeatable, evidence-based audits.

**Tasks**
- Audit worker using `safeFetch`: reachable, HTTPS, mobile-usability indicators (viewport meta, responsive hints), performance indicators (response time, page weight, basic checks), broken links (sample), contact visibility, CTA, contact form, booking indicators, WhatsApp/contact button, basic SEO tags.
- Store `LeadWebsiteAudit.checks` as structured pass/fail/needs-attention + measured values (detected facts only).
- Audit tab on lead detail.

**Acceptance criteria**
- Same fixture site produces the same audit results (deterministic checks).
- Unreachable sites produce `UNREACHABLE` with error, no crash, no unbounded retries.
- Audit checks never include AI-generated claims.

---

### M5 — Scoring Profiles + AI Analysis + Service Recommendation

**Goal:** per-campaign scoring and explainable AI opportunity summaries.

**Tasks**
- `scoreLead` (5.6) + seed Website Acquisition / Website Redesign profiles; `scoring` worker; re-score on data change or profile version change.
- Scoring settings UI (edit weights/thresholds → new `version`).
- `AIService` interface + `MockAIService` + one real provider implementation behind env config (key in env, never in frontend).
- `analyzeLead` using structured evidence only; store `evidence` and `aiSummary` separately; cache by `inputHash`.
- Service rules (configurable mapping: signal → service) + `ServiceRecommendation` with reason and evidence refs.
- Lead detail Analysis tab with score breakdown.

**Acceptance criteria**
- For every score, `sum(events.points) == score` (property test).
- Changing a profile's weights creates a new version; old scores remain as history.
- Lead failing a gate is `isEligible=false`.
- AI analysis rejects/never includes claims outside provided evidence (prompt tests with mock; schema validation on output).
- Token usage recorded in `UsageLedger`.

---

### M6 — CRM

**Goal:** manage leads from NEW to WON/LOST.

**Tasks**
- Stage/outcome transitions (5.11) with permissions; `LeadActivity` timeline; notes.
- Assignment: manual, bulk; (rules later). Sales exec visibility restriction.
- Follow-ups (due dates respect org working days/hours), notifications for due follow-ups and new assignments.
- Pipeline kanban; sales dashboard ("today's work"); manager dashboard basics.
- Suppression enforcement on stage changes to outreach stages.

**Acceptance criteria**
- Invalid transitions are rejected; backward moves require manager role (tests).
- Suppressed lead cannot move to `CONTACTED+` (`409 SUPPRESSED_CONTACT`).
- Every stage change creates `LeadActivity` and `AuditLog`.
- Bulk assign 100 leads works in one request and is audit-logged.

---

### M7 — StoreMate Demo Lite

**Goal:** one-click demo from a qualified lead, safely.

**Prerequisite:** `docs/storemate-api-contract.md` completed by a human (H2). Until then, use `MockStoreMateClient`.

**Tasks**
- `StoreMateClient` interface (create/get/disable/delete demo) + mock + real client per contract.
- Generic local-business template mapping; `generateWebsiteDraft` (Bangla/English) from **verified** data only; simple review/edit form (headline, about).
- `demo-generation` worker: idempotent create, status polling/webhook per contract, retries.
- Demo safety (5.12): label, `noindex,nofollow`, unguessable slug, expiry, auto-disable, delete cron; manual extend/disable/delete.
- Lead detail Demo tab; `/demos` list.
- Suppression → immediate demo disable.

**Acceptance criteria**
- Double-clicking `Generate Demo` yields exactly one active demo (DB constraint + test).
- Payload sent to StoreMate always contains the demo label and `noindex,nofollow` flags (automated test on the payload builder).
- Demo content contains no field that isn't in the verified lead data (test with fixtures); no invented services/reviews.
- Expiry cron disables expired demos; deletion cron deletes after retention (time-travel tests).
- Suppressing a lead disables its demo.

---

### M8 — AI Sales Assistant

**Goal:** drafts, never auto-send.

**Tasks**
- Draft generation endpoints/UI: WhatsApp draft, email draft, call script, follow-up draft, proposal draft, interaction summary — languages `bn`, `en`, `bn-en`.
- Drafts saved as `Communication` (status `DRAFT`); copy/mark-as-sent flow records manual outcome. **No** automatic sending.
- "Needs review" badge for Bangla until a user approves.
- Suppression check before generating/saving.

**Acceptance criteria**
- No code path sends a message externally (grep/test).
- Drafts reference only stored facts; WhatsApp draft offered only when a contact has WhatsApp status `PUBLICLY_LISTED`/`CONFIRMED` (otherwise suggest call/email).
- Suppressed contact → `409 SUPPRESSED_CONTACT`.

---

### M9 — Analytics, Cost & Management

**Tasks**
- Funnel (Leads → Qualified → Contacted → Replied → Interested → Demo → Customer), breakdown by campaign/location/category/salesperson/service/time.
- Cost reports from `UsageLedger`: per campaign/source/period; cost per 100/1,000 leads; cost per qualified lead; budget-cap alerts; BDT conversion using stored rates.
- Export reports (CSV).

**Acceptance criteria**
- Cost totals equal the sum of ledger rows (test).
- Funnel counts match CRM data (test with seeded data).

---

### Post-MVP (do not build unless instructed)

Industry templates, bKash/Nagad, extra scoring profiles (Review Management, Automation, Local Presence), Bangla UI, review management, competitor monitoring, multi-tenant SaaS.

---

## 9. Working Protocol

### 9.1 Per-milestone loop

1. Read the milestone and referenced sections of this guide.
2. Write `docs/build-specs/Mx-<name>.md` (template 9.3). Keep it short.
3. Implement in small commits; keep logic in `packages/core`.
4. Write tests first for core logic; add API/integration tests for routes/workers.
5. Run `pnpm lint && pnpm typecheck && pnpm test`.
6. Report using 9.2.

### 9.2 Final report format (each milestone)

```text
Milestone: Mx
Done: <bullets>
Acceptance criteria: <each criterion -> PASS/FAIL + how verified>
Tests added: <list>
Assumptions made: <list, referencing section 11 defaults>
BLOCKED-ON-HUMAN: <items or "none">
Known limitations / follow-ups: <list>
Files/migrations of note: <list>
```

### 9.3 Build-spec template

```text
Title / Milestone
Goal
Referenced guide sections
In scope
Out of scope
Data model changes
API endpoints
UI changes
Background jobs
Acceptance criteria (testable)
Tests required
Security / compliance checks
Definition of done
```

### 9.4 Definition of Done

- All acceptance criteria pass; automated tests cover core logic.
- RBAC enforced on all new endpoints (test per relevant role).
- New external calls write `UsageLedger`; new important actions write `AuditLog`.
- No secrets in code/logs; `.env.example` updated.
- No long-running work inside HTTP requests.
- Migrations apply cleanly on an empty DB and on the previous milestone's DB.
- `README` / docs updated for new env vars and commands.

### 9.5 Things the agent must NOT do

- Do not add features outside the current milestone.
- Do not scrape sites or call data providers except through adapters and `safeFetch`.
- Do not hardcode provider terms, prices, or quotas; read them from `DataSourceConfig`.
- Do not "fix" a failing test by weakening it; fix the code or flag the issue.
- Do not change enums/state machines/permissions without updating this guide and noting it in the report.

---

## 10. Environment Variables (`.env.example`)

```text
NODE_ENV=development
APP_BASE_URL=http://localhost:3000
API_BASE_URL=http://localhost:4000
DATABASE_URL=postgresql://leadmate:leadmate@localhost:5432/leadmate
REDIS_URL=redis://localhost:6379
SESSION_SECRET=change-me
CREDENTIAL_ENCRYPTION_KEY=change-me-32-bytes
SEED_SUPER_ADMIN_EMAIL=admin@example.com
SEED_SUPER_ADMIN_PASSWORD=change-me
DEFAULT_TIMEZONE=Asia/Dhaka
DEFAULT_CURRENCY=BDT
SAFE_FETCH_TIMEOUT_MS=10000
SAFE_FETCH_MAX_BYTES=2097152
DEMO_DEFAULT_EXPIRY_DAYS=14
DEMO_DELETE_AFTER_EXPIRY_DAYS=30
AI_PROVIDER=mock            # mock | <real provider key set later>
AI_API_KEY=
STOREMATE_MODE=mock         # mock | real
STOREMATE_BASE_URL=
STOREMATE_API_KEY=
```

---

## 11. Decided Defaults, Templates & Open Items

### 11.1 Decided defaults (use unless a human overrides)

| Topic | Default |
|---|---|
| Demo expiry | 14 days; delete 30 days after expiry |
| Working days | Sun–Thu, 10:00–18:00 `Asia/Dhaka` (configurable per org) |
| Priority thresholds | HIGH ≥ 70, MEDIUM ≥ 40 |
| Job retries | 3 attempts, exponential backoff |
| Session lifetime | 7 days sliding, httpOnly cookie |
| Password policy | min 10 chars, argon2id |
| Pagination | 50 per page, max 200 |
| Budget alert | 80% of cap |
| Contact staleness | mark `STALE` after 180 days (config) |
| First scoring profiles | Website Acquisition, Website Redesign |
| AI language default | `bn-en` mixed for drafts, `bn` for demo copy (needs review) |

### 11.2 BLOCKED-ON-HUMAN items (do not guess)

1. Approved data sources and their terms/limits/prices (`docs/data-source-matrix.md`).
2. StoreMate API contract (`docs/storemate-api-contract.md`).
3. Bangladesh numbering-plan confirmation for the mobile prefix rule.
4. Legal review (data protection, electronic communication, marketing rules in Bangladesh).
5. Approved outreach channels/workflow for the pilot (especially WhatsApp).
6. Real AI provider choice and key.
7. Native-speaker review process for Bangla content.
8. Hosting/storage provider.

### 11.3 Template: `docs/data-source-matrix.md`

```text
| Source | Role | Access method | Fields available | Fields we may persist | Persistence/cache limit | Refresh policy | Rate limit | Pricing | BD coverage (measured) | Terms URL | Terms verified (date/by) | Status |
```
Spike results (per source): categories/areas tested, result count, field coverage, duplicate rate, error rate, latency, measured cost.

### 11.4 Template: `docs/storemate-api-contract.md`

```text
Base URL / environments:
Authentication:
POST create demo — request schema / response schema:
GET demo status:
Disable / delete demo endpoints:
Idempotency header/behavior:
Status values and webhook/polling:
Error codes and retry guidance:
Rate limits / expected generation time:
Template keys available (MVP: generic-local-business):
How the demo label and noindex are enforced on StoreMate side:
```

---

## 12. Testing Strategy

- **Unit (Vitest):** everything in `packages/core` — phone fixtures, dedupe, suppression, scoring (property test: breakdown sums), CRM transitions, demo lifecycle with fake clock, safeFetch IP checks.
- **Integration:** API routes with Supertest + test DB (RBAC per role, suppression, pagination), workers with real Redis/Postgres via Docker or testcontainers.
- **Fixtures:** `tests/fixtures/` HTML pages for enrichment/audit; mock Bangladeshi business datasets including Bangla names, invalid numbers, duplicates.
- **E2E (later):** Playwright for login → discover → lead → demo flow.
- **Compliance tests (must exist):** WhatsApp evidence guard; suppression blocking; demo label/noindex payload; no outbound send path; no non-approved source in production mode.

---

## 13. Prompts To Give The AI Agent

### 13.1 Kickoff prompt (once)

```text
You are building LeadMate. Read LEADMATE_AI_BUILD_GUIDE.md fully (sections 0-7, 9-12) and the PRD for background.
Do NOT implement everything. Start with Milestone M0 only.
Follow section 9: write the build spec, implement, test, then report using 9.2.
Use section 11 defaults for ambiguity; mark BLOCKED-ON-HUMAN items instead of guessing.
Do not invent data sources, provider terms, or StoreMate API details.
```

### 13.2 Per-milestone prompt

```text
Implement Milestone <Mx> from LEADMATE_AI_BUILD_GUIDE.md.
Previous milestones are complete and merged.
Follow section 9 (build spec, tests, report format).
Stay strictly within this milestone's scope. List any assumptions and BLOCKED-ON-HUMAN items.
```

### 13.3 Review prompt (after each milestone)

```text
Review the changes for Milestone <Mx> against LEADMATE_AI_BUILD_GUIDE.md.
Check: Hard Rules (section 2), acceptance criteria, RBAC on every new route, UsageLedger/AuditLog coverage, idempotency, suppression enforcement, and test quality. List violations and fix them.
```

---

## 14. Glossary

- **Lead:** a business (not an individual) that may become a customer.
- **Source / DataSource:** a provider or method that supplied data, governed by `DataSourceConfig`.
- **Enrichment:** adding missing contact/presence data from permitted sources.
- **Scoring Profile:** a configurable set of weighted rules for one service/campaign type.
- **Qualified lead:** not duplicate, not suppressed, has required contacts, HIGH priority in the campaign's profile.
- **Demo Lite:** MVP StoreMate demo: one generic template, one button, one demo URL.
- **Suppression:** a do-not-contact/opt-out/takedown entry that blocks outreach and demos.
- **Evidence:** a stored, verifiable fact (with source URL) that supports a claim; AI must only use evidence.
