# LeadMate Progress Tracking

## Current Milestone: M5 — AI Sales Assistant
- **Status:** IN PROGRESS
- **Approved Base Checkpoint:** `0b8c0e5eaca31c3b4d52c5ebecd190de05771b84` (`fix(db): pin follow-up task index name`)
- **Step 1 (AI Sales Assistant Contracts + Guardrails):** COMPLETE (`a09cd82b88a671f3408abdf3a472dd8ceb8c9ee7`)
- **Step 2 (Sales Assistant Draft Persistence + Migration):** COMPLETE (`feat(m5): add sales assistant draft persistence`)
- **Step 3 (AI Sales Assistant Provider Abstraction & Domain Service):** NOT STARTED
- **Step 4 (Sales Assistant API Endpoints, RBAC & Audit Logging):** NOT STARTED
- **Step 5 (Lead Detail Sales Assistant UI):** NOT STARTED
- **Step 6 (E2E Integration, Security Hardening & Milestone Closure):** NOT STARTED

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

---


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
- **Milestone M4 — StoreMate Demo Website Integration:** COMPLETE / CLOSED.
- **Milestone M5:** NOT STARTED. Awaiting explicit approval and kickoff instructions.
