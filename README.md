# 🏡 הבית שלנו (`habait`)

**`habait`** is a local-first, Hebrew-native (`he-IL`, strict RTL) family task, routine, and household chore management web application designed for wall tablets and phones. Inspired by Hearth Display and ChoreOps ("Jira for the family"), it runs as a single lightweight Node.js + SQLite (WAL) process inside an unprivileged Proxmox LXC container.

---

## ✨ Key Features

* **Netflix-Style Family Lobby (`/`)**
  * Dynamic family title (`הבית שלנו`), live `Asia/Jerusalem` digital clock & Hebrew calendar date, and family-wide announcement banner.
  * Kid-friendly profile cards (age 6+ ergonomics, large emoji avatars, `Rubik` font with Niqqud-safe line height).
  * **Non-Overwhelming Open-Task Indicator:** Shows a clean pulsing status dot (`יש משימות פתוחות` vs. `הכל בוצע!`) without anxiety-inducing task counts.
  * **Conditional PIN Auth:** Parents require a 4-digit PIN (hashed with `crypto.scrypt` and verified against live DB role/active status); children can log in with a single tap or an optional PIN.
* **Personal Workspace (`היום שלי`)**
  1. **Active Claimed Pool Task Hero Card:** Live 60-minute countdown timer, star bounty (`+X ⭐`), `בוצע!` (Complete), and `החזר לקופה` (Unclaim).
  2. **One-Off Assigned Tasks (`משימות מיוחדות`):** Parent-assigned tasks (`0..N` stars) that roll over across midnight until completed or canceled.
  3. **Daily Routines (`שגרה יומית`):** Recurring zero-star habits scheduled on Israeli days of the week (`0 = יום א׳` … `6 = שבת`) across `בוקר`, `צהריים`, `ערב`, and `כל היום`, auto-expanding the active time window.
  4. **Peer-to-Peer Help Requests (`בקשות עזרה`):** Zero-star sibling/family help requests (`בוצע` / `דחה` / `ביטול`) to encourage cooperation without star farming.
  5. **Completed Today (`בוצעו היום`) & Undo (`ביטול השלמה`):** Same-day undo restores task state and writes a compensating `-N` entry to the immutable star ledger.
* **Shared Household Pool (`קופת המשימות`)**
  * **Strict 1-WIP Limit:** Each family member can hold at most **1** active claimed pool task at a time (enforced in both the domain service and a SQLite partial unique index).
  * **1-Hour Claim Expiry:** Unfinished claims automatically return to `AVAILABLE` after 60 minutes.
  * **Two Reset Modes:**
    * `COOLDOWN` (`מחזורי עם השהיה`): Enters a configurable cooldown timer after completion before returning to `AVAILABLE`.
    * `AUTO_DISABLE` (`הפעלה ידנית`): Automatically turns `isActive = false` upon completion (ideal for event-driven chores like unloading the dishwasher) until re-enabled by a parent in one tap.
* **Immutable Star Ledger & History (`היסטוריה`)**
  * Stars are never stored as a mutable counter; all balances (`יומי`, `שבועי`, `חודשי`, `שנתי`, `סה״כ`) are derived from `star_transactions`.
  * **Midnight Rollover (`00:00` `Asia/Jerusalem`):** Idempotent daily rollover snapshots uncompleted scheduled routines as `MISSED` in `routine_daily_logs` and catches up automatically on boot if the container was powered off overnight.
* **Parent Admin (`ניהול הבית`)**
  * Protected by server-side `PARENT` session verification.
  * One-tap `פעיל / כבוי` switchboard for `קופת המשימות`, full CRUD for Pool Tasks, Routines, One-Offs, Profiles & PINs, and Family Announcements.

---

## 🏗️ Architecture & Tech Stack

```text
habait/
├── ARCHITECTURE.md             # Layer boundaries, Pool state machine & Rollover spec
├── SPEC.md                     # Master domain & UI/UX specification
├── deploy/
│   ├── habait.service          # Hardened systemd unit (MemoryMax=256M, TZ=Asia/Jerusalem)
│   └── install-lxc.sh          # Idempotent Debian 12 Proxmox LXC installer
├── e2e/
│   └── habait.spec.ts          # Playwright E2E suite (Flows 1–5)
└── packages/
    ├── shared/                 # Zod schemas, DTOs, error codes, Asia/Jerusalem time helpers, Hebrew copy
    ├── server/                 # Fastify v5 REST API, Drizzle ORM, better-sqlite3 (WAL), Croner scheduler
    └── web/                    # Vite + React 19 + Tailwind CSS v4 (strict RTL logical properties)
```

* **Single-Origin Serving:** In production, Fastify serves the compiled Vite SPA from `/` and mounts REST endpoints under `/api/v1/*` on port `3000` (LAN & Cloudflare Tunnel ready).
* **SQLite WAL Pragmas:** `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`.

---

## 🚀 Quickstart (Local Development)

### Prerequisites
* **Node.js** `>= 22` LTS
* **npm** (v10+)

### 1. Install Dependencies
```bash
npm install
```

### 2. Seed Default Family Data (Optional — auto-runs on server start if DB is empty)
```bash
npm run db:seed
```
Default seeded profiles:
* **Parents (`PIN: 1234`):** `אִמָּא` (🦸‍♀️), `אַבָּא` (🦸‍♂️)
* **Children (no PIN):** `נוֹעָה` (🦄), `יוּבָל` (🦖)

### 3. Build All Workspaces & Start Server
```bash
npm run build
npm --workspace @habait/server run start
```
Then open `http://localhost:3000`.

*(For hot-reload backend development, run `npm --workspace @habait/server run dev`; for Vite frontend dev server with `/api` proxy, run `npm --workspace @habait/web run dev`.)*

---

## 🧪 Verification & Testing

```bash
# 1. Strict TypeScript typechecking across all workspaces
npm run typecheck

# 2. Unit & API integration test suite (Vitest — 58 tests)
npm test

# 3. Production bundle build (shared -> web -> server)
npm run build

# 4. End-to-End browser verification (Playwright — Flows 1–5)
npx playwright test
```

---

## 📦 Proxmox LXC Production Deployment

Target: Unprivileged **Debian 12** LXC container (`1 vCPU`, `512 MB RAM`, `4 GB disk`).

Run the idempotent installer as `root` inside the LXC container:
```bash
sudo bash deploy/install-lxc.sh
```

What `deploy/install-lxc.sh` does:
1. Configures container timezone to `Asia/Jerusalem`.
2. Installs Node.js 22 LTS and SQLite build dependencies.
3. Creates the unprivileged `habait` system user and `/var/lib/habait` data directory.
4. Copies the repo to `/opt/habait`, runs `npm ci && npm run build`, and generates a 32-byte random `SESSION_SECRET` in `/etc/habait/habait.env` (`0600`).
5. Installs, enables, and starts `habait.service` on port `3000`.

### Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen address |
| `DB_PATH` | `./data/habait.db` | SQLite database file path (`/var/lib/habait/habait.db` in LXC) |
| `TZ` | `Asia/Jerusalem` | Mandatory timezone for midnight rollover and time windows |
| `SESSION_SECRET` | *(dev fallback only)* | **Required in `NODE_ENV=production`**; HMAC-SHA256 secret for session cookies |
