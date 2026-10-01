# LeadMate — MASTER PROMPT

> **Every AI agent (Codex, Claude Code, Cursor, any other) MUST read this file first, before doing anything else — whatever the task is.**
> This file tells you what to read, what rules never bend, and which playbook to follow for each kind of task.

---

## 0. Session Start Protocol (do this every session, in order)

1. **Read, in this order:**
   1. `master-prompt.md` (this file)
   2. `LEADMATE_AI_BUILD_GUIDE.md` — stack, data model, core logic, milestones, acceptance criteria. **Implementation source of truth.**
   3. `docs/prd/AI_Business_Lead_Sales_Platform_PRD_v1.1.md` — product reasoning and background. If it conflicts with the Build Guide, the Build Guide wins; flag the conflict.
   4. `docs/progress.md` — current milestone, what is done, what is next. (Create it if missing, using the template in section 9.)
   5. `docs/decisions.md` — decisions already made. Do not reopen them without asking.
   6. `CLAUDE.md` / `AGENTS.md` if present (generated project notes).
2. **Reply with a 5-line status** before any work:
   - Current milestone (from `docs/progress.md`)
   - What you understand the task to be
   - Which playbook (section 5) you will use
   - Any `BLOCKED-ON-HUMAN` items that affect this task
   - Your first step
3. **Do not write code** until a plan exists for any non-trivial task (see 4.2).
4. If a file you are told to read does not exist, say so and continue with the rest; do not invent its contents.

---

## 1. What This Project Is

LeadMate is an internal, Bangladesh-first web platform that discovers business leads, enriches **business** contact data from permitted sources (tracking the source of every value), analyzes websites/online presence, scores leads per campaign type, manages the sales CRM, and generates safe one-click StoreMate demo websites. AI finds and analyzes opportunities; humans sell. **No automatic outbound messaging in v1.**

**Stack (verify exact versions in `package.json` / lockfile before relying on them):** pnpm monorepo · TypeScript (strict) · Next.js (App Router) + Tailwind + TanStack Query · Node.js + Express REST (`/api/v1`) · PostgreSQL + Prisma · Redis + BullMQ · Zod · Vitest + Supertest + Playwright · pino · Docker Compose for local services.

**Commands (the repo must provide these; if missing, create them in M0):**

| Purpose | Command |
|---|---|
| Install | `pnpm install` |
| Dev (web + api + worker) | `pnpm dev` |
| Build | `pnpm build` |
| Test | `pnpm test` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Local services | `docker compose up -d` |
| DB migrate (dev) | `pnpm db:migrate` |
| DB seed | `pnpm db:seed` |

---

## 2. Hard Rules — Non-Negotiable

Violating any of these is a failure, even if the user's request seems to allow it. If a request conflicts with a rule, **stop and say so**.

### 2.1 Data, compliance, outreach
1. Never label a phone number as WhatsApp without stored evidence (`evidenceType` + `evidenceUrl`).
2. Check the `SuppressionList` before: draft generation, demo generation, CRM moves to outreach stages, and "outreach" exports. Blocked actions return `409 SUPPRESSED_CONTACT`.
3. Fetch external data **only** through a `DataSourceAdapter`, and external URLs **only** through `safeFetch` (SSRF-protected).
4. Never enable a data source that is not `APPROVED` outside development. Never hardcode provider terms, prices, or quotas.
5. Never scrape in violation of a site's terms, use login-based scraping, or bypass access controls. Facebook/Instagram data only via authorized API, links on an official business site, or manual input.
6. Store business/public contact data only — never harvested private personal data.
7. **No code path may send WhatsApp/email/SMS automatically.** Drafts only.
8. Every demo carries `DEMO — NOT OFFICIAL`, `noindex,nofollow` (meta + `X-Robots-Tag`), an unguessable URL, and an expiry.
9. Never invent: data sources, StoreMate API details, provider terms, legal claims, business facts. Use mocks and mark `BLOCKED-ON-HUMAN`.

### 2.2 Engineering
10. Business logic goes in `packages/core` as pure, unit-tested functions. Controllers and workers stay thin.
11. No LLM for dedupe, phone normalization, filtering, scoring, or status rules.
12. Jobs are idempotent and retry-safe. No long-running work inside HTTP requests.
13. Every paid/quota-limited external call writes a `UsageLedger` row. Every important action writes an `AuditLog` row.
14. RBAC is enforced on the backend for every route.
15. Never put secrets in code, logs, config files, or the frontend. Use env vars; add names to `.env.example`, never real values.
16. Validate all input with Zod; sanitize imported data.
17. Never weaken or delete a test to make it pass. Fix the code or report the problem.
18. Stay inside the current milestone. Do not add features "while you're there".

### 2.3 Protected paths — never modify without explicit approval
- `docs/prd/**`, `LEADMATE_AI_BUILD_GUIDE.md`, `master-prompt.md` (ask first; propose a diff)
- `packages/db/prisma/migrations/**` (applied migrations are immutable; add a new migration instead)
- `.env`, `.env.*` (except `.env.example`), any secrets/credentials files
- Production/deployment config and CI secrets
- `docs/data-source-matrix.md` status/terms fields and `docs/storemate-api-contract.md` (human-owned)

### 2.4 Requires my explicit sign-off before you touch it
- **AUTH:** login, sessions, password handling, RBAC permission model
- **PAYMENTS / BILLING:** any payment, billing, bKash/Nagad code (post-MVP; do not start)
- **PROD DATA:** anything that reads/writes/deletes real production data, or destructive migrations
- Suppression logic, WhatsApp-status logic, demo safety policy, scoring-profile semantics
- Adding a new data source adapter or a new external dependency/service

---

## 3. Ground Rules For How You Work

- **Ask, don't invent.** If a rule, requirement, or fact is unclear, ask one precise question. Use the defaults in Build Guide section 11 only where the guide says a default exists.
- **Evidence, not vibes.** For bugs and claims about the code, show the file/line or the test output.
- **Small verifiable steps.** The app compiles, lints, and tests pass after every step.
- **Short imperative notes.** Keep docs you write terse and specific to this repo.
- **Language:** talk to the human in the language they use (they often write Bangla); write code, comments, commit messages, and docs in English. Bangla *content* features (drafts, demo copy) follow Build Guide section 5.15 and need human review.
- **Never claim "done" without proof:** run `pnpm lint && pnpm typecheck && pnpm test` and show results.
- **Report format** at the end of every task is in Build Guide section 9.2.

---

## 4. Choosing The Right Mode

### 4.1 Task size
- **Trivial** (≤ ~20 lines, one file, no behavior/schema/API change): do it, run checks, report.
- **Anything else:** use the playbooks below, starting with **Plan mode (5.A)**.

### 4.2 Default flow for non-trivial work
`Spec (5.B) → Plan (5.A) → Build sequence (5.C) → implement one step at a time → verify → commit (5.L) → update docs/progress.md`

Wait for my "go"/approval at: spec approved, plan approved, and between build steps when I ask for step-by-step.

---

## 5. Playbooks

Each playbook is a ready prompt. When I name one (e.g. "use playbook 5.A for …"), follow it exactly. When I give a task without naming one, pick the matching one and say which.

### 5.A Plan Mode (no code yet)

> Enter plan mode. **Do NOT write any code yet.**
> **Task:** [what I asked]  **Constraints:** current milestone scope; protected paths (2.3); sign-off areas (2.4); deadline if I state one.
> 1. Read every file this task touches; list them with one line on what each does today.
> 2. Map current behavior vs target behavior.
> 3. Propose 2–3 approaches with real tradeoffs: complexity, risk, blast radius.
> 4. Pick one and justify it in 3 lines.
> 5. Break it into steps small enough to verify one at a time, each with its own check.
> 6. List risks and the exact rollback for each.
> 7. Flag anything touching AUTH / PAYMENTS / PROD DATA (2.4) for my explicit sign-off.
> Then stop. Show the plan and wait for my approval before touching any file.

### 5.B Spec First

> We build specs first. Write a spec for: **[feature]**. Context: who uses it + why now (from the PRD/Build Guide).
> Spec format:
> - **Behavior:** given / when / then — happy path, edge cases, failure states
> - **API contract:** inputs, outputs, error shapes (use the project error format), status codes, required permission
> - **Data:** schema changes + migrations needed
> - **UI states:** loading, empty, error, success
> - **Non-goals:** what this spec deliberately skips
> - **Acceptance checklist** I can verify line by line
>
> Save as `docs/build-specs/<id>-<name>.md`. After I approve, implement **exactly** the spec. If reality forces a deviation: stop, update the spec, get my OK, continue. The spec is the source of truth, not the code.

### 5.C Implementation Plan (build sequence)

> Create an implementation plan for: **[approved spec / milestone]**.
> - Sequence steps so the app compiles and runs after **every** step.
> - Each step: files touched, what changes, how I verify it works.
> - Flag steps needing a migration or a new dependency.
> - Put the riskiest unknowns first.
> - Size each step: S / M / L.
> Output a numbered build sequence I can run one step at a time. Wait for my "go" between steps.

### 5.D Feature PRD

> Write a PRD for the feature below. **Feature:** [..] **Users:** Admin / Sales Manager / Sales Executive / Viewer (as relevant) **Stack:** section 1.
> Include: problem statement + success metrics · user stories with acceptance criteria · scope (what ships in v1, what does not) · data model changes · edge cases + failure states · open questions for me to answer.
> Under 2 pages. Specific, no filler. Save as `docs/prd-<feature>.md`. Reference the Build Guide instead of repeating it.

### 5.E UI/UX Design Brief

> Create a UI/UX design brief for: **[screen or flow]**.
> **Audience:** internal salespeople and managers in Bangladesh, working fast through lists of leads; many are on mid-range laptops, some on mobile; content may contain Bangla Unicode.
> **Brand:** clean, calm, data-dense B2B dashboard — neutral palette with one accent colour, system/Inter + a Bangla-capable font (e.g. Noto Sans Bengali). *(Confirm brand with me before finalizing.)*
> Deliver: step-by-step user journey · layout per screen (hierarchy, spacing, breakpoints) · component inventory with every state (hover, empty, error, loading) · typography + colour tokens · motion (what animates, duration, easing) · accessibility notes.
> Study patterns from 2–3 products I name (or suggest well-known CRM/lead tools). Never copy them.
> Mandatory UI rules: contacts always show value + status + source + `fetchedAt`; WhatsApp status badge + evidence link; detected facts visually separate from AI interpretation; suppressed-lead banner disables outreach buttons; Bangla AI content shows "Needs review".

### 5.F Database Connection / Schema Work

> Connect/extend the database (PostgreSQL via Prisma).
> - Env vars: name them, add to `.env.example`, never commit real values.
> - Schema per Build Guide section 4: types, relations, and indexes for the hot queries (lead list filters, contact lookup by `normalizedValue`, suppression lookup, job idempotency keys).
> - Create and run migrations; show the rollback for each one. Never edit an applied migration.
> - One typed query helper/repository per table — no raw SQL scattered through routes or components.
> - Row-level isolation by `organizationId` on every query (keeps multi-tenant possible later).
> - Connection pooling settings documented.
> - Prove it: seed one row, read it back, show me the output.

### 5.G MCP Server Wiring

> Wire up an MCP server for: **[service/API]**. Jobs to be done: **[..]**.
> 1. Check for an official or well-maintained existing server first — name your source.
> 2. If one exists: exact install command + `.mcp.json` config, scoped to this project.
> 3. If not: scaffold one with the MCP SDK — tools, auth, error handling, typed responses.
> 4. Add only the tools I will actually use: **[list]**.
> 5. Secrets via env vars; never hardcode keys in config.
> 6. Verify the connection and call one tool end to end; show the output.
> 7. Document each tool in one line so future sessions know when to reach for it.
> *(Adding any MCP/external dependency needs my sign-off — 2.4.)*

### 5.H Security Audit

> Audit this codebase for security gaps. Attack it like you want in.
> **Focus:** AUTH, user/lead/contact data, SSRF in `safeFetch`, demo content, CSV import, export.
> Check: secrets in code/config/git history · injection (SQL, XSS, command, path traversal) · auth (routes missing checks, weak sessions, broken redirects) · **IDOR** (can user A read user B's leads? sales executives must only see assigned leads) · file uploads + input validation on every form · dependency CVEs (run the audit, read it) · rate limiting on expensive endpoints (`/auth/login`, `/search-jobs`, `/ai-analysis`, `/drafts`, `/demos`, `/leads/export`) · what leaks through error messages and logs · RBAC on every backend route.
> Rank findings by severity with exact file:line, fix the critical ones now (after sign-off if they touch AUTH), and list the rest as tickets with effort estimates.

### 5.I Debugging

> Debug this error. **Do NOT guess.** Error: [full error + stack trace]. When it happens: [steps to reproduce].
> 1. Read the stack trace; open the exact files involved.
> 2. State expected vs actual behavior in 1 line.
> 3. List 3 hypotheses, ranked by likelihood.
> 4. Prove or kill each with logs or a tiny test — evidence, not vibes.
> 5. Fix the root cause, not the symptom.
> 6. Search the repo for the same pattern; if it can break here, it breaks elsewhere.
> 7. Add a regression test that fails without the fix.
> 8. Tell me in 2 lines why it broke and why it cannot break this way again.

### 5.J Playwright E2E Tests

> Write Playwright E2E tests for: **[flow]**. Stack: section 1. CI: GitHub Actions.
> - Money paths first: **login → discover (mock source) → lead list → lead detail → change CRM stage → generate demo (mock StoreMate)**.
> - Test what the user sees, not implementation details. Selectors: roles and labels, never brittle CSS chains.
> - One unhappy path per flow: bad input, network failure, expired session, **suppressed contact blocked**.
> - Tests are independent — any order, zero shared state, each seeds its own data.
> - Headless in CI, headed locally. Screenshots + traces on failure only.
> Run the suite, show results, fix what fails, and tell me what the suite still does NOT cover.

### 5.K Dead Code Cleanup

> Find and delete dead code. **Scope:** [whole repo / folder].
> Unused exports/components/hooks/utils · unreachable branches + commented-out blocks · `package.json` dependencies nothing imports · stale feature flags · duplicate logic that should merge · dead CSS + unused assets.
> Verify with a search before **every** deletion (dynamic imports and string references count). Never delete adapters, migrations, or compliance code just because they look unused. Delete in small commits; run `pnpm build && pnpm test` after each; report total lines removed and anything you were not 100% sure about.

### 5.L Commit Workflow

> Commit my staged changes properly. **Convention:** Conventional Commits.
> - Split unrelated changes into separate commits.
> - Format: `type(scope): what changed and why` — feat / fix / refactor / chore / docs / test.
> - Subject under 50 chars, imperative mood. Body explains the WHY, wrapped at 72.
> - Reference the milestone/ticket (e.g. `M2-03`).
> - Never mix a refactor with a behavior change.
> - Never commit secrets, `.env`, or generated files.
> Show the plan (files per commit + messages) **before** committing. Then commit one at a time so I can stop you.

### 5.M Claude Code Hooks (guardrails)

> Set up Claude Code hooks as guardrails. Stack: pnpm monorepo.
> - **PostToolUse:** run `pnpm lint && pnpm typecheck` after every file edit; feed errors straight back.
> - **PreToolUse:** block edits to protected paths (2.3): applied migrations, `.env*`, `docs/prd/**`, prod config.
> - **Stop:** run `pnpm test` before a session ends.
> - **Notification:** ping me when my input is needed.
> Write the hook scripts + `settings.json` entries. Each script < 20 lines; exit non-zero with a clear message so the agent knows exactly what to fix. Trigger each hook on purpose and show it firing.

### 5.N Turn A Repetitive Task Into A Skill

> Turn this repetitive task into a Claude Code skill. **Task:** [describe + steps].
> - Create `.claude/skills/<name>/SKILL.md`.
> - Frontmatter: name + description with the exact trigger phrases I actually say.
> - Body: numbered workflow, my conventions, edge cases; what to ask me vs infer; what "done" looks like.
> - Dry-run on a real example and refine until the output matches how I do it by hand.
>
> **Suggested skills for this repo:** `add-data-source-adapter`, `add-scoring-signal`, `add-api-endpoint` (route + Zod + RBAC + audit + test), `new-milestone-spec`.

### 5.O Generate / Refresh `CLAUDE.md` (and `AGENTS.md`)

> Scan this entire codebase, then generate/update `CLAUDE.md` (and a short `AGENTS.md` pointing to it).
> Include: what the project is in 2 lines · tech stack + versions that matter · commands (section 1) · architecture: where things live and why · code conventions you **actually detect** · hard rules (point to `master-prompt.md` section 2; add only repo-specific ones) · gotchas a new engineer would hit in week 1.
> Short imperative rules. Nothing generic — only what is true for THIS repo. If unsure about a rule, **ask me instead of inventing it.** Always begin the file with: *"Read `master-prompt.md` first."*
> *(Run this after M0, after each milestone, and whenever structure changes. Before M0 there is no code — create only the pointer file.)*

---

## 6. Milestone Map (details in Build Guide section 8)

| ID | Milestone |
|---|---|
| M0 | Foundation (monorepo, auth, RBAC, DB, queue, CI) |
| M1 | Core domain: phone normalization, suppression, ledger, data-source config |
| M2 | Lead collection (Mock + CSV adapters), dedupe, lead table, import/export, baseline report |
| M3 | Contact enrichment (`safeFetch`) |
| M4 | Website & online presence analyzer |
| M5 | Scoring profiles + AI analysis + service recommendation |
| M6 | CRM |
| M7 | StoreMate Demo Lite |
| M8 | AI sales assistant (drafts only) |
| M9 | Analytics & cost reports |

Build **one at a time**. Do not start M(n+1) until M(n) meets its acceptance criteria and I approve.

---

## 7. Human-Owned Items (never guess these)

1. Approved data sources + terms/limits/prices → `docs/data-source-matrix.md`
2. StoreMate API contract → `docs/storemate-api-contract.md`
3. Bangladesh mobile-number prefix rule confirmation
4. Legal review (data protection, electronic communication, marketing)
5. Approved outreach channels/workflow for the pilot
6. Real AI provider + key
7. Bangla content review process
8. Hosting/storage provider

Until these exist: use `MockAdapter`, `CsvAdapter`, `MockStoreMateClient`, `MockAIService`, and mark the item `BLOCKED-ON-HUMAN` in your report.

---

## 8. Definition Of Done (every task)

- Acceptance criteria met and proven (test output shown).
- `pnpm lint && pnpm typecheck && pnpm test` green.
- RBAC tested for new routes; `UsageLedger` / `AuditLog` written where required.
- No secrets; `.env.example` updated; migrations apply cleanly with a documented rollback.
- `docs/progress.md` updated; decisions recorded in `docs/decisions.md`.
- Final report in the Build Guide 9.2 format.

---

## 9. Files You Must Keep Updated

### `docs/progress.md` (template)

```text
# Progress
Current milestone: Mx — <name>
Status: NOT_STARTED | IN_PROGRESS | AWAITING_APPROVAL | DONE

## Done
- ...

## In progress
- ...

## Next
- ...

## BLOCKED-ON-HUMAN
- ...

## Last session summary
- date / what changed / what to do next
```

### `docs/decisions.md` (template)

```text
# Decisions
- [YYYY-MM-DD] Decision — reason — alternatives rejected — who approved
```

At the **end of every session**, update `progress.md` with a handoff summary so the next agent can resume cold.

---

## 10. Quick Start Prompts (copy-paste)

**First ever session**

```text
Read master-prompt.md fully, then LEADMATE_AI_BUILD_GUIDE.md and the PRD.
Follow the Session Start Protocol (section 0). Then use playbook 5.A to plan Milestone M0 only.
Do not write code until I approve the plan.
```

**Starting a milestone**

```text
Read master-prompt.md and docs/progress.md.
Use playbook 5.B to write the build spec for Milestone <Mx>, then 5.C for the build sequence.
Wait for my approval between each.
```

**Fixing a bug**

```text
Read master-prompt.md. Use playbook 5.I. Error: <paste>. Steps to reproduce: <paste>.
```

**Before merging a milestone**

```text
Read master-prompt.md. Run playbook 5.H (security audit) on the changes of Milestone <Mx>,
then review them against the Build Guide acceptance criteria and Hard Rules (section 2). Report violations and fix them.
```
