# `habait` (הבית שלנו) — Master Architecture & Implementation Specification

## 0. Agent Execution Protocol, Model Strategy & Skill Routing

You are building **`habait`**, a production-grade, local-first, Hebrew RTL family task and routine management web application inspired by Hearth Display and ChoreOps ("Jira for the family").

### Mandatory Engineering Discipline
1. **Strict TDD (Red-Green-Refactor):** Every backend domain feature and API endpoint MUST begin with a failing Vitest test (`Red`), followed by the minimal implementation to pass (`Green`), and clean refactoring (`Refactor`).
2. **Zero Business Logic in Transport/UI:** Fastify HTTP routes and React components must never contain raw database queries or domain state rules. All state transitions flow through pure/tested Domain Services.
3. **Minimalist & Safe Code (`Ponytail` Discipline):** Ship the smallest, cleanest, type-safe implementation that satisfies the spec. Zero `any` types, strict Zod validation at every boundary, and zero unrequested features.
4. **Hebrew-First & Native RTL:** The UI is 100% Hebrew (`he-IL`, `dir="rtl"`). Use Tailwind CSS logical properties (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `text-start`, `border-s-*`) exclusively. Physical horizontal directional classes (`pl-*`, `pr-*`, `ml-*`, `mr-*`, `left-*`, `right-*`, `text-left`, `text-right`) are **BANNED**.

### Installed Skills & Activation Matrix
Use the pre-installed Global and Workspace skills according to the active phase:

| Scope | Skill / Plugin | Activation Phase & Responsibility |
| :--- | :--- | :--- |
| **Global Plugin** | `Superpowers Skills` | All Milestones — Enforces planning, strict TDD cycle, debugging, and verification gates. |
| **Global Skill** | `Matt Pocock Handoff` | End of Milestone 1 — Packages workspace state into `HANDOFF.md` before switching models. |
| **Global Skill** | `Ponytail Skill` | All Milestones — Prevents over-engineering while enforcing validation, security, and data-safety floors. |
| **Global Skill** | `Caveman Skill` | Phase 1 (Opus 5.5) — Keep conversational prose terse to conserve output tokens; never truncate code or tests. |
| **Workspace** | `database-architect` | Milestone 1 — SQLite WAL configuration, Drizzle schema, indexes, immutable ledger, and snapshot modeling. |
| **Workspace** | `api-design-principles` | Milestone 1 & 3 — Clean REST resource contracts, status codes, and decoupled service boundaries. |
| **Workspace** | `typescript-pro` | All Milestones — Discriminated unions, strict generics, and shared Zod-to-TS type inference. |
| **Workspace** | `Frontend Design` | Milestone 4 & 5 — Warm, tactile Hearth-inspired family UI design system, typography, and RTL layout. |
| **Workspace** | `Emil Kowalski Design Eng` | Milestone 4 & 5 — Purposeful micro-interactions, celebratory completion animations, and touch responsiveness. |
| **Workspace** | `e2e-testing-patterns` | Milestone 6 — Resilient Playwright E2E flows covering PIN auth, pool claiming, cooldowns, and rollovers. |

---

## 1. System Architecture & Proxmox LXC Context

### 1.1 Target Runtime Environment
* **Host Hardware:** Intel N150 Mini PC running Proxmox VE (co-hosted alongside Home Assistant OS, Plex Media Server, and AdGuard Home).
* **Container Target:** Unprivileged Debian 12 / Alpine Linux LXC container (`hostname: habait`).
* **Resource Budget:** Idle RAM consumption must remain `< 120 MB`; idle CPU `< 1%`.
* **Timezone Mandate:** The server process and all scheduled jobs MUST operate strictly in `TZ=Asia/Jerusalem`.
* **Network & Tunnel-Ready Topology:**
  * **v1 Access:** Direct LAN access over Wi-Fi (`http://<LXC-IP>:3000` or `http://habait:3000`).
  * **Future Access:** Drop-in compatibility with Cloudflare Zero Trust Tunnel (`cloudflared`) without code or build changes.
  * **Single-Origin Serving:** In production mode, the Fastify backend serves the compiled Vite static SPA bundle from `/` and mounts REST endpoints under `/api/v1/*` on the exact same port (`3000`). All frontend API requests and asset links MUST use relative paths (`/api/v1/...`).

### 1.2 Monorepo Tech Stack
Use an `npm workspaces` (or `pnpm workspaces`) TypeScript monorepo:
```text
habait/
├── package.json
├── tsconfig.base.json
├── ARCHITECTURE.md
├── HANDOFF.md                  # Generated at the Phase 1 -> Phase 2 Stop Gate
├── packages/
│   ├── shared/                 # Zod schemas, DTOs, domain enums, error codes, Hebrew UI constants
│   ├── server/                 # Fastify API, Drizzle ORM, better-sqlite3 (WAL), cron engine, Vitest suite
│   └── web/                    # Vite + React 19 + TypeScript + Tailwind CSS v4 (RTL) + Lucide/Emoji UI
└── e2e/                        # Playwright E2E test suite
```

* **Database:** `better-sqlite3` with Drizzle ORM. Database file stored at configurable `DB_PATH` (default `./data/habait.db`, `/var/lib/habait/habait.db` in production).
  * Mandatory SQLite pragmas on connection startup:
    ```sql
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    ```
* **Backend Framework:** Fastify (`fastify`, `@fastify/static`, `@fastify/cookie`, `fastify-type-provider-zod`).
* **Scheduler:** Built-in lightweight scheduler (`croner` or `node-cron` with `timezone: "Asia/Jerusalem"`) running inside the server process for:
  1. **Midnight Daily Rollover (`0 0 * * *` `Asia/Jerusalem`)**
  2. **Pool Claim Expiry & Cooldown Sweep (every 60 seconds)**

---

## 2. Domain Model & Database Schema Specification

### 2.1 System Settings (`app_settings` — Singleton Row `id = 1`)
* `id`: Integer PK (always `1`)
* `appTitle`: Text, default `'הבית שלנו'` (customizable by Parents in Admin settings)
* `announcementText`: Text, nullable (Family-wide banner message on the main lobby screen)
* `announcementEmoji`: Text, nullable (e.g., `'📣'`, `'🍕'`)
* `announcementUpdatedBy`: Integer FK $\rightarrow$ `users.id`, nullable
* `updatedAt`: Integer (Unix timestamp ms)

### 2.2 Users / Profiles (`users`)
* `id`: Integer PK autoincrement
* `name`: Text, required (supports Hebrew + Niqqud)
* `avatarEmoji`: Text, required (large emoji/icon, e.g., `'🦁'`, `'🦄'`, `'🦸‍♂️'`)
* `avatarBgColor`: Text, required (Tailwind-compatible theme token for profile card accent)
* `role`: Enum `'PARENT' | 'CHILD'`
* `pinHash`: Text, nullable for `'CHILD'`, **mandatory (non-null)** for `'PARENT'` (4-digit numeric PIN hashed with `scrypt` or `argon2`/salted SHA-256)
* `isActive`: Boolean, default `true`
* `sortOrder`: Integer, default `0`
* `createdAt`: Integer (Unix timestamp ms)

**Domain Rule — PIN Enforcement:**
* If `role === 'PARENT'`, attempting to create or update the user with an empty/null PIN MUST throw a `DomainValidationError`.
* If `role === 'CHILD'`, `pinHash` is optional. If null, selecting the profile on the lobby screen logs in immediately without a PIN prompt.

### 2.3 Task Categories & Lifecycle

`habait` separates work into four distinct domain entities/flows to keep the schema clean and type-safe:

#### Category A: Daily Routines (`routine_templates` & `routine_daily_logs`)
Recurring daily habits (e.g., brushing teeth, organizing school bag).
* **Stars Rule:** Routines ALWAYS carry **0 stars**.
* **Israeli Week Schedule:** Days of the week are stored as a JSON array of integers `[0..6]` where `0 = Sunday (יום א׳)` through `6 = Saturday (שבת)`.
* **Time Windows (`timeWindow`):** Enum:
  * `'MORNING'` (`בוקר` — default auto-focus `05:00–11:59`)
  * `'AFTERNOON'` (`צהריים` — default auto-focus `12:00–16:59`)
  * `'EVENING'` (`ערב` — default auto-focus `17:00–23:59`)
  * `'ALL_DAY'` (`כל היום` — always visible across windows)

**`routine_templates` Table:**
* `id`: Integer PK
* `assigneeId`: Integer FK $\rightarrow$ `users.id` (Cascade delete)
* `title`: Text, required (supports Niqqud)
* `iconEmoji`: Text, required (e.g., `'🪥'`, `'🎒'`)
* `timeWindow`: Enum `'MORNING' | 'AFTERNOON' | 'EVENING' | 'ALL_DAY'`
* `daysOfWeekJson`: Text (JSON array of `[0..6]`, e.g., `"[0,1,2,3,4,5]"`)
* `sortOrder`: Integer, default `0`
* `isActive`: Boolean, default `true`
* `createdBy`: Integer FK $\rightarrow$ `users.id`
* `createdAt`: Integer (Unix timestamp ms)

**`routine_daily_logs` Table (Immutable Daily Tracking & Midnight Snapshot):**
* `id`: Integer PK
* `routineId`: Integer FK $\rightarrow$ `routine_templates.id`
* `assigneeId`: Integer FK $\rightarrow$ `users.id`
* `titleSnapshot`: Text (captures title at the time of logging so future edits don't corrupt history)
* `iconEmojiSnapshot`: Text
* `timeWindowSnapshot`: Text
* `logicalDate`: Text (`YYYY-MM-DD` in `Asia/Jerusalem`, indexed)
* `status`: Enum `'COMPLETED' | 'MISSED'`
* `completedAt`: Integer, nullable (Unix timestamp ms)
* **Unique Constraint:** `(routineId, logicalDate)`

**Midnight (`00:00` `Asia/Jerusalem`) Rollover Logic for Routines:**
When the clock crosses `00:00` (and on server startup if a previous day was missed while powered off):
1. Identify the previous calendar date `D_prev` (`YYYY-MM-DD`) and its day-of-week index (`0..6`).
2. Find all active `routine_templates` scheduled for `D_prev` that do NOT have a `COMPLETED` row in `routine_daily_logs` for `D_prev`.
3. Insert rows into `routine_daily_logs` with `status = 'MISSED'`, `logicalDate = D_prev`.
4. The new day `D_curr` begins with a clean slate for all scheduled routines.

---

#### Category B: One-Off Assigned Tasks (`one_off_tasks`)
Standalone tasks assigned by a Parent to a specific user (e.g., "Tidy your room", "Clean bike chain").
* **Rollover Rule:** Unfinished tasks remain open and roll over across midnight until marked `COMPLETED` or `CANCELED` by a parent.
* **Stars Rule:** Carries `0` to `N` stars (`stars >= 0`), set by a parent.

**`one_off_tasks` Table:**
* `id`: Integer PK
* `assigneeId`: Integer FK $\rightarrow$ `users.id`
* `createdById`: Integer FK $\rightarrow$ `users.id` (Must be a `PARENT`)
* `title`: Text, required (supports Niqqud)
* `iconEmoji`: Text, required
* `stars`: Integer, default `0` (`>= 0`)
* `status`: Enum `'PENDING' | 'COMPLETED' | 'CANCELED'`
* `issuedDate`: Text (`YYYY-MM-DD` in `Asia/Jerusalem` when created)
* `issuedAt`: Integer (Unix timestamp ms)
* `finishedDate`: Text, nullable (`YYYY-MM-DD` in `Asia/Jerusalem` when completed or canceled)
* `finishedAt`: Integer, nullable (Unix timestamp ms)

---

#### Category C: Shared Household Pool (`pool_tasks` & `pool_task_executions`) — `קופת המשימות`
Shared household tasks (e.g., unloading the dishwasher, taking out recycling) created and configured **exclusively by Parents**. Any user can claim an available pool task to complete it.

**`pool_tasks` Table:**
* `id`: Integer PK
* `title`: Text, required (supports Niqqud)
* `iconEmoji`: Text, required
* `stars`: Integer, required (`>= 0`, set by Parent)
* `resetMode`: Enum `'COOLDOWN' | 'AUTO_DISABLE'`
  * `'COOLDOWN'` (`מחזורי עם השהיה`): After completion, enters cooldown for `cooldownMinutes` (default `60`), then automatically returns to `'AVAILABLE'`.
  * `'AUTO_DISABLE'` (`הפעלה ידנית`): After completion, automatically sets `isActive = false` and `state = 'AVAILABLE'` (used for event-driven chores like "Unload the dishwasher" so it doesn't pop back up 1 hour later when the dishwasher is empty; a parent re-enables `isActive = true` with a single tap in `ניהול הבית`).
* `cooldownMinutes`: Integer, default `60`
* `isActive`: Boolean, default `true` (Parents can toggle active/inactive at any time)
* `state`: Enum `'AVAILABLE' | 'CLAIMED' | 'COOLDOWN'`
* `claimedByUserId`: Integer FK $\rightarrow$ `users.id`, nullable
* `claimedAt`: Integer, nullable (Unix timestamp ms)
* `claimExpiresAt`: Integer, nullable (Unix timestamp ms — set to `claimedAt + 60 minutes`)
* `cooldownEndsAt`: Integer, nullable (Unix timestamp ms — set to `completedAt + cooldownMinutes * 60000` when `resetMode === 'COOLDOWN'`)
* `lastCompletedAt`: Integer, nullable (Unix timestamp ms)
* `createdById`: Integer FK $\rightarrow$ `users.id`

**`pool_task_executions` Table (History & Revert Tracking for Pool Tasks):**
* `id`: Integer PK
* `poolTaskId`: Integer FK $\rightarrow$ `pool_tasks.id`
* `userId`: Integer FK $\rightarrow$ `users.id`
* `titleSnapshot`: Text
* `iconEmojiSnapshot`: Text
* `starsAwarded`: Integer
* `claimedAt`: Integer
* `completedAt`: Integer
* `logicalDate`: Text (`YYYY-MM-DD` in `Asia/Jerusalem`, indexed)
* `revertedAt`: Integer, nullable (if undone on the same day or by a parent)

**Domain Rules for `קופת המשימות` (Flow A — Strict State Machine):**
1. **Strict 1-WIP Claim Limit per User:** A user may have at most **ONE (1)** `pool_tasks` row where `state === 'CLAIMED' AND claimedByUserId === user.id`. Attempting to claim a second pool task while holding an active claim MUST fail with `409 Conflict` (`POOL_WIP_LIMIT_REACHED`).
2. **Claiming (`לקחתי!`):**
   * Prerequisite: `pool_task.isActive === true` and `pool_task.state === 'AVAILABLE'`.
   * Transition: `state = 'CLAIMED'`, `claimedByUserId = userId`, `claimedAt = now`, `claimExpiresAt = now + 3_600_000` (1 hour).
3. **Unclaiming / Returning to Pool (`החזר לקופה`) or 1-Hour Claim Timeout:**
   * Either triggered manually by the claiming user (or a parent) OR automatically when `now >= claimExpiresAt`.
   * Transition: `state = 'AVAILABLE'`, `claimedByUserId = null`, `claimedAt = null`, `claimExpiresAt = null`.
4. **Completing a Claimed Pool Task (`בוצע!`):**
   * Prerequisite: `state === 'CLAIMED'` and `claimedByUserId === userId` (and claim has not expired).
   * Writes a row to `pool_task_executions` and awards `stars` in `star_transactions`.
   * If `resetMode === 'COOLDOWN'`:
     * Transition: `state = 'COOLDOWN'`, `cooldownEndsAt = now + cooldownMinutes * 60_000`, `claimedByUserId = null`, `claimedAt = null`, `claimExpiresAt = null`, `lastCompletedAt = now`.
     * Once `now >= cooldownEndsAt`, the background sweep (or read-time lazy evaluation) transitions `state = 'AVAILABLE'`, `cooldownEndsAt = null`.
   * If `resetMode === 'AUTO_DISABLE'`:
     * Transition: `isActive = false`, `state = 'AVAILABLE'`, `claimedByUserId = null`, `claimedAt = null`, `claimExpiresAt = null`, `cooldownEndsAt = null`, `lastCompletedAt = now`.

---

#### Category D: Peer-to-Peer Help Requests (`peer_requests`) — `בקשות עזרה`
Any user can request help from another user.
* **Stars Rule:** Always **0 stars** (prevents siblings from farming stars by sending each other tasks).
* **Rollover Rule:** Pending requests remain in the recipient's `בקשות עזרה` section across midnight until completed, declined, or canceled.

**`peer_requests` Table:**
* `id`: Integer PK
* `requesterId`: Integer FK $\rightarrow$ `users.id`
* `recipientId`: Integer FK $\rightarrow$ `users.id` (Must not equal `requesterId`)
* `title`: Text, required (supports Niqqud)
* `iconEmoji`: Text, required (default `'🤝'`)
* `status`: Enum `'PENDING' | 'COMPLETED' | 'DECLINED' | 'CANCELED'`
* `issuedDate`: Text (`YYYY-MM-DD` in `Asia/Jerusalem`)
* `issuedAt`: Integer (Unix timestamp ms)
* `finishedDate`: Text, nullable (`YYYY-MM-DD` in `Asia/Jerusalem`)
* `finishedAt`: Integer, nullable (Unix timestamp ms)

**Domain Rules for `בקשות עזרה`:**
* Recipient can mark `'COMPLETED'` (`בוצע`) or `'DECLINED'` (`דחה`).
* Requester or any `PARENT` can mark `'CANCELED'` (`ביטול`).

---

### 2.4 Motivation Engine: Immutable Star Ledger (`star_transactions`)
Stars are never stored as a mutable integer column on `users`. All star balances and period breakdowns are derived from `star_transactions`.

**`star_transactions` Table:**
* `id`: Integer PK autoincrement
* `userId`: Integer FK $\rightarrow$ `users.id` (indexed)
* `sourceType`: Enum `'ONE_OFF' | 'POOL' | 'REVERT' | 'PARENT_ADJUSTMENT'`
* `sourceId`: Integer, nullable (ID of `one_off_tasks.id` or `pool_task_executions.id`)
* `starsDelta`: Integer, required (Positive for earning, negative for Undo/Revert)
* `description`: Text, required (Snapshot of task title or reason)
* `logicalDate`: Text (`YYYY-MM-DD` in `Asia/Jerusalem`, indexed)
* `createdAt`: Integer (Unix timestamp ms, indexed)

**Undo / Revert (`ביטול השלמה`) Domain Rule:**
* Any user can undo a task they completed *today* (`logicalDate === today`) from their `בוצעו היום` section; a `PARENT` can also revert any completed task from Admin/History.
* Reverting a completed task:
  1. Restores the source record (`routine_daily_logs` row deleted if today, `one_off_tasks.status` back to `'PENDING'`, `peer_requests.status` back to `'PENDING'`, or `pool_task_executions.revertedAt = now` and if `pool_tasks.resetMode === 'AUTO_DISABLE'` re-activates `isActive = true` and `state = 'AVAILABLE'`).
  2. If the task awarded `stars > 0`, inserts a compensating row into `star_transactions` with `starsDelta = -stars` and `sourceType = 'REVERT'`.

**Star Analytics Period Queries (in `Asia/Jerusalem`):**
* **Daily (`יומי`):** `logicalDate = YYYY-MM-DD`
* **Weekly (`שבועי`):** Israeli calendar week starting Sunday `00:00` through Saturday `23:59:59`
* **Monthly (`חודשי`):** `logicalDate LIKE 'YYYY-MM-%'`
* **Yearly (`שנתי`):** `logicalDate LIKE 'YYYY-%'`
* **All-Time Total (`סה״כ`):** `SUM(starsDelta)` for `userId`

---

## 3. UI/UX & Hebrew Terminology Specification

### 3.1 Mandatory Hebrew Labels & Copy
Use these exact Hebrew terms across the interface:
* **Default App Title:** `הבית שלנו` (editable in Admin settings)
* **Personal Tasks View:** `היום שלי`
* **Shared Household Pool:** `קופת המשימות`
* **Claim Pool Task Button:** `לקחתי!`
* **Return Claimed Pool Task Button:** `החזר לקופה`
* **Peer Help Requests Section:** `בקשות עזרה`
* **Completed Today Section:** `בוצעו היום`
* **Undo Completion Button:** `ביטול השלמה`
* **History View:** `היסטוריה`
* **Parent Admin View:** `ניהול הבית`
* **Time Windows:** `בוקר` (Morning), `צהריים` (Afternoon), `ערב` (Evening), `כל היום` (All Day)
* **Peer Request Actions:** `בוצע` (Complete), `דחה` (Decline)

### 3.2 Typography, Niqqud & Visual Ergonomics (Age 6+ Friendly)
* **Font Family:** Load Google Font **`Rubik`** (weights 400, 500, 700) with `subset=hebrew`. Ensure `line-height` (`leading-relaxed`) accommodates Hebrew **Niqqud** (vowel diacritics) without clipping.
* **Large Visual Anchors:** Every task card and profile card must render its `iconEmoji` / `avatarEmoji` at a large, scannable size (`text-3xl` to `text-4xl` on tasks, `text-5xl` on profile avatars).
* **Touch Targets:** Minimum touch target size of `48px × 48px` (`min-h-12 min-w-12`) on all buttons and checkboxes for mobile/tablet use.
* **Micro-Celebrations:** Completing a task triggers a snappy, joyful tactile animation (spring checkmark + subtle star burst if `stars > 0`) before moving the item to `בוצעו היום`.

### 3.3 Screen-by-Screen Layout

#### Screen 1: Family Lobby / Overview (`/`)
1. **Top Header Bar:**
   * Displays the dynamic `appTitle` (default `הבית שלנו`).
   * Live digital clock (`HH:mm`) and formatted Hebrew date + day of week (e.g., `יום ראשון, 25 באוקטובר 2026`).
   * Quick navigation link to `היסטוריה` (History).
2. **Family Announcement Banner:**
   * If `announcementText` is non-empty, renders a warm highlighted banner with `announcementEmoji` and `announcementText`.
3. **Netflix-Style Profile Selector Grid:**
   * Responsive grid of active family profiles (`users`).
   * Each profile card displays:
     * Large `avatarEmoji` on its `avatarBgColor` badge.
     * User `name` (with Niqqud support) and a subtle crown/shield icon if `role === 'PARENT'`.
     * **Star Pill:** Shows `⭐ {totalStars}`.
     * **Non-Overwhelming Open-Task Indicator:** A clean, pulsing emerald/amber status dot (`יש משימות פתוחות` vs. `הכל בוצע!`) indicating whether the user currently has any uncompleted routines (for the current/elapsed windows today), pending one-off tasks, active claimed pool tasks, or pending peer requests—**STRICTLY WITHOUT displaying the numeric count of open tasks**.
4. **PIN Modal (Conditional):**
   * Tapping a profile with `pinHash === null` navigates directly to `/profile/:id`.
   * Tapping a profile with a PIN opens a clean, kid-friendly 4-digit numeric keypad modal (`הזן קוד סודי`).

#### Screen 2: User Workspace (`/profile/:id`)
Bottom navigation bar (on mobile) or top pill bar (on tablet) with tabs:
1. **`היום שלי` (Default Tab — Strict Top-to-Bottom Visual Hierarchy):**
   * **Header:** User avatar, greeting (`שלום, {name}`), current star counter (tappable to view Daily / Weekly / Monthly / Yearly star breakdown modal), and "Switch User" (`החלף משתמש`) button.
   * **Section 1 — Active Claimed Pool Task (Conditional):** If the user currently holds a claimed task from `קופת המשימות`, render a prominent highlighted hero card at the very top showing the task emoji, title, star bounty (`+X ⭐`), live 1-hour claim expiry countdown (`נותרו XX דקות`), a primary **`בוצע!`** button, and a secondary **`החזר לקופה`** button.
   * **Section 2 — One-Off Assigned Tasks (`משימות מיוחדות`):** Cards showing emoji, title, issue date (`נוצר ב-...`), star badge (`+X ⭐`), and large completion button.
   * **Section 3 — Daily Routines (`שגרה יומית`):** Grouped by `בוקר`, `צהריים`, `ערב`, `כל היום`. Automatically expands and highlights the active time window for the current `Asia/Jerusalem` hour while keeping other windows collapsible.
   * **Section 4 — Peer Help Requests (`בקשות עזרה`):** Cards showing requester's avatar + name (`מאת: {requesterName}`), emoji, title, and two action buttons: **`בוצע`** (Complete) and **`דחה`** (Decline). Includes a `+ בקש עזרה` button to send a new request to another family member.
   * **Section 5 — Completed Today (`בוצעו היום`):** Collapsible accordion at the bottom listing all tasks completed by this user today (`logicalDate === today`), each with a **`ביטול השלמה`** (Undo) button.
2. **`קופת המשימות` (Shared Household Pool Tab):**
   * Shows all `pool_tasks` where `isActive === true`.
   * **Available Tasks (`AVAILABLE`):** Shows emoji, title, star bounty (`+X ⭐`), reset mode badge, and a prominent **`לקחתי!`** button. (If the current user already holds a claimed pool task, the `לקחתי!` button is disabled with a clear helper badge: `כבר לקחת משימה אחת — סיים אותה קודם!`).
   * **Claimed by Someone (`CLAIMED`):** Shows who claimed it (`בטיפול של {name}`) and when the claim expires.
   * **Cooling Down (`COOLDOWN`):** Rendered muted/greyed-out with a live countdown (`יהיה זמין שוב בעוד XX דקות`).
3. **`היסטוריה` (History & Star Tracker Tab):**
   * Date navigator (`YYYY-MM-DD`, defaults to today/yesterday with easy prev/next day arrows).
   * Displays every family member's daily record for the selected date: Completed Routines, Missed Routines (`לא בוצע`), Completed One-Offs, Completed Pool Tasks, Peer Requests, and Stars earned (`יומי / שבועי / חודשי / שנתי`).
4. **`ניהול הבית` (Parent Admin Tab — Visible & Accessible ONLY when logged in as a `PARENT`):**
   * **Quick Toggles for `קופת המשימות`:** One-tap Active/Inactive (`פעיל / כבוי`) switches for every Shared Pool task (so turning "Unload the dishwasher" back on takes 1 second), plus CRUD for pool tasks (title, emoji, stars, `COOLDOWN` vs `AUTO_DISABLE`, cooldown minutes).
   * **Task Management across All Users:** Create/edit/cancel One-Off tasks and Routine templates (including day-of-week selector Sun–Sat and time window) for any user; cancel any pending Peer Request; revert any completed task.
   * **Family Announcement & App Title:** Edit `appTitle` (default `הבית שלנו`) and update or clear the family announcement banner.
   * **Profile & PIN Management:** Add/edit family members, set/change/remove child PINs, change parent PINs (enforcing that parent PINs can never be removed).

---

## 4. Implementation Milestones & Model Handover Plan

---

### PHASE 1: ARCHITECTURE, SCHEMA & CONTRACTS
> **Active Model:** `Claude Opus 5.5 (High)`
> **Active Skills:** `Superpowers`, `Ponytail`, `Caveman`, `database-architect`, `api-design-principles`, `typescript-pro`

#### Milestone 0: Monorepo Scaffold & Tooling Baseline
1. Initialize the root workspace (`package.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc` targeting Node 22 LTS).
2. Scaffold `packages/shared`, `packages/server`, and `packages/web`.
3. Configure TypeScript in strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`, `"noImplicitOverride": true`).
4. Configure Vitest at the workspace level for `packages/shared` and `packages/server`.
5. **Verification Gate:** `npm install && npm run typecheck` passes with zero errors.

#### Milestone 1: Database Schema, Shared Zod Contracts & Architecture Blueprint
1. Using `database-architect`, design and implement `packages/server/src/db/schema.ts` with Drizzle ORM and `better-sqlite3` covering:
   * `app_settings`, `users`, `routine_templates`, `routine_daily_logs`, `one_off_tasks`, `pool_tasks`, `pool_task_executions`, `peer_requests`, and `star_transactions`.
   * Generate initial SQL migration and write the database connection factory enforcing WAL mode and foreign keys.
2. Using `typescript-pro` and `api-design-principles`, implement `packages/shared/src/index.ts` containing:
   * All domain enums, discriminated unions, and Zod request/response schemas for every API endpoint.
   * Pure timezone helper signatures for `Asia/Jerusalem` (`getLogicalDateString`, `getIsraeliDayOfWeek`, `getCurrentTimeWindow`, `getIsraeliWeekBounds`).
   * Hebrew UI dictionary constants (`HEBREW_COPY`).
3. Create `ARCHITECTURE.md` documenting:
   * Layer boundaries (Routes $\rightarrow$ Domain Services $\rightarrow$ DB Repositories).
   * The exact state machine transitions for `pool_tasks` (`AVAILABLE` $\leftrightarrow$ `CLAIMED` $\rightarrow$ `COOLDOWN` / `AUTO_DISABLE`).
   * The midnight `00:00` `Asia/Jerusalem` rollover algorithm.
4. **Verification Gate:** Run `npm run typecheck` and write a schema smoke test in `packages/server/test/schema.test.ts` verifying table creation and WAL pragma activation in an in-memory/temp SQLite instance.

---

## 🛑 STOP POINT — MODEL HANDOVER GATE (`Opus 5.5` $\rightarrow$ `Argon 4`)

**CRITICAL INSTRUCTION FOR CLAUDE OPUS 5.5:**
1. As soon as **Milestone 0** and **Milestone 1** are complete and `npm test` + `npm run typecheck` pass:
2. Invoke the **`Matt Pocock Handoff Skill`** (`skill-handoff`) to generate `HANDOFF.md` in the repository root. `HANDOFF.md` must summarize:
   * Exact files created in `packages/shared` and `packages/server/src/db`.
   * Verification status of the Drizzle schema and shared Zod contracts.
   * Exact starting instructions for **Milestone 2**.
3. **STOP IMMEDIATELY.** Do NOT start Milestone 2. Output a single short message telling the user:
   > *"Phase 1 (Architecture, Schema & Contracts) is complete and verified. `HANDOFF.md` has been written. Please switch your Antigravity model to **Gemini 4 Argon (High)** and reply `'Continue with Phase 2'`."*

---

### PHASE 2: TDD IMPLEMENTATION, RTL FRONTEND & E2E VERIFICATION
> **Active Model:** `Gemini 4 Argon (High)`
> **Active Skills:** `Superpowers`, `Ponytail`, `typescript-pro`, `api-design-principles`, `Frontend Design`, `Emil Kowalski Design Eng`, `e2e-testing-patterns`

#### Milestone 2: Core Domain Services, Star Ledger & Midnight Rollover Engine (Strict TDD)
Follow strict **Red-Green-Refactor** in `packages/server/src/services/` with comprehensive Vitest suites in `packages/server/test/services/`:
1. **Timezone & Date Service (`date.service.ts`):**
   * Write unit tests proving accurate `YYYY-MM-DD`, Israeli day-of-week (`0=Sun..6=Sat`),Israeli week start/end bounds, and time-window resolution (`MORNING`, `AFTERNOON`, `EVENING`) across DST transitions in `Asia/Jerusalem`.
2. **Profile & PIN Auth Service (`user.service.ts`):**
   * Test and implement user creation, enforcing mandatory 4-digit PIN for `PARENT` and optional PIN for `CHILD`.
   * Test PIN verification and session token signing/validation.
   * Test lobby profile summary query: computes `hasOpenTasks: boolean` (true if user has uncompleted routines for today, pending one-off tasks, active claimed pool task, or pending peer requests) without leaking overwhelming task counts to the lobby card.
3. **Shared Pool State Machine Service (`pool.service.ts`):**
   * Write failing tests first for:
     * Claiming an available task (`לקחתי!`).
     * Rejecting a second claim by the same user (`409 Conflict` — 1 WIP limit).
     * Rejecting a claim on an inactive (`isActive === false`) or cooling-down task.
     * Unclaiming (`החזר לקופה`) and automatic 60-minute claim expiry sweep.
     * Completing a claimed task under `COOLDOWN` mode (transitions to `COOLDOWN` for `cooldownMinutes`, then back to `AVAILABLE` after expiry).
     * Completing a claimed task under `AUTO_DISABLE` mode (transitions to `isActive = false`, `state = 'AVAILABLE'`).
     * Awarding stars in `star_transactions` upon completion.
4. **Routines, One-Offs, Peer Requests & Undo/Revert Service (`task.service.ts` & `star.service.ts`):**
   * Test and implement CRUD and completion flows for Routines (`0` stars), One-Offs (`0..N` stars), and Peer Requests (`0` stars, Complete vs. Decline vs. Parent Cancel).
   * Test and implement **Undo/Revert (`ביטול השלמה`)**: verifies that reverting a completed task restores its open state (and re-enables an `AUTO_DISABLE` pool task) and records a negative `-N` compensating entry in `star_transactions`.
   * Test Star Analytics queries for Daily, Weekly (Sun–Sat), Monthly, and Yearly aggregations.
5. **Midnight Rollover Service (`rollover.service.ts`):**
   * Test and implement the idempotent `runDailyRollover(targetDate)` job: writes `MISSED` snapshots to `routine_daily_logs` for any uncompleted routines scheduled on `targetDate`, while leaving pending `one_off_tasks` and `peer_requests` intact to roll over.
   * Ensure the server runs a catch-up check on boot in case the LXC container was offline at `00:00`.

#### Milestone 3: Fastify REST API & Database Seed (`packages/server`)
Using `api-design-principles`, build and integration-test the Fastify server (`src/app.ts`):
1. **Endpoints (`/api/v1`):**
   * `GET /api/v1/lobby` — Returns `appSettings`, server time (`Asia/Jerusalem`), and profile cards (`id`, `name`, `avatarEmoji`, `avatarBgColor`, `role`, `hasPin`, `hasOpenTasks`, `totalStars`).
   * `POST /api/v1/auth/login` — Validates profile ID + optional/mandatory PIN; sets HTTP-only signed session cookie (or returns session token).
   * `GET /api/v1/users/:id/dashboard` — Returns structured data for `היום שלי` (active claimed pool task, pending one-off tasks, today's scheduled routines grouped by time window, pending peer requests, and today's completed items).
   * `POST /api/v1/routines/:id/complete` & `POST /api/v1/routines/:id/revert`
   * `POST /api/v1/one-offs/:id/complete` & `POST /api/v1/one-offs/:id/revert`
   * `GET /api/v1/pool` — Lists active pool tasks with live state (`AVAILABLE`, `CLAIMED`, `COOLDOWN`) after running lazy expiry evaluation.
   * `POST /api/v1/pool/:id/claim`, `POST /api/v1/pool/:id/unclaim`, `POST /api/v1/pool/:id/complete`, `POST /api/v1/pool/executions/:execId/revert`
   * `POST /api/v1/peer-requests`, `POST /api/v1/peer-requests/:id/complete`, `POST /api/v1/peer-requests/:id/decline`, `POST /api/v1/peer-requests/:id/cancel`
   * `GET /api/v1/stars/summary` — Returns Daily, Weekly, Monthly, Yearly, and Total stars per user.
   * `GET /api/v1/history?date=YYYY-MM-DD` — Returns full daily history across all categories and users for the given date.
   * `Admin Routes (/api/v1/admin/* — Protected by Parent Session Guard):`
     * Settings update (`appTitle`, `announcementText`, `announcementEmoji`)
     * User CRUD & PIN management
     * Routine template CRUD
     * One-Off task CRUD & cancellation
     * Pool task CRUD & one-tap `PATCH /api/v1/admin/pool/:id/toggle-active`
2. **Default Seed Script (`npm run db:seed`):**
   * Seeds `app_settings` with `appTitle = 'הבית שלנו'`, sample parent profiles (with default PIN `1234`), sample child profiles, morning/evening routines with emojis & Niqqud, and sample `קופת המשימות` tasks (including a dishwasher task in `AUTO_DISABLE` mode and a living-room tidy task in `COOLDOWN` mode).
3. **Verification Gate:** All API integration tests in `packages/server/test/api/` pass via `fastify.inject()`.

#### Milestone 4: Mobile-First Hebrew RTL Frontend — Lobby, `היום שלי`, `קופת המשימות` & `בקשות עזרה`
Activate `Frontend Design` and `Emil Kowalski Design Engineering` to build `packages/web`:
1. **RTL & Design Foundation:**
   * Set `<html lang="he" dir="rtl">` in `index.html` and load Google Font **`Rubik`**.
   * Enforce Tailwind logical properties across every component.
   * Create a warm, tactile Hearth-inspired palette (soft cream/sand background, crisp high-contrast cards, emerald completion accents, golden star badges) designed for effortless legibility by a 6-year-old.
2. **Lobby Screen (`/`):**
   * Header with dynamic `appTitle` (`הבית שלנו`), live clock, Hebrew date, and `היסטוריה` button.
   * Family Announcement banner.
   * Netflix-style profile picker cards with large avatar emoji, star counter badge, and the **non-overwhelming pulsing task indicator dot** (zero numbers).
   * Tactile 4-digit PIN keypad modal with shake animation on wrong PIN.
3. **User Workspace (`/profile/:id`):**
   * **`היום שלי` Tab:** Implements the exact 5-tier visual hierarchy:
     1. Highlighted Claimed Pool Task hero card (with live countdown timer, `בוצע!`, and `החזר לקופה`).
     2. `משימות מיוחדות` (One-Off tasks with star badges).
     3. `שגרה יומית` (Routines grouped into `בוקר`, `צהריים`, `ערב`, `כל היום`, auto-expanding the current window).
     4. `בקשות עזרה` (Peer requests with `בוצע` and `דחה` buttons + modal to send a help request to a sibling/parent with an emoji picker).
     5. Collapsible `בוצעו היום` section with `ביטול השלמה` (Undo) buttons.
   * **`קופת המשימות` Tab:** Shared pool board showing `AVAILABLE` tasks with **`לקחתי!`** button, `CLAIMED` status badges, and `COOLDOWN` countdown timers.
   * **Micro-Interactions:** Smooth spring transitions when checking off tasks, celebratory star-fly/confetti pulse on completion, and responsive touch feedback.

#### Milestone 5: Parent Admin (`ניהול הבית`), Star Analytics & History (`היסטוריה`)
1. **`היסטוריה` View & Star Breakdown Modal:**
   * Interactive date stepper (`YYYY-MM-DD`) displaying completed routines, missed routines (`לא בוצע`), one-off tasks, pool completions, and peer requests per family member.
   * Star summary view with tabs for **יומי (Daily)**, **שבועי (Weekly Sun–Sat)**, **חודשי (Monthly)**, and **שנתי (Yearly)**.
2. **`ניהול הבית` (Parent Admin Dashboard):**
   * Accessible only to logged-in `PARENT` profiles.
   * **Instant Pool Switchboard:** Top row of one-tap toggle switches (`פעיל / כבוי`) for all `קופת המשימות` tasks (e.g., turning "פינוי מדיח" on in one tap), plus modal to create/edit pool tasks (`COOLDOWN` vs `AUTO_DISABLE`, cooldown minutes, stars, emoji).
   * Full management tabs for Users & PINs, Routines (with Israeli Sun–Sat day pills and time window selector), One-Off assignments, Active Task cancellation/reversion, and Family Announcement / App Title editing.

#### Milestone 6: Playwright E2E Verification & Proxmox LXC Production Packaging
Activate `e2e-testing-patterns`:
1. **End-to-End Playwright Suite (`e2e/`):**
   * **Flow 1 (Lobby & PIN):** Verify Hebrew RTL rendering (`dir="rtl"`), non-numeric open-task indicator on lobby cards, child login without PIN, and mandatory PIN enforcement for Parent profile.
   * **Flow 2 (`קופת המשימות` WIP & Cooldown):** Child claims a pool task (`לקחתי!`) $\rightarrow$ attempts to claim a second pool task and verifies `1-WIP` block $\rightarrow$ completes the first task (`בוצע!`) $\rightarrow$ verifies stars increase and task enters `COOLDOWN` (or `AUTO_DISABLE` disappears from active pool).
   * **Flow 3 (Undo/Revert):** Child clicks `ביטול השלמה` under `בוצעו היום` $\rightarrow$ verifies stars are deducted back and task returns to active state.
   * **Flow 4 (Peer Help Request):** Child A creates a help request for Child B $\rightarrow$ Child B sees it under `בקשות עזרה` and declines (`דחה`) or completes (`בוצע`).
   * **Flow 5 (Parent Admin):** Parent logs in with PIN $\rightarrow$ updates the Family Announcement and toggles an `AUTO_DISABLE` pool task back to active $\rightarrow$ verifies immediate update on the lobby and pool screens.
2. **Production Build & LXC Deployment Artifacts:**
   * Configure root `npm run build` to build `packages/shared`, `packages/web` (copied/served by Fastify static), and `packages/server`.
   * Generate `deploy/habait.service` (systemd unit file running as unprivileged `habait` user with `Environment="NODE_ENV=production"`, `Environment="TZ=Asia/Jerusalem"`, `Environment="PORT=3000"`, `Environment="DB_PATH=/var/lib/habait/habait.db"`, `MemoryMax=256M`).
   * Generate `deploy/install-lxc.sh` (idempotent setup script for a fresh Debian 12 Proxmox LXC container).
3. **Final Verification Gate:** Run `npm run typecheck`, `npm test` (all Vitest suites), `npm run build`, and `npx playwright test`. All checks must pass with zero warnings or errors.