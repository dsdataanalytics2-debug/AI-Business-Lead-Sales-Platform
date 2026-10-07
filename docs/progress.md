# LeadMate Progress Tracking

## Current Milestone: M7 — Team Management + Sales Dashboard + Analytics 🔄 IN PROGRESS
- **Status:** IN PROGRESS
- **Base Checkpoint:** `1a3160834c6c4eb1208640917204e38f898fcd24` (`docs(m6): close automated outreach milestone`)
- **Step 0 (Architecture & Scope Freeze):** IMPLEMENTED / AWAITING REVIEW
- **Step 1 (Shared Contracts & RBAC Permissions):** NOT STARTED
- **Step 2 (Team Management Domain Service, DB Indexes & API):** NOT STARTED
- **Step 3 (Team Management UI):** NOT STARTED
- **Step 4 (Sales Analytics Domain Engine):** NOT STARTED
- **Step 5 (Sales Dashboard REST API & Scoping):** NOT STARTED
- **Step 6 (Sales Dashboard UI Core):** NOT STARTED
- **Step 7 (Team Workload & Outreach Analytics UI):** NOT STARTED
- **Step 8 (Security, Tenant Isolation & Query Optimization Hardening):** NOT STARTED
- **Step 9 (E2E Integration & Full Workspace Regression):** NOT STARTED
- **Step 10 (Milestone Review & Closure):** NOT STARTED

## Completed Milestone: M6 — Automated Outreach & Delivery ✅ COMPLETE
- **Status:** COMPLETE
- **Base Checkpoint:** `e498542377882c4e1a46590f794bb49ef1196ecd` (`feat(m6): add resend email live provider`)
- **Step 0 through Step 10:** COMPLETE (`1a3160834c6c4eb1208640917204e38f898fcd24`)

### M7 Step 0 — Architecture & Scope Freeze (Implemented / Awaiting Review)
- **Status:** IMPLEMENTED / AWAITING REVIEW
- **Base Checkpoint:** `1a3160834c6c4eb1208640917204e38f898fcd24` (`docs(m6): close automated outreach milestone`)
- **Primary Goals & Scoped Modules:**
  - A. **Team Management:** Organization user management, role assignments, profile edits, activation/deactivation, and workload visibility.
  - B. **Sales Dashboard:** Real-time pipeline KPI cards, funnel metrics, follow-up workload, and outreach performance.
  - C. **Analytics Engine:** Indexed real-time database aggregates for lead lifecycle, sales executive performance, outreach delivery, and lead sources.
- **Architectural Guardrails & Frozen Decisions:**
  - **Team Hierarchy Decision:** No `managerId`, `teamId`, or `departmentId` columns added to `User`. The operational sales manager role exercises tenant-wide sales oversight; all members belong directly to the `Organization`.
  - **User Onboarding Model:** Reuses existing Option A (Admin creates member with temporary password using Argon2id hashing via `hashPassword`). No complex email token invitation subsystem introduced in M7.
  - **User Activation & Invariant:** Relies on existing `User.isActive`. Deactivated users are blocked from logging in (`session.service.ts` rejects immediately), excluded from new assignment dropdowns (`lead.service.ts listAssignees` filters `isActive: true`), while historical assignments and audit logs remain intact (`onDelete: Restrict`). No silent reassignment or deletion.
  - **Role Management & Permission Matrix (`USERS_READ` / `USERS_MANAGE`):**
    - `SUPER_ADMIN`: `USERS_READ` + `USERS_MANAGE` (full user management across all roles within tenant).
    - `ADMIN`: `USERS_READ` + `USERS_MANAGE` (can manage `SALES_MANAGER`, `SALES_EXECUTIVE`, `VIEWER`; cannot create/promote to `SUPER_ADMIN` or peer `ADMIN`; cannot edit/deactivate `SUPER_ADMIN`).
    - `SALES_MANAGER`: `USERS_READ` (read-only member list and workload visibility; cannot create, edit, or deactivate users).
    - `SALES_EXECUTIVE`: No `USERS_READ`, no `USERS_MANAGE` (cannot access `/team` or user roster).
    - `VIEWER`: No `USERS_READ`, no `USERS_MANAGE` (observer only; cannot access `/team` or user roster).
    - Safety guards: no self-role demotion, no self-deactivation (`targetUserId !== currentUserId`), and last active `SUPER_ADMIN` in tenant cannot be demoted or deactivated (HTTP 409).
  - **Lead Assignment Authority:** `Lead.assignedUserId` remains single source of truth. Reassignment strictly uses existing CRM route (`PATCH /api/v1/leads/:id/assignment`) with `LEADS_ASSIGN` permission and audit logging.
  - **Stage Date Semantics & Limitation (Why `updatedAt` is NOT used):**
    - The `Lead` model does NOT have an authoritative scalar timestamp column (`wonAt`, `lostAt`, `stageChangedAt`).
    - `Lead.updatedAt` is modified on any lead mutation (contact additions, assignment changes, notes, manual field edits, rating changes), making `updatedAt` unsafe as a proxy for conversion or stage transition dates.
    - Historical transitions are recorded in `CrmActivity` (`type: STAGE_CHANGED`), but querying JSON metadata is unindexed for dashboard aggregates.
    - Explicit M7 Step 0 Limitation: Stage counts across the pipeline are defined strictly as **CURRENT-STATE snapshots** (`crmStage = ...`), decoupled from date-range transition filters.
    - Schema Change Proposal (Deferred to future Step 2 persistence, NOT implemented in Step 0): Evaluate adding dedicated timestamps (`stageChangedAt DateTime?`, `wonAt DateTime?`, `lostAt DateTime?`) to `Lead` updated transactionally in `updateCrmStage`.
  - **Canonical Cohort Conversion Rate Formula:**
    - To eliminate population mixing between creation dates and transition dates, M7 freezes a single canonical cohort formula:
      $$\text{Cohort Conversion Rate} = \frac{\text{Leads created in selected period that are currently WON}}{\text{Total Leads created in selected period}} \times 100$$
    - Denominator: `count(Lead WHERE organizationId = :org [AND assignedUserId = :user] AND createdAt BETWEEN from AND to)`.
    - Numerator: `count(Lead WHERE organizationId = :org [AND assignedUserId = :user] AND createdAt BETWEEN from AND to AND crmStage = WON)`.
    - Zero-denominator behavior: Safe `0.0%` when denominator is 0 (never NaN, never divide-by-zero).
    - Single-population guarantee: Denominator and numerator evaluate the exact same cohort of leads acquired during the selected period.
  - **Funnel Semantics (Current Pipeline Distribution):**
    - The funnel is defined strictly as **Current Pipeline Distribution by `crmStage`** (breakdown of active lead volume across `NEW`, `CONTACTED`, `QUALIFIED`, `PROPOSAL_SENT`, `NEGOTIATION`, `WON`, `LOST`).
    - It is NOT a historical drop-off transition funnel because the database tracks current stage state, not historical stage progression. UI wording will explicitly display "Current Pipeline Distribution by Stage".
  - **Analytics RBAC & Sales Executive Scoping Rule:**
    - Core Invariant: **Permission grants capability. Service/API scope determines data visibility.**
    - Step 1 grants `REPORTS_READ` to: `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_EXECUTIVE`, and `VIEWER`.
    - `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`: Tenant-wide analytics across all sales reps and unassigned leads.
    - `VIEWER`: Tenant-wide read-only dashboard visibility (cannot view or mutate `/team` user roster).
    - `SALES_EXECUTIVE`: API/service layer strictly scopes all analytics queries to `WHERE organizationId = req.user.organizationId AND assignedUserId = req.user.id`. A sales executive NEVER gains tenant-wide reports simply by possessing `REPORTS_READ`. Frontend hiding is never relied upon; scoping is unconditionally enforced in database queries.
  - **Sales Team Performance Table (No Leaderboard / Gamification):**
    - UI section is named **Sales Team Performance Table** (or **Team Performance Table**), explicitly rejecting "Leaderboard" terminology, arbitrary composite scores, or subjective employee rankings.
    - Deterministic column sorting is permitted only by explicit operational metrics (e.g., Assigned Leads, Cohort Won, Overdue Follow-ups, Cohort Conversion Rate) at the user's explicit request.
  - **Workload vs Period Performance Metric Distinction:**
    - **Current Workload Metrics** (Point-in-time snapshot, independent of date picker):
      - `activeLeadsCount`: Count of leads assigned to rep where `crmStage NOT IN [WON, LOST]`.
      - `pendingFollowUpsCount`: Count of follow-up tasks assigned to rep with `status = PENDING`.
      - `overdueFollowUpsCount`: Count of follow-up tasks assigned to rep with `status = PENDING` and `dueAt < now()`.
    - **Selected-Period Performance Metrics** (Filtered by `from` and `to` date range):
      - `leadsCreatedInPeriod`: Cohort leads created in period (`createdAt BETWEEN from AND to`) assigned to rep.
      - `cohortWonCount`: Leads created in period assigned to rep that are currently `crmStage = WON`.
      - `cohortConversionRate`: `(cohortWonCount / leadsCreatedInPeriod) * 100` (safe `0.0%` on zero denominator).
      - `outreachSentCount`: Outreach deliveries in the send cohort (`sentAt BETWEEN from AND to`) for rep's leads.
      - `outreachDeliveredCount`: Deliveries in the send cohort currently `status = DELIVERED` (`sentAt BETWEEN from AND to`).
      - `outreachFailedCount`: Deliveries in the send cohort currently `status = FAILED` (`sentAt BETWEEN from AND to`).
      - `outreachAwaitingCount`: Deliveries in the send cohort currently `status = SENT` (`sentAt BETWEEN from AND to`) awaiting provider terminal receipt.
      - `resolvedDeliverySuccessRate`: `(outreachDeliveredCount / (outreachDeliveredCount + outreachFailedCount)) * 100` (safe `0.0%` on zero terminal outcomes; both numerator and denominator evaluate the exact same send cohort and exclude pending `SENT` sends).
  - **Deterministic KPI Contract Table:**

| Metric | Meaning | Source Model | Filter / Status | Timestamp Semantics | Assignee Scope | Zero-Denominator Behavior |
|---|---|---|---|---|---|---|
| **Total Leads (Period Cohort)** | Total leads created within the selected date range | `Lead` | All stages | `createdAt BETWEEN from AND to` | All or rep-scoped (`assignedUserId`) | N/A (integer $\ge$ 0) |
| **Current Stage Counts** | Current number of leads in each CRM stage (current pipeline/state distribution) | `Lead` | Specific `crmStage` (`NEW`, `CONTACTED`, `QUALIFIED`, `PROPOSAL_SENT`, `NEGOTIATION`, `WON`, `LOST`) | Current state snapshot (no date filter for total pipeline snapshot) | All or rep-scoped (`assignedUserId`) | N/A (integer $\ge$ 0) |
| **Cohort Conversion Rate** | Percentage of leads acquired during the period that have reached WON status | `Lead` | Numerator: `crmStage = WON`; Denominator: Total leads in cohort | Numerator and Denominator: `createdAt BETWEEN from AND to` | All or rep-scoped (`assignedUserId`) | `0.0%` if denominator is 0 (never NaN / error) |
| **Follow-ups Due Today** | Pending tasks scheduled for action within today's operational window | `FollowUpTask` | `status = PENDING` | `dueAt BETWEEN startOfDay AND endOfDay` (in org timezone) | All or rep-scoped (`assignedUserId`) | N/A (integer $\ge$ 0) |
| **Overdue Follow-ups** | Pending tasks whose due date has passed without completion | `FollowUpTask` | `status = PENDING` | `dueAt < now()` | All or rep-scoped (`assignedUserId`) | N/A (integer $\ge$ 0) |
| **Outreach Sent (Send Cohort)** | Total outbound messages dispatched to delivery network within selected window | `OutreachDelivery` | `sentAt IS NOT NULL` (all statuses in send cohort) | `sentAt BETWEEN from AND to` (Send Cohort) | All or rep-scoped (via `lead.assignedUserId`) | N/A (integer $\ge$ 0) |
| **Outreach Delivered** | Messages from the send cohort confirmed delivered by provider | `OutreachDelivery` | `status = DELIVERED` | `sentAt BETWEEN from AND to` (Same Send Cohort; not `deliveredAt`) | All or rep-scoped (via `lead.assignedUserId`) | N/A (integer $\ge$ 0) |
| **Outreach Failed** | Messages from the send cohort that failed delivery or bounced | `OutreachDelivery` | `status = FAILED` | `sentAt BETWEEN from AND to` (Same Send Cohort; not `failedAt`) | All or rep-scoped (via `lead.assignedUserId`) | N/A (integer $\ge$ 0) |
| **Awaiting Delivery** | Messages from the send cohort in flight awaiting provider terminal callback | `OutreachDelivery` | `status = SENT` | `sentAt BETWEEN from AND to` (Same Send Cohort) | All or rep-scoped (via `lead.assignedUserId`) | N/A (integer $\ge$ 0) |
| **Resolved Delivery Success Rate** | Ratio of confirmed deliveries to resolved terminal outcomes within the send cohort | `OutreachDelivery` | Numerator: `status = DELIVERED`; Denominator: `status IN [DELIVERED, FAILED]` | Numerator & Denominator: `sentAt BETWEEN from AND to` (Same Send Cohort) | All or rep-scoped (via `lead.assignedUserId`) | `0.0%` if resolved count is 0 (never NaN / error) |
| **Active Workload (Per Rep)** | Count of active non-terminal leads assigned to sales rep | `Lead` | `crmStage NOT IN [WON, LOST]` | Current state snapshot | Scoped to specific sales rep (`assignedUserId`) | N/A (integer $\ge$ 0) |

  - **Date & Timezone Semantics:** Each metric uses dedicated date column (`Lead.createdAt`, `FollowUpTask.dueAt`, `OutreachDelivery.sentAt`). Outreach analytics evaluate a single send cohort via `sentAt`. Calendar day bucketing uses `Organization.timezone` (`@default("Asia/Dhaka")`).
  - **Analytics Architecture:** Direct indexed Prisma/PostgreSQL aggregates with parallel `Promise.all` execution. Zero external OLAP warehouse (no ClickHouse/Elasticsearch), zero premature Redis caching, zero WebSocket/SSE transports.
  - **Proposed Indexes (Targeted Query Pattern Alignment):**
    - `Lead`:
      - `[organizationId, createdAt]` (tenant-wide period cohort queries)
      - `[organizationId, assignedUserId, createdAt]` (sales-executive period cohort queries)
      - `[organizationId, assignedUserId, crmStage]` (rep-scoped current stage counts & active workload queries)
      - `[organizationId, primarySource]` (tenant-wide lead source distribution)
      - *(Note: `[organizationId, crmStage]` and `[organizationId, assignedUserId]` already exist in `schema.prisma`)*
    - `FollowUpTask`:
      - `[organizationId, status, dueAt]` (tenant-wide due today and overdue follow-up queries; rep-scoped `[organizationId, assignedUserId, status, dueAt]` already exists)
    - `OutreachDelivery`:
      - `[organizationId, sentAt]` (sufficient for tenant-wide send cohort queries; `[organizationId, status, createdAt]` already exists)
      - Evaluated for future query shapes (propose for Step 2 evaluation, not implemented in Step 0): `[organizationId, channel, sentAt]` for channel-filtered send cohorts and `[organizationId, status, sentAt]` for status aggregations within send cohorts.
  - **Frontend UI & Charts:** Responsive layout using existing Tailwind CSS & Lucide icons. Visual SVG/Tailwind bars and progress metrics (no heavy chart library bloat).
  - **Audit Logging:** Emits `team.member_created`, `team.member_updated`, `team.member_role_changed`, `team.member_activated`, `team.member_deactivated` with zero password or token leakage.
  - **Explicitly Deferred:** StoreMate live external provider integration remains deferred behind 503; bulk multi-lead campaigns deferred; internal `@leadmate/*` renaming deferred.
- **10-Step Implementation Roadmap:**
  - Step 0: Architecture & Scope Freeze (Current)
  - Step 1: Shared Contracts & RBAC Permissions
  - Step 2: Team Management Domain Service, DB Indexes & API
  - Step 3: Team Management UI (`/team`)
  - Step 4: Sales Analytics Domain Engine
  - Step 5: Sales Dashboard REST API & Scoping
  - Step 6: Sales Dashboard UI Core (`/dashboard`)
  - Step 7: Advanced Team Workload & Outreach Analytics UI
  - Step 8: Security, Tenant Isolation & Query Optimization Hardening
  - Step 9: E2E Integration & Full Workspace Regression
  - Step 10: Milestone Review & Closure

### M6 Step 1 — Shared Outreach Contracts + Permissions (Completed)
- **Files Created:** `packages/shared/src/schemas/outreach.ts`, `packages/shared/src/tests/outreach-schemas.spec.ts`.
- **Files Modified:** `packages/shared/src/enums.ts`, `packages/shared/src/permissions.ts`, `packages/shared/src/index.ts`, `docs/progress.md`.
- **Contracts Implemented:**
  - `OutreachChannel`: `WHATSAPP`, `EMAIL`.
  - `OutreachDeliveryStatus`: `REQUESTED`, `QUEUED`, `PROCESSING`, `SENT`, `DELIVERED`, `FAILED`, `CANCELLED` (terminal states: `DELIVERED`, `FAILED`, `CANCELLED`).
  - State machine transition validator: `isValidOutreachDeliveryTransition(from, to)`.
  - Error enum: `OutreachErrorCode` (13 canonical codes).
  - Public error contract: `lastErrorCode` strictly typed as `z.nativeEnum(OutreachErrorCode).nullable().optional()`; arbitrary/internal strings strictly rejected.
  - Idempotency header contract: `outreachIdempotencyKeyHeaderSchema` (8-128 chars, case-preserving regex `^[A-Za-z0-9._:-]+$`).
  - Send request schema: `sendOutreachDeliveryRequestSchema` marked `.strict()` with strict rejection of client-injected provider, status, or context overrides.
  - Channel compatibility matrix: `WHATSAPP` $\rightarrow$ `WHATSAPP` only; `EMAIL` $\rightarrow$ `EMAIL` only; `PROPOSAL` $\rightarrow$ `EMAIL` only; `FOLLOW_UP` $\rightarrow$ `WHATSAPP` or `EMAIL`; `CALL_SCRIPT` $\rightarrow$ non-dispatchable.
  - RBAC: `OUTREACH_READ`, `OUTREACH_SEND`, `OUTREACH_MANAGE`.

### M6 Step 2 — Outreach Delivery Persistence + Migration (Completed)
- **Files Created:**
  - `packages/db/prisma/migrations/20261005060210_add_m6_outreach_delivery/migration.sql`
  - `packages/db/src/tests/outreach-delivery-persistence.spec.ts`
- **Files Modified:**
  - `packages/db/prisma/schema.prisma`
  - `docs/progress.md`
  - `docs/decisions.md`
- **Data Model & Invariants Implemented:**
  - **Prisma Enums:** `OutreachChannel` (`WHATSAPP`, `EMAIL`), `OutreachDeliveryStatus` (`REQUESTED`, `QUEUED`, `PROCESSING`, `SENT`, `DELIVERED`, `FAILED`, `CANCELLED`).
  - **OutreachDelivery Model:** Mapped to table `outreach_deliveries` with default `status = REQUESTED` and `attemptCount = 0`.
  - **Tenant Isolation & Composite Foreign Keys:**
    - `(organization_id)` $\rightarrow$ `organizations(id)` ON DELETE CASCADE
    - `(lead_id, organization_id)` $\rightarrow$ `leads(id, organization_id)` ON DELETE CASCADE
    - `(draft_id, organization_id)` $\rightarrow$ `sales_assistant_drafts(id, organization_id)` ON DELETE RESTRICT
    - `(requested_by_user_id, organization_id)` $\rightarrow$ `users(id, organization_id)` ON DELETE RESTRICT
  - **Recipient & Contact Safety:**
    - `recipientNormalized`: Required scalar string snapshot of verified destination.
    - `recipientContactId`: Nullable scalar UUID; contact foreign key omitted from DB schema to prevent un-scoped cross-tenant foreign key bypasses (enforced transactionally at Step 4 service layer).
  - **Server-Managed Content Snapshots (Immutable-by-Domain):**
    - `snapshotContent`: Nullable text for WhatsApp messages.
    - `snapshotSubject`: Nullable text for Email messages.
    - `snapshotBody`: Nullable text for Email messages.
    - `approvedDraftSnapshotHash`: Required 64-char SHA-256 integrity hash snapshot taken at dispatch request time.
    - Content snapshots are server-managed immutable-by-domain (persisted in standard PostgreSQL columns, with immutability preserved by application/worker domain invariants rather than DB-level row triggers).
  - **Idempotency & Replay Protection:**
    - `idempotencyKey`: Case-preserving client idempotency key with mandatory uniqueness constraint `@@unique([organizationId, idempotencyKey])`.
    - `requestFingerprint`: SHA-256 fingerprint of normalized request parameters for parameter mismatch detection.
  - **Provider Correlation & Error Diagnosis:**
    - `providerName` & `providerMessageId`: Nullable correlation identifiers; indexed via `@@index([providerName, providerMessageId])` (non-unique to support multiple providers or test accounts without cross-account collision).
    - `lastErrorCode` & `safeLastErrorMessage`: Internal diagnosis error fields. The max 500 length constraint for `safeLastErrorMessage` is enforced at the shared/public DTO boundary while stored in a flexible PostgreSQL text column.
  - **Full Timestamp Lifecycle:** `requestedAt` (default `now()`), `queuedAt`, `processingAt`, `sentAt`, `deliveredAt`, `failedAt`, `cancelledAt`, `createdAt`, `updatedAt`.
  - **Indexes:** `[organizationId, leadId, createdAt]`, `[organizationId, status, createdAt]`, `[organizationId, channel, status]`, `[providerName, providerMessageId]`, `[draftId]`, `[requestedByUserId]`, `@@unique([organizationId, idempotencyKey])`, `@@unique([id, organizationId])`.
  - **Data Minimization:** Zero storage of raw provider request/response payloads, bearer tokens, API keys, secrets, system prompts, or reasoning traces.
  - **Migration Safety:** Clean PostgreSQL migration `20261005060210_add_m6_outreach_delivery` containing strictly M6 types, table, indexes, and FKs without drops, destructive alters, or table rewrites. Applied cleanly to development and test databases.
- **Test Suite Results:**
  - `packages/db/src/tests/outreach-delivery-persistence.spec.ts`: 23 targeted persistence tests passing (enum parity, creation, defaults, idempotency unique constraint, case sensitivity, resend support, cross-tenant lead/user/draft rejection, provider update, error storage, lifecycle transitions, and referential integrity restrict/cascade).
  - Full DB regression: **118 passed** across 8 test files.
  - Full repository test suite: **1,387 passed** across 66 test files (0 failures).

### M6 Step 3 — Delivery Provider Abstraction + Deterministic Mock Providers (Completed)
- **Files Created:**
  - `packages/core/src/outreach/interfaces.ts`
  - `packages/core/src/outreach/errors.ts`
  - `packages/core/src/outreach/mock-whatsapp-provider.ts`
  - `packages/core/src/outreach/mock-email-provider.ts`
  - `packages/core/src/outreach/registry.ts`
  - `packages/core/src/outreach/index.ts`
  - `packages/core/src/tests/outreach-delivery-provider.spec.ts`
- **Files Modified:**
  - `packages/core/src/index.ts`
  - `docs/progress.md`
  - `docs/decisions.md`
- **Architecture & Implementation Delivered:**
  - **Provider Interface:** Defined `OutreachDeliveryProvider` requiring `readonly name: string`, `readonly channel: OutreachChannel`, and `send(input): Promise<OutreachProviderSendResult>`.
  - **Typed Transport Inputs (Discriminated Union):** Implemented `OutreachProviderSendInput` as a clean discriminated union of `WhatsAppOutreachProviderSendInput` (requires `content`, forbids `subject`/`body`) and `EmailOutreachProviderSendInput` (requires `body`, optional `subject`, forbids `content`), carrying solely immutable transport snapshot data (`deliveryId`, `organizationId`, `recipientNormalized`, `providerIdempotencyToken`).
  - **Deterministic Result Contract:** `OutreachProviderSendResult` carries `providerName`, `providerMessageId`, and `acceptedAt` Date (zero raw HTTP payloads, headers, or tokens).
  - **Deterministic Provider Identifiers:** Mock providers generate deterministic message IDs as `mock-wa:<deliveryId>` and `mock-email:<deliveryId>` with zero randomness, guaranteeing stable assertions and replay identification across test suites.
  - **Idempotency Token Handling:** Accepts caller-provided `providerIdempotencyToken` derived stably from `OutreachDelivery.id` without generating fresh random tokens on retry.
  - **Internal Provider Error Taxonomy:** `OutreachProviderErrorCode` (`PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_RATE_LIMITED`, `RECIPIENT_REJECTED`, `CONTENT_REJECTED`, `INVALID_PROVIDER_RESPONSE`, `CHANNEL_MISMATCH`, `INVALID_INPUT`, `DELIVERY_FAILED`).
  - **Deterministic Retryability:** `RETRYABLE_PROVIDER_ERROR_CODES` explicitly classifies `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, and `PROVIDER_RATE_LIMITED` as `retryable: true`; semantic rejections, channel mismatches, and input faults are `retryable: false`.
  - **Public Error Mapper:** `mapProviderErrorToPublicErrorCode` maps internal errors directly to canonical `OutreachErrorCode` enums (`CHANNEL_MISMATCH` $\rightarrow$ `OUTREACH_CHANNEL_INCOMPATIBLE`, `INVALID_INPUT` $\rightarrow$ `OUTREACH_DELIVERY_FAILED`, `CONTENT_REJECTED` $\rightarrow$ `OUTREACH_CONTENT_REJECTED`) without string parsing.
  - **Deterministic Mock Providers & Clock Injection:** `MockWhatsAppDeliveryProvider` and `MockEmailDeliveryProvider` support instant scenario rule matching and simulation (`TIMEOUT`, `UNAVAILABLE`, `RATE_LIMITED`, `RECIPIENT_REJECTED`, `CONTENT_REJECTED`, `INVALID_PROVIDER_RESPONSE`, `CHANNEL_MISMATCH`) with optional injectable deterministic `clock?: () => Date` (defaults to `() => new Date()`), without artificial sleeps or network calls.
  - **Provider Registry & Resolver:** `DefaultOutreachDeliveryProviderRegistry` and `getOutreachDeliveryProvider(channel)` provide channel-based provider lookup with defensive mismatch protection.
  - **Defensive Channel Mismatch Guard:** Both providers fail closed with non-retryable `CHANNEL_MISMATCH` (`OUTREACH_CHANNEL_INCOMPATIBLE`) when supplied with cross-channel payloads.
  - **Safety Boundaries:** Strict contact safety preserved (`PHONE != WHATSAPP`); zero network dependencies; zero provider secrets or environment credentials; zero database or queue coupling; zero state machine mutations.
- **Test Suite Results:**
  - Targeted provider tests (`packages/core/src/tests/outreach-delivery-provider.spec.ts`): **47 passed (47 total)** in 15ms.
  - Package regression (`packages/core/src/tests`): **264 passed (264 total)** across **6 test files**.

### M6 Step 4 — Outreach Service + Idempotent Request/Queue Creation + Suppression Guard (Completed)
- **Files Created:**
  - `packages/core/src/outreach/service-errors.ts`
  - `packages/core/src/outreach/hashing.ts`
  - `packages/core/src/outreach/queue.ts`
  - `packages/core/src/outreach/outreach-delivery-service.ts`
  - `packages/core/src/tests/outreach-delivery-service.spec.ts`
  - `packages/queues/package.json`
  - `packages/queues/tsconfig.json`
  - `packages/queues/src/config/redis.ts`
  - `packages/queues/src/index.ts`
  - `packages/queues/src/outreach-delivery/bullmq-outreach-delivery-queue.ts`
  - `packages/queues/src/tests/bullmq-outreach-delivery-queue.spec.ts`
  - `apps/worker/src/queues/outreach-delivery.queue.ts`
- **Files Modified:**
  - `packages/core/src/outreach/index.ts`
  - `apps/api/package.json`
  - `apps/worker/package.json`
  - `apps/worker/src/index.ts`
  - `package-lock.json`
  - `docs/progress.md`
  - `docs/decisions.md`
- **Architecture & Implementation Delivered:**
  - **Domain Service & Queue Decoupling:** Implemented `OutreachDeliveryService` in `@leadmate/core` accepting injectable `OutreachDeliveryQueue` interface, keeping `@leadmate/core` completely clean of BullMQ / ioredis dependencies. Extracted concrete BullMQ producer into `@leadmate/queues` (`BullMQOutreachDeliveryQueue`) so `apps/api` can instantiate the service without importing `apps/worker`.
  - **Role & Entity-Aware Authorization:** Enforces role-based permissions (`OUTREACH_SEND` for `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_EXECUTIVE`; denies `VIEWER` with HTTP 403 `FORBIDDEN`). For `SALES_EXECUTIVE`, enforces entity assignment boundary (`lead.assignedUserId === authenticatedUserId`), preventing unassigned lead dispatches.
  - **Tenant Isolation & Invariants:** Strictly scopes entity lookups by `organizationId`. Enforces that `draft.leadId === lead.id` and that the draft is in `APPROVED` status with `approvedAt` and `approvedByUserId` present (rejects unapproved drafts with 409 `OUTREACH_DRAFT_NOT_APPROVED`).
  - **Channel Compatibility Matrix:** Enforces compatibility (`WHATSAPP` draft $\rightarrow$ `WHATSAPP` channel only; `EMAIL` / `PROPOSAL` draft $\rightarrow$ `EMAIL` channel only; `FOLLOW_UP` draft $\rightarrow$ `WHATSAPP` or `EMAIL`; `CALL_SCRIPT` $\rightarrow$ non-dispatchable). Incompatible requests fail closed with 422 `OUTREACH_CHANNEL_INCOMPATIBLE`.
  - **Recipient Trust & Contact Provenance (PHONE != WHATSAPP):** For WhatsApp dispatches, requires explicit CRM contact with `ContactType.WHATSAPP` and verified/public provenance (`status === VERIFIED` or `whatsappStatus IN [PUBLICLY_LISTED, CONFIRMED]`). Prohibits auto-promoting plain `PHONE` numbers. For Email, normalizes destination to trimmed lowercase from `LeadContact` or `lead.primaryEmail`.
  - **Suppression Gate A vs Idempotency Ordering:** Strict 4-case ordering: (1) existing non-REQUESTED replay returns historical delivery immediately without re-evaluating Gate A; (2) existing REQUESTED recovery re-evaluates Gate A before retrying enqueue; (3) same key with different fingerprint throws 409 `OUTREACH_IDEMPOTENCY_KEY_REUSED`; (4) new delivery request validates Gate A before DB row creation. Gate B is deferred to Step 7 worker pre-send.
  - **Immutable Snapshot & Canonical Hashing:** `approvedDraftSnapshotHash` strictly hashes outbound transport content (`channel`, `subject`, `body`, `content`). `requestFingerprint` captures semantic request identity (`organizationId`, `leadId`, `draftId`, `channel`, `recipientContactId`, `recipientNormalized`).
  - **Idempotency & Concurrency Protection:** Scoped by `@@unique([organizationId, idempotencyKey])`. Handles concurrent insert races (`P2002`) safely.
  - **Conditional State Transition & Race Safety:** Transitions `REQUESTED -> QUEUED` conditionally via `updateMany({ where: { id, organizationId, status: 'REQUESTED' } })`. If 0 rows updated, reloads authoritative delivery and preserves newer state (`CANCELLED`, `PROCESSING`, `SENT`, `DELIVERED`, `FAILED`).
  - **Queue Payload Minimization:** BullMQ job payload is strictly `{ deliveryId: string }` with deterministic `jobId = deliveryId`, with zero PII, message bodies, or auth secrets.
- **Test Suite Results:**
  - Targeted service tests (`packages/core/src/tests/outreach-delivery-service.spec.ts`): **52 passed (52 total)**.
  - Queue adapter tests (`packages/queues/src/tests/bullmq-outreach-delivery-queue.spec.ts`): **3 passed (3 total)**.
  - Core package regression (`packages/core/src/tests`): **316 passed (316 total)** across **7 test files**.
  - Shared package regression (`packages/shared/src/tests`): **213 passed (213 total)** across **7 test files**.
  - Database package regression (`packages/db/src/tests`): **118 passed (118 total)** across **8 test files**.
  - Worker package tests (`apps/worker/src/tests`): **2 passed (2 total)** across **1 test file**.
  - Full repository test suite: **1,489 passed (1,489 total)** across **69 test files** (0 failures).

### M6 Step 7 — Worker Execution + Retry + Cancellation + Webhook Framework (Implemented / Ready for Review)
- **Files Created:**
  - `packages/core/src/outreach/worker-delivery-executor.ts`
  - `packages/core/src/outreach/webhook-event-processor.ts`
  - `packages/core/src/tests/worker-delivery-executor.spec.ts`
  - `packages/core/src/tests/webhook-event-processor.spec.ts`
  - `packages/core/src/tests/outreach-cancellation.spec.ts`
  - `packages/db/prisma/migrations/20261006120000_add_m6_step7_outreach_webhook_events/migration.sql`
  - `apps/worker/src/workers/outreach-delivery.worker.ts`
  - `apps/api/src/tests/outreach-cancellation-and-webhook.spec.ts`
- **Files Modified:**
  - `packages/db/prisma/schema.prisma`
  - `packages/core/src/outreach/index.ts`
  - `packages/core/src/outreach/queue.ts`
  - `packages/core/src/outreach/outreach-delivery-service.ts`
  - `packages/queues/src/outreach-delivery/bullmq-outreach-delivery-queue.ts`
  - `apps/worker/src/index.ts`
  - `apps/api/src/routes/lead.routes.ts`
  - `apps/api/src/controllers/outreach.controller.ts`
  - `apps/api/src/services/outreach.service.ts`
  - `apps/api/src/app.ts`
  - `docs/progress.md`
  - `docs/decisions.md`
- **Architecture & Implementation Delivered:**
  - **Worker Delivery Execution (`WorkerDeliveryExecutor`):** BullMQ worker consumes `{ deliveryId }` job and delegates execution to `WorkerDeliveryExecutor`. Reloads authoritative PostgreSQL record with tenant relations (`lead`, `draft`, `requestedByUser`), verifies cross-model tenant consistency (fails closed on discrepancy), checks non-dispatchable terminal states (`CANCELLED`, `SENT`, `DELIVERED`, `FAILED` -> no-op skip), handles `REQUESTED` race via `OutreachRequestedRaceError` (safe requeue), protects against duplicate physical processing when already in `PROCESSING` (reconciliation-required ambiguity, 0 resends), atomically claims `QUEUED -> PROCESSING`, validates Suppression Gate B immediately before provider dispatch, verifies immutable `approvedDraftSnapshotHash`, increments `attemptCount` once for actual physical send attempt outside DB transactions, and maps results to `SENT` (success) or `FAILED` (terminal/exhausted) or `QUEUED` (retryable with remaining attempts).
  - **Accepted-But-Persistence Ambiguity Safety:** Verified with deterministic failure-injection test: when provider send succeeds but subsequent DB update to `SENT` fails, record remains `PROCESSING`; subsequent executions see pre-existing `PROCESSING`, make ZERO physical resends (total `provider.send` call count === 1), do not mark `DELIVERED` or `SENT` or `FAILED`, leaving state safe for reconciliation.
  - **Retry & Backoff Framework:** Frozen retry policy: `maxAttempts = 3`, BullMQ `attempts = 3`, `backoff.type = 'exponential'`, `backoff.delay = 2000` ms. Retryable provider errors within budget transition status back to `QUEUED`, record public sanitized error code and message, and rethrow the provider error to trigger BullMQ exponential backoff. Non-retryable errors or exhausted budgets transition status to `FAILED`, record safe error diagnostics and audit log, and complete without worker retry.
  - **Atomic Cancellation (`cancelDelivery`):** Guarded by `OUTREACH_MANAGE` permission. Scoped strictly by `organizationId` and `leadId`. Transitions `[REQUESTED, QUEUED] -> CANCELLED` with `cancelledAt` timestamp. Fails closed with 409 `OUTREACH_DELIVERY_IN_FLIGHT` if delivery is in `PROCESSING`, `SENT`, `DELIVERED`, or `FAILED`. Idempotent for already-cancelled deliveries. Best-effort queue cleanup via `queue.removeJob(deliveryId)`: queue failure leaves database `CANCELLED` state intact without rollback and returns successful cancellation summary. Authoritative `lead.outreach_cancelled` audit log recorded.
  - **Normalized Webhook Framework (`OutreachWebhookEventProcessor`):** Strictly provider-neutral internal domain processor. Generic public webhook HTTP route and universal HMAC schemes are omitted from Step 7 (deferred to Step 9 provider-specific verified adapters). Input contains only normalized trusted event fields. Idempotent replay deduplication via `[providerName, eventId]`. Correlates delivery strictly via `(providerName, providerMessageId)`. Enforces forward-only transitions (`SENT -> DELIVERED`, `SENT -> FAILED`) with timestamp capture and safe error recording. Prevents state regression from terminal `DELIVERED`, `FAILED`, or `CANCELLED`.
  - **Zero Step 6 Modification Invariant:** Frontend workspace (`apps/web`) remains 100% untouched and closed at commit `76343f93895ee03762b08547c9bdc30a334471d9`.
- **Test Suite Verification:**
  - Targeted Step 7 unit & integration tests: **35 passed (35 total)** across 4 test suites (`worker-delivery-executor.spec.ts`, `webhook-event-processor.spec.ts`, `outreach-cancellation.spec.ts`, `outreach-cancellation-and-webhook.spec.ts`).
  - Full repository test suite: **1,602 passed (1,602 total)** across **77 test files** (0 failures).
  - TypeScript typecheck: clean across all 11 monorepo workspaces.

### M6 Step 8 — E2E + Security + Race/Replay/Idempotency Hardening (Implemented / Awaiting Review)
- **Files Created:**
  - `apps/api/src/tests/outreach-step8-security.spec.ts` (13 comprehensive E2E integration & security hardening tests)
  - `packages/core/src/tests/outreach-step8-race-hardening.spec.ts` (17 domain race, replay, and concurrency hardening tests)
  - `apps/worker/src/tests/outreach-step8-worker.spec.ts` (5 worker adapter integrity & fault injection tests)
- **Files Modified:**
  - `packages/core/src/outreach/webhook-event-processor.ts` (hardened atomic conditional updateMany on terminal DELIVERED and FAILED transitions)
  - `docs/progress.md`
- **Scope & Hardening Validated:**
  - **Full E2E Delivery Harness (WhatsApp & Email):** Validated complete flow: approved draft -> POST delivery request with `Idempotency-Key` -> `REQUESTED` -> `QUEUED` -> worker atomic claim -> `PROCESSING` -> mock provider dispatch -> `SENT` with `providerMessageId` -> normalized webhook event -> `DELIVERED` -> authoritative audit trail. Validated explicit email contact and `primaryEmail` fallback on 0-contact leads.
  - **Idempotency Lifecycle & Concurrency (P2002 Race):** Sequential identical requests return the same logical delivery without queue or audit duplication. Concurrent identical requests resolve safely via P2002 race recovery to a single DB row and single physical send. Same-key/different-payload returns HTTP 409 `OUTREACH_IDEMPOTENCY_KEY_REUSED`. Idempotency keys are strictly tenant-isolated (`@@unique([organizationId, idempotencyKey])`).
  - **Queue Downtime Recovery & Worker Races:** Enqueue failure leaves delivery in `REQUESTED` with safe 500 `OUTREACH_DELIVERY_FAILED`; replay after queue recovery reuses record and enqueues safely. `REQUESTED` worker race delays job via BullMQ `moveToDelayed` with `DelayedError` without consuming retry budget, executing cleanly once `QUEUED`. Duplicate worker runs resolve via atomic `QUEUED -> PROCESSING` claim where losing runs safe no-op (`provider.send` = 1).
  - **Ambiguity & Failure Retries:** Pre-existing `PROCESSING` with known `providerMessageId` never physically resends (at-most-once safety). Retryable errors (`PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_RATE_LIMITED`) transition back to `QUEUED` within retry budget (3 attempts) and throw to BullMQ backoff; exhausting 3 attempts marks terminal `FAILED`. Non-retryable errors (`RECIPIENT_REJECTED`, `CONTENT_REJECTED`, `INVALID_PROVIDER_RESPONSE`) fail immediately on first attempt. Transient error codes are cleared on eventual success.
  - **Suppression Defense:** Gate A blocks at API boundary with HTTP 422 `OUTREACH_RECIPIENT_SUPPRESSED` (0 rows, 0 jobs). Gate B blocks at worker pre-send if suppressed while queued (0 provider calls, attemptCount unchanged). Expired entries permit dispatch.
  - **Contact Provenance & Immutability:** Enforces absolute invariant `PHONE != WHATSAPP` (rejects plain phone with 422 `OUTREACH_RECIPIENT_INVALID`). Rejects untrusted WhatsApp contacts missing `VERIFIED`, `PUBLICLY_LISTED`, or `CONFIRMED`. Destination and draft changes in CRM do not mutate persisted delivery snapshot. Snapshot SHA-256 hash tampering fails closed (`OUTREACH_CONTENT_REJECTED`, 0 provider calls).
  - **Cancellation Races:** Cancel before claim transitions to `CANCELLED`; stale worker execution safely no-ops. Claim before cancel fails closed with 409 `OUTREACH_DELIVERY_IN_FLIGHT` without rolling back `PROCESSING`. Concurrent cancellations resolve to a single transition and audit entry. Redis `removeJob` error leaves database `CANCELLED` state intact.
  - **Webhook Safety, Replay & Out-of-Order Hardening:**
    - Replays of `(providerName, eventId)` are deduplicated when already `PROCESSED` without re-auditing or altering state.
    - Ambiguous correlation `(providerName, providerMessageId)` with >1 matching deliveries fails closed without mutating ANY delivery or selecting an arbitrary tenant, storing event safely as `UNMATCHED` with `organizationId = null` and safe error message "Ambiguous provider message correlation". Step 9 remains responsible for defining live provider/account correlation scoping.
    - Out-of-order terminal webhook events arriving while delivery is in a pre-terminal state (`REQUESTED`, `QUEUED`, `PROCESSING`) are deferred as `UNRESOLVED` (`processedAt: null`) rather than finalized, preserving delivery state without illegal transition (`PROCESSING -> DELIVERED` prohibited). Replay of the same event after delivery reaches `SENT` authoritatively reconciles `SENT -> DELIVERED` or `SENT -> FAILED` with exactly one audit log, finalizing the event as `PROCESSED`. Subsequent replays are duplicate no-ops.
    - Concurrent `DELIVERED` vs `FAILED` races for the same `SENT` delivery yield exactly one winning terminal transition via atomic `updateMany` with zero state oscillation.
    - Terminal delivery states (`DELIVERED`, `FAILED`, `CANCELLED`) remain strictly forward-only and immutable. Late events never reopen or alter terminal state.
    - Unknown message IDs are persisted safely as `UNMATCHED` with null org and zero delivery mutations. Normalized events contain zero raw bodies, headers, signatures, or credentials.
  - **Security Boundaries, RBAC & IDOR:** Delivery summaries strictly exclude internal fields (`recipientNormalized`, `requestFingerprint`, `idempotencyKey`, snapshot hashes/content, secrets). Canonical error envelope `{ error: { code, message, details, requestId } }` without stack traces or SQL. Cross-tenant reads and cancellations return 404 (never 403 revealing existence). Cross-lead access returns 404. Sales Executives restricted to assigned leads. Cancellations restricted to `OUTREACH_MANAGE` (`SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`). Unauthenticated requests return 401 requiring `leadmate_session` cookie. Strict body schema rejects injected properties; header validates 8-128 chars.
  - **Worker Fault Injection:** Malformed job payload or non-UUID deliveryId fails safely. Unknown deliveryId marks skipped failure without leakage. Cross-tenant relational corruption (mismatched lead, draft, or user org) fails closed with zero provider calls.
  - **Invariant Verification:** `attemptCount` strictly equals actual `provider.send` invocations across all success, retry, exhaustion, and suppression paths. Timestamps are mutually exclusive and consistent (`failedAt` only on `FAILED`, `sentAt` only on `SENT+`, `deliveredAt` only on `DELIVERED`, `cancelledAt` only on `CANCELLED`).
  - **Zero Frontend Changes:** `apps/web` remains 100% untouched. No live external network or providers configured.

### M6 Step 9 — Live Provider Adapter Integration (Meta WhatsApp Cloud API Pilot & Webhook Adapter) (Implemented / Awaiting Review)
- **Files Created:**
  - `packages/core/src/outreach/meta-whatsapp-provider.ts` (Meta WhatsApp Cloud API outbound delivery provider implementing `OutreachDeliveryProvider`)
  - `packages/core/src/outreach/meta-whatsapp-normalizer.ts` (Meta webhook payload validator and normalizer emitting `NormalizedOutreachWebhookEvent[]`)
  - `packages/core/src/tests/meta-whatsapp-provider.spec.ts` (15 unit & fault injection tests for Meta outbound provider)
  - `packages/core/src/tests/meta-whatsapp-normalizer.spec.ts` (5 normalization & security tests for Meta webhook events)
  - `apps/api/src/middleware/meta-webhook-auth.ts` (Cryptographic HMAC SHA-256 signature verification over raw request body buffer)
  - `apps/api/src/routes/meta-webhook.routes.ts` (Dedicated Meta webhook challenge and event ingestion endpoints)
  - `apps/api/src/tests/meta-whatsapp-webhook.spec.ts` (9 end-to-end webhook verification & correlation tests)
  - `apps/worker/src/config/env.ts` (Worker fail-closed configuration schema for live Meta provider mode)
- **Files Modified:**
  - `packages/core/src/outreach/registry.ts` (Registered `META_WHATSAPP` and options in provider registry)
  - `packages/core/src/outreach/index.ts` (Exported Meta provider and normalizer)
  - `packages/core/src/tests/outreach-delivery-provider.spec.ts` (Updated provider contract tests verifying mock/live parity)
  - `apps/api/src/config/env.ts` (Added `OUTREACH_WHATSAPP_PROVIDER` and `META_WHATSAPP_*` fail-closed configuration)
  - `apps/api/src/app.ts` (Added raw body capture and mounted `/api/v1/webhooks/meta/whatsapp` router)
  - `apps/worker/src/workers/outreach-delivery.worker.ts` (Integrated worker provider registry with live/mock switching)
  - `.env.example` (Documented Meta WhatsApp environment variables)
  - `docs/progress.md`
  - `docs/decisions.md`
- **Scope & Hardening Validated:**
  - **Meta WhatsApp Cloud API Outbound Adapter (`MetaWhatsAppDeliveryProvider`):** Implements `OutreachDeliveryProvider` for `WHATSAPP` channel. Formats outbound requests to Graph API `/{phoneNumberId}/messages`. Injects custom `fetch` enabling 100% deterministic offline unit testing. Enforces strict input validation, recipient normalization, and authorization headers (`Bearer ${accessToken}`).
  - **Error Classification & Sanitization:** Maps HTTP/Graph errors deterministically:
    - HTTP 429 & Graph rate limits $\rightarrow$ `PROVIDER_RATE_LIMITED` (retryable)
    - HTTP 5xx & network/fetch failures $\rightarrow$ `PROVIDER_UNAVAILABLE` (retryable)
    - Abort / timeout $\rightarrow$ `PROVIDER_TIMEOUT` (retryable)
    - Graph error 131026/131051 $\rightarrow$ `RECIPIENT_REJECTED` (non-retryable terminal)
    - Graph error 131047/131048 $\rightarrow$ `CONTENT_REJECTED` (non-retryable terminal)
    - HTTP 401/403/Graph 190 (bad auth/token) $\rightarrow$ `DELIVERY_FAILED` (non-retryable terminal)
    - Malformed response / HTTP 200 without message ID $\rightarrow$ `INVALID_PROVIDER_RESPONSE` (non-retryable terminal)
    - Raw tokens and sensitive credentials are sanitized; never leaked in errors, logs, or exceptions.
  - **Meta Webhook Normalizer (`MetaWhatsAppWebhookNormalizer`):** Strictly parses verified Meta webhook payloads. Filters for `messages` field and status updates (`delivered`, `failed`). Safely ignores intermediate statuses (`sent`, `read`) and inbound messages. Constructs deterministic `eventId` (`meta-wa:${messageId}:${status}:${timestamp}`). Sets `organizationId = null` to prevent incoming tenant spoofing, relying on Step 8 correlation engine.
  - **Cryptographic Webhook Signature Verification (`verifyMetaSignatureHeader`):** Captures exact raw body buffer via `express.json({ verify })`. Verifies `x-hub-signature-256` using constant-time `crypto.timingSafeEqual`. Rejects missing or invalid signatures with HTTP 401 Unauthorized before JSON parsing or domain execution.
  - **Meta Webhook Endpoints:**
    - `GET /api/v1/webhooks/meta/whatsapp`: Handles Meta webhook challenge verification (`hub.mode === 'subscribe'`, `hub.verify_token`), returning `hub.challenge` as plain text (200 OK) or 403 Forbidden.
    - `POST /api/v1/webhooks/meta/whatsapp`: Cryptographically verifies signature, normalizes payload, processes events via `OutreachWebhookEventProcessor`, and returns HTTP 200 `{ status: 'EVENT_RECEIVED' }`.
  - **Worker Environment & Registry:** `apps/worker` validates environment configuration fail-closed when `OUTREACH_WHATSAPP_PROVIDER=meta` and provides `createWorkerProviderRegistry()` configuring `MetaWhatsAppDeliveryProvider` for production delivery.
  - **Blocked-On-Human Live Email Vendor Status:** Email delivery remains on `MockEmailDeliveryProvider`. Live email provider is strictly reported as `BLOCKED-ON-HUMAN: Live email vendor selection` without inventing speculative vendors.
  - **Safety Invariants Preserved:** Absolute contact safety `PHONE != WHATSAPP` intact. Two-gate suppression defense intact. Zero credential exposure. Zero frontend modifications (`apps/web` untouched).

### M6 Step 9B — Resend Live Email Provider Integration (Implemented / Awaiting Review)
- **Files Created:**
  - `packages/core/src/outreach/resend-email-provider.ts` (Resend Email outbound delivery provider implementing `OutreachDeliveryProvider`)
  - `packages/core/src/outreach/resend-email-normalizer.ts` (Resend webhook payload validator and normalizer emitting `NormalizedOutreachWebhookEvent[]`)
  - `packages/core/src/tests/resend-email-provider.spec.ts` (Unit & fault injection tests for Resend outbound provider)
  - `packages/core/src/tests/resend-email-normalizer.spec.ts` (Normalization & security tests for Resend webhook events)
  - `apps/api/src/middleware/resend-webhook-auth.ts` (Cryptographic Svix HMAC SHA-256 signature verification over raw request body buffer)
  - `apps/api/src/routes/resend-webhook.routes.ts` (Dedicated Resend webhook delivery receipt ingestion endpoint)
  - `apps/api/src/tests/resend-email-webhook.spec.ts` (End-to-end webhook verification & correlation tests)
- **Files Modified:**
  - `packages/core/src/outreach/registry.ts` (Registered `RESEND_EMAIL` and options in provider registry)
  - `packages/core/src/outreach/index.ts` (Exported Resend provider and normalizer)
  - `packages/core/src/tests/outreach-delivery-provider.spec.ts` (Updated provider contract tests verifying mock/live parity)
  - `apps/api/src/config/env.ts` (Added `OUTREACH_EMAIL_PROVIDER` and `RESEND_*` fail-closed configuration)
  - `apps/api/src/app.ts` (Mounted `/api/v1/webhooks/resend/email` before application JSON parser)
  - `apps/worker/src/config/env.ts` (Worker fail-closed configuration schema for live Resend provider mode)
  - `apps/worker/src/workers/outreach-delivery.worker.ts` (Integrated worker provider registry with Resend live/mock switching)
  - `.env.example` (Documented Resend email environment variables)
  - `docs/progress.md`
  - `docs/decisions.md`
- **Scope & Hardening Validated:**
  - **Resend Outbound Delivery Adapter (`ResendEmailDeliveryProvider`):** Implements `OutreachDeliveryProvider` for `EMAIL` channel. Dispatches approved snapshots (`subject`, `text: snapshotBody` without invented HTML markup) to Resend `POST /emails`. Supports native provider deduplication via `Idempotency-Key: ${providerIdempotencyToken}` header. Provider idempotency retention is bounded (~24 hours) with strict same-payload semantics (never claiming universal or indefinite exactly-once); 36-char delivery UUID fits comfortably within provider limits. Injects custom `fetchFn` for 100% deterministic offline unit testing. Enforces strict input validation, recipient email structure, and `Authorization: Bearer ${apiKey}` headers.
  - **Error Classification & Sanitization:** Maps HTTP/Resend errors deterministically:
    - HTTP 409 `concurrent_idempotent_requests` $\rightarrow$ `PROVIDER_RATE_LIMITED` (retryable)
    - HTTP 409 `invalid_idempotent_request` $\rightarrow$ `DELIVERY_FAILED` (non-retryable terminal)
    - HTTP 429 & rate limit errors $\rightarrow$ `PROVIDER_RATE_LIMITED` (retryable)
    - HTTP 5xx & network/fetch failures $\rightarrow$ `PROVIDER_UNAVAILABLE` (retryable)
    - Abort / timeout $\rightarrow$ `PROVIDER_TIMEOUT` (retryable)
    - HTTP 422 with recipient bounce/unroutable indicators $\rightarrow$ `RECIPIENT_REJECTED` (non-retryable terminal)
    - HTTP 422 with content/policy/spam indicators $\rightarrow$ `CONTENT_REJECTED` (non-retryable terminal)
    - HTTP 422/403 with unverified sender domain $\rightarrow$ `DELIVERY_FAILED` (non-retryable terminal)
    - HTTP 401/403 (bad auth/key) $\rightarrow$ `DELIVERY_FAILED` (non-retryable terminal)
    - Malformed response / HTTP 200 without email ID $\rightarrow$ `INVALID_PROVIDER_RESPONSE` (non-retryable terminal)
    - Zero API key or secret leakage in logs, errors, or exceptions.
  - **Resend Webhook Normalizer (`normalizeResendEmailWebhookPayload`):** Strictly parses verified Resend webhook payloads. Maps terminal delivery events:
    - `email.delivered` $\rightarrow$ `DELIVERED`
    - `email.bounced` $\rightarrow$ `FAILED` with `OUTREACH_RECIPIENT_REJECTED`
    - `email.failed` $\rightarrow$ `FAILED` with `OUTREACH_DELIVERY_FAILED`
    - `email.suppressed` $\rightarrow$ `FAILED` with `OUTREACH_RECIPIENT_REJECTED`
    Safely ignores non-terminal / analytics events (`email.sent`, `email.delivery_delayed`, `email.opened`, `email.clicked`, `email.complained`). Extracts authoritative `providerMessageId` (`data.email_id || data.id`) for all terminal events. Constructs deterministic `eventId` (`resend:${event.id}` or `resend:${emailId}:${type}:${timestamp}`). Sets `organizationId = null` to prevent incoming tenant spoofing, relying on Step 8 correlation engine.
  - **Svix Webhook Signature Verification (`verifyResendWebhookSignature`):** Verifies Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`) using constant-time `crypto.timingSafeEqual` over `${svixId}.${svixTimestamp}.${rawBody}` buffer and base64-decoded `whsec_` secret. Rejects missing/invalid signatures or expired timestamps (> 300s) with HTTP 401 Unauthorized before JSON parsing.
  - **Resend Webhook Endpoint (`POST /api/v1/webhooks/resend/email`):** Dedicated route with 256kb raw body parsing, Svix signature verification, safe 400 error handling on malformed JSON, and event dispatch through `OutreachWebhookEventProcessor`. Requires `RESEND_WEBHOOK_SECRET` fail-closed in API environment schema when `NODE_ENV=production` and `OUTREACH_EMAIL_PROVIDER=resend`, while keeping worker schema free of unneeded webhook secrets.
  - **Worker Environment & Registry:** `apps/worker` validates environment configuration fail-closed when `OUTREACH_EMAIL_PROVIDER=resend` and provides `createWorkerProviderRegistry()` configuring `ResendEmailDeliveryProvider` for production delivery.
  - **No Live Sending:** 100% offline mock tests; zero real emails dispatched.

### M6 Step 10 — Milestone Review & Closure (Implemented / Awaiting Review)
- **Status:** IMPLEMENTED / AWAITING REVIEW
- **Milestone Scope Closed:** Automated Outreach & Delivery (Steps 0–10).
- **Final Provider Production Matrix:**
  - **WhatsApp:**
    - Mock: `MockWhatsAppDeliveryProvider` (development & offline testing)
    - Live: `MetaWhatsAppDeliveryProvider` (`META_WHATSAPP`) via Meta WhatsApp Cloud API (`POST /{phoneNumberId}/messages`)
    - Configuration: `OUTREACH_WHATSAPP_PROVIDER=mock|meta` (explicit fail-closed validation in production)
  - **Email:**
    - Mock: `MockEmailDeliveryProvider` (development & offline testing)
    - Live: `ResendEmailDeliveryProvider` (`RESEND_EMAIL`) via Resend Transactional Email API (`POST /emails`)
    - Configuration: `OUTREACH_EMAIL_PROVIDER=mock|resend` (explicit fail-closed validation in production)
- **Hardened Invariants Preserved:**
  - **Human-in-the-Loop Isolation:** Draft approval (`DRAFT -> APPROVED`) never auto-transmits; dedicated human dispatch action required (`POST /leads/:id/outreach/deliveries`).
  - **Contact Provenance & PHONE != WHATSAPP:** WhatsApp strictly requires verified CRM contact (`status === VERIFIED` or `whatsappStatus IN [PUBLICLY_LISTED, CONFIRMED]`); plain phone numbers never auto-promoted.
  - **Email Destination & Recipient Rules:** EMAIL delivery resolves destination either from (A) an existing `ContactType.EMAIL` contact (via explicit `recipientContactId` or single existing email contact; multiple email contacts require explicit `recipientContactId`), or (B) `lead.primaryEmail` fallback ONLY when zero `ContactType.EMAIL` contacts exist on the lead (`primaryEmail` is ignored when email contact rows exist). EMAIL does NOT require `ContactStatus.VERIFIED` (WhatsApp provenance rules do not apply to EMAIL). Raw client-supplied email strings remain strictly prohibited. Outbound payload sends exact immutable approved snapshot (`subject`, `text: snapshotBody` without invented HTML markup).
  - **Exact Delivery State Machine Transitions:**
    - `REQUESTED -> QUEUED | CANCELLED`
    - `QUEUED -> PROCESSING | CANCELLED`
    - `PROCESSING -> SENT | QUEUED` (retryable failure within 3 attempts) `| FAILED` (non-retryable failure or attempts exhausted)
    - `SENT -> DELIVERED | FAILED`
    - Terminal states: `DELIVERED`, `FAILED`, `CANCELLED` (strictly forward-only; terminal states never reopen).
    - Cancellation is permitted strictly from `REQUESTED` or `QUEUED` under `OUTREACH_MANAGE`; in-flight `PROCESSING` cancellation returns HTTP 409 `OUTREACH_DELIVERY_IN_FLIGHT`; cancelled stale queue jobs safely no-op.
  - **Two-Gate Suppression Defense:** Evaluated at API request time (Gate A) and worker pre-flight (Gate B).
  - **Strict Idempotency:** API unique `[organizationId, idempotencyKey]` returns 200 on identical replay, 409 on parameter divergence; Resend forwards `providerIdempotencyToken` (bounded ~24h retention, 409 concurrent mapped to retryable `PROVIDER_RATE_LIMITED`, 409 invalid mapped to terminal `DELIVERY_FAILED`).
  - **Queue Authority & Attempt Budget:** BullMQ job payload is strictly `{ deliveryId: string }`; worker loads PostgreSQL state authoritatively; `attemptCount` strictly equals actual `provider.send` calls (max 3 attempts).
  - **Webhook Defense-in-Depth:** Route-scoped raw buffer parsing (256kb limit) before JSON parsing; Meta HMAC-SHA256 and Resend Svix signature verification; `organizationId = null` rejects tenant spoofing; terminal events mapped strictly to `DELIVERED`/`FAILED`; non-terminal analytics events ignored; out-of-order events recorded as `UNRESOLVED` without illegal status regressions, reconciled upon replay after `SENT`; ambiguous correlation fails closed (`UNMATCHED`).
  - **Branding & Identifiers:** LeadAtlas public branding preserved (`/brand/leadatlas-logo.jpg`); internal `@leadmate/*`, database models, and API paths preserved without churn.
- **M6 Deferred Technical Debt & Operational Items:**
  1. *Meta Cloud API Timeout Ambiguity:* Meta does not provide native arbitrary-message idempotency keys on Graph API; timeout recovery relies on at-most-once safety with operator reconciliation when message state is ambiguous.
  2. *Meta Provider Correlation Scoping:* Multi-WABA / multi-account setup will require correlation queries to include `accountId` / `phoneNumberId` alongside `providerMessageId`.
  3. *Resend Idempotency Retention Window:* Bounded provider retention (~24 hours); replays after 24 hours require internal deduplication defense.
  4. *Webhook Event Table Retention & Archival:* `OutreachWebhookEvent` table growth requires future periodic cleanup or partitioning cron.
  5. *Distributed Rate Limiting:* Worker rate limiting relies on provider 429 backoff; future high-volume pipelines should consider Redis token bucket rate limiters per channel/tenant.
  6. *Bulk Campaign Orchestration:* Intentionally excluded from M6 single-lead architecture; deferred to future campaign milestone.
  7. *Live Provider Monitoring & Credential Rotation:* Production runbooks for credential rotation and delivery latency alerts.
  8. *StoreMate Live Transport:* Remains strictly deferred behind `StoreMateUnavailableError` (503) pending human contractual signoff.
- **Verification Baseline:**
  - Targeted M6 Test Matrix: **20 test files passed (20 total), 408 tests passed (408 total)**.
  - Full Repository Test Suite: **87 test files passed (87 total), 1,756 tests passed (1,756 total)**, 0 failures.
  - Workspace Typecheck: **0 errors** across all 10 workspaces.
  - Next.js Web Build: **Successful production compilation** (all 8 routes generated).
  - Prisma Schema Validation: **Valid**.
  - npm ci dry-run: **Clean**.
  - Zero live credentials, zero live external API sends.

### M5 Step 1 — Contracts + Guardrails (Completed)
- **Files:** `packages/shared/src/enums.ts`, `packages/shared/src/schemas/sales-assistant.ts`, `packages/shared/src/tests/sales-assistant-schemas.spec.ts`, `packages/shared/src/index.ts`.
- **Enums:** `SalesAssistantDraftType` (`WHATSAPP`, `EMAIL`, `CALL_SCRIPT`, `PROPOSAL`, `FOLLOW_UP`), `SalesAssistantLanguage` (`BANGLA`, `ENGLISH`, `MIXED`), `SalesAssistantTone` (`PROFESSIONAL`, `FRIENDLY`, `CONCISE`, `PERSUASIVE`), `SalesAssistantDraftStatus` (`DRAFT`, `APPROVED`, `REJECTED` — no `SENT`; sending belongs to M6), `SalesAssistantWarning` (5 codes).
- **Request:** `generateSalesAssistantDraftRequestSchema` is `.strict()`.
- **Output:** `generatedSalesAssistantDraftSchema` is a provider-neutral discriminated union with strict objects.
- **Safety Invariants:** AI drafts only; mandatory human approval; verified facts only; no fake urgency; contact safety (`PHONE != WHATSAPP`); data minimization.

### M5 Step 2 — Sales Assistant Draft Persistence + Migration (Completed)
- **Schema & Model:** `SalesAssistantDraft` in `packages/db/prisma/schema.prisma` with mapped table `sales_assistant_drafts`.
- **Enums in Prisma:** `SalesAssistantDraftType`, `SalesAssistantLanguage`, `SalesAssistantTone`, `SalesAssistantDraftStatus` (strictly `DRAFT`, `APPROVED`, `REJECTED` — no `SENT` status), `SalesAssistantWarning`.
- **Tenant Isolation & Composite FKs:**
  - `(organization_id)` $\rightarrow$ `organizations(id)` ON DELETE CASCADE
  - `(lead_id, organization_id)` $\rightarrow$ `leads(id, organization_id)` ON DELETE CASCADE
  - `(created_by_user_id, organization_id)` $\rightarrow$ `users(id, organization_id)` ON DELETE RESTRICT
  - `(approved_by_user_id, organization_id)` $\rightarrow$ `users(id, organization_id)` ON DELETE RESTRICT
  - `(rejected_by_user_id, organization_id)` $\rightarrow$ `users(id, organization_id)` ON DELETE RESTRICT
- **Multi-Draft Support:** Leads can have multiple sales drafts (no unique constraint on `leadId`).
- **Human Approval & Rejection Attribution:** Dedicated attribution timestamps and nullable composite FK user relations: `approvedAt`, `approvedByUserId`, `rejectedAt`, `rejectedByUserId`.
- **Content Storage:** Flexible nullable content fields (`content`, `emailSubject`, `emailBody`) supporting email and non-email formats without brittle engine check constraints.
- **Warnings Storage:** Native PostgreSQL enum array `"SalesAssistantWarning"[]` with `@default([])`.
- **Data Minimization & Deferred Provider Metadata:** Zero raw provider request/response payloads, system prompts, chain-of-thought, reasoning, API tokens, model names, token counts, or costs stored in DB. Provider metadata is deferred to Step 3.
- **Indexes:** `[organizationId, leadId, createdAt]`, `[organizationId, status, createdAt]`, `[organizationId, createdByUserId, createdAt]`, `[organizationId, type, createdAt]`, composite unique `[id, organizationId]`.
- **Migration:** `packages/db/prisma/migrations/20261003103439_add_m5_sales_assistant_drafts/migration.sql` containing strictly M5 objects (5 `CREATE TYPE`, 1 `CREATE TABLE`, 5 indexes, 5 FKs; 0 unrelated statements). Applied cleanly to dev and test databases.
- **Test Suite:** `packages/db/src/tests/sales-assistant-draft-persistence.spec.ts` (35 tests covering enum parity, defaults, CRUD, multi-drafts, warnings array default, cross-tenant FK rejections, cascade and restrict behaviors).

### M5 Step 3 — AI Provider Abstraction + Mock Provider (Completed)
- **Files:** `packages/ai/src/sales-assistant/*`, `packages/ai/src/tests/sales-assistant-provider.spec.ts`.
- **Interface & Normalization:** `SalesAssistantProviderClient` interface; normalized inputs (`NormalizedSalesAssistantInput`, `NormalizedLeadContext`, `NormalizedBusinessContext`) preventing model or credentials leaks; provider output validated via `generatedSalesAssistantDraftSchema`.
- **Mock Provider & Factory:** `MockSalesAssistantProvider` with testable failure injection and warning generation; `getSalesAssistantProvider` factory.
- **Test Suite:** `packages/ai/src/tests/sales-assistant-provider.spec.ts` (29 tests passing).

### M5 Step 4 — Sales Assistant API Endpoints, RBAC & Audit Logging (Implemented / Awaiting Review)
- **Files Created:**
  - `apps/api/src/services/sales-assistant.service.ts`
  - `apps/api/src/controllers/sales-assistant.controller.ts`
  - `apps/api/src/tests/sales-assistant-api.spec.ts`
  - `apps/api/src/tests/sales-assistant-service.spec.ts`
- **Files Modified:**
  - `packages/shared/src/permissions.ts` (added `SALES_ASSISTANT_GENERATE` and `SALES_ASSISTANT_REVIEW`)
  - `packages/shared/src/schemas/sales-assistant.ts` (added `salesAssistantDraftSummarySchema` and list response DTO)
  - `apps/api/package.json` & `package-lock.json` (added `@leadmate/ai` workspace dependency)
  - `apps/api/src/middleware/rate-limiter.ts` (added `salesAssistantRateLimiter`: 30 req/60s per user)
  - `apps/api/src/middleware/error-handler.ts` (added `SalesAssistantProviderError` handler with status mappings)
  - `apps/api/src/routes/lead.routes.ts` (mounted drafts endpoints)
  - `docs/progress.md`
  - `docs/decisions.md`
- **Service Orchestration:**
  - `SalesAssistantService` encapsulates tenant-safe lead lookup (`leadId + organizationId`), safe lead context projection, provider invocation, output contract validation, atomic database persistence, and review transitions (`approveDraft`, `rejectDraft`).
  - Provider calls execute strictly OUTSIDE database transaction to prevent connection starvation during AI calls.
  - Persistence and audit writing execute inside a short atomic Prisma `$transaction`.
- **Contact Safety (`PHONE != WHATSAPP`):**
  - Context projection populates `leadContext.whatsapp` only from explicit verified or publicly confirmed WhatsApp contacts.
  - Raw phone numbers are NEVER promoted to WhatsApp. When WhatsApp contact evidence is missing, `whatsapp` is `undefined` and the provider emits `UNVERIFIED_WHATSAPP`.
- **Storage & Invariants:**
  - `EMAIL` drafts persist `emailSubject` and `emailBody` with `content: null`.
  - Non-email drafts (`WHATSAPP`, `CALL_SCRIPT`, `PROPOSAL`, `FOLLOW_UP`) persist `content` with `emailSubject: null` and `emailBody: null`.
  - Generated draft status is always `DRAFT`.
  - Provider failures or schema validation errors never persist draft rows.
- **Review Lifecycle & Concurrency Guard:**
  - `approveDraft`: transitions `DRAFT -> APPROVED`, sets `approvedAt` and `approvedByUserId`, leaves rejection fields null.
  - `rejectDraft`: transitions `DRAFT -> REJECTED`, sets `rejectedAt` and `rejectedByUserId`, leaves approval fields null.
  - Terminal review states: once `APPROVED` or `REJECTED`, drafts cannot be re-approved, re-rejected, or reverted to draft; returns 409 Conflict.
  - Concurrency protection: review mutations perform conditional `updateMany({ where: { id, leadId, organizationId, status: 'DRAFT' } })`, preventing simultaneous reviewer race conditions.
- **API Endpoints:**
  - `POST /api/v1/leads/:id/sales-assistant/drafts` (201 Created) — rate-limited, requires `SALES_ASSISTANT_GENERATE`
  - `GET /api/v1/leads/:id/sales-assistant/drafts` (200 OK) — requires `LEADS_READ`, paginated, sorted `createdAt DESC, id DESC`
  - `GET /api/v1/leads/:id/sales-assistant/drafts/:draftId` (200 OK) — requires `LEADS_READ`, tenant & lead-scoped
  - `POST /api/v1/leads/:id/sales-assistant/drafts/:draftId/approve` (200 OK) — requires `SALES_ASSISTANT_REVIEW`
  - `POST /api/v1/leads/:id/sales-assistant/drafts/:draftId/reject` (200 OK) — requires `SALES_ASSISTANT_REVIEW`
- **RBAC Matrix:**
  - `SALES_ASSISTANT_GENERATE`: `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_EXECUTIVE`. `VIEWER` is denied (403).
  - `SALES_ASSISTANT_REVIEW`: `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`. `SALES_EXECUTIVE` and `VIEWER` are denied (403).
  - Draft reading: reuses `LEADS_READ`, allowing `VIEWER` to inspect draft history without generation or review privileges.
- **Audit Logging & Data Minimization:**
  - Emits `lead.sales_assistant_draft_generated`, `lead.sales_assistant_draft_approved`, `lead.sales_assistant_draft_rejected`.
  - Audit metadata is strictly minimized: contains IDs, types, languages, tones, and warning counts/codes; zero full text content, custom instructions, prompts, or provider internal data stored in audit logs.
- **Safe Error Mapping:**
  - Maps `PROVIDER_TIMEOUT` (504), `PROVIDER_UNAVAILABLE` (503), `PROVIDER_RATE_LIMITED` (429), `INVALID_PROVIDER_RESPONSE` (502), and `GENERATION_FAILED` (500) without leaking stack traces or internal secrets.
- **Test Suites:**
  - `apps/api/src/tests/sales-assistant-service.spec.ts`: 11 domain service tests.
  - `apps/api/src/tests/sales-assistant-api.spec.ts`: 25 API, RBAC, multi-tenant, and error handling tests.
  - Total M5 Step 4 new tests: 36 tests.

- **Provider Interface:** `SalesAssistantProviderClient` defining `providerName: string` and stateless `generateDraft(input: NormalizedSalesAssistantInput): Promise<GeneratedSalesAssistantDraft>`.
- **Normalized Input Contract:** `NormalizedSalesAssistantInput` encapsulating `draftType`, `language`, `tone`, optional `objective`, optional `customInstruction`, safe `NormalizedLeadContext`, optional `NormalizedBusinessContext` (contains caller-supplied trusted/approved business facts), and optional `NormalizedWarningsContext`. Zero DB models, sessions, credentials, or audit objects passed.
- **Contact Safety (`PHONE != WHATSAPP`):** The provider contract defines the expected normalized trust boundary, where `whatsapp` must be populated by the calling service only from explicit verified/public WhatsApp evidence; the provider strictly never infers WhatsApp from `phone`, and phone presence alone never satisfies WhatsApp generation or suppresses `UNVERIFIED_WHATSAPP` warning.
- **Provider Output Contract:** Guaranteed to parse with `generatedSalesAssistantDraftSchema`. Returns final draft output only (`subject`/`body` for EMAIL, `content` for others). Zero exposure of raw responses, reasoning, chain-of-thought, system prompts, API keys, or tokens.
- **DRAFT-Only Invariant:** Every generated draft has `status = 'DRAFT'`. The provider cannot output `APPROVED`, `REJECTED`, or `SENT`.
- **Normalized Warnings Engine:** Deterministically detects and emits `LIMITED_LEAD_CONTEXT`, `MISSING_PRODUCT_CONTEXT`, `MISSING_PRICE_CONTEXT`, `UNVERIFIED_WHATSAPP`, and `UNSUPPORTED_CLAIM_REMOVED` (deterministic MOCK behavior for sample claims in tests; does not claim complete semantic moderation).
- **Caller-Supplied Trusted Facts (Anti-Fabrication):** Derives output solely from caller-supplied trusted facts (calling service is responsible for verifying source data); the provider strictly never fabricates prices, discounts, ratings, reviews, opening hours, certifications, guarantees, or delivery promises.
- **Safe Error Normalization:** `SalesAssistantProviderError` with normalized codes (`PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMITED`, `INVALID_PROVIDER_RESPONSE`, `GENERATION_FAILED`), containing only `code`, `safeMessage`, and `retryable`.
- **Mock Provider & Factory:** `MockSalesAssistantProvider` with deterministic language/tone templating and test-controlled failure simulation (`setSimulateFailure`); `getSalesAssistantProvider` factory resolving `MOCK` and rejecting any unsupported/real AI provider with `PROVIDER_UNAVAILABLE`.
- **Zero Real AI / Zero External Network:** No OpenAI/Gemini/Anthropic SDKs, zero external network or HTTP requests.
- **Zero DB / API / UI Scope:** Pure stateless domain abstraction. No database writes/orchestration (deferred to Step 4 domain service), no API routes/controllers, no frontend UI.
- **Test Suite:** 29 tests in `packages/ai/src/tests/sales-assistant-provider.spec.ts` covering factory, all 5 draft types, all 3 languages, all 4 tones, schema validation, length bounds, email structure, warnings, anti-fabrication, controlled failures, secret leak prevention, and determinism.

### M5 Step 5 — Lead Detail AI Sales Assistant UI (Implemented / Awaiting Review)
- **Files Created:**
  - `apps/web/src/components/leads/sales-assistant-card.tsx`
  - `apps/web/src/lib/leads/sales-assistant-display.ts`
  - `apps/web/src/tests/sales-assistant-display.spec.ts`
  - `apps/web/src/tests/sales-assistant-card-ui.spec.tsx`
- **Files Modified:**
  - `apps/web/src/lib/api-client.ts` (added 5 frontend API methods on `apiClient.leads`)
  - `apps/web/src/app/leads/[id]/page.tsx` (mounted `SalesAssistantCard` on Lead Detail)
  - `docs/progress.md`
- **Features Implemented:**
  - **Generation Form:** Full draft generation controls supporting 5 draft types (`WHATSAPP`, `EMAIL`, `CALL_SCRIPT`, `PROPOSAL`, `FOLLOW_UP`), 3 languages (`BANGLA`, `ENGLISH`, `MIXED`), and 4 tones (`PROFESSIONAL`, `FRIENDLY`, `CONCISE`, `PERSUASIVE`).
  - **Character Counters & Limits:** Objective bounded to 300 characters (`0 / 300`); custom instruction bounded to 1000 characters (`0 / 1000`); prevents over-limit submissions.
  - **Result & Content Preview:** Type, language, tone, status badges (`DRAFT`, `APPROVED`, `REJECTED`). Formatted subject & body for `EMAIL` drafts; formatted prose content for non-email drafts with `whitespace-pre-wrap` and `break-words`.
  - **Safety & Warning UI:** All 5 warnings mapped to clear user guidance (`MISSING_PRODUCT_CONTEXT`, `MISSING_PRICE_CONTEXT`, `UNVERIFIED_WHATSAPP`, `UNSUPPORTED_CLAIM_REMOVED`, `LIMITED_LEAD_CONTEXT`). Prominent `UNVERIFIED_WHATSAPP` notice ("No verified WhatsApp contact is available for this lead. This draft is for review only.") and strict omission of any WhatsApp send button.
  - **Mandatory Human Approval Notice:** Prominent notice displayed for `DRAFT` status ("Human approval required. Approval does not send the message automatically.").
  - **Review Lifecycle (Approve / Reject):** Confirmation dialogs for Approve and Reject actions. Once approved or rejected, drafts become terminal, review controls are hidden, and reviewer attribution is displayed.
  - **RBAC-Aware Controls:**
    - Generation: Allowed for `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_EXECUTIVE`; hidden / read-only for `VIEWER`.
    - Review: Allowed for `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`; hidden for `SALES_EXECUTIVE` and `VIEWER`.
  - **Copy Functionality:** Browser clipboard copy ("Copy Email" vs "Copy Draft") with clean text formatting.
  - **Draft History:** Chronological history list (newest first) with selection, active ring, status badges, and warning indicators.
  - **Safe Error Handling:** Classifies 409 `CONFLICT` (prompts refresh of latest status and history), 429 `RATE_LIMITED`, 504 `AI_PROVIDER_TIMEOUT`, 503 `AI_PROVIDER_UNAVAILABLE`, 502 `AI_PROVIDER_BAD_GATEWAY`, 500 `AI_GENERATION_FAILED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 422 `VALIDATION_ERROR`.
  - **Product Invariants:** Zero send buttons (No Send WhatsApp, Send Email, Call Now, Schedule Send, Start Campaign); zero `SENT` state; zero real AI provider calls; Step 6 NOT STARTED.
- **Test Suites & Verification Boundaries:**
  - `apps/web/src/tests/sales-assistant-display.spec.ts`: 17 pure unit tests (label formatting, warning message mapping, status badge styles, clipboard formatting for email and prose, error classification for 409, 429, 504, 503, 403, 404).
  - `apps/web/src/tests/sales-assistant-card-ui.spec.tsx`: 15 static render tests (using `renderToStaticMarkup` to verify DOM element IDs, character counters, form elements, DRAFT preview, EMAIL subject/body vs non-email content, warning banners, approval notices, RBAC button visibility, and strict prohibition of send buttons/SENT state).
  - **Interaction & Browser Verification Status:** Existing repository test tooling operates in a Node environment (`environment: 'node'`) without client DOM testing utilities (`@testing-library/react`, `@testing-library/user-event`, `jsdom`, `happy-dom`, `Playwright`, `Cypress`). `renderToStaticMarkup` verifies static markup structure and attribute invariants only, not client event handling, async state transitions, or browser clipboard APIs. Automated manual browser verification was not run in this headless verification session. Comprehensive interactive client verification remains deferred to M5 Step 6 E2E integration.
  - Total M5 Step 5 new tests: 32 tests (17 display + 15 static render).

### M5 Step 6 & Step 6.1 — E2E + Security + Provider Error Contract Fix (Completed)
- **Files Created:**
  - `apps/api/src/tests/m5-sales-assistant-e2e-security.spec.ts` (76 E2E integration & security tests)
  - `apps/web/src/tests/sales-assistant-flow.spec.ts` (8 frontend client flow & state transition tests)
- **Files Modified:**
  - `apps/api/src/middleware/error-handler.ts` (normalized provider error mapping to public `AI_*` codes)
  - `apps/api/src/tests/sales-assistant-api.spec.ts` (updated assertions for public `AI_*` codes, 35 tests)
  - `docs/progress.md`
  - `docs/decisions.md`
- **Scope & Objectives Verified:**
  - **Full E2E Generation Flow:** Authenticated, authorized caller generates drafts end-to-end, persists `DRAFT` status with safe context projection, creates audit log, and returns sanitized DTO without provider internals or raw prompts.
  - **All 5 Draft Types:** Verified `WHATSAPP`, `EMAIL`, `CALL_SCRIPT`, `PROPOSAL`, `FOLLOW_UP`. `EMAIL` draft populates `emailSubject` and `emailBody` with `content: null`. Non-email drafts populate `content` with `emailSubject: null` and `emailBody: null`.
  - **Language & Tone Matrix:** Verified `BANGLA`, `ENGLISH`, `MIXED` across `PROFESSIONAL`, `FRIENDLY`, `CONCISE`, `PERSUASIVE` without schema drift between shared contracts, AI provider, DB, and API.
  - **Contact Safety (`PHONE != WHATSAPP`):** Leads with phone only emit `UNVERIFIED_WHATSAPP` and do not project WhatsApp contacts. Unverified WhatsApp contacts still emit `UNVERIFIED_WHATSAPP`. Explicitly verified/confirmed WhatsApp contacts suppress `UNVERIFIED_WHATSAPP`.
  - **Adversarial `customInstruction` Trust Boundary:** Injection payloads attempting to override rules, force auto-approval, or request secrets fail to alter status (`DRAFT`), tenant scope (`organizationId`), RBAC, or leak system prompts/keys.
  - **Strict Request Schema Defense:** 15 prohibited fields (`organizationId`, `createdByUserId`, `provider`, `model`, `systemPrompt`, `apiKey`, `warnings`, `content`, `emailSubject`, `emailBody`, `status`, `approvedAt`, `approvedByUserId`, `autoSend`, `sendNow`) strictly rejected with 422 `VALIDATION_ERROR` and 0 persisted draft rows.
  - **Boundary Length Enforcement:** `objective` accepted at 300 chars, rejected at 301 (422); `customInstruction` accepted at 1000 chars, rejected at 1001 (422).
  - **Multi-Tenant Isolation:** Org A user cannot generate, read, list, approve, or reject drafts of Org B leads (returns 404 `NOT_FOUND` with 0 state mutations and 0 audit events).
  - **Cross-Lead Isolation:** Draft belonging to Lead A cannot be accessed or reviewed via Lead B route even within same organization (returns 404 `NOT_FOUND`).
  - **RBAC Matrix:**
    - Generation: `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_EXECUTIVE` allowed (201); `VIEWER` denied (403 `FORBIDDEN`, 0 drafts, 0 audits).
    - Review: `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER` allowed (200); `SALES_EXECUTIVE` and `VIEWER` denied (403 `FORBIDDEN`, 0 mutations).
    - Read/List: All authenticated organization roles including `VIEWER` permitted via `LEADS_READ`.
  - **DRAFT-Only Human Approval Invariant:** Generation can never output or persist `APPROVED`, `REJECTED`, or `SENT`. Every generation produces `DRAFT`.
  - **Review Transitions & Attribution:** Approve sets `approvedAt` and `approvedByUserId`. Reject sets `rejectedAt` and `rejectedByUserId`. Emits audit log and read endpoints reflect updated review status.
  - **Terminal State Enforcement:** Duplicate reviews (`APPROVED -> approve/reject`, `REJECTED -> reject/approve`) rejected with 409 `CONFLICT` without reviewer rewrite or duplicate audits.
  - **Concurrent Review Race Protection:** Atomic `updateMany` conditional lock ensures simultaneous review attempts resolve with exactly one winning terminal transition (200) and one conflict (409), leaving exactly one audit log.
  - **Provider Failure Normalization & Contract Hardening:**
    - Internal provider-domain errors (`PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_RATE_LIMITED`, `INVALID_PROVIDER_RESPONSE`, `GENERATION_FAILED`) are strictly translated in `errorHandler` into canonical public API error codes:
      - `PROVIDER_TIMEOUT` $\rightarrow$ HTTP 504 `AI_PROVIDER_TIMEOUT` ("AI provider request timed out. Please try again.")
      - `PROVIDER_UNAVAILABLE` $\rightarrow$ HTTP 503 `AI_PROVIDER_UNAVAILABLE` ("AI provider is currently unavailable. Please try again later.")
      - `PROVIDER_RATE_LIMITED` $\rightarrow$ HTTP 429 `AI_PROVIDER_RATE_LIMITED` ("AI provider rate limit reached. Please wait a moment.")
      - `INVALID_PROVIDER_RESPONSE` $\rightarrow$ HTTP 502 `AI_PROVIDER_BAD_GATEWAY` ("AI provider returned an invalid response. Please try again.")
      - `GENERATION_FAILED` $\rightarrow$ HTTP 500 `AI_GENERATION_FAILED` ("AI generation failed. Please try again.")
    - Corrected contract regression in Step 6.1 where internal provider error codes were previously emitted directly in HTTP responses rather than public `AI_*` codes.
    - Zero draft persistence, zero success audits, and zero stack trace or internal credential leakage across all failure modes.
  - **Audit & Response Data Minimization:** Audit logs and API responses strictly omit `content`, `emailBody`, `emailSubject`, `customInstruction`, `systemPrompt`, raw provider payloads, API keys, and token usage.
  - **Rate Limiter Hardening:** Generation strictly limited to 30 requests per 60 seconds per user with `429 RATE_LIMITED` and `Retry-After` header.
  - **UUID & Nonexistent ID Defense:** Malformed UUIDs return 422 `VALIDATION_ERROR` across all 5 endpoints; random nonexistent UUIDs return 404 `NOT_FOUND` without Prisma leaks.
  - **List Ordering:** Draft list returns newest first (`createdAt DESC`) and validates against `salesAssistantDraftListResponseSchema`.
  - **Frontend Client Flow & Interaction Verification:** Live HTTP server integration tests verify `apiClient.leads` generation, listing, review mutations, 409 error classification (`isConflict: true`), 429 rate limit classification, client-side RBAC enforcement, and clipboard formatting.
  - **Product Invariants:** Zero real AI provider SDKs; zero external message sending (no WhatsApp/email dispatch); zero Prisma migration changes.
  - **Test Suite Results:** Dedicated test suite (76 API tests + 8 Web client tests = 84 tests) passing with 0 failures; full repository suite (1,310 tests across 64 files) 100% green.

### M5 Step 7 — Milestone Closure & Final Verification (Completed / Awaiting Review)
- **Scope Audit Result:** All 21 core M5 capabilities confirmed in place and passing automated tests:
  1. Shared Sales Assistant contracts (`packages/shared/src/schemas/sales-assistant.ts`)
  2. Multi-tenant database persistence (`packages/db/prisma/schema.prisma` `SalesAssistantDraft`)
  3. AI provider abstraction interface (`packages/ai/src/sales-assistant/provider.ts`)
  4. Deterministic MOCK provider with anti-fabrication rules (`MockSalesAssistantProvider`)
  5. Domain generation and review service (`apps/api/src/services/sales-assistant.service.ts`)
  6. Generate draft API (`POST /api/v1/leads/:id/sales-assistant/drafts`)
  7. List drafts API (`GET /api/v1/leads/:id/sales-assistant/drafts`)
  8. Read draft detail API (`GET /api/v1/leads/:id/sales-assistant/drafts/:draftId`)
  9. Approve draft API (`POST /api/v1/leads/:id/sales-assistant/drafts/:draftId/approve`)
  10. Reject draft API (`POST /api/v1/leads/:id/sales-assistant/drafts/:draftId/reject`)
  11. Role-based access control (`SALES_ASSISTANT_GENERATE`, `SALES_ASSISTANT_REVIEW`, `LEADS_READ`)
  12. Authoritative audit logging (`lead.sales_assistant_draft_generated`, `lead.sales_assistant_draft_approved`, `lead.sales_assistant_draft_rejected`)
  13. Provider error normalization (`AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_RATE_LIMITED`, `AI_PROVIDER_BAD_GATEWAY`, `AI_GENERATION_FAILED`)
  14. Lead detail UI card component (`apps/web/src/components/leads/sales-assistant-card.tsx`)
  15. Interactive generation form (draft type, language, tone, objective, customInstruction)
  16. Draft history timeline with selection and status badges
  17. Draft preview with email subject/body vs non-email formatted text
  18. System warnings mapping (5 canonical warning codes)
  19. Copy-only UX with clipboard formatting ("Copy Email" / "Copy Draft")
  20. Human approval required badge, notice, and non-native confirmation dialogs
  21. Comprehensive E2E and security coverage across all layers
- **Out-of-Scope Boundaries Confirmed:**
  - Zero external AI provider integrations (no OpenAI, Gemini, Anthropic, DeepSeek, GLM, or local LLM HTTP servers).
  - Zero outbound message dispatch (no WhatsApp sending, email sending, SMS dispatch, phone calling, campaign execution, or scheduled dispatch).
  - Zero auto-approval or automatic sending; human approval is strictly internal review and does NOT send messages.
  - Zero `SENT` status; draft status is strictly `DRAFT`, `APPROVED`, or `REJECTED`.
  - Zero Milestone M6 outreach automation.
- **Architectural & Security Baseline Delivered:**
  - **Pure Multi-Tenancy:** All Sales Assistant queries and mutations are strictly scoped by the `organizationId` resolved from the authenticated server-side session (`leadmate_session` cookie). Cross-organization operations (generate, list, read, approve, reject) return the repository's safe 404 `NOT_FOUND` behavior with 0 mutations, 0 state disclosure, and 0 audit entries.
  - **Contact Safety (`PHONE != WHATSAPP`):** Phone numbers are never inferred or promoted to WhatsApp. Missing verified/public WhatsApp contact evidence triggers `UNVERIFIED_WHATSAPP` warning and suppresses WhatsApp contact projection.
  - **Data Minimization:** Provider output schemas, audit logs, and response DTOs strictly omit internal infrastructure, raw LLM payloads, system prompts, chain-of-thought, reasoning, API tokens, and operational prompt text.
  - **Concurrency & Terminal State Locks:** Atomic conditional `updateMany` prevents concurrent review races; repeat reviews on terminal states return 409 `CONFLICT`.
  - **Safe Error Normalization:** Internal provider errors are cleanly mapped to safe public `AI_*` error envelopes without stack traces or sensitive internals.
  - **Safe UI Rendering:** Plain text rendering with `whitespace-pre-wrap` and zero use of `dangerouslySetInnerHTML`.
- **Targeted Test Inventory (292 tests across 9 files):**
  1. `packages/shared/src/tests/sales-assistant-schemas.spec.ts` (66 tests)
  2. `packages/db/src/tests/sales-assistant-draft-persistence.spec.ts` (35 tests)
  3. `packages/ai/src/tests/sales-assistant-provider.spec.ts` (29 tests)
  4. `apps/api/src/tests/sales-assistant-service.spec.ts` (11 tests)
  5. `apps/api/src/tests/sales-assistant-api.spec.ts` (35 tests)
  6. `apps/api/src/tests/m5-sales-assistant-e2e-security.spec.ts` (76 tests)
  7. `apps/web/src/tests/sales-assistant-display.spec.ts` (17 tests)
  8. `apps/web/src/tests/sales-assistant-card-ui.spec.tsx` (15 tests)
  9. `apps/web/src/tests/sales-assistant-flow.spec.ts` (8 tests)
- **Full Repository Verification Baseline:**
  - Full repo test suite: **1,310 passed** across **64 files** (0 failures).
  - TypeScript typecheck (`npm run typecheck`): **0 errors** across all 9 workspaces.
  - Web production build (`npm run build -w apps/web`): **SUCCESS** (8/8 routes compiled).
  - Prisma schema validation: **VALID**.
  - Clean dependency check (`npm ci --dry-run --ignore-scripts`): **SUCCESS**.
- **Explicit Deferred Items & Known Limitations:**
  - *DEFERRED (Pending Vendor Selection / Production AI Infra):* Live AI provider adapters (OpenAI, Gemini, Anthropic) deferred; mock provider with anti-fabrication templates is used for offline deterministic safety.
  - *DEFERRED (Milestone M6 — Automated Outreach & Delivery):* External delivery mechanisms (WhatsApp Cloud API, SMTP/SES email delivery, telephony integrations, outbound campaigns, auto-sending, `SENT` lifecycle tracking).
  - *KNOWN LIMITATION (Test Infrastructure):* The repository operates with Node-based test runners without client DOM/browser test frameworks (`@testing-library/react`, Playwright, Cypress); client interaction verification is performed via live HTTP integration tests (`apiClient.leads`) against Express.
  - *DEFERRED (Telemetry & Operations):* Live LLM token usage tracking, inference cost attribution ledger, and dynamic provider circuit-breakers deferred until live AI vendor integration.

---

## Milestone M6: Automated Outreach & Delivery
- **Status:** STEP 1 — Shared Outreach Contracts + Permissions (IMPLEMENTED / AWAITING REVIEW)
- **Approved Base Checkpoint:** `e1e3c177391dbe62002c9aa9aa8c9a4fe8a81507`
- **M5 Status:** COMPLETE / CLOSED (`e1342b5a1d5ee03909b3d7e375dba3faba6a0c21`)
- **Step 0 (Architecture & Scope Freeze):** COMPLETE (`e1e3c177391dbe62002c9aa9aa8c9a4fe8a81507`)
  - Created `docs/m6-outreach-architecture.md` defining delivery domain model (`OutreachDelivery`), core channels (`WHATSAPP`, `EMAIL`; `CALL` deferred from generic delivery), draft compatibility matrix, strict `PHONE != WHATSAPP` contact safety, recipient provenance, delivery state machine (`REQUESTED`, `QUEUED`, `PROCESSING`, `SENT`, `DELIVERED`, `FAILED`, `CANCELLED` with attempt failure != delivery failure, `PROCESSING -> QUEUED` on retryable backoff, and terminal `FAILED` only on exhausted budget or non-retryable error), immutable content snapshot + canonical JSON SHA-256 hash (`approvedDraftSnapshotHash`), recipient snapshot, mandatory client `Idempotency-Key` header with resend semantics, minimal BullMQ job payload (`{ deliveryId: string }`), worker database authority model, provider abstraction & deterministic mock provider strategy, retry/failure classification, provider-specific webhook verification, two-gate suppression defense (API + worker pre-flight), atomic cancellation race protection, provider call execution outside DB transactions, RBAC (`OUTREACH_SEND`, `OUTREACH_READ`, `OUTREACH_MANAGE`), Sales Executive assigned-leads-only rule, API contracts, audit events, data minimization, UI workflow & confirmation modal, bulk campaign boundary frozen as deferred to an unassigned future campaign milestone (preserving M7 for Team Management + Sales Dashboard + Analytics), Step 9 live provider-specific verification requirements, 11-stage roadmap (Step 0 architecture phase + Steps 1–10 implementation/closure), threat model, and open product questions.
- **Step 1 (Shared Outreach Contracts & Permissions):** IMPLEMENTED / AWAITING REVIEW
  - Created `packages/shared/src/schemas/outreach.ts` and updated `packages/shared/src/enums.ts`, `packages/shared/src/permissions.ts`, `packages/shared/src/index.ts`.
  - **Channels:** Defined `OutreachChannel` (`WHATSAPP`, `EMAIL`). `CALL` and `SMS` are strictly omitted.
  - **Statuses & Terminal States:** Defined `OutreachDeliveryStatus` (7 statuses: `REQUESTED`, `QUEUED`, `PROCESSING`, `SENT`, `DELIVERED`, `FAILED`, `CANCELLED`), `OUTREACH_TERMINAL_STATUSES`, and `isOutreachDeliveryTerminal`.
  - **State Machine Transitions:** Implemented `ALLOWED_OUTREACH_DELIVERY_TRANSITIONS` and `canTransitionOutreachStatus` guaranteeing attempt failure != delivery failure (`PROCESSING -> QUEUED` retry) and strict immutability of terminal states.
  - **Public Error Codes:** Defined `OutreachErrorCode` with 13 canonical public error codes.
  - **Dispatch Schema:** Implemented strict `sendOutreachDeliveryRequestSchema` requiring `draftId` and `channel`, optional `recipientContactId`, and strictly rejecting all unknown/internal/tampering fields via `.strict()`.
  - **Idempotency Key:** Implemented `outreachIdempotencyKeySchema` validating case-preserving tokens (8-128 chars, `^[A-Za-z0-9._:-]+$`).
  - **Draft / Channel Compatibility:** Implemented `ALLOWED_CHANNELS_FOR_DRAFT_TYPE`, `getAllowedOutreachChannelsForDraftType`, and `isOutreachChannelCompatible` enforcing single-channel mappings for `WHATSAPP`/`EMAIL`/`PROPOSAL`, explicit channel selection for `FOLLOW_UP`, and zero valid channels for `CALL_SCRIPT`.
  - **Public DTOs:** Implemented safe public `outreachDeliverySummarySchema`, `outreachDeliveryResponseSchema`, and `outreachDeliveryListResponseSchema` with strict data minimization (zero raw recipients, snapshots, hashes, provider credentials, or providerMessageIds exposed).
  - **Recipient Masking:** Implemented deterministic `maskRecipient` utility for phone and email destinations.
  - **RBAC:** Defined `Permissions.OUTREACH_READ`, `Permissions.OUTREACH_SEND`, `Permissions.OUTREACH_MANAGE` and mapped into `ROLE_PERMISSIONS` (SUPER_ADMIN/ADMIN/SALES_MANAGER have all 3, SALES_EXECUTIVE has READ/SEND, VIEWER has READ only).
  - **Safety Invariants:** Proved `PHONE != WHATSAPP` preserved with zero inference helpers; verified M5 `SalesAssistantDraftStatus` contains strictly `DRAFT`, `APPROVED`, `REJECTED` (no `SENT`).
  - **Test Suite:** Added 52 unit tests in `packages/shared/src/tests/outreach-schemas.spec.ts` (shared package total: 211 tests across 7 files).
- [2026-10-05] Step 2 (Outreach Delivery Persistence + Migration): COMPLETE (`98dab882f5f3a8c2c569a952ca8228d0de5419e1`)
- [2026-10-05] Step 3 (Delivery Provider Abstraction + Deterministic Mock Providers): COMPLETE (`11f0c3f0d80d6675f69c566dc72f6a1805464a88`)
- [2026-10-05] Step 4 (Outreach Service + Idempotent Request/Queue Creation + Suppression Guard): COMPLETE (`bc5081709a5782b1339503eacba2aaa75f7762b6`)
  - Implemented `OutreachDeliveryService` in `packages/core/src/outreach/outreach-delivery.service.ts` with atomic delivery creation, immutable draft snapshotting (`approvedDraftSnapshotHash`), Gate A suppression enforcement, and post-transaction queue enqueueing.
  - Implemented `BullMQOutreachDeliveryQueue` in `@leadmate/queues` (`jobId = deliveryId`).
  - Implemented 61 unit tests in `packages/core/src/tests/outreach-delivery-service.spec.ts` and 3 tests in `packages/queues/src/tests/bullmq-outreach-delivery-queue.spec.ts`.
- [2026-10-05] Step 5 (Outreach REST API + RBAC + Audit Logging): COMPLETE (`8972d3c114d35e1654378f8cb4dfbcfbe83baab9`)
  - Implemented single canonical REST route family in `apps/api/src/routes/lead.routes.ts`: `POST /api/v1/leads/:id/outreach/deliveries`, `GET /api/v1/leads/:id/outreach/deliveries`, `GET /api/v1/leads/:id/outreach/deliveries/:deliveryId` (zero alias sprawl; removed legacy paths return 404).
  - Authenticated via PostgreSQL server-side sessions (`leadmate_session` cookie; zero JWT/Bearer auth).
  - Mandatory case-preserving `Idempotency-Key` HTTP header extraction and validation via `outreachIdempotencyKeySchema`.
  - RBAC: `OUTREACH_SEND` for POST dispatch, `OUTREACH_READ` for GET queries; strict Sales Executive lead assignment defense-in-depth (`lead.assignedUserId === authenticatedUserId`), returning 403 `FORBIDDEN` for unassigned or other reps' leads.
  - Canonical API error envelope and deterministic error mapping (`OUTREACH_DRAFT_NOT_APPROVED` -> 409, `OUTREACH_CHANNEL_INCOMPATIBLE` -> 422, `OUTREACH_RECIPIENT_INVALID` -> 422, `OUTREACH_RECIPIENT_SUPPRESSED` -> 422, `OUTREACH_IDEMPOTENCY_KEY_REUSED` -> 409, internal `QUEUE_ERROR` mapped to safe public `OUTREACH_DELIVERY_FAILED` 500 without leaking Redis/BullMQ internals).
  - Public DTO data minimization with masked destinations via `maskRecipient` (zero raw PII, snapshots, hashes, or provider secrets).
  - Authoritative audit logging emitting `lead.outreach_requested` for newly created deliveries; duplicate creation audits strictly suppressed on idempotent replay.
  - Standard rate limiting and authentication conventions (no unapproved 30/min rate quotas invented).
  - Implemented 31 integration tests in `apps/api/src/tests/outreach-api.spec.ts`.
- [2026-10-05] Step 6 (Lead Detail Outreach Delivery UI + Explicit Confirmation Modal): IMPLEMENTED / AWAITING REVIEW
  - Created `apps/web/src/components/leads/outreach-card.tsx` and `apps/web/src/components/leads/outreach-delivery-modal.tsx`.
  - Created `apps/web/src/lib/leads/outreach-display.ts` with complete status badge styling, honest labels/descriptions, channel formatters, recipient resolution helpers, and safe API error classification.
  - Mounted `<OutreachCard />` on the Lead Detail page (`apps/web/src/app/leads/[id]/page.tsx`) beneath `<SalesAssistantCard />`.
  - Extended `apiClient.leads` in `apps/web/src/lib/api-client.ts` with `sendOutreachDelivery(leadId, body, idempotencyKey)`, `listOutreachDeliveries(leadId, query)`, and `getOutreachDelivery(leadId, deliveryId)` passing case-preserving `Idempotency-Key` HTTP headers and strict JSON body without body `idempotencyKey`.
  - **Human-in-the-Loop Safety:** Mandatory 2-step confirmation modal (`OutreachDeliveryModal`) with prominent non-delivery queueing disclaimer (`OUTREACH_DISPATCH_DISCLAIMER`), draft preview (subject/body for Email, content for WhatsApp), channel indicator, and masked recipient confirmation.
  - **Channel Compatibility Guard:** WhatsApp drafts lock channel to WhatsApp; Email and Proposal drafts lock channel to Email; Follow-up drafts require explicit user channel selection; Call scripts display an exclusion notice without dispatch controls.
  - **Contact Provenance & `PHONE != WHATSAPP`:** Recipient candidate resolution strictly filters for verified WhatsApp contacts for WhatsApp channel (plain voice phone contacts strictly excluded) and verified email contacts / primary email for Email channel.
  - **Double-Click & Idempotency Safeguards:** UI generates dynamic UUID `Idempotency-Key` per dispatch attempt, locks confirm button during pending HTTP submissions to prevent double clicks, preserves same key on retry of failed queueing, and generates new key on intentional resend.
  - **Data Minimization & Security:** Zero PII or tokens stored in localStorage/sessionStorage; deliveries table and modals render masked destinations only.
  - **RBAC Matrix in UI:** `canSend` enabled for `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, and assigned `SALES_EXECUTIVE`; restricted read-only mode displayed for unassigned representatives and `VIEWER` role.
  - **Targeted Test Suites:**
    - `apps/web/src/tests/outreach-display.spec.ts` (13 unit tests)
    - `apps/web/src/tests/outreach-card-ui.spec.tsx` (8 component render & interaction tests)
    - `apps/web/src/tests/outreach-flow.spec.ts` (10 live API client integration tests)
    - Total Step 6 new tests: 31 tests.
- **Step 7 (Worker Execution + Retry + Cancellation + Webhook Framework):** NOT STARTED
- **Step 8 (E2E + Security + Race/Replay/Idempotency Hardening):** NOT STARTED
- **Step 9 (Live Provider Adapter Integration):** NOT STARTED
- **Step 10 (Milestone Review & Closure):** NOT STARTED



## Current Milestone: M4 — StoreMate Demo Website Integration
- **Status:** COMPLETE / CLOSED (Steps 1–6 all COMPLETE)
- **LeadMate internal demo platform:** COMPLETE (mock provider; API, RBAC, audit, UI, E2E/security)
- **Live StoreMate provider integration:** BLOCKED / DEFERRED pending human-provided API contract (`docs/storemate-api-contract.md`); not implemented
- **Final M4 Baseline Checkpoint:** `ce1179788ec8df6524f2d1486f17094f6a9213c3` (`test(m4): harden demo website e2e security`)
- **Next Milestone:** Milestone M5 (NOT STARTED — AWAITING APPROVAL)

---

## Milestone M4 Summary of Accomplishments (Completed)

### Step-by-Step Execution Summary (Steps 1–6)
- **Step 1 (Integration Architecture & Shared Contracts):** Defined canonical demo lifecycle enum (`DemoWebsiteStatus`: `REQUESTED`, `CREATING`, `READY`, `FAILED`, `EXPIRED`, `REMOVED`), providers (`DemoWebsiteProvider`: `STOREMATE`, `MOCK`), error codes (`DemoWebsiteErrorCode`), status labels, lifecycle transition validator (`isValidDemoWebsiteTransition`), strict request/summary/response schemas, normalized outbound payload contract (`storemateOutboundPayloadSchema`), demo safety invariants (`isDemo: true`, `noindex: true`, `nofollow: true`), contact safety (`PHONE != WHATSAPP`), tenant isolation model, proposed database model (`DemoWebsite`), and RBAC permission mappings (`DEMOS_GENERATE`, `DEMOS_MANAGE`). Documented that external StoreMate raw transport details remain TBD pending human-owned `docs/storemate-api-contract.md`.
  - *Approved Checkpoint:* `f8846e4e80a6c65cc3ede929e3bac0febe10e140` (`feat(m4): add demo website internal contracts`)
- **Step 2 (Demo Website Persistence & Migration):** Evolved PostgreSQL database schema with `DemoWebsite` model, `DemoWebsiteStatus` and `DemoWebsiteProvider` enums, composite multi-tenant foreign keys `(organization_id, lead_id)` (onDelete: Cascade), `(organization_id, requested_by_user_id)` (onDelete: Restrict), `(organization_id)` (onDelete: Cascade), `@@unique([lead_id, organization_id])` enforcing one demo per lead, additive migration `20261003123000_add_m4_demo_website_persistence`, and full constraint integration tests.
  - *Approved Checkpoint:* `41827aea5a8fb3342ee63ad094675137c161ccc6` (`feat(m4): add demo website persistence`)
- **Step 3 (Provider Abstraction, Mock Provider & Domain Service):** Built `DemoWebsiteProviderClient` interface and `MockDemoWebsiteProvider` with deterministic siteId/URL generation and invariant enforcement in `@leadmate/storemate`; implemented `getDemoWebsiteProvider` factory throwing `StoreMateUnavailableError` when blocked `STOREMATE` provider is requested; built `DemoWebsiteService` in `apps/api/src/services/demo-website.service.ts` with strict multi-tenant isolation, idempotency (one active demo per lead), concurrency race protection, data minimization, `PHONE != WHATSAPP` semantic safety, and non-blocking transaction boundaries across provider calls.
  - *Approved Checkpoint:* `072caeae365d54afdf67d8ac7206cc668fe7605d` (`feat(m4): add mock demo provider service`)
- **Step 4 (Demo Website API Endpoints, RBAC & Audit Logging):** Implemented authenticated REST endpoints in `apps/api/src/routes/lead.routes.ts` (`POST /:id/demo`, `GET /:id/demo`, `POST /:id/demo/regenerate`, `POST /:id/demo/expire`, `POST /:id/demo/remove`) with dedicated RBAC permission guards (`DEMOS_GENERATE` for create/regenerate, `DEMOS_MANAGE` for expire/remove, `LEADS_READ` for get summary), `DemoWebsiteController` with strict Zod body and UUID parameter validation, canonical error handling for `StoreMateUnavailableError` (503 `STOREMATE_UNAVAILABLE`), and authoritative audit logging (`lead.demo_created`, `lead.demo_regenerated`, `lead.demo_expired`, `lead.demo_removed`) with 0 duplicate audits on idempotent retries and no-ops.
  - *Approved Checkpoint:* `199cefac90d8aa2832f97a842d3b58bbeb3f1cc8` (`feat(m4): add demo website api`)
- **Step 5 (Lead Detail Demo Website UI):** Implemented interactive, responsive `DemoWebsiteCard` component in `apps/web/src/components/leads/demo-website-card.tsx` on `/leads/[id]`, supporting all canonical lifecycle states (`REQUESTED`, `CREATING`, `READY`, `FAILED`, `EXPIRED`, `REMOVED`, and 404 empty state), prominent product invariant disclaimer (`DEMO — NOT OFFICIAL`), URL security validation via `getSafeExternalUrl` (`target="_blank" rel="noopener noreferrer"`; hardened to HTTPS-only `getSafeDemoWebsiteUrl` in Step 6), non-native confirmation dialogs for Expire and Remove actions, and permission-aware UX (`DEMOS_GENERATE` for Generate/Regenerate, `DEMOS_MANAGE` for Expire/Remove, `LEADS_READ` for read-only view and Open Demo).
  - *Approved Checkpoint:* `1aea76daee9fd9f9ec005d45c29ba4dc2e89b82c` (`feat(m4): add demo website lead ui`)
- **Step 6 (End-to-End Integration, Security Hardening & Final Regression):** Implemented comprehensive E2E and security hardening suite (`apps/api/src/tests/m4-demo-e2e-security.spec.ts`) validating complete happy-path lifecycle (`404 -> CREATE -> READY -> REGENERATE -> EXPIRE -> REGENERATE -> REMOVE -> GET REMOVED`), API concurrency race safety with DB-level single-row guarantees, tenant isolation (Org A vs Org B 404/0 mutations/0 audits), RBAC permission matrix (`SUPER_ADMIN`/`ADMIN`/`SALES_MANAGER` full, `SALES_EXECUTIVE` create/regen, `VIEWER` read-only), 401 unauthenticated defenses, malformed UUID validation consistency (422 `VALIDATION_ERROR` across all 5 endpoints), body anti-tampering, StoreMate blocked-transport safety (503 without DB corruption), mock provider full lead UUID deterministic site ID collision elimination, HTTPS-only demo URL enforcement in frontend (`getSafeDemoWebsiteUrl`), TTL boundaries, expired READY record regeneration paths, invalid lifecycle transitions, and audit logging actor/metadata safety.
  - *Approved Checkpoint:* `ce1179788ec8df6524f2d1486f17094f6a9213c3` (`test(m4): harden demo website e2e security`)

---

## Architectural & Security Foundation Delivered in M4

| Layer / Subsystem | Architecture & Invariants | Status |
|---|---|---|
| **M4 API Surface** | 5 REST endpoints covering demo creation, status query, regeneration, manual expiration, and soft removal | Operational |
| **Granular RBAC** | `DEMOS_GENERATE` (`SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_EXECUTIVE`), `DEMOS_MANAGE` (`SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`), `LEADS_READ` (`SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_EXECUTIVE`, `VIEWER`) | Operational |
| **Multi-Tenancy & IDOR Defense** | Cross-tenant access to demo resources returns generic 404 `NOT_FOUND` with 0 mutations and 0 audit records | Operational |
| **Single-Row Persistence** | Exactly one `DemoWebsite` row per `(organizationId, leadId)` enforced by PostgreSQL composite `@@unique([lead_id, organization_id])` | Operational |
| **Lifecycle & Terminal State** | Canonical states: `REQUESTED`, `CREATING`, `READY`, `FAILED`, `EXPIRED`, `REMOVED`. `REMOVED` is strictly terminal; invalid transitions rejected with 422 | Operational |
| **StoreMate Live Transport Blocked** | Live third-party HTTP transport blocked with 503 `STOREMATE_UNAVAILABLE` pending human contract in `docs/storemate-api-contract.md`; mock provider fully operational | Operational / Blocked |
| **Provider Abstraction** | Pluggable `DemoWebsiteProviderClient` interface with deterministic, network-free `MockDemoWebsiteProvider` eliminating provider hardcoding | Operational |
| **Data Minimization** | Outbound demo payload projects only verified public business/contact/social/branding info; CRM notes, follow-up notes, and org secrets completely excluded | Operational |
| **Contact Semantic Safety** | Strict `PHONE != WHATSAPP` semantic validation prevents routing misclassified mobile numbers into inappropriate channels | Operational |
| **Demo Safety Invariants** | Generated sites tagged with `isDemo: true`, `noindex: true`, `nofollow: true`, and UI displays prominent `DEMO — NOT OFFICIAL` indicator | Operational |
| **HTTPS-Only URL Policy** | External demo link rendering enforces strict HTTPS protocol validation (`getSafeDemoWebsiteUrl`), rejecting plain HTTP and non-web schemes | Operational |
| **Authoritative Audit Logging** | Dedicated actions: `lead.demo_created`, `lead.demo_regenerated`, `lead.demo_expired`, `lead.demo_removed`; zero duplicate audits on no-ops | Operational |
| **Non-Blocking Concurrency** | Long-running provider operations executed outside database transaction boundaries to prevent connection pool starvation | Operational |
| **Frontend Confirmation UX** | Destructive demo lifecycle operations (Expire and Remove) protected by non-native accessible confirmation dialogs | Operational |

---

## Final M4 API Surface (5 Endpoints)

1. `POST /api/v1/leads/:id/demo` — Generate initial StoreMate demo website for lead.
   - **Permission:** `DEMOS_GENERATE`
2. `GET /api/v1/leads/:id/demo` — Retrieve current demo website status and details for lead.
   - **Permission:** `LEADS_READ`
3. `POST /api/v1/leads/:id/demo/regenerate` — Regenerate demo website for lead with refreshed business details.
   - **Permission:** `DEMOS_GENERATE`
4. `POST /api/v1/leads/:id/demo/expire` — Manually mark an active demo website as `EXPIRED`.
   - **Permission:** `DEMOS_MANAGE`
5. `POST /api/v1/leads/:id/demo/remove` — Soft-unpublish and permanently disable demo website (`REMOVED` terminal state).
   - **Permission:** `DEMOS_MANAGE`

---

## M4 Canonical Data Models & Lifecycle Rules

### Demo Website Statuses & Lifecycle Rules
- **Canonical Enum:** `REQUESTED`, `CREATING`, `READY`, `FAILED`, `EXPIRED`, `REMOVED`
- **Allowed Transitions:**
  - `REQUESTED` $\rightarrow$ `CREATING`, `FAILED`, `REMOVED`
  - `CREATING` $\rightarrow$ `READY`, `FAILED`, `REMOVED`
  - `READY` $\rightarrow$ `REQUESTED`, `CREATING`, `EXPIRED`, `REMOVED`
  - `FAILED` $\rightarrow$ `REQUESTED`, `CREATING`, `REMOVED`
  - `EXPIRED` $\rightarrow$ `REQUESTED`, `CREATING`, `REMOVED`
  - `REMOVED` $\rightarrow$ *None* (`REMOVED` is strictly terminal)
  - *Source of truth:* `ALLOWED_DEMO_WEBSITE_TRANSITIONS` in `packages/shared/src/enums.ts`.
- **Single-Row Invariant:** Exactly one `DemoWebsite` record per `(organizationId, leadId)` enforced at DB engine level.

### Audit Actions Matrix
| Domain Event | Audit Action | Details / Invariants |
|---|---|---|
| Demo Created | `lead.demo_created` | Written only on successful generation; `before` null, `after` = demo snapshot |
| Demo Regenerated | `lead.demo_regenerated` | Written only on successful regeneration; `before`/`after` snapshots |
| Demo Expired | `lead.demo_expired` | Written only on a real transition (no audit on no-op) |
| Demo Removed | `lead.demo_removed` | Written only on a real transition (no audit on no-op) |

Actor (`userId`) and `organizationId` always come from the authenticated session. Audit entityType is `Lead`.

---

---

## Milestone M3 Summary of Accomplishments (Completed)

### Step-by-Step Execution Summary (Steps 1–8)
- **Step 1 (Shared CRM Contracts):** Defined canonical CRM stage enums (`CrmStage`), activity types (`CrmActivityType`), stage transition labels, request/response validation schemas, and assignee summaries in `@leadmate/shared`.
  - *Approved Checkpoint:* `14207335c8c7565c3b968f201918ae91c9b55cad` (`feat(m3): add shared crm contracts`)
- **Step 2 (CRM Persistence Layer):** Evolved PostgreSQL schema with `CrmNote` and `CrmActivity` models, composite foreign keys `(organization_id, lead_id)`, `(organization_id, user_id)`, `(organization_id, actor_user_id)`, and updated `Lead` with `crmStage`, `assignedUserId`, and `assignedAt`.
  - *Approved Checkpoint:* `bd696dc6c05897887006569cbb1ce55f330502fd` (`feat(m3): add crm persistence layer`)
- **Step 3 (Lead Assignment API & Service):** Built `PATCH /api/v1/leads/:id/assignment` with dedicated `LEADS_ASSIGN` permission guard, active same-tenant assignee validation, unassign support, atomic activity logging (`LEAD_ASSIGNED`, `LEAD_REASSIGNED`, `LEAD_UNASSIGNED`), deterministic no-op semantics, and audit log tracking (`lead.assignment_changed`).
  - *Approved Checkpoint:* `ad2024c17cbcf6b4626a32abb6af138fe3c9cb26` (`feat(m3): add lead assignment api and service`)
- **Step 4 (CRM Pipeline Stage, Notes & Activity Timeline APIs):** Built `PATCH /api/v1/leads/:id/crm-stage`, `GET /api/v1/leads/:id/notes`, `POST /api/v1/leads/:id/notes`, and `GET /api/v1/leads/:id/activities` with strict RBAC (`LEADS_WRITE` for mutations, `LEADS_READ` for queries), atomic multi-write transactions, stage no-op deduping, and authoritative audit logging (`lead.crm_stage_changed`, `lead.crm_note_added`).
  - *Approved Checkpoint:* `d9479c8499e0cdf73840c01df03d983e3e98a4ec` (`feat(m3): add crm pipeline stage, notes, and activity timeline apis`)
- **Step 6A (Lead Detail CRM Contract Bridge & Assignee Directory):** Added `GET /api/v1/leads/assignees` returning sanitized active users `{ id, name, email }` guarded by `LEADS_ASSIGN`, and bridged `GET /api/v1/leads/:id` to include populated `assignedUser` summary and `crmStage`.
  - *Approved Checkpoint:* `b0b7b734fb2cd2c9e999339454d7863fce0c13c3` (`feat(m3): add crm frontend backend contracts`)
- **Step 6 (Lead Detail CRM Frontend UI):** Implemented interactive, responsive CRM card (`CrmCard`) on `/leads/[id]` displaying CRM stage badge & selector, assignee controls, notes composer & timeline, and activity audit feed with permission-aware rendering and localized failure isolation.
  - *Approved Checkpoint:* `664a066530324c783ac4de4b5667d2416ed6529b` (`feat(m3): add lead detail crm ui`)
- **Step 5 (Follow-Up Tasks & Reminders Backend):** Created `FollowUpTask` database model, migration, shared contracts, and complete REST lifecycle (`POST/GET /follow-ups`, `PATCH /follow-ups/:followUpId`, `POST /follow-ups/:followUpId/complete`, `POST /follow-ups/:followUpId/cancel`) with deterministic ordering (`PENDING` by `dueAt ASC`, terminal by `updatedAt DESC`), default assignee inheritance from parent lead, and audit logging (`lead.follow_up_created`, `lead.follow_up_updated`, `lead.follow_up_completed`, `lead.follow_up_cancelled`).
  - *Approved Checkpoint:* `8e7a2c7f64c39e32b3f52c24f2a3f1a693c8226f` (`feat(m3): add follow-up task backend`)
  - *Note on Execution Order:* Step 6 (CRM UI) was completed before Step 5 (Follow-Up Tasks Backend) to decouple frontend CRM delivery from follow-up task backend persistence.
- **Step 7 (End-to-End CRM Workflows & Security Hardening):** Built comprehensive security test suite (`m3-security.spec.ts`), multi-role E2E journey suite (`m3-e2e.spec.ts`), and frontend security test suite (`crm-security.spec.tsx`) validating 12/12 endpoints unauthenticated 401 handling, permission matrix, tenant isolation, IDOR resistance, strict body anti-tampering, XSS entity escaping, audit integrity, and cross-terminal transition rules.
  - *Approved Checkpoint:* `5f8854e19ed7d3a8c58d97c092184e56dc2834a8` (`test(m3): harden crm security and e2e coverage`)
- **Step 8 (Milestone Closure & Canonical Documentation):** Consolidated M3 architectural guarantees, verified final test baseline (867 tests across 47 files), documented technical debt, and finalized M3 milestone closure.

---

## Architectural & Security Foundation Delivered in M3

| Layer / Subsystem | Architecture & Invariants | Status |
|---|---|---|
| **M3 API Surface** | 12 REST endpoints covering lead detail, assignees, assignment, CRM stages, notes, activities, and follow-up tasks | Operational |
| **Granular RBAC** | Production permissions: `LEADS_READ` (viewing CRM data), `LEADS_WRITE` (stage/notes/tasks mutations), `LEADS_ASSIGN` (lead assignment & assignee directory) | Operational |
| **Multi-Tenancy & IDOR Defense** | Cross-tenant requests to any lead, note, activity, task, or assignee return generic 404 `NOT_FOUND` with 0 mutations | Operational |
| **Database Foreign Keys** | PostgreSQL composite foreign keys `(organization_id, lead_id)`, `(organization_id, assigned_user_id)`, `(organization_id, created_by_user_id)` enforce tenant integrity at DB engine level | Operational |
| **Atomic Transactions** | All multi-write mutations (lead updates + activities + audit logs) execute atomically in `prisma.$transaction` | Operational |
| **Strict Request Validation** | Zod schemas with `.strict()` reject extra or injected fields (`organizationId`, `role`, `authorId`, `status`) with 422 `VALIDATION_ERROR` | Operational |
| **Safe Output Projection** | Assignee directory and activity actor summaries strictly sanitized to `{ id, name, email }`; credentials, sessions, and org internals stripped | Operational |
| **CRM Pipeline Stages** | 7 canonical stages (`NEW`, `CONTACTED`, `QUALIFIED`, `PROPOSAL_SENT`, `NEGOTIATION`, `WON`, `LOST`); same-stage is 200 no-op; terminal reopen permitted in V1 | Operational |
| **CRM Activity Feed** | Authoritative timeline recording `LEAD_ASSIGNED`, `LEAD_REASSIGNED`, `LEAD_UNASSIGNED`, `STAGE_CHANGED`, `NOTE_ADDED`; follow-ups do NOT emit CRM activities | Operational |
| **Follow-Up Task Lifecycle** | `PENDING` $\rightarrow$ `COMPLETED` / `CANCELLED`; repeat calls are 200 no-ops; cross-terminal flips (`CANCELLED` $\rightarrow$ complete or `COMPLETED` $\rightarrow$ cancel) return 422 | Operational |
| **Derived Overdue Status** | Overdue is strictly derived in application logic (`status === PENDING && dueAt < now`); no persisted `OVERDUE` state, no background scheduler | Operational |
| **Follow-Up UI Boundary** | Follow-up task backend is fully operational; follow-up frontend UI is intentionally deferred and NOT part of M3 UI | Documented Limitation |
| **Authoritative Audit Logging** | Dedicated actions: `lead.assignment_changed`, `lead.crm_stage_changed`, `lead.crm_note_added`, `lead.follow_up_created`, `lead.follow_up_updated`, `lead.follow_up_completed`, `lead.follow_up_cancelled` | Operational |
| **XSS Prevention** | React DOM text node escaping without `dangerouslySetInnerHTML`; script payloads stored safely as literal plain text | Operational |
| **Frontend Failure Isolation** | Secondary CRM data failures (notes/activities/assignees) isolated via localized error banners without crashing parent lead view | Operational |

---

## Final M3 API Surface (12 Endpoints)

1. `GET /api/v1/leads/:id` — Retrieve authoritative lead detail with CRM summary (`crmStage`, `assignedUserId`, `assignedAt`, `assignedUser`).
   - **Permission:** `LEADS_READ`
2. `GET /api/v1/leads/assignees` — Retrieve list of active assignable users `{ id, name, email }` in caller's organization.
   - **Permission:** `LEADS_ASSIGN`
3. `PATCH /api/v1/leads/:id/assignment` — Assign, reassign, or unassign (`assignedUserId: null`) a lead.
   - **Permission:** `LEADS_ASSIGN`
4. `PATCH /api/v1/leads/:id/crm-stage` — Transition lead's CRM pipeline stage.
   - **Permission:** `LEADS_WRITE`
5. `GET /api/v1/leads/:id/notes` — Retrieve chronological CRM notes for a lead.
   - **Permission:** `LEADS_READ`
6. `POST /api/v1/leads/:id/notes` — Add a new CRM note (max 5,000 characters).
   - **Permission:** `LEADS_WRITE`
7. `GET /api/v1/leads/:id/activities` — Retrieve chronological CRM activity timeline.
   - **Permission:** `LEADS_READ`
8. `GET /api/v1/leads/:id/follow-ups` — List all follow-up tasks for a lead (ordered deterministically: `PENDING` by `dueAt ASC`, completed/cancelled by `updatedAt DESC`).
   - **Permission:** `LEADS_READ`
9. `POST /api/v1/leads/:id/follow-ups` — Create a follow-up task (defaults assignee from parent lead if omitted).
   - **Permission:** `LEADS_WRITE`
10. `PATCH /api/v1/leads/:id/follow-ups/:followUpId` — Update mutable fields (`dueAt`, `assignedUserId`, `note`) of a pending follow-up task.
    - **Permission:** `LEADS_WRITE`
11. `POST /api/v1/leads/:id/follow-ups/:followUpId/complete` — Mark a follow-up task as `COMPLETED` (server-generated `completedAt`).
    - **Permission:** `LEADS_WRITE`
12. `POST /api/v1/leads/:id/follow-ups/:followUpId/cancel` — Mark a follow-up task as `CANCELLED` (`completedAt: null`).
    - **Permission:** `LEADS_WRITE`

---

## Canonical Data Models & Lifecycle Rules

### CRM Stages
- **Canonical Enum:** `NEW`, `CONTACTED`, `QUALIFIED`, `PROPOSAL_SENT`, `NEGOTIATION`, `WON`, `LOST`
- **Transition Policy:** Any stage transition is permitted in V1 (including reopening from `WON`/`LOST`).
- **No-Op Semantics:** Updating to the lead's current stage returns `200 OK` with 0 new activities and 0 new audit records.

### Follow-Up Task Statuses & Terminal Matrix
- **Canonical Enum:** `PENDING`, `COMPLETED`, `CANCELLED`
- **Transition Rules:**
  - `PENDING` $\rightarrow$ `COMPLETED`: Allowed (`200 OK`, sets `completedAt`).
  - `PENDING` $\rightarrow$ `CANCELLED`: Allowed (`200 OK`, clears `completedAt`).
  - `COMPLETED` $\rightarrow$ `complete`: Idempotent no-op (`200 OK`, 0 new audits).
  - `CANCELLED` $\rightarrow$ `cancel`: Idempotent no-op (`200 OK`, 0 new audits).
  - `CANCELLED` $\rightarrow$ `complete`: Rejected with `422 VALIDATION_ERROR`.
  - `COMPLETED` $\rightarrow$ `cancel`: Rejected with `422 VALIDATION_ERROR`.
  - `PATCH` on `COMPLETED` or `CANCELLED` task: Rejected with `422 VALIDATION_ERROR`.
- **Overdue Rule:** `status === PENDING && dueAt < now` (dynamically evaluated; no persisted `OVERDUE` state).

### Audit Actions & CRM Activity Matrix
| Domain Event | Audit Action | CRM Activity Type | Metadata Invariants |
|---|---|---|---|
| Initial Assignment | `lead.assignment_changed` | `LEAD_ASSIGNED` | `{ assignedUserId, operation: "ASSIGNED" }` |
| Reassignment | `lead.assignment_changed` | `LEAD_REASSIGNED` | `{ assignedUserId, previousAssignedUserId, operation: "REASSIGNED" }` |
| Unassignment | `lead.assignment_changed` | `LEAD_UNASSIGNED` | `{ previousAssignedUserId, operation: "UNASSIGNED" }` |
| CRM Stage Transition | `lead.crm_stage_changed` | `STAGE_CHANGED` | `{ previousStage, newStage }` |
| CRM Note Added | `lead.crm_note_added` | `NOTE_ADDED` | `{ noteId }` (full content omitted from audit metadata) |
| Follow-Up Created | `lead.follow_up_created` | *None* | `{ leadId, dueAt, assignedUserId, status: "PENDING" }` |
| Follow-Up Updated | `lead.follow_up_updated` | *None* | `{ leadId, dueAt, assignedUserId, note }` |
| Follow-Up Completed | `lead.follow_up_completed` | *None* | `{ leadId, status: "COMPLETED", completedAt }` |
| Follow-Up Cancelled | `lead.follow_up_cancelled` | *None* | `{ leadId, status: "CANCELLED" }` |

---

## Test & Verification Baseline

- **Automated Tests:** **1,018 / 1,018 tests passing** across **55 test files** (`node node_modules/vitest/vitest.mjs run`).
  - *M4 targeted suite:* 151 tests across 8 files — E2E/security 26, API 35, service 20, persistence 13, card UI 17, schemas 19, mock provider 7, display 14.
- **Root Typecheck:** **0 errors** across all 9 workspaces (`npm run typecheck`).
- **Web Production Build:** **SUCCESS** with optimized static and dynamic routes (`npm run build -w apps/web`).
- **Prisma Schema Validation:** **VALID** (`prisma validate --schema="packages/db/prisma/schema.prisma"`).
- **Clean Install Check:** **SUCCESS** with zero dependency drift (`npm ci --dry-run --ignore-scripts`).
- **Test DB Safety:** All test suites guarded by PostgreSQL `ensureTestDatabase` assertion.

---

## Known Non-Blocking Notes & Technical Debt

1. **Live StoreMate HTTP Transport (M4 Blocker):** Live third-party StoreMate HTTP transport integration is strictly blocked pending human-provided external API specifications in `docs/storemate-api-contract.md`. Internal demo generation, persistence, API, and UI are fully operational with `MockDemoWebsiteProvider`.
2. **Dedicated Distributed Demo Rate Limiting (M4 Tech Debt):** Demo generation currently relies on authenticated session throughput and database-level unique constraint concurrency serialization. Dedicated Redis distributed limiter for demo generation is deferred post-M4.
3. **Real-Provider Polling & Webhooks (M4 Tech Debt):** Async polling / webhook ingestion from StoreMate is deferred until StoreMate external API contract defines delivery mechanics.
4. **Background Demo Expiration Cron (M4 Tech Debt):** Demo expiration is currently handled via user action (`POST /:id/demo/expire`) or TTL expiry detection (`expiresAt`) when generating/regenerating; background expiration worker/cron is deferred.
5. **Demo Version History (M4 Scope Boundary):** Exactly one `DemoWebsite` record is maintained per `(organizationId, leadId)`; multi-version historical demo archiving is intentionally out of scope for V1.
6. **CRM Rate Limiting (M3 Tech Debt):** M3 CRM routes currently rely on authenticated session throughput. Distributed Redis-backed rate limiting is scheduled for post-M3 infrastructure hardening.
7. **Concurrent Write Locking (M3 Tech Debt):** Lead assignment, stage updates, and follow-up mutations currently follow last-write-wins semantics within atomic PostgreSQL transactions. Optimistic locking (`version` column) is deferred.
8. **Cursor-Based Pagination (M3 Tech Debt):** CRM notes, activity timeline entries, and follow-up tasks are returned unpaginated with deterministic ordering. Cursor-based pagination is deferred to high-volume optimization phases.
9. **Follow-Up Frontend UI (M3 Scope Boundary):** Follow-up task backend is fully implemented and tested, but follow-up UI controls on the frontend are intentionally deferred beyond M3.
10. **In-Memory Rate Limiting (M2 Tech Debt):** Analyze rate limiter (30 req / 60s) is in-memory per API process.
11. **In-Process Analysis Deduplication (M2 Tech Debt):** In-flight website analysis deduplication is in-process only.
12. **IANA IP Range Policy (M2 Tech Debt):** Special-purpose IP range definitions in `ssrf-guard.ts` should be periodically reviewed against updated IANA registry allocations.

---

## Milestone M2 Summary of Accomplishments (Archived Reference)

### Step-by-Step Execution Summary (Steps 1–7)
- **Step 1 (Shared Contracts & Deterministic Qualification Engine):** Established analysis status enums, campaign schemas, qualification reason codes, and pure deterministic qualification scoring engine in `@leadmate/core` evaluating factual signals across 3 distinct campaigns (`50e6ec1`).
- **Step 2 (Safe SSRF Guard & Website Analyzer):** Implemented zero-trust SSRF protection with global unicast IP classifier, DNS resolution validation, socket IP pinning against DNS rebinding, manual redirect revalidation (max 3 hops), 100 KB body streaming cap with early `</head>` abort, 5-second total probe budget, and attribute-order-agnostic `<title>` / `<meta name="description">` extraction (`09c36aa`).
- **Step 3 (Online Presence Analysis Persistence):** Evolved PostgreSQL schema with `LeadOnlinePresenceAnalysis` model containing composite unique key `(lead_id, organization_id)`, multi-tenant composite foreign keys, and synchronous Lead summary fields (`websiteStatus`, `onlinePresenceType`) (`373e565`).
- **Step 4 (Online Presence Analysis Service & API):** Implemented `POST /api/v1/leads/:id/analyze` and `GET /api/v1/leads/:id/analysis`, optimistic concurrency protection (409 on stale input mutation), same-process in-flight deduplication, transactional invalidation hooks, authoritative audit logging (`lead.online_presence_analyzed`), and per-user in-memory rate limiting (30 req / 60s) (`fae5c8c`, `f18b265`).
- **Step 5 (Lead Detail Analysis UI):** Built reactive Lead Detail online presence card (`OnlinePresenceAnalysisCard`) with canonical error handling, unanalyzed state CTA, populated score breakdown per campaign, responsive layouts, sanitized external links (`target="_blank" rel="noopener noreferrer"`), and strict `LEADS_WRITE` RBAC button mirroring (`9f14eb5`, `eea5279`).
- **Step 6 (End-to-End & Security Validation Suite):** Created comprehensive validation suite (`apps/api/src/tests/m2-e2e-security-validation.spec.ts`) proving the entire M2 journey, direct IP SSRF rejection, mixed DNS defense, redirect SSRF blocking, DNS pinning, rate limiting, tenant isolation, RBAC, input anti-tampering, stale concurrency races (409), suppression rules, audit data minimization, error envelope compliance, and zero global score contamination (`e3bb20b`).
- **Step 7 (CI Validation, Documentation & Milestone Closure):** Validated GitHub Actions CI coverage, documented final M2 architecture, security controls, technical debt, and finalized milestone closure (`860c441`).

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
- **Milestone M5 — AI Sales Assistant:** COMPLETE / CLOSED.
- **Milestone M6 — Automated Outreach & Delivery:** STEP 1 (COMPLETE). STEP 2 (COMPLETE). STEP 3 — Delivery Provider Abstraction + Deterministic Mock Providers (IMPLEMENTED / AWAITING REVIEW). Steps 4–10 NOT STARTED.
