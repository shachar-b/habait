# User Profile Self-Service & Family Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable any logged-in user to customize their own PIN, nickname, avatar emoji (including a custom emoji keyboard input), and background color in a new `👤 הפרופיל שלי` tab, while enabling parents in `⚙️ ניהול הבית` to edit all family member fields, manage PINs, and permanently hard-delete unwanted profiles (such as the seeded `נועה` and `יובל`) and their tasks/history.

**Architecture:** Add a nullable `nickname` column to `users` via an auto-applied Drizzle migration, validate single-grapheme emojis and self-service payloads in `@habait/shared`, implement `updateOwnProfile` and transactional `deleteUser` in `user.service.ts`, expose `PATCH /api/v1/users/me/profile` and `DELETE /api/v1/admin/users/:id` in `app.ts`, and build `ProfileSettingsView.tsx` plus the upgraded family management section in `AdminView.tsx`.

**Tech Stack:** TypeScript (strict), Zod, Fastify, Drizzle ORM + `better-sqlite3` (WAL), React 19, Tailwind CSS v4 (RTL logical properties), Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-27-user-profile-and-family-management-design.md`](../specs/2026-10-27-user-profile-and-family-management-design.md)

## Global Constraints

- **Strict TDD (Red-Green-Refactor):** Every domain and API feature begins with a failing Vitest test before implementation.
- **Zero Business Logic in Transport/UI:** Fastify routes and React components must never contain raw database queries or domain state rules.
- **Hebrew-First & Native RTL (`dir="rtl"`):** Use Tailwind CSS logical properties (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `text-start`, `border-s-*`) exclusively. Physical horizontal directional classes (`pl-*`, `pr-*`, `ml-*`, `mr-*`, `left-*`, `right-*`, `text-left`, `text-right`) are banned and enforced by `api.test.ts`.
- **Tactile Design Engineering:** Minimum `48px × 48px` (`min-h-12 min-w-12`) touch targets, `scale(0.97)` `:active` feedback, `Rubik` typography with Niqqud support.

## Review Focus

1. **Compound ZWJ / variation-selector emojis vs. plain text in `EmojiSchema`:** Single visual emojis composed of multiple code points (e.g., `🦸‍♀️`, `🧑‍🚀`, `1️⃣`) must pass `EmojiSchema`, whereas plain ASCII/Hebrew letters (`"a"`, `"א"`) or multi-emoji strings (`"🦄🦁"`) must be rejected.
2. **Empty or whitespace-only `nickname` normalization:** Passing `nickname: ""` or `nickname: "   "` in `NicknameSchema` / `updateOwnProfile` / `updateUser` must normalize to `null` (clearing the nickname) instead of throwing a min-length error or storing blank text.
3. **Active `CLAIMED` pool task cleanup on user deletion:** Deleting a user who currently holds a claimed pool task must reset `state = 'AVAILABLE'`, `claimedByUserId = null`, `claimedAt = null`, `claimExpiresAt = null` together so SQLite's `pool_tasks_claim_consistent` CHECK constraint is satisfied.
4. **Foreign-key deletion order for `routine_daily_logs` before `routine_templates` / `users`:** Because `users` cascades to `routine_templates` while `routine_daily_logs.routine_id` references `routine_templates.id` without `ON DELETE CASCADE`, `deleteUser` must delete `routine_daily_logs` (for the user's routines and assignee rows) before deleting `routine_templates` and `users`.
5. **Reassigning `createdBy` / `createdById` on shared tasks before deleting a parent:** If a parent created `pool_tasks`, `routine_templates`, or `one_off_tasks` for other family members, `deleteUser` must reassign those creator foreign keys to `actorUserId` (and clear `app_settings.announcementUpdatedBy`) before deleting the parent's `users` row.

---

### Task 1: Shared Zod Contracts, Single-Emoji Grapheme Validator & Nickname DTOs (`packages/shared`)

**Files:**
- Modify: `packages/shared/src/entities.ts:36-69`
- Modify: `packages/shared/src/api.ts:40-53,227-261`
- Modify: `packages/shared/src/copy.ts:8-14`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/contracts.test.ts`

**Interfaces:**
- Consumes: `PinSchema`, `TitleSchema`, `UserRoleSchema` in `packages/shared/src/entities.ts`
- Produces:
  - `EmojiSchema`: validates 1 grapheme cluster containing `\p{Extended_Pictographic}` or `\p{Emoji_Presentation}` or `\p{Regional_Indicator}` (or keycap `\u20E3`)
  - `NicknameSchema`: `z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().min(1).max(40).nullable())`
  - `UserSchema` & `LobbyProfileSchema` with `nickname: z.string().nullable()`
  - `CreateUserRequestSchema` & `UpdateUserRequestSchema` with `nickname?: string | null`
  - `UpdateOwnProfileRequestSchema` & `UpdateOwnProfileRequest` (`{ nickname?: string | null; avatarEmoji?: string; avatarBgColor?: string; pin?: string | null }`)
  - `getDisplayName(user: { name: string; nickname?: string | null }): string`
  - `HEBREW_COPY.nav.myProfile = 'הפרופיל שלי'`

- [ ] **Step 1: Write the failing contract tests in `packages/shared/test/contracts.test.ts`**

Add tests covering `EmojiSchema` (simple emoji `🦄`, compound ZWJ emoji `🦸‍♀️`, keycap `1️⃣`, rejecting plain text `'א'`, `'ab'`, and two emojis `'🦄🦁'`), `NicknameSchema` (normalizing `''` and `'   '` to `null`), `UpdateOwnProfileRequestSchema` (accepting `nickname`, `avatarEmoji`, `avatarBgColor`, `pin`, and stripping/ignoring `name` or `role`), and `getDisplayName`:

```ts
describe('EmojiSchema (single emoji grapheme)', () => {
  it('accepts single simple and compound ZWJ emojis', () => {
    for (const emoji of ['🦄', '🦸‍♀️', '🧑‍🚀', '🏳️‍🌈', '1️⃣']) {
      expect(EmojiSchema.safeParse(emoji).success).toBe(true);
    }
  });

  it('rejects plain text or multiple emojis', () => {
    for (const bad of ['', 'a', 'א', 'שלום', '🦄🦁', '12']) {
      expect(EmojiSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('NicknameSchema & UpdateOwnProfileRequestSchema', () => {
  it('normalizes empty or whitespace-only nickname to null', () => {
    expect(NicknameSchema.parse('')).toBeNull();
    expect(NicknameSchema.parse('   ')).toBeNull();
    expect(NicknameSchema.parse(' שוער העל ')).toBe('שוער העל');
  });

  it('accepts valid self-service profile fields and rejects empty object', () => {
    expect(
      UpdateOwnProfileRequestSchema.safeParse({
        nickname: 'נועה המלכה',
        avatarEmoji: '👑',
        avatarBgColor: 'bg-amber-200',
        pin: '4321',
      }).success,
    ).toBe(true);
    expect(UpdateOwnProfileRequestSchema.safeParse({}).success).toBe(false);
  });

  it('getDisplayName prefers non-empty nickname and falls back to name', () => {
    expect(getDisplayName({ name: 'נועה', nickname: 'נועה המלכה' })).toBe('נועה המלכה');
    expect(getDisplayName({ name: 'נועה', nickname: null })).toBe('נועה');
    expect(getDisplayName({ name: 'נועה', nickname: '  ' })).toBe('נועה');
  });
});
```

- [ ] **Step 2: Run the shared contract tests to verify they fail**

Run: `npx vitest run packages/shared/test/contracts.test.ts`
Expected: FAIL (`EmojiSchema` / `NicknameSchema` / `UpdateOwnProfileRequestSchema` / `getDisplayName` missing or failing assertions)

- [ ] **Step 3: Implement `EmojiSchema`, `NicknameSchema`, `UpdateOwnProfileRequestSchema`, `getDisplayName`, and `HEBREW_COPY.nav.myProfile`**

In `packages/shared/src/entities.ts`:
- Implement `isSingleEmojiGrapheme(s: string): boolean` using `new Intl.Segmenter('he', { granularity: 'grapheme' })`:
  ```ts
  const graphemeSegmenter = new Intl.Segmenter('he', { granularity: 'grapheme' });
  const EMOJI_GRAPHEME_RE = /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|\u20E3)/u;

  export const EmojiSchema = z
    .string()
    .trim()
    .min(1)
    .max(16)
    .refine((val) => {
      const segments = Array.from(graphemeSegmenter.segment(val));
      return segments.length === 1 && EMOJI_GRAPHEME_RE.test(val);
    }, 'Must be a single emoji');
  ```
- Define `NicknameSchema`:
  ```ts
  export const NicknameSchema = z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().min(1).max(40).nullable(),
  );
  ```
- Add `nickname: z.string().nullable()` to `UserSchema` (and `getDisplayName` helper in `entities.ts`).
- In `packages/shared/src/api.ts`:
  - Add `nickname: z.string().nullable()` to `LobbyProfileSchema`.
  - Add `nickname: NicknameSchema.optional()` to `UserFieldsSchema`.
  - Define and export `UpdateOwnProfileRequestSchema` and `UpdateOwnProfileRequest`.
- In `packages/shared/src/copy.ts`:
  - Add `myProfile: 'הפרופיל שלי'` to `HEBREW_COPY.nav`.

- [ ] **Step 4: Run the shared contract tests to verify they pass**

Run: `npx vitest run packages/shared/test/contracts.test.ts`
Expected: PASS

---

### Task 2: Database Schema, Migration (`0001_user_nickname.sql`), `updateOwnProfile` & `deleteUser` (`packages/server`)

**Files:**
- Modify: `packages/server/src/db/schema.ts:60-79`
- Create: `packages/server/drizzle/0001_user_nickname.sql`
- Modify: `packages/server/drizzle/meta/_journal.json`
- Modify: `packages/server/src/services/user.service.ts:112-203,372-398`
- Test: `packages/server/test/services/user.service.test.ts`

**Interfaces:**
- Consumes: `UpdateOwnProfileRequest`, `CreateUserRequest`, `UpdateUserRequest`, `User`, `LobbyProfile` from `@habait/shared`
- Produces:
  - `updateOwnProfile(db: Db, userId: number, input: UpdateOwnProfileRequest): User`
  - `deleteUser(db: Db, targetUserId: number, actorUserId: number): void`

- [ ] **Step 1: Write the failing unit tests in `packages/server/test/services/user.service.test.ts`**

Add tests for:
1. Creating and updating a user's `nickname` (including normalizing blank strings to `null` and surfacing `nickname` in `getLobbyData`).
2. `updateOwnProfile`: allows a child or parent to update their own `nickname`, `avatarEmoji` (including compound emoji `🦸‍♀️`), `avatarBgColor`, and `pin`; allows a child to clear their PIN (`pin: null`); forbids a `PARENT` from clearing their PIN (`pin: null` throws `DomainValidationError`).
3. `deleteUser`:
   - Hard-deletes a child (`נועה`) who has routines, `routine_daily_logs`, `one_off_tasks`, an active `CLAIMED` pool task, `pool_task_executions`, `peer_requests`, and `star_transactions`: verifies the user is removed from `users`, their active pool claim returns to `AVAILABLE`, and all their logs/tasks/stars are purged.
   - Reassigns `pool_tasks.createdById`, `routine_templates.createdBy`, and `one_off_tasks.createdById` (for other assignees) to `actorUserId` and clears `app_settings.announcementUpdatedBy` when a second parent is deleted by the first parent.
   - Throws `DomainValidationError` when attempting to delete oneself (`targetUserId === actorUserId`) or the last remaining active `PARENT`.

- [ ] **Step 2: Run the user service tests to verify they fail**

Run: `npx vitest run packages/server/test/services/user.service.test.ts`
Expected: FAIL (`updateOwnProfile` / `deleteUser` not exported or `nickname` column missing)

- [ ] **Step 3: Add `nickname` to `schema.ts`, create `0001_user_nickname.sql`, and implement `updateOwnProfile` and `deleteUser` in `user.service.ts`**

1. In `packages/server/src/db/schema.ts`, add `nickname: text('nickname'),` to `users`.
2. Create `packages/server/drizzle/0001_user_nickname.sql`:
   ```sql
   ALTER TABLE `users` ADD `nickname` text;
   ```
   And append entry `idx: 1, version: "6", when: 1793136000000, tag: "0001_user_nickname", breakpoints: true` to `packages/server/drizzle/meta/_journal.json`.
3. In `packages/server/src/services/user.service.ts`:
   - Map `nickname: row.nickname ?? null` in `toUserDto` and `getLobbyData`.
   - Handle `nickname` in `createUser` and `updateUser` (normalizing empty/whitespace string to `null`).
   - Implement `updateOwnProfile(db: Db, userId: number, input: UpdateOwnProfileRequest): User`.
   - Implement `deleteUser(db: Db, targetUserId: number, actorUserId: number): void` inside `db.transaction((tx) => { ... })` following the exact FK order from Review Focus #3, #4, #5.

- [ ] **Step 4: Run all server unit tests to verify they pass**

Run: `npx vitest run packages/server/test/services/user.service.test.ts packages/server/test/schema.test.ts`
Expected: PASS

---

### Task 3: Fastify Endpoints (`PATCH /api/v1/users/me/profile` & `DELETE /api/v1/admin/users/:id`) (`packages/server`)

**Files:**
- Modify: `packages/server/src/app.ts:12-28,63-73,170-180,368-376`
- Test: `packages/server/test/api/api.test.ts`

**Interfaces:**
- Consumes: `UpdateOwnProfileRequestSchema`, `IdParamSchema` from `@habait/shared`; `updateOwnProfile`, `deleteUser` from `./services/user.service.js`
- Produces:
  - `PATCH /api/v1/users/me/profile` $\rightarrow$ `200 { user: User }`
  - `DELETE /api/v1/admin/users/:id` $\rightarrow$ `200 { ok: true }`

- [ ] **Step 1: Write the failing API integration tests in `packages/server/test/api/api.test.ts`**

Add integration tests in `packages/server/test/api/api.test.ts`:
1. `PATCH /api/v1/users/me/profile` allows a logged-in child to set their `nickname`, custom `avatarEmoji`, `avatarBgColor`, and `pin` (and subsequently requires that PIN on `/api/v1/auth/login`, then allows clearing `pin: null`), while ignoring/rejecting any attempt to change `name` or `role`.
2. `PATCH /api/v1/users/me/profile` allows a logged-in parent to change their PIN from `'1234'` to `'5678'`, and rejects `pin: null` with `400`.
3. `DELETE /api/v1/admin/users/:id` forbids children (`403`), blocks a parent from deleting themselves (`400`), and allows a parent to delete seeded `נועה` and `יובל` (`200 { ok: true }`), removing them from `/api/v1/lobby` and `/api/v1/history`.

- [ ] **Step 2: Run the API integration tests to verify they fail**

Run: `npx vitest run packages/server/test/api/api.test.ts`
Expected: FAIL (`404` on `PATCH /api/v1/users/me/profile` and `DELETE /api/v1/admin/users/:id`)

- [ ] **Step 3: Register `PATCH /api/v1/users/me/profile` and `DELETE /api/v1/admin/users/:id` in `packages/server/src/app.ts`**

In `packages/server/src/app.ts`:
- Add `PATCH /api/v1/users/me/profile` with `{ schema: { body: UpdateOwnProfileRequestSchema } }`, calling `requireAuth(req)` and `updateOwnProfile(db, actor.userId, req.body)`.
- Add `DELETE /api/v1/admin/users/:id` with `{ schema: { params: IdParamSchema } }`, calling `requireParent(req)` and `deleteUser(db, req.params.id, parent.userId)`.

- [ ] **Step 4: Run the API integration tests to verify they pass**

Run: `npx vitest run packages/server/test/api/api.test.ts`
Expected: PASS

---

### Task 4: Frontend `👤 הפרופיל שלי` Tab (`ProfileSettingsView.tsx`), Admin Family Management (`AdminView.tsx`), Nickname Display & E2E (`packages/web` & `e2e`)

**Files:**
- Modify: `packages/web/src/api.ts`
- Create: `packages/web/src/components/ProfileSettingsView.tsx`
- Modify: `packages/web/src/components/WorkspaceView.tsx`
- Modify: `packages/web/src/components/AdminView.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `e2e/habait.spec.ts`

**Interfaces:**
- Consumes: `UpdateOwnProfileRequest`, `getDisplayName`, `HEBREW_COPY` from `@habait/shared`
- Produces:
  - `api.updateOwnProfile(payload: UpdateOwnProfileRequest): Promise<UserResponse>`
  - `api.adminDeleteUser(id: number): Promise<{ ok: boolean }>`
  - `ProfileSettingsView` component (`data-testid="profile-settings-view"`)
  - Updated `AdminView` family management section with inline edit & delete (`data-testid="admin-edit-user-${u.id}"`, `data-testid="admin-delete-user-${u.id}"`)

- [ ] **Step 1: Add `updateOwnProfile` and `adminDeleteUser` to `packages/web/src/api.ts`**

Add:
- `updateOwnProfile: (payload: UpdateOwnProfileRequest) => request<UserResponse>('/api/v1/users/me/profile', { method: 'PATCH', body: JSON.stringify(payload) })`
- `adminDeleteUser: (id: number) => request<{ ok: boolean }>(`/api/v1/admin/users/${id}`, { method: 'DELETE' })`

- [ ] **Step 2: Create `packages/web/src/components/ProfileSettingsView.tsx`**

Build `ProfileSettingsView.tsx` using only logical RTL Tailwind utilities (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `text-start`):
- **Live Identity Card Preview** at the top showing how the user's card looks in the Lobby (`nickname || name`, official `name` badge when a nickname is set, `avatarEmoji`, `avatarBgColor`, total stars).
- **Identity & Appearance Form:**
  - Read-only `שם פרטי (נקבע על ידי ההורים 🔒)` input showing `user.name`.
  - Editable `כינוי אישי` input (`data-testid="profile-nickname-input"`).
  - Curated 12-emoji preset grid (`🦄`, `🦁`, `🦖`, `🦊`, `🐼`, `🦸‍♀️`, `🦸‍♂️`, `⚽`, `🎨`, `🚀`, `👑`, `🐶`) + **`+ אימוג׳י מהמקלדת`** custom single-emoji input (`data-testid="profile-custom-emoji-input"`) that segments input to the last entered emoji grapheme.
  - 8 background color swatches (`bg-emerald-200`, `bg-sky-200`, `bg-rose-200`, `bg-amber-200`, `bg-violet-200`, `bg-teal-200`, `bg-orange-200`, `bg-indigo-200`).
  - Save button (`data-testid="profile-save-identity-btn"`).
- **Self-Service PIN Section:**
  - 4-digit numeric PIN input (`data-testid="profile-new-pin-input"`) + `עדכן קוד סודי` button (`data-testid="profile-save-pin-btn"`).
  - For `CHILD` users with `user.hasPin === true`: `הסר קוד (כניסה מהירה)` button (`data-testid="profile-remove-pin-btn"`).

- [ ] **Step 3: Wire `ProfileSettingsView` into `WorkspaceView.tsx`, update Nickname Display in `App.tsx` & `WorkspaceView.tsx`, and upgrade `AdminView.tsx`**

1. In `WorkspaceView.tsx`:
   - Add `'myProfile'` to `WorkspaceTab` and render the `👤 הפרופיל שלי` tab button (`data-testid="tab-myProfile"`) for all users.
   - Render `getDisplayName(user)` in the workspace greeting (`HEBREW_COPY.greeting(getDisplayName(user))`) with a subtle `שם רשמי: {user.name}` pill when `user.nickname` is set.
   - Pass `currentUserId={user.id}` to `AdminView`.
2. In `App.tsx`:
   - Render `getDisplayName(profile)` as the primary `<h3>` on each Lobby card, and when `profile.nickname` is present, render a small subtitle pill with `profile.name`.
3. In `AdminView.tsx`:
   - Upgrade Section 5 (`בני המשפחה וקודים סודיים`) so every family member card has:
     - `✏️ עריכה וקוד` (`data-testid={`admin-edit-user-btn-${u.id}`}`): toggles an inline edit panel for `name`, `nickname`, `role`, `avatarEmoji` (preset + custom emoji input), `avatarBgColor`, and a new 4-digit PIN input (`data-testid={`admin-user-pin-input-${u.id}`}`) + "הסר קוד" button for children.
     - `🗑️ מחיקה` (`data-testid={`admin-delete-user-btn-${u.id}`}`): opens an inline confirmation bar (`בטוחים שברצונכם למחוק את {u.name}?` $\rightarrow$ `כן, מחק סופית` `data-testid={`admin-confirm-delete-user-${u.id}`}` / `ביטול`), hidden/disabled for the currently logged-in parent (`u.id === currentUserId`).

- [ ] **Step 4: Add Playwright E2E coverage in `e2e/habait.spec.ts` and run full verification**

Add an E2E test verifying:
1. A child logs in, opens `👤 הפרופיל שלי`, sets a nickname, picks a custom emoji, and sets a personal PIN.
2. A parent logs in, opens `⚙️ ניהול הבית`, changes their own PIN or edits a family member, and deletes `יובל`—confirming `יובל` disappears from the Lobby.

Run:
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npx playwright test`
Expected: All unit, integration, typecheck, build, and E2E suites PASS with 0 errors.
