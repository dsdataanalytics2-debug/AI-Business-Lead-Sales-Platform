# LeadMate Progress Tracking

## Current Milestone: M2 — Online Presence Analysis & Deterministic Qualification
- **Status:** COMPLETE
- **Completion Date:** 2026-10-02
- **Next Milestone:** M3 — CRM + Lead Assignment + Follow-up Management (NOT STARTED)

---

## Milestone M2 Summary of Accomplishments

### Step-by-Step Execution Summary (Steps 1–7)
- **Step 1 (Shared Contracts & Deterministic Qualification Engine):** Established analysis status enums, campaign schemas, qualification reason codes, and pure deterministic qualification scoring engine in `@leadmate/core` evaluating factual signals across 3 distinct campaigns without LLM or network dependency.
  - *Approved Checkpoint:* `50e6ec16315dc0e0caf57acbc3fbcc11f8f65bfb` (`feat(m2): add deterministic qualification contracts and scoring`)
- **Step 2 (Safe SSRF Guard & Website Analyzer):** Implemented zero-trust SSRF protection with global unicast IP classifier, DNS resolution validation, socket IP pinning against DNS rebinding, manual redirect revalidation (max 3 hops), 100 KB body streaming cap with early `</head>` abort, 5-second total probe budget, and attribute-order-agnostic `<title>` / `<meta name="description">` extraction.
  - *Approved Checkpoint:* `09c36aa76a4b6fd2989c9e146cb860943d49e1a2` (`feat(m2): add ssrf-safe website analyzer`)
- **Step 3 (Online Presence Analysis Persistence):** Evolved PostgreSQL schema with `LeadOnlinePresenceAnalysis` model containing composite unique key `(lead_id, organization_id)`, multi-tenant composite foreign keys, and synchronous Lead summary fields (`websiteStatus`, `onlinePresenceType`).
  - *Approved Checkpoint:* `373e565bb1068295feb37166ed5663253cd93271` (`feat(m2): add online presence analysis persistence`)
- **Step 4 (Online Presence Analysis Service & API):** Implemented `POST /api/v1/leads/:id/analyze` and `GET /api/v1/leads/:id/analysis`, optimistic concurrency protection (409 on stale input mutation), same-process in-flight deduplication, transactional invalidation hooks, authoritative audit logging (`lead.online_presence_analyzed`), and per-user in-memory rate limiting (30 req / 60s).
  - *Approved Implementation:* `fae5c8c440b45f57019d2bdabdff77fe4a6de754` (`feat(m2): add online presence analysis API`)
  - *Contract Verification:* `f18b265193955f9ec6c0a55175b09cbff5f0fb47` (`test(m2): verify analysis audit and error contracts`)
- **Step 5 (Lead Detail Analysis UI):** Built reactive Lead Detail online presence card (`OnlinePresenceAnalysisCard`) with canonical error handling, unanalyzed state CTA, populated score breakdown per campaign, responsive layouts, sanitized external links (`target="_blank" rel="noopener noreferrer"`), and strict `LEADS_WRITE` RBAC button mirroring.
  - *Approved Implementation:* `9f14eb5b83d5a61e58f05ed7a790d98609c2ebd9` (`feat(m2): add lead analysis detail UI`)
  - *Contract Alignment:* `eea52790311854a32e9389eafd1336d665ae087e` (`fix(m2): align analysis UI permission and not-found handling`)
- **Step 6 (End-to-End & Security Validation Suite):** Created comprehensive validation suite (`apps/api/src/tests/m2-e2e-security-validation.spec.ts`) proving the entire M2 journey, direct IP SSRF rejection, mixed DNS defense, redirect SSRF blocking, DNS pinning, rate limiting, tenant isolation, RBAC, input anti-tampering, stale concurrency races (409), suppression rules, audit data minimization, error envelope compliance, and zero global score contamination.
  - *Approved Checkpoint:* `e3bb20b418c9ae9d62e6ea9bbb700a73b28be466` (`test(m2): validate online presence security and e2e flows`)
- **Step 7 (CI Validation, Documentation & Milestone Closure):** Validated GitHub Actions CI coverage, documented final M2 architecture, security controls, technical debt, and finalized milestone closure.

---

## Architectural & Security Foundation Delivered in M2

| Layer / Subsystem | Architecture & Invariants | Status |
|---|---|---|
| **SSRF Guard & IP Classifier** | Zero-trust global unicast classifier; blocks private, loopback, multicast, link-local, cloud metadata, ULA, CGNAT | Operational |
| **Website Analyzer** | 5s wall-clock total budget; 100 KB streaming cap; socket IP pinning; manual redirect re-validation (max 3 hops) | Operational |
| **Metadata Extraction** | Attribute-order & quote agnostic extraction of `<title>` and `<meta name="description">`; HTML entity decoding | Operational |
| **Deterministic Scoring** | Rule-based, side-effect-free scoring (0–100) per campaign; no LLM; no global score; contact/suppression aware | Operational |
| **Multi-Campaign Models** | `WEBSITE_ACQUISITION`, `WEBSITE_REDESIGN`, `ONLINE_PRESENCE_IMPROVEMENT` | Operational |
| **Version Consistency** | Exact versions maintained: `analyzerVersion = 'v1'`, `scoreVersion = 'v1'` | Operational |
| **Persistence & Sync** | Exactly 1 analysis row per `(leadId, organizationId)`; synchronizes `Lead.websiteStatus` & `Lead.onlinePresenceType` | Operational |
| **Invalidation Lifecycle** | Lead input edit (PATCH), manual contact creation, and provider merge transactionally invalidate analysis and reset state | Operational |
| **Concurrency Protection** | Optimistic concurrency checking input fingerprint & `updatedAt` on persistence (409 CONFLICT on stale race) | Operational |
| **In-Flight Deduplication** | In-process deduplication shares single active probe across concurrent requests for same `organizationId:leadId` | Operational |
| **Rate Limiting** | 30 requests per 60 seconds per user on `POST /analyze` (returns 429 with `Retry-After` header) | Operational |
| **Granular RBAC** | `POST /analyze` requires `LEADS_WRITE`; `GET /analysis` requires `LEADS_READ`; VIEWER cannot trigger analysis | Operational |
| **Multi-Tenancy** | Strict tenant isolation; cross-tenant GET or POST returns generic 404 `NOT_FOUND` | Operational |
| **Audit & Error Contract** | Action `lead.online_presence_analyzed` with scalar metadata only; standard error envelope `{ error: { code, message, requestId } }` | Operational |
| **Frontend UI** | Next.js Lead Detail card with unanalyzed CTA, campaign score breakdown, safe link sanitization, and permission-aware action button | Operational |
| **Zero Live Network** | 100% of automated tests execute with zero public internet requests via dependency-injected mock transports | Operational |

---

## API Endpoints & Contracts

### Endpoints
- `POST /api/v1/leads/:id/analyze` — Trigger or re-run online presence analysis.
  - **Permission Required:** `LEADS_WRITE`
  - **Status Codes:** `200 OK`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT` (stale race), `422 VALIDATION_ERROR` (body tampering), `429 RATE_LIMITED`
- `GET /api/v1/leads/:id/analysis` — Retrieve latest analysis state.
  - **Permission Required:** `LEADS_READ`
  - **Status Codes:** `200 OK` (returns `{ data: null }` if unanalyzed, or populated analysis object), `401 UNAUTHENTICATED`, `404 NOT_FOUND`

### Analysis Statuses
- `NOT_APPLICABLE` — Lead has no website URL provided (`website = null`).
- `REACHABLE` — HTTP 200/2xx reachable HTML webpage.
- `UNREACHABLE` — HTTP 404/5xx, connection failure, DNS resolution failure, or exceeded redirect hops.
- `TIMEOUT` — Total 5-second deadline exceeded during DNS/connect/TLS/redirect/streaming.
- `ACCESS_RESTRICTED` — HTTP 401/403/429 authorization/bot challenge encountered.
- `BLOCKED_SSRF` — Target URL or resolved IP blocked by positive global unicast policy.
- `INVALID_URL` — Malformed URL syntax, unsupported scheme, or embedded user credentials.
- `NON_HTML` — Valid response with non-HTML content type (e.g. `application/pdf`).

### Campaign Types & Scoring Invariants
- `WEBSITE_ACQUISITION` — Targets businesses without websites or with unreachable/broken websites.
- `WEBSITE_REDESIGN` — Targets businesses with reachable websites needing modernization (non-HTTPS, missing metadata, slow response).
- `ONLINE_PRESENCE_IMPROVEMENT` — Targets businesses reliant solely on social media (Facebook/Instagram) or marketplace channels.
- **Invariants:** Every campaign score is deterministic (0–100). No global/winner score is computed or stored.

---

## Test & Verification Baseline

- **Automated Tests:** 607/607 tests passing across 32 test files (`node node_modules/vitest/vitest.mjs run`).
- **Root Typecheck:** 0 errors across 9 workspaces (`npm run typecheck`).
- **Web Production Build:** Clean static and dynamic route generation (`npm run build -w apps/web`).
- **Security Audit:** Zero live network requests in tests; zero credentials/secrets leaked; zero `dangerouslySetInnerHTML`.
- **Test DB Safety:** All database test suites protected by PostgreSQL `ensureTestDatabase` guard asserting database name ends with `_test`.

---

## Known Non-Blocking Notes & Technical Debt

1. **In-Memory Rate Limiting:** The analyze rate limiter (30 req / 60s) is in-memory per API process. Multi-instance distributed rate limiting is deferred to future infrastructure phases.
2. **In-Process Deduplication:** In-flight analysis deduplication is in-process only. Multiple API instances can still execute concurrent probes for the same lead.
3. **Cross-Process Concurrency:** Analysis writes rely on PostgreSQL unique constraints and optimistic input fingerprint comparisons; no distributed locks (e.g. Redis Redlock) are used.
4. **IANA IP Range Policy:** Special-purpose IP range definitions in `ssrf-guard.ts` should be periodically reviewed against updated IANA special registry allocations.
5. **Lightweight HTML Probing:** Website analysis performs lightweight, bounded HTTP streaming without headless browser rendering or client-side JavaScript execution.

---

## Milestone M1 Summary of Accomplishments (Archived Reference)

### Step-by-Step Execution Summary (Steps 1–10)
- **Step 1 (Datasource Interfaces & Registry):** Established `packages/datasources` with pluggable `DataSourceProvider` interface, provider registry, search & resolve contracts, and mock provider implementation with 10 Bangladesh business fixtures (`f110759`).
- **Step 2 (Prisma Schema Evolution):** Enhanced PostgreSQL schema with Lead sources, contacts with phone type & trust status, contact evidence provenance, multi-tenant composite foreign keys, and unique indexes for idempotent deduplication (`1c45dfc`).
- **Step 3 (Normalization Engine):** Implemented pure domain normalization in `@leadmate/core` for Bangladesh E.164 phone numbers (`01...`, `+8801...`, `8801...`, Bengali numerals), domain/URL normalization, and business name normalization (`aa42013`).
- **Step 4 (Deterministic Deduplication Engine):** Implemented multi-tier duplicate detection in `@leadmate/core`: Tier 1A (Provider Identity), Tier 1B (Mobile Phone Match), Tier 2A (Website Domain Candidate), Tier 2B (Name & City Candidate), and Conflict resolution (`70f5e71`).
- **Step 5 (Datasource Mock Provider & Live Preview Search):** Wired datasource search registry and mock provider with location/keyword filtering, pagination, and multi-tenant isolation (`8da7715`).
- **Step 6 (Business Search & Trusted Save Backend API):** Built `GET /api/v1/business-search` preview endpoint and `POST /api/v1/business-search/save-lead` trusted save handler with server-side provider resolution, deduplication, atomic transaction rollback, and audit logging (`8b97587`).
- **Step 7 (Master Lead Database API):** Implemented `GET /api/v1/leads` (cursor pagination, multi-filter query, tri-state booleans), `GET /api/v1/leads/:id` (authoritative detail, evidence, provenance, data minimization), `PATCH /api/v1/leads/:id` (strict allowed updates), and `POST /api/v1/leads/:id/contacts` (strict manual contact creation with `PHONE != WHATSAPP` invariants) (`126c912`).
- **Step 8 (Business Search Frontend Page):** Built Next.js `/business-search` page with query inputs, results table, status badges, conflict modals, responsive layout, and granular RBAC protection (`LEADS_READ` for search, `LEADS_WRITE` for save) (`fcf533c`).
- **Step 9 (Master Lead Database & Detail Frontend Pages):** Built `/leads` list page with server-side filters & cursor pagination, and `/leads/[id]` detail page with inline edit drawer, manual contact modal with trust enforcement, provenance timeline, and suppression indicators (`6cd4f8d`).
- **Step 9.5 (Test Database Safety Hardening):** Centralized `ensureTestDatabase` guard in `@leadmate/db/test-guard` asserting connected PostgreSQL `current_database()` strictly ends with `_test`, eliminating all weak connection string checks repository-wide (`3056a96`).
- **Step 10 (End-to-End Integration, CI Validation & M1 Closure):** Created comprehensive M1 E2E integration test suite (`apps/api/src/tests/m1-e2e-integration.spec.ts`) validating complete business lifecycle, anti-tampering, multi-tenant isolation, RBAC, duplicate matrix, contact trust, suppression, audit trails, error contracts, and GitHub Actions CI (`3f323bd`).

---

## Next Steps (Awaiting Kickoff)
- **Milestone M3 — CRM + Lead Assignment + Follow-up Management:** NOT STARTED. Awaiting explicit approval and kickoff instructions.
