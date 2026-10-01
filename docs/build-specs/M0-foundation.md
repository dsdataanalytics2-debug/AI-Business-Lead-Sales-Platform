# Milestone M0: Foundation — Build Spec (Final Approved)

## 1. Goal
Establish a running npm workspaces monorepo skeleton with authentication, RBAC, PostgreSQL via Prisma (with server-side `Session` storage using SHA-256 token hashing), BullMQ worker queue via Redis, cross-platform diagnostics (`npm run doctor`), IP-based login rate limiting, centralized error handling, test DB safety guard, GitHub Actions CI workflow, and automated tests.

---

## 2. Referenced Guide & PRD Sections
- **Master Prompt:** Section 0 (Session Protocol), Section 2 (Hard Rules), Section 2.4 (Explicit Auth Sign-off), Section 6 (Milestone Map), Playbook 5.A / 5.C
- **Environment:** `ENVIRONMENT.md` (npm only, no Docker, Redis direct, PostgreSQL direct, Windows cross-platform, test DB `*_test` guard)
- **Build Guide:** Section 3 (Tech Stack & Conventions), Section 4 (Domain Model), Section 6 (API Surface: `/auth`, `/users`, `/health`), Section 8 (M0 Acceptance Criteria), Section 11.1 (Decided Defaults: argon2id, 7-day session)
- **PRD v1.1:** Section 24 (RBAC), Section 27 (Data Model Skeleton), Section 34 (Phase 0), Section 37 (Security)

---

## 3. In Scope

### 3.1 Monorepo & Environment Tooling
- Root `package.json` with npm workspaces (`apps/*`, `packages/*`).
- Workspaces: `apps/web`, `apps/api`, `apps/worker`, `packages/core`, `packages/db`, `packages/shared`, `packages/datasources`, `packages/ai`, `packages/storemate`.
- `.env.example` with `DATABASE_URL`, `DATABASE_URL_TEST`, `REDIS_URL`, `REDIS_URL_TEST`, `REDIS_KEY_PREFIX`, `SESSION_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD`.
- `.gitattributes` (`* text=auto eol=lf`), `.gitignore`, `.nvmrc` (`24.19.0`).
- Cross-platform `scripts/doctor.mjs` verifying Node LTS version, env vars, Postgres connection, Redis connection, and BullMQ expectations.
- Test runner safety guard: tests abort immediately if `DATABASE_URL_TEST` database name does not end with `_test`.

### 3.2 Database & ORM (`packages/db`)
- Prisma schema with initial models:
  - `Organization` (multi-tenant ready, timezone `Asia/Dhaka`, working hours)
  - `User` (email, passwordHash, role, isActive)
  - `Session` (server-side session storage: `id`, `userId`, `tokenHash` `@unique`, `expiresAt`, `ipAddress`, `userAgent`, `createdAt`, `updatedAt`)
  - `AuditLog` (action, entityType, entityId, before, after, ip, userId)
  - `Notification` (userId, type, payload, readAt)
  - `DataSourceConfig` (skeleton table)
  - `SuppressionList` (skeleton table)
  - `UsageLedger` (skeleton table)
- Seed script (`prisma/seed.ts`): creates default Organization and Super Admin user with Argon2id hashed password from environment variables.
- Verification: `prisma generate`, `prisma validate`, and applying the initial migration to the development database without destructive resets.

### 3.3 Shared Definitions (`packages/shared`)
- Zod schemas: auth (`loginSchema`, `userCreateSchema`, `userUpdateSchema`, pagination schemas).
- Enums: `Role`, `ContactType`, `PhoneType`, `ContactStatus`, `WhatsAppStatus`, `WebsiteStatus`, `OnlinePresenceType`, `CrmStage`, `JobStatus`, `DemoStatus`, `DataSourceStatus`, `SuppressionType`, `SuppressionReason`, `ChannelScope`, `Priority`.
- Error codes: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `SUPPRESSED_CONTACT`, `SOURCE_NOT_APPROVED`, `BUDGET_EXCEEDED`, `RATE_LIMITED`, `EXTERNAL_SERVICE_ERROR`, `INTERNAL_ERROR`.
- Standard API error structure:
  ```json
  { "error": { "code": "...", "message": "...", "details": {}, "requestId": "..." } }
  ```
- Granular permission constants and role-to-permission mapping (`SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_EXECUTIVE`, `VIEWER`).

### 3.4 Backend REST API (`apps/api`) & AUTH Specifications (Approved per 2.4)
- **AUTH Specifications:**
  - Password Hashing: `argon2id` via `argon2` npm library.
  - Session Token Generation & Storage:
    - On login, generate a cryptographically random raw token (32 bytes hex/base64url).
    - Send the raw token **only** in the httpOnly cookie.
    - Compute the SHA-256 hash of the raw token (`tokenHash`) and store only `tokenHash` in the PostgreSQL `Session` table.
    - On incoming requests, compute SHA-256 of the cookie's token and match against `Session.tokenHash`.
  - Session Cookie: Name `leadmate_session`, `httpOnly: true`, `SameSite: "lax"`, `secure: process.env.NODE_ENV === "production"`, `path: "/"`, 7-day sliding expiration.
  - Login Rate Limiting (M0 Simplified):
    - Applied to all `POST /api/v1/auth/login` attempts.
    - Max **5 attempts per 15 minutes** per IP.
    - Exceeded response returns HTTP 429 with standard project error code `RATE_LIMITED`.
  - RBAC Middleware: Verifies authenticated user session, checks permissions against role mapping, returns standard `401 UNAUTHENTICATED` or `403 FORBIDDEN`.
- **API Middleware & Routes:**
  - Pino logger + Request ID middleware (`X-Request-Id`).
  - Centralized error-handling middleware matching standard project error JSON.
  - Auth routes: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.
  - User routes: `GET /api/v1/users`, `POST /api/v1/users`, `GET /api/v1/users/:id`, `PATCH /api/v1/users/:id`.
  - Health check: `GET /health` and `GET /api/v1/health` (checks Postgres and Redis connectivity).

### 3.5 Worker Queue (`apps/worker`)
- BullMQ worker connected to Redis (`REDIS_URL`) with key prefix `leadmate`.
- Worker connection configured with `maxRetriesPerRequest: null`.
- `maintenance` queue with health check job processor.
- Fails fast with clear log if Redis is unreachable at startup.

### 3.6 Web Frontend Skeleton (`apps/web`)
- Next.js (App Router) + Tailwind CSS.
- Auth context / API client with credentials support.
- `/login` screen (with validation and error feedback) and `/dashboard` skeleton.

### 3.7 Empty Package Skeletons
- `packages/datasources`, `packages/ai`, `packages/storemate`, `packages/core` created as clean workspace packages with `package.json` and empty exports. No logic or adapters until their respective milestones.

### 3.8 CI Workflow
- `.github/workflows/ci.yml`: GitHub Actions workflow running on push and PRs:
  - Setup Node.js LTS
  - `npm ci`
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`

---

## 4. Out of Scope (Deliberately Deferred)
- Lead collection, scrapers, data adapters (M1 / M2).
- Website audits (M4).
- AI analysis and LLM calls (M5).
- StoreMate client calls (M7).
- Real billing / payment gateways (Post-MVP).

---

## 5. Acceptance Criteria
1. `npm run doctor` passes for Node LTS, env variables, Postgres, and Redis.
2. Database migrations apply cleanly (`prisma generate`, `prisma validate`, `prisma migrate dev`); `npm run db:seed` seeds default Organization and Super Admin user with argon2id hash without destructive resets.
3. Server-side session generates raw token for cookie and stores SHA-256 `tokenHash` in `Session` table; raw token is never persisted.
4. `GET /api/v1/auth/me` validates session via SHA-256 hash lookup and returns user info with permissions; invalid/expired session returns 401.
5. Login rate limiter triggers 429 `RATE_LIMITED` after 5 attempts per 15 minutes per IP.
6. RBAC middleware denies unauthorized routes with 403 `FORBIDDEN`.
7. `GET /api/v1/health` returns status of API, database, and Redis.
8. Enqueued BullMQ maintenance job completes in worker.
9. Integration tests verify test DB safety guard (refuses to run against non-`*_test` DB).
10. `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` execute cleanly with zero errors across all workspaces.
