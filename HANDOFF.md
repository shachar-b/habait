# HANDOFF — Phase 1 → Phase 2 (Milestone 2)

Next session: execute **Milestone 2** of [SPEC.md](./SPEC.md) (core domain services, star ledger, rollover) under strict TDD. Design lives in [ARCHITECTURE.md](./ARCHITECTURE.md) (layers, pool state machine, rollover algorithm, spec-gap decisions) — don't re-derive it.

## Status

Milestones 0 and 1 are done. Last verification: `npm run typecheck` (0 errors, all 3 workspaces) and `npm test` (2 files, 21 tests) both pass.

## Files created

Root: `package.json` (npm workspaces, scripts `typecheck`, `test`, `db:generate`), `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `noImplicitOverride`, Bundler resolution, `noEmit`), `vitest.config.ts` (projects: shared, server), `.gitignore`, `.nvmrc` (22), `ARCHITECTURE.md`, this file.

`packages/shared/src` (consumed as TS source via `exports` → `./src/index.ts`):
- `enums.ts` — enum tuples + Zod enums + business constants (`POOL_CLAIM_DURATION_MS`, `TIME_ZONE`, defaults)
- `errors.ts` — `ERROR_CODES`, `ERROR_HTTP_STATUS`, `ApiErrorSchema`
- `entities.ts` — primitives (`IdSchema`, `LogicalDateSchema`, `PinSchema`…), entity DTOs, `PoolTaskSchema` (discriminated on `state`), `CompletedItemSchema` (discriminated on `kind`)
- `api.ts` — request/response schemas for every M3 endpoint (lobby, login, dashboard, complete/revert, pool, peer requests, stars summary, history, admin CRUD/settings)
- `time.ts` — `getLogicalDateString`, `getIsraeliDayOfWeek`, `getCurrentTimeWindow`, `getIsraeliWeekBounds`: **signatures only, bodies throw "not implemented"**
- `copy.ts` — `HEBREW_COPY`
- `index.ts` — re-exports all; test: `packages/shared/test/contracts.test.ts`

`packages/server`:
- `src/db/schema.ts` — Drizzle schema for all 9 tables, indexes and CHECKs (PARENT PIN, singleton settings, 1-WIP partial unique index, pool state consistency, no self peer-request, stars ≥ 0)
- `src/db/connection.ts` — `createDb(path)` (WAL, synchronous NORMAL, foreign_keys ON, busy_timeout 5000), `migrateDb(handle)`, `resolveDbPath()` (`DB_PATH`), types `Db`, `DbHandle`
- `drizzle/0000_cloudy_skaar.sql` (+ `meta/`) — initial migration; `drizzle.config.ts`
- `test/schema.test.ts` — temp-file SQLite: pragmas, table creation, constraint/FK/unique/1-WIP checks, ledger sum

`packages/web`: minimal scaffold only (Vite + React 19 + Tailwind v4 config, RTL `index.html`, empty `main.tsx`). No UI yet.

## Verification caveats

- Fastify, `@fastify/*`, `fastify-type-provider-zod`, `croner` are **not installed** (nothing needed them yet); add them when first used.
- No server runtime/dev runner is set up (e.g. `tsx`); the server package only runs under Vitest today. Needed by M3 (`npm run db:seed`, `dev`).
- No `build` script yet (M6). Shared is TS-source-only, so the production build must bundle it.
- Host Node is v24; `.nvmrc` says 22 per spec. Tests passed on 24.
- Drizzle `.get()`/`.all()` are used synchronously in tests (better-sqlite3 driver).
- `npm install` printed deprecation warnings from `drizzle-kit`'s transitive deps (`@esbuild-kit/*`); revisit before the M6 "zero warnings" gate.
- Caveman skill was not resolvable on this machine (user chose to proceed without it). The handoff skill is installed as `handoff` and writes to `%TEMP%` by default; user chose to write to the repo root instead.

## Starting instructions for Milestone 2

1. Read SPEC §2 (domain rules), §4 Milestone 2, and ARCHITECTURE.md §2–§3.
2. Work in `packages/server/src/services/*.service.ts`, tests in `packages/server/test/services/`. Red → Green → Refactor; commit-sized steps. Use `createDb(':memory:')` + `migrateDb` for fixtures (or a temp file when WAL matters).
3. Order: `date.service.ts` first. Implement the four helper signatures from `packages/shared/src/time.ts` (move bodies there or re-export from the service — keep one implementation), tested across both DST transitions in Asia/Jerusalem (Friday before the last Sunday of March; last Sunday of October) and with `TZ` set to something else to prove host independence. Then `user.service.ts` → `pool.service.ts` → `task.service.ts` + `star.service.ts` → `rollover.service.ts`.
4. Services take `(db, now)`/an injected clock, run multi-row changes in `db.transaction`, throw typed errors using `ERROR_CODES` (define `DomainError` / `DomainValidationError` in `server/src/errors.ts`). No `any`, no raw SQL in routes.
5. PIN hashing: use Node's built-in `crypto.scrypt` with per-user salt (no new dependency); session tokens: HMAC-signed with `crypto` (secret from env, dev default only outside production).
6. Do **not** start Milestone 3 (Fastify) in this phase beyond what M2 tests need.

## Suggested skills

`using-superpowers`, `test-driven-development`, `systematic-debugging` (if a test fails unexpectedly), `verification-before-completion`, `ponytail`, `typescript-pro`, `api-design-principles` (error/status mapping), `database-architect` (only if the schema must change — generate a new migration, never edit `0000`).
