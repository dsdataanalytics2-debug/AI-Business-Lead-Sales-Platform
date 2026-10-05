# M6 — Automated Outreach & Delivery Architecture & Scope Freeze

## 1. Purpose
This document establishes the authoritative architectural blueprint and scope boundaries for **Milestone M6: Automated Outreach & Delivery**. It freezes domain models, channel abstractions, human-approval boundaries, state machines, queue and worker responsibilities, idempotency guarantees, RBAC policies, and safety constraints prior to implementation.

---

## 2. M6 Primary Goals
The primary goal of Milestone M6 is to enable **controlled, human-authorized, and auditable outbound sales communication delivery** for approved AI Sales Assistant drafts.

Key principles:
1. **Human-in-the-Loop Dispatch:** Outbound dispatch occurs strictly when an authorized user intentionally initiates sending for an already `APPROVED` sales draft.
2. **Channel Abstraction:** Deliver a unified outbound delivery interface supporting WhatsApp and Email (with voice calls deferred to a dedicated sub-phase).
3. **Contact Safety & Compliance:** Enforce the invariant `PHONE != WHATSAPP`, verify recipient trust provenance from authoritative CRM data, and fail-closed against `SuppressionList` constraints across two mandatory check gates.
4. **Reliable Asynchronous Processing:** Decouple HTTP request handling from external provider dispatch via Redis/BullMQ queues with minimal job payloads (`{ deliveryId }`), deterministic retries, idempotency, and dead-letter safety.
5. **Multi-Tenant & Data-Minimizing Architecture:** Strict tenant scoping (`organizationId`), immutable content and recipient snapshots, zero credentials or prompt leakage, and minimized audit logging.

---

## 3. Non-Goals (Explicit Exclusions)
The following capabilities are explicitly out of scope for M6:
- **Zero Automatic AI Sending:** No automated, unattended, or rule-triggered message dispatch without explicit human authorization.
- **No Unapproved Draft Dispatch:** Drafts with status `DRAFT` or `REJECTED` cannot be dispatched under any circumstances.
- **No In-Platform AI Generation Changes:** AI prompt engineering, token limits, and language/tone templating remain frozen under M5.
- **No Real-Time Voice/Telephony Automation in Core Phase:** Automated voice bots or interactive voice response (IVR) systems are excluded; call workflows represent sales call guidance/logging only.
- **No Bulk/Multi-Lead Campaign Batching in Core M6:** M6 core is strictly focused on controlled, single-lead approved outreach delivery. Multi-lead campaign batching and cold mass-blasting are prohibited. Campaign orchestration is deferred to a future dedicated milestone / future campaign phase (milestone number remains UNASSIGNED); no campaign batch execution is in scope for Steps 1–10.
- **No Direct Vendor Coupling in Domain Logic:** Core delivery services must never depend directly on vendor-specific SDKs or HTTP schemas.

---

## 4. Relationship to M5 (AI Sales Assistant)
The architecture strictly enforces the separation of concerns across the sales pipeline:

$$\text{M5: AI Draft Generation} \neq \text{M5: Human Review/Approval} \neq \text{M6: Outbound Dispatch}$$

| Phase | Milestone | Entity | Status | Responsible Actor |
|---|---|---|---|---|
| **Drafting** | M5 | `SalesAssistantDraft` | `DRAFT` | AI Provider (Mock / LLM) |
| **Review** | M5 | `SalesAssistantDraft` | `APPROVED` / `REJECTED` | Sales Manager / Admin |
| **Dispatch** | M6 | `OutreachDelivery` | `REQUESTED` $\rightarrow$ `SENT` | Authorized Sales Rep / Manager |

- M5 ends when a sales assistant draft reaches the terminal review status `APPROVED`.
- Approval does **not** send the draft.
- M6 begins when an authorized caller requests delivery of an approved draft.
- The `SalesAssistantDraft` remains immutable; transport status is tracked in a dedicated `OutreachDelivery` entity.

---

## 5. Delivery Domain Model & Immutable Snapshots
A dedicated `OutreachDelivery` entity decouples transport lifecycle tracking from content authoring and persists immutable content and recipient snapshots at request time.

### Conceptual Schema (`OutreachDelivery`)
```prisma
model OutreachDelivery {
  id                         String                 @id @default(uuid())
  organizationId             String                 @map("organization_id")
  leadId                     String                 @map("lead_id")
  draftId                    String                 @map("draft_id")
  channel                    OutreachChannel
  recipientContactId         String?                @map("recipient_contact_id")
  recipientNormalized        String                 @map("recipient_normalized")
  status                     OutreachDeliveryStatus @default(REQUESTED)
  provider                   String
  providerMessageId          String?                @map("provider_message_id")
  idempotencyKey             String                 @map("idempotency_key")
  requestedByUserId          String                 @map("requested_by_user_id")

  // Immutable content snapshot taken strictly from APPROVED draft at request time
  snapshotContent            String?                @map("snapshot_content")
  snapshotSubject            String?                @map("snapshot_subject")
  snapshotBody               String?                @map("snapshot_body")
  approvedDraftSnapshotHash  String                 @map("approved_draft_snapshot_hash")

  attemptCount               Int                    @default(0) @map("attempt_count")
  maxAttempts                Int                    @default(3) @map("max_attempts")
  queuedAt                   DateTime?              @map("queued_at")
  sentAt                     DateTime?              @map("sent_at")
  deliveredAt                DateTime?              @map("delivered_at")
  failedAt                   DateTime?              @map("failed_at")
  cancelledAt                DateTime?              @map("cancelled_at")
  lastErrorCode              String?                @map("last_error_code")
  safeLastErrorMessage       String?                @map("safe_last_error_message")
  createdAt                  DateTime               @default(now()) @map("created_at")
  updatedAt                  DateTime               @updatedAt @map("updated_at")

  organization               Organization           @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  lead                       Lead                   @relation(fields: [leadId, organizationId], references: [id, organizationId], onDelete: Cascade)
  draft                      SalesAssistantDraft    @relation(fields: [draftId, organizationId], references: [id, organizationId], onDelete: Restrict)
  requestedByUser            User                   @relation("OutreachRequestedBy", fields: [requestedByUserId, organizationId], references: [id, organizationId], onDelete: Restrict)
  recipientContact           LeadContact?           @relation(fields: [recipientContactId], references: [id], onDelete: SetNull)

  @@unique([organizationId, idempotencyKey])
  @@index([organizationId, leadId, createdAt])
  @@index([organizationId, status, createdAt])
  @@index([organizationId, channel, status])
  @@index([providerMessageId])
  @@map("outreach_deliveries")
}
```

### Worker Dispatch from Snapshot Invariant
The background worker **MUST** dispatch outbound messages using `snapshotContent` (for WhatsApp) or `snapshotSubject` / `snapshotBody` (for Email) stored on the `OutreachDelivery` record. The worker **MUST NOT** re-derive or rebuild message content from current mutable lead data, fresh AI generation, or user custom instructions.

---

## 6. Channel Model (Core Phase)
The initial core delivery channels for generic `OutreachDelivery` are strictly:

```typescript
export enum OutreachChannel {
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL'
}
```

*Note on CALL & SMS:*
- `CALL_SCRIPT` remains an M5 draft type representing sales conversation guidance for human sales representatives. Actual telephone execution and call logging are deferred to a dedicated M6 sub-phase or separate activity model, as human phone calls do not fit asynchronous `SENT`/`DELIVERED` message delivery semantics.
- `SMS` is deferred to a future milestone due to Bangladesh telco aggregator registration requirements (BTRC DLT/masking compliance).

---

## 7. Draft-to-Channel Compatibility Matrix
Delivery channels are strictly coupled to approved draft types to eliminate ambiguous content formatting:

| Draft Type (`SalesAssistantDraftType`) | Permitted Channel (`OutreachChannel`) | Rationale & Dispatch Rules |
|---|---|---|
| `WHATSAPP` | `WHATSAPP` | Conversational text formatted for WhatsApp; rejects email. |
| `EMAIL` | `EMAIL` | Requires approved `emailSubject` and `emailBody`; rejects WhatsApp. |
| `PROPOSAL` | `EMAIL` | Formatted business proposal sent via email. Sends exactly the approved proposal snapshot; does **not** append StoreMate URLs at dispatch time. |
| `FOLLOW_UP` | `WHATSAPP` or `EMAIL` | Requires **explicit caller channel selection**. Does **not** auto-default to WhatsApp. The selected channel must have a verified recipient. |
| `CALL_SCRIPT` | *Not dispatchable* | Represents sales guidance; not dispatchable through generic `OutreachDelivery`. |

Attempting to dispatch a draft over an incompatible channel is rejected at the API boundary with HTTP 422 `OUTREACH_CHANNEL_INCOMPATIBLE`.

---

## 8. Recipient Trust Rules & Contact Provenance
Destinations for outbound delivery must originate exclusively from verified CRM contact records:
1. **No Client-Supplied Destinations:** Clients cannot provide arbitrary email addresses or phone numbers in the send request. The destination must reference a valid CRM contact.
2. **Channel-Specific Provenance:**
   - **WhatsApp:** Must have `LeadContact.type === ContactType.WHATSAPP` with `status === ContactStatus.VERIFIED` or `whatsappStatus === WhatsAppStatus.PUBLICLY_LISTED / CONFIRMED`.
   - **Email:** Must have an explicit `EMAIL` contact in `LeadContact` or an approved `lead.primaryEmail` matching existing CRM contact provenance. No speculative verification states are invented.
3. **Recipient Snapshot:** The resolved normalized recipient destination (`recipientNormalized`) and `recipientContactId` are immutably persisted on `OutreachDelivery` at creation time. If the lead contact record changes later, the delivery preserves the destination snapshot that was confirmed for that dispatch.

---

## 9. Contact Safety: PHONE != WHATSAPP Invariant
The product-wide invariant `PHONE != WHATSAPP` is strictly preserved:
- A plain mobile phone number (even if valid E.164) is **never** promoted or routed to WhatsApp.
- If a lead has only a phone number and no verified WhatsApp record, WhatsApp dispatch is blocked with HTTP 422 `OUTREACH_RECIPIENT_INVALID`.
- There is no automatic fallback from WhatsApp to SMS or phone.

---

## 10. Approval-to-Send Boundary
Before any delivery record can be created or queued, the system verifies:
1. `draft.status === SalesAssistantDraftStatus.APPROVED`
2. `draft.approvedAt !== null`
3. `draft.approvedByUserId !== null`

If the draft is in `DRAFT` or `REJECTED` status, the request is rejected with HTTP 409 `OUTREACH_DRAFT_NOT_APPROVED`.

---

## 11. Delivery State Machine & Retry Architecture

### Core State Rule: Attempt Failure != Delivery Failure
A transient transport error during an attempt does **not** transition the delivery to terminal `FAILED` while retry attempts remain in the BullMQ retry budget.

```
[REQUESTED] ──> [QUEUED] ──> [PROCESSING] ──> [SENT] ──> [DELIVERED]
     │              │              │              │
     │              ▼              │              ▼
     └────────> [CANCELLED]        │           [FAILED] (bounce/drop callback)
                                   ▼
                       [QUEUED] (retry backoff)
                                   ▼
                       [FAILED] (attempts exhausted or non-retryable)
```

### State Definitions
- `REQUESTED`: Delivery record created and validated in database; awaiting queue submission.
- `QUEUED`: Stored in Redis/BullMQ job queue (initial attempt or awaiting scheduled retry backoff).
- `PROCESSING`: Worker dequeued job and is executing outbound provider transport.
- `SENT`: Upstream provider accepted message for delivery (e.g. Meta Cloud API 200 / SMTP 250).
- `DELIVERED`: Confirmed delivered to recipient device via delivery receipt webhook.
- `FAILED`: Terminal failure reached **only** when retry budget is exhausted or on a non-retryable rejection (or authoritative downstream bounce).
- `CANCELLED`: User cancelled delivery while in `REQUESTED` or `QUEUED` state.

### Allowed State Transitions
- `REQUESTED` $\rightarrow$ `QUEUED`, `CANCELLED`
- `QUEUED` $\rightarrow$ `PROCESSING`, `CANCELLED`
- `PROCESSING` $\rightarrow$ `SENT` (accepted by provider)
- `PROCESSING` $\rightarrow$ `QUEUED` (retryable error; BullMQ schedules next exponential backoff attempt)
- `PROCESSING` $\rightarrow$ `FAILED` (non-retryable error OR `attemptCount >= maxAttempts`)
- `SENT` $\rightarrow$ `DELIVERED` (authoritative success webhook)
- `SENT` $\rightarrow$ `FAILED` (authoritative downstream bounce/rejection webhook)
- Terminal States: `DELIVERED`, `FAILED`, `CANCELLED` (immutable; no further transitions allowed).

---

## 12. Content Snapshot Hash Design
To detect integrity mismatch without using ambiguous string concatenation:
1. Canonical payload structure:
   ```json
   {
     "draftId": "uuid",
     "draftType": "WHATSAPP",
     "channel": "WHATSAPP",
     "subject": null,
     "content": "...",
     "recipientNormalized": "+8801700000000"
   }
   ```
2. Compute `approvedDraftSnapshotHash`:
   $$\text{hash} = \text{SHA-256}(\text{JSON.stringify}(\text{canonicalPayload}))$$
3. Persisted in `OutreachDelivery`. The worker validates this hash before dispatch; if tampered, the job fails closed.

---

## 13. Idempotency & Intentional Resend Semantics
To guarantee duplicate-send prevention while allowing intentional subsequent outreach:
1. **Mandatory Client Idempotency Key:**
   - Every send request must supply a client-provided idempotency key (via `Idempotency-Key` HTTP header or request body).
   - Scoped by tenant: `@@unique([organizationId, idempotencyKey])`.
2. **Behavior on Matching Key:**
   - **Same Key + Same Request Parameters:** Returns HTTP 200 with existing `OutreachDeliverySummary` (idempotent no-op).
   - **Same Key + Different Request Parameters:** Returns HTTP 409 `OUTREACH_IDEMPOTENCY_KEY_REUSED`.
3. **Intentional Resend:**
   - A subsequent, intentional message dispatch to the same lead using the same approved draft requires a **new, unique idempotency key**.
4. **Worker Retry Idempotency:**
   - BullMQ worker retries operate on the **same `OutreachDelivery` record** and reuse the same stable provider request token. Retries never spawn a second `OutreachDelivery` database row.

---

## 14. Queue Architecture (BullMQ / Redis)
Outbound delivery uses BullMQ on top of established monorepo Redis infrastructure:
- **Queue Name:** `outreach-delivery` (prefixed with `REDIS_PREFIX = 'leadmate'`).
- **Job Options:**
  - `attempts: 3`
  - `backoff: { type: 'exponential', delay: 2000 }`
  - `removeOnComplete: { count: 500 }`
  - `removeOnFail: { count: 1000 }`

### Strict Payload Minimization
The BullMQ job payload is strictly:
```typescript
export interface OutreachDeliveryJobData {
  deliveryId: string;
}
```
No tenant IDs, recipient details, message bodies, or authorization secrets are duplicated into Redis.

---

## 15. Worker Execution & Database Authority Model
The background worker operates without an authenticated user session. It derives authority strictly from PostgreSQL:
1. **Load Delivery by ID:** Queries `OutreachDelivery` by `deliveryId`. If not found, drops the job.
2. **Database Relationship Verification:**
   - Verifies `delivery.organizationId === draft.organizationId === lead.organizationId`.
   - Enforces relational consistency across tenant boundaries.
3. **Atomic Processing Claim:**
   Executes conditional transition:
   ```sql
   UPDATE outreach_deliveries
   SET status = 'PROCESSING', attempt_count = attempt_count + 1
   WHERE id = :deliveryId AND status IN ('QUEUED', 'REQUESTED');
   ```
   If 0 rows updated, another worker or a cancellation won the race; exits safely.
4. **Gate B Suppression Re-Check:**
   Queries `SuppressionList` for `organizationId` and `recipientNormalized`. If suppressed between enqueue and processing, transitions to `FAILED` with `OUTREACH_RECIPIENT_SUPPRESSED` and halts.
5. **Snapshot Integrity Check:**
   Validates `approvedDraftSnapshotHash` against the stored snapshot fields.
6. **Provider Invocation Outside DB Transaction:**
   Invokes the channel provider client outside any database transaction.
7. **Result Persistence:**
   - On success: updates status to `SENT`, records `providerMessageId` and `sentAt`.
   - On retryable error: updates status back to `QUEUED`, records `lastErrorCode`, and throws error to let BullMQ manage exponential backoff.
   - On terminal error or retry budget exhausted: marks status `FAILED`.
8. **Audit Logging:** Creates authoritative audit log entry (`lead.outreach_sent` or `lead.outreach_failed`).

---

## 16. Provider Abstraction & Idempotency
All delivery providers implement a common interface:

```typescript
export interface OutreachSendResult {
  providerName: string;
  providerMessageId: string;
  acceptedAt: Date;
  status: 'SENT';
}

export interface OutreachProviderClient {
  readonly channel: OutreachChannel;
  readonly providerName: string;
  sendMessage(payload: NormalizedOutreachPayload): Promise<OutreachSendResult>;
}

export interface NormalizedOutreachPayload {
  deliveryId: string;
  providerIdempotencyKey: string;
  recipient: string;
  subject?: string;
  content: string;
}
```

*Provider Idempotency:* Where supported (e.g. Meta client token), `providerIdempotencyKey` is derived deterministically from `OutreachDelivery.id`. On worker retry, the same provider token is re-sent to prevent duplicate provider dispatch.

---

## 17. Mock Provider Strategy
Consistent with StoreMate (M4) and Sales Assistant (M5), Steps 1–8 execute with deterministic mock providers:
- `MockWhatsAppDeliveryProvider`: Simulates WhatsApp Cloud API responses with deterministic message IDs (`wamid.mock.<deliveryId>`) and configurable failure injection.
- `MockEmailDeliveryProvider`: Simulates SMTP/SES acceptance with deterministic message IDs (`<deliveryId>@mock.leadmate.internal>`).

Live provider adapters belong strictly to Step 9.

---

## 18. Error Classification & Public Error Contract

### Provider Error Classification
| Internal Error Code | Retryable? | Worker Action | Public Error Code |
|---|---|---|---|
| `PROVIDER_TIMEOUT` | Yes | BullMQ retry; back to `QUEUED` | `OUTREACH_PROVIDER_TIMEOUT` (504) |
| `PROVIDER_UNAVAILABLE` | Yes | BullMQ retry; back to `QUEUED` | `OUTREACH_PROVIDER_UNAVAILABLE` (503) |
| `PROVIDER_RATE_LIMITED` | Yes | BullMQ retry with delay | `OUTREACH_PROVIDER_RATE_LIMITED` (429) |
| `INVALID_PROVIDER_RESPONSE`| Yes | BullMQ retry | `OUTREACH_PROVIDER_BAD_GATEWAY` (502) |
| `AUTH_FAILED` | No | Mark `FAILED`; alert ops | `OUTREACH_AUTH_FAILED` (500) |
| `RECIPIENT_REJECTED` | No | Mark `FAILED` | `OUTREACH_RECIPIENT_REJECTED` (422) |
| `RECIPIENT_SUPPRESSED` | No | Mark `FAILED` | `OUTREACH_RECIPIENT_SUPPRESSED` (422) |
| `CONTENT_REJECTED` | No | Mark `FAILED` | `OUTREACH_CONTENT_REJECTED` (422) |

### Sensitive Error Storage Rule
In `OutreachDelivery`, store `lastErrorCode` and a sanitized `safeLastErrorMessage?`. Raw provider stack traces, HTTP authorization headers, internal API keys, or raw recipient payloads are strictly excluded.

---

## 19. Webhook Delivery Status Model

### Provider-Specific Verification
Webhook authenticity is verified using provider-specific protocols:
- **Meta WhatsApp:** Validates HMAC-SHA256 signature using `X-Hub-Signature-256` and the configured app secret.
- **Email Providers:** Validates provider-specific signatures (e.g. AWS SNS message signature and certificate verification; DKIM/webhook signing keys). SNS verification is **never** modeled as generic HMAC.

### Processing Pipeline
1. Verify provider signature; reject unauthenticated calls with 401/403.
2. Deduplicate event using provider event ID (`@@unique([provider, eventId])`). Duplicate callbacks return 200 OK as idempotent no-ops.
3. Locate `OutreachDelivery` via indexed `providerMessageId`.
4. Validate that the requested state transition is permissible (e.g. `SENT` $\rightarrow$ `DELIVERED`). Late callbacks for already terminal records are safely ignored.
5. Atomically update delivery status and write minimized audit log.

---

## 20. Suppression Check: Two-Gate Defense-in-Depth
Suppression list validation is enforced at two distinct gates:
1. **Gate A (API Request):** Checked prior to creating or queueing `OutreachDelivery`. If suppressed, request returns HTTP 422 `OUTREACH_RECIPIENT_SUPPRESSED` with zero database writes.
2. **Gate B (Worker Pre-Flight):** Checked immediately before calling the physical provider. If the recipient was added to the suppression list after the message was queued, the worker aborts dispatch, marks status `FAILED` (`RECIPIENT_SUPPRESSED`), and emits an audit event.

---

## 21. Cancellation Concurrency & Race Protection
- Cancellation is permitted only when status is `REQUESTED` or `QUEUED`.
- Protected by atomic conditional update:
  ```sql
  UPDATE outreach_deliveries
  SET status = 'CANCELLED', cancelled_at = NOW()
  WHERE id = :deliveryId AND status IN ('REQUESTED', 'QUEUED');
  ```
- If the worker has already claimed the job (`status = 'PROCESSING'`), cancellation fails with HTTP 409 `OUTREACH_DELIVERY_IN_FLIGHT`. Once provider dispatch has begun, cancellation cannot claim the message was unsent.

---

## 22. RBAC & Lead Assignment Rules
New permissions in `@leadmate/shared`:
- `Permissions.OUTREACH_SEND = 'outreach:send'`
- `Permissions.OUTREACH_READ = 'outreach:read'`
- `Permissions.OUTREACH_MANAGE = 'outreach:manage'`

### Role Permission Matrix
| Role | `OUTREACH_READ` | `OUTREACH_SEND` | `OUTREACH_MANAGE` | Lead Scope Constraint |
|---|---|---|---|---|
| `SUPER_ADMIN` | Yes | Yes | Yes | All leads in tenant |
| `ADMIN` | Yes | Yes | Yes | All leads in tenant |
| `SALES_MANAGER` | Yes | Yes | Yes | All leads in tenant |
| `SALES_EXECUTIVE` | Yes | Yes | No | **Assigned leads only** (`lead.assignedUserId === authenticatedUser.id`) |
| `VIEWER` | Yes | No | No | Read-only delivery history |

*Sales Executive Rule:* A Sales Executive can only initiate outreach for leads explicitly assigned to them. Attempting to dispatch to an unassigned lead or a lead assigned to a peer returns HTTP 403 `FORBIDDEN`.

---

## 23. API Contract Proposal
Mounted under `apps/api/src/routes/lead.routes.ts`:

1. `POST /api/v1/leads/:id/outreach`
   - Header: `Idempotency-Key: string` (required)
   - Guarded by: `requireAuth`, `requirePermission(Permissions.OUTREACH_SEND)`
   - Body:
     ```json
     {
       "draftId": "uuid",
       "channel": "WHATSAPP",
       "recipientContactId": "uuid (optional)"
     }
     ```
   - Response: HTTP 201 (Created) / HTTP 200 (Idempotent replay) with `OutreachDeliverySummary`.

2. `GET /api/v1/leads/:id/outreach`
   - Lists delivery history for the lead.
   - Guarded by: `requirePermission(Permissions.OUTREACH_READ)`.

3. `GET /api/v1/leads/:id/outreach/:deliveryId`
   - Retrieves single delivery status.
   - Guarded by: `requirePermission(Permissions.OUTREACH_READ)`.

4. `POST /api/v1/leads/:id/outreach/:deliveryId/cancel`
   - Cancels a queued delivery.
   - Guarded by: `requirePermission(Permissions.OUTREACH_MANAGE)`.

---

## 24. Audit Model
Authoritative audit actions (`entityType: 'OutreachDelivery'`):
- `lead.outreach_requested`
- `lead.outreach_queued`
- `lead.outreach_sent`
- `lead.outreach_delivered`
- `lead.outreach_failed`
- `lead.outreach_cancelled`

### Audit Minimization
Audit metadata records only entity IDs, channel, masked recipient (e.g. `+8801700****00`), provider name, attempt counts, and error codes. Message bodies, prompts, authorization headers, and raw vendor payloads are strictly excluded.

---

## 25. Rate Limiting & Concurrency Controls
1. **User Endpoint Limiting:** Express rate limiter on `POST /leads/:id/outreach` (20 requests / 60s per user) returning 429 `RATE_LIMITED`.
2. **Provider Limiting:** Upstream provider rate limits return 429 `OUTREACH_PROVIDER_RATE_LIMITED`.
3. **Single Active Delivery Per Draft:** Conditional lock prevents duplicate active queued deliveries for the same draft.

---

## 26. Lead Detail UI Workflow & Confirmation UX
In `SalesAssistantCard` on `/leads/[id]`:
1. When a draft reaches `APPROVED` status, the **Outreach Delivery** action becomes available to authorized users.
2. Clicking "Send" displays an accessible, non-native confirmation dialog:
   - Displays selected channel and verified recipient contact badge.
   - Previews approved draft content snapshot.
   - Displays suppression verification checkmark.
   - Prominent confirmation warning: *"This will dispatch a real outbound message to the recipient."*
   - Explicit "Send Message" and "Cancel" buttons.
3. Delivery status badges: `Queued`, `Processing`, `Sent`, `Delivered`, `Failed`, `Cancelled`.

---

## 27. Security Threat Model

| Threat | Impact | Architectural Mitigation |
|---|---|---|
| **Duplicate Send** | Recipient receives repeated sales messages | Idempotency keys + unique DB constraint `[organizationId, idempotencyKey]`. |
| **Cross-Tenant Send** | Org A dispatches message to Org B lead | Tenant isolation on all queries (`organizationId` from server session); composite FKs. |
| **Cross-Lead Draft Misuse** | Draft for Lead A sent to Lead B | Query validation requires `draft.leadId === leadId`. |
| **Unapproved Draft Send** | Raw AI draft sent to client | Service enforces `draft.status === APPROVED` before delivery creation. |
| **Suppressed Recipient Send** | Contacted after opt-out | Two-gate suppression checks (at API request time and immediately before worker send). |
| **PHONE != WHATSAPP Bypass** | WhatsApp sent to landline/voice mobile | Contact provenance check requires explicit verified `WHATSAPP` contact. |
| **Tampered Content Send** | Modified message sent after approval | Dispatch uses immutable `snapshotContent`; validated via `approvedDraftSnapshotHash`. |
| **Provider Credential Leakage** | External API keys exposed | Server-side environment variables only; zero exposure in DTOs, logs, or UI. |
| **Webhook Forgery** | Attacker simulates delivery receipts | Cryptographic provider-specific signature verification on inbound webhooks. |
| **Audit PII Exposure** | Sensitive messages stored in audit log | Audit metadata minimization (IDs, channels, and masked recipients only). |

---

## 28. Phased Integration Boundaries
- **Core M6 Phase (Steps 1–8):** Controlled single-lead approved delivery, internal delivery entity, BullMQ worker, two-gate suppression, RBAC, single-lead API, UI confirmation flow, and deterministic mock providers (`MockWhatsAppDeliveryProvider`, `MockEmailDeliveryProvider`).
- **Live Provider Phase (Step 9):** Live Meta WhatsApp Cloud API adapter integration with mandatory provider-specific verification (contract tests, signature verification, safe error translation, timeout/rate-limit resilience, credential leak tests, and adapter parity). Live email adapter remains provider-neutral pending vendor selection.
- **Bulk Campaign Orchestration (Deferred):** Multi-lead bulk campaign batching and campaign execution are strictly deferred from M6 Steps 1–10. Any future campaign capabilities belong to a future dedicated milestone / future campaign phase (milestone number remains UNASSIGNED). Note: Existing project roadmap reserves Milestone M7 for Team Management + Sales Dashboard + Analytics.
- **Telephony Phase (Deferred Post-M6):** Live voice calling workflows.

---

## 29. Architecture Decision Matrix

| Area | Chosen Decision | Rationale | Deferred Item |
|---|---|---|---|
| **Delivery Entity** | Separate `OutreachDelivery` entity | Keeps `SalesAssistantDraft` immutable; isolates transport states. | None |
| **Approval Boundary** | Strict human approval required | Safety & compliance; AI output is never sent directly. | None |
| **Send Action** | Explicit user action (`POST /leads/:id/outreach`) | Clear separation between approval and dispatch. | None |
| **Content Snapshot** | Immutable snapshot on `OutreachDelivery` | Worker sends from snapshot; prevents post-approval tampering. | None |
| **Snapshot Hash** | Canonical JSON SHA-256 hash | Integrity verification; detects any DB tampering. | None |
| **Recipient Snapshot** | Resolved & normalized at request | Confirms trusted CRM provenance; protects against contact edits. | None |
| **Idempotency Key** | Mandatory client `Idempotency-Key` header | Prevents accidental duplicate sends while allowing intentional resends. | None |
| **Queue Payload** | `{ deliveryId }` only | Minimizes Redis memory; enforces DB as authoritative state source. | None |
| **Worker Authority** | DB relation checks; no caller session | Worker derives authority strictly from stored DB entity. | None |
| **Core Channels** | `WHATSAPP` & `EMAIL` | Asynchronous message channels fitting `SENT`/`DELIVERED`. | `CALL` deferred to dedicated phase |
| **FOLLOW_UP** | Explicit channel selection required | Eliminates ambiguous automated channel guessing. | None |
| **PROPOSAL** | Sends approved snapshot; no StoreMate append | Content must not mutate after human approval. | None |
| **Sales Rep Scope** | Assigned leads only (`assignedUserId === user.id`) | Enforces CRM ownership and representative accountability. | None |
| **Provider Strategy** | Mock providers first; Meta Cloud API in Step 9 with full verification | Enables 100% offline testability in Steps 1–8; Step 9 requires provider-specific contract/webhook/leak tests before closure. | Live Email provider TBD |
| **Suppression** | Two-gate check (API + Worker) | Fails closed if recipient opts out between queue and send. | None |
| **Cancellation** | Conditional atomic update on `QUEUED` | Eliminates race between user cancel and worker claim. | None |
| **Transaction Boundary** | Provider call outside DB transaction | Prevents database connection pool starvation during HTTP calls. | None |
| **Webhooks** | Provider-specific signature verification | Meta HMAC / AWS SNS protocol verification (not generic HMAC). | None |
| **Bulk Campaigns** | Deferred to future campaign milestone | Keeps M6 focused on controlled single-lead approved delivery; preserves M7 for Team Management + Sales Dashboard + Analytics. | Multi-lead campaign batching (milestone unassigned) |

---

## 30. Step 0 Architecture Phase + Steps 1–10 Implementation/Closure Roadmap

- **M6 Step 0 (Architecture & Scope Freeze):** Architecture blueprint, domain models, state machine, safety boundaries, and documentation (Current).
- **M6 Step 1 (Shared Outreach Contracts & Permissions):** Zod schemas, enums (`OutreachChannel`, `OutreachDeliveryStatus`), and RBAC permissions (`OUTREACH_SEND`, `OUTREACH_READ`, `OUTREACH_MANAGE`) in `@leadmate/shared`.
- **M6 Step 2 (Outreach Delivery Persistence & Migration):** `OutreachDelivery` Prisma model, composite multi-tenant foreign keys, and PostgreSQL migration in `@leadmate/db`.
- **M6 Step 3 (Provider Abstraction & Deterministic Mock Providers):** `OutreachProviderClient` interface and deterministic `MockWhatsAppDeliveryProvider` / `MockEmailDeliveryProvider` in `@leadmate/core`.
- **M6 Step 4 (Outreach Domain Service, Suppression Guard & BullMQ Queue):** `OutreachService` in `apps/api`, two-gate suppression check, idempotency enforcement, and `outreach-delivery` BullMQ queue in `apps/worker`.
- **M6 Step 5 (Outreach REST API, RBAC & Audit Logging):** Express routes (`/leads/:id/outreach`), controller validation, tenant scoping, and authoritative audit logging in `apps/api`.
- **M6 Step 6 (Lead Detail Outreach Delivery UI & Confirmation UX):** Outreach card component, confirmation dialog UX, status badges, and error display on `/leads/[id]` in `apps/web`.
- **M6 Step 7 (Worker Execution, Retry, Cancellation & Webhook Processing):** Asynchronous BullMQ worker dispatch, exponential retry backoff, atomic cancellation claim, and signature-verified webhook endpoints.
- **M6 Step 8 (Comprehensive E2E, Security & Idempotency Hardening):** Full lifecycle tests, tenant isolation, concurrent send race prevention, anti-tampering, and error contract tests against core/mock architecture.
- **M6 Step 9 (Live Provider Adapter Integration & Provider-Specific Verification):** Meta WhatsApp Cloud API adapter integration behind provider interfaces. Must include comprehensive provider-specific verification: live/mock adapter parity checks, provider contract tests, cryptographic signature/webhook verification tests, safe error translation tests, network timeout/rate-limit tests, and credential leakage defense tests. Step 9 must NOT introduce a live provider without complete provider-specific verification prior to milestone closure.
- **M6 Step 10 (Milestone Review & Closure):** Final audit, regression baselines, documentation freeze, and milestone signoff.

---

## 31. Remaining Open Product Questions
1. **Live Email Provider Selection:** Which live email infrastructure will be chosen for production: AWS SES, SendGrid, Resend, or direct SMTP? *(Deferred to Step 9 vendor selection).*
2. **Organization-Level Daily Dispatch Quotas:** What are the exact default daily/hourly rate caps per tenant to prevent outbound spam or sudden Meta API cost spikes? *(Can be configured in Step 4 environment settings).*
3. **Bulk Campaign Orchestration Boundary:** Bulk campaign orchestration is frozen as out of scope for M6 core (which focuses strictly on controlled single-lead approved delivery). When planned, bulk campaign capabilities belong to a future dedicated milestone / campaign phase whose milestone number remains unassigned, preserving M7 for Team Management + Sales Dashboard + Analytics.
