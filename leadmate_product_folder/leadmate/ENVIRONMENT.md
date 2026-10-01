# ENVIRONMENT — Owner Overrides (read right after `master-prompt.md`)

> **Precedence:** this file overrides any conflicting statement about the package manager, Docker, or local services in `LEADMATE_AI_BUILD_GUIDE.md`, the PRD, or any other file. If you find a leftover `pnpm` or Docker instruction anywhere, follow this file and tell the owner.

## 1. Owner decisions

| Topic | Decision |
|---|---|
| Package manager | **npm only** (npm workspaces). Never use pnpm or yarn. |
| Docker | **Not used.** Do not create Dockerfiles or `docker-compose.yml`. Do not write instructions that need Docker. |
| Redis | Used **directly** (not through Docker), connected via `REDIS_URL`. |
| PostgreSQL | No Docker. Connected via `DATABASE_URL` (local install or hosted — **owner to confirm which**; code must not care). |
| Owner OS | Windows (assume Windows-friendly tooling; see section 5). |

## 2. npm workspaces rules

- Root `package.json` declares `"workspaces": ["apps/*", "packages/*"]` and `"private": true`.
- Internal packages depend on each other with version `"*"` (e.g. `"@leadmate/core": "*"`). **Do not use the `workspace:` protocol** (that is pnpm syntax).
- Commit `package-lock.json`. CI uses `npm ci`. Never create `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or `yarn.lock`.
- Add a dependency to one workspace: `npm install <pkg> -w apps/api`. Run a script in one workspace: `npm run <script> -w apps/api`.
- Run Prisma through `npx prisma ...` from `packages/db` (or via the root scripts below).
- Set `engines.node` in root `package.json` and add `.nvmrc` using the current Node LTS (verify the current LTS version; do not guess).

### Required root scripts (create in M0)

| Command | Purpose |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Start web + api + worker together (use `concurrently`) |
| `npm run build` | Build all workspaces |
| `npm test` | Run all tests |
| `npm run lint` | Lint all workspaces |
| `npm run typecheck` | `tsc --noEmit` for all workspaces |
| `npm run db:migrate` | Prisma migrate (dev) |
| `npm run db:seed` | Seed roles + super admin from env |
| `npm run doctor` | Environment check (section 6) |

Replace every `pnpm ...` command in any doc with the matching `npm run ...` command above.

## 3. Redis (no Docker)

- Connect only through `REDIS_URL`. Code must not assume how Redis is run (local service, WSL, or hosted).
- **Windows note for the owner:** Redis does not officially run natively on Windows. Common options: a Redis-compatible Windows build (e.g. Memurai), Redis inside WSL2, or a hosted Redis service. Pick one and put its URL in `.env`. The AI must **not** install system software on its own — it tells the owner what is missing.
- BullMQ requirements — **verify in the current BullMQ docs** and follow them: connection options for workers (e.g. `maxRetriesPerRequest: null`), recommended Redis `maxmemory-policy` (`noeviction`), and the minimum supported Redis version.
- Use a key prefix (`REDIS_KEY_PREFIX=leadmate`) for all keys/queues.
- Dev uses Redis DB index 0; tests use a separate URL (`REDIS_URL_TEST`, DB index 1) and clean only their own prefix.
- API and worker **fail fast** with a clear message if Redis is unreachable at startup.

## 4. PostgreSQL (no Docker)

- Connect only through `DATABASE_URL`. Tests use a separate `DATABASE_URL_TEST`.
- **Safety guard:** the test runner must refuse to run if the database name in `DATABASE_URL_TEST` does not end with `_test`, and must never run against the dev or production database.
- Migrations via Prisma; applied migrations are immutable (see `master-prompt.md` 2.3).
- Hosted vs local Postgres is an owner decision — record it in `docs/decisions.md` once made.

## 5. Windows-friendly rules

- npm scripts must be cross-platform: use `cross-env` for env vars, `rimraf` instead of `rm -rf`, no bash-only syntax in `package.json` scripts.
- Helper scripts are **Node scripts** (`scripts/*.mjs`), not `.sh` files. This includes Claude Code hook scripts (`master-prompt.md` playbook 5.M).
- Add `.gitattributes` with `* text=auto eol=lf`. Use forward slashes in config paths. Avoid symlinks.
- Do not rely on tools that exist only on Linux/macOS.

## 6. `npm run doctor` (create in M0)

`scripts/doctor.mjs` checks and prints PASS/FAIL with a fix hint for each:
1. Node version matches `engines`.
2. Required env vars are present (compare `.env` to `.env.example`).
3. PostgreSQL reachable via `DATABASE_URL`; `DATABASE_URL_TEST` points to a `*_test` database.
4. Redis reachable via `REDIS_URL` (and `REDIS_URL_TEST`).
5. Redis config matches BullMQ expectations (warn if not).

M0 is not done until `npm run doctor` exists and passes on the owner's machine.

## 7. `.env.example` additions

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/leadmate
DATABASE_URL_TEST=postgresql://USER:PASSWORD@HOST:5432/leadmate_test
REDIS_URL=redis://HOST:6379/0
REDIS_URL_TEST=redis://HOST:6379/1
REDIS_KEY_PREFIX=leadmate
```

(These replace the Docker-style localhost defaults in the Build Guide section 10.)

## 8. Testing without Docker

- Integration tests use `DATABASE_URL_TEST` and `REDIS_URL_TEST`. No testcontainers.
- Each test seeds its own data and cleans up; BullMQ tests use a unique queue name per test run.

## 9. Owner setup checklist (human)

1. Install Node.js LTS and confirm `node -v` and `npm -v` work.
2. Have a PostgreSQL database ready (local or hosted) plus a separate `_test` database.
3. Have Redis running and reachable (see section 3).
4. Copy `.env.example` to `.env` and fill in values.
5. Run `npm install`, then `npm run doctor`.

## 10. What the AI must NOT do

- Do not use pnpm or yarn, create Docker files, or require Docker.
- Do not install system software (Node, Postgres, Redis) without asking.
- Do not hardcode hostnames/ports/passwords; always use env vars.
- Do not write `.sh`-only tooling.
