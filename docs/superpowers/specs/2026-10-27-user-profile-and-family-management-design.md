# User Profile Self-Service (`הפרופיל שלי`) & Parent Family Management — Design Spec

**Date:** 2026-10-27  
**Size:** Small Change (Focused feature addition across schema, shared contracts, user service, Fastify API, and React RTL views)

---

## 1. Intent & Why

After installing `habait` on a fresh LXC container, the database starts with seeded demo profiles (`אמא`, `אבא` with default PIN `1234`, and demo children `נועה` and `יובל`). Today, the backend supports updating users, but the UI is missing controls to:
1. Change a user's own PIN (or a parent's PIN).
2. Delete unwanted family members (like `נועה` and `יובל`) and clean up their tasks and history.
3. Let any user (child or parent) customize their own avatar emoji (including picking any custom emoji from their device keyboard), card background color, and a self-chosen nickname (`כינוי`)—while keeping their official `name` and `role` strictly parent-managed.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **Self-Service Personal Profile (`👤 הפרופיל שלי`):** Every logged-in user (child or parent) gets a `הפרופיל שלי` tab in their workspace to update their `nickname`, `avatarEmoji` (preset grid + custom single-emoji keyboard input), `avatarBgColor`, and 4-digit PIN (plus "Remove PIN" for children).
- **Parent Family Management (`בני המשפחה וקודים סודיים` in `⚙️ ניהול הבית`):** Parents can edit any family member's official `name`, `nickname`, `role`, `avatarEmoji` (including custom emoji), `avatarBgColor`, and PIN, or permanently delete a family member.
- **Zero-Junk Hard Delete:** Deleting a family member removes the user and all of their tasks, logs, peer requests, and star history in one transaction without breaking foreign keys on shared tasks.

### Non-Goals
- Changing the session cookie authentication mechanism or 4-digit numeric PIN format.
- Allowing children to view or edit other family members' settings.

### Anti-Goals
- **Privilege or Name Tampering:** A child must never be able to alter their official `name`, `role`, or `isActive` status—even by crafting a raw HTTP request.
- **Household Lockout:** Parents must never be able to delete the last remaining active `PARENT` profile or remove a parent's PIN.
- **Leftover Demo Junk:** Deleting seeded users (`נועה`, `יובל`) must not leave dead rows or "Inactive" ghost cards in `היסטוריה`.

---

## 3. Constraints

- **Hebrew-First & Native RTL (`dir="rtl"`):** All UI copy in idiomatic Hebrew; only Tailwind CSS logical properties (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `text-start`). Physical directional classes (`left-*`, `right-*`, `pl-*`, `pr-*`, `ml-*`, `mr-*`, `text-left`, `text-right`) are banned.
- **Strict TDD & Layer Separation:** Failing Vitest tests first (`Red` $\rightarrow$ `Green` $\rightarrow$ `Refactor`); all state rules and transactions live in `packages/server/src/services/user.service.ts`, never in Fastify routes or React components.
- **Design Engineering (`frontend-design` + `emil-design-eng`):**
  - Warm Hearth aesthetic (`#FAF6EE` sand canvas, crisp white cards, `Rubik` typography with `leading-relaxed` for Niqqud).
  - Tactile button responsiveness (`active:scale-[0.97] transition-transform duration-150 ease-out`), minimum `48px × 48px` (`min-h-12 min-w-12`) touch targets, and `prefers-reduced-motion` support.

---

## 4. Approaches Considered

1. **Approach 1 (Selected) — Hard-Delete Cascade in Transaction + Dedicated Self-Service Endpoint (`PATCH /api/v1/users/me/profile`):**
   - `DELETE /api/v1/admin/users/:id` runs a single SQLite transaction that releases active pool claims, reassigns `createdBy`/`createdById` on shared tasks to the acting parent, deletes all user-owned tasks/logs/executions/peer-requests/star-transactions, and deletes the `users` row.
   - `PATCH /api/v1/users/me/profile` accepts a dedicated `UpdateOwnProfileRequestSchema` (`nickname`, `avatarEmoji`, `avatarBgColor`, `pin`) that omits `name` and `role`.
   - *Why chosen:* Leaves zero dead rows or ghost history entries when deleting seeded demo kids (`נועה` and `יובל`) or fixing profile mistakes.
2. **Approach 2 — Smart Hybrid Delete (Hard-delete if no history, Soft-deactivate if history exists):**
   - *Tradeoff:* If a user tapped even one test task on `נועה` or `יובל` after installing, deleting them would still leave them visible in today's `היסטוריה` as inactive.
3. **Approach 3 — Always Soft-Delete (`isActive = false`) Only:**
   - *Tradeoff:* Leaves dead rows in SQLite permanently.

---

## 5. Detailed Design

### 5.1 Database Schema & Migration (`packages/server`)
- **`users` table (`packages/server/src/db/schema.ts`):**
  - Add `nickname: text('nickname')` (nullable).
- **Drizzle Migration (`packages/server/drizzle/0001_user_nickname.sql` + `_journal.json`):**
  - `ALTER TABLE users ADD COLUMN nickname text;`
  - Runs automatically on server startup via `migrateDb()` so existing LXC installations upgrade in place without losing data.

### 5.2 Shared Zod Contracts (`packages/shared`)
- **Single-Emoji Grapheme Validation (`EmojiSchema` in `entities.ts`):**
  - Trim string and validate with `Intl.Segmenter('he', { granularity: 'grapheme' })` that the input consists of **exactly 1 grapheme cluster** (max 16 UTF-16 code units) containing an emoji/pictographic character (`/(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator})/u`). This allows any single emoji from a native mobile/desktop keyboard (including compound ZWJ emojis like `🦸‍♀️` or `🧑‍🚀`) while rejecting plain text or multi-emoji strings.
- **`NicknameSchema`:**
  - `z.string().trim().min(1).max(40).nullable()`
- **DTO Updates:**
  - Add `nickname: z.string().nullable()` to `UserSchema` and `LobbyProfileSchema`.
  - Add optional `nickname: NicknameSchema.optional()` to `CreateUserRequestSchema` and `UpdateUserRequestSchema`.
- **New `UpdateOwnProfileRequestSchema` (`PATCH /api/v1/users/me/profile`):**
  ```ts
  export const UpdateOwnProfileRequestSchema = z
    .object({
      nickname: NicknameSchema,
      avatarEmoji: EmojiSchema,
      avatarBgColor: z.string().trim().min(1).max(40),
      pin: PinSchema.nullable(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
  ```

### 5.3 Domain Service Logic (`packages/server/src/services/user.service.ts`)
- **`updateOwnProfile(db, userId, input)`:**
  - Loads existing active user; throws `NOT_FOUND` if missing/inactive.
  - If `input.pin === null` and `user.role === 'PARENT'`, throws `DomainValidationError('PARENT profile must always have a PIN')`.
  - Updates only `nickname` (normalizing empty/whitespace string to `null`), `avatarEmoji`, `avatarBgColor`, and `pinHash`.
- **`deleteUser(db, targetUserId, actorUserId)`:**
  - Loads target user; throws `NOT_FOUND` if missing.
  - **Last-Parent & Self-Delete Guard (Builder Call):**
    - If `targetUserId === actorUserId`, throws `DomainValidationError('לא ניתן למחוק את הפרופיל שמחובר כרגע')` (prevents a parent from accidentally nuking their own active session; another parent can delete them if needed).
    - If `targetUser.role === 'PARENT'`, counts remaining active `PARENT` rows (`id <> targetUserId`). If `< 1`, throws `DomainValidationError('חייב להישאר לפחות הורה אחד בבית')`.
  - **Transactional Cascade (`db.transaction`):**
    1. Release active pool claims held by `targetUserId`: update `pool_tasks` set `state = 'AVAILABLE'`, `claimedByUserId = null`, `claimedAt = null`, `claimExpiresAt = null` where `claimedByUserId = targetUserId`.
    2. Preserve shared records authored by `targetUserId`:
       - Update `pool_tasks` set `createdById = actorUserId` where `createdById = targetUserId`.
       - Update `routine_templates` set `createdBy = actorUserId` where `createdBy = targetUserId AND assigneeId <> targetUserId`.
       - Update `one_off_tasks` set `createdById = actorUserId` where `createdById = targetUserId AND assigneeId <> targetUserId`.
       - Update `app_settings` set `announcementUpdatedBy = null` where `announcementUpdatedBy = targetUserId`.
    3. Delete user-specific records:
       - `DELETE FROM star_transactions WHERE user_id = targetUserId`
       - `DELETE FROM pool_task_executions WHERE user_id = targetUserId`
       - `DELETE FROM routine_daily_logs WHERE assignee_id = targetUserId`
       - `DELETE FROM routine_templates WHERE assignee_id = targetUserId`
       - `DELETE FROM one_off_tasks WHERE assignee_id = targetUserId`
       - `DELETE FROM peer_requests WHERE requester_id = targetUserId OR recipient_id = targetUserId`
    4. Delete user row:
       - `DELETE FROM users WHERE id = targetUserId`

### 5.4 Fastify Endpoints (`packages/server/src/app.ts`)
- `PATCH /api/v1/users/me/profile` (`requireAuth`, body: `UpdateOwnProfileRequestSchema`) $\rightarrow$ returns `{ user }`.
- `DELETE /api/v1/admin/users/:id` (`requireParent`, params: `IdParamSchema`) $\rightarrow$ returns `{ ok: true }`.

### 5.5 Frontend UX (`packages/web`)
- **Nickname Display Convention (Builder Call):**
  - On **Lobby cards (`App.tsx`)** and **Workspace header (`WorkspaceView.tsx`)**: if `user.nickname` is set, display `user.nickname` as the primary title/greeting (`שלום, {nickname}`), and render the official `user.name` in a small pill badge beside/below it so parents always know which profile is which. In Admin and History lists, show `name` (with `("כינוי")` in parentheses when present).
- **New `👤 הפרופיל שלי` Tab (`ProfileSettingsView.tsx` inside `WorkspaceView.tsx`):**
  - Added to the main workspace navigation bar for both `CHILD` and `PARENT` users.
  - **Live Identity Card Preview** at the top reflecting unsaved emoji, background color, and nickname changes in real time.
  - **Name & Nickname:** Read-only `שם פרטי (נקבע ע״י ההורים 🔒)` + editable `כינוי אישי` input (leaving it blank clears the nickname).
  - **Emoji Picker + Custom Emoji Input:** Grid of 12 quick-pick emojis (`🦄`, `🦁`, `🦖`, `🦊`, `🐼`, `🦸‍♀️`, `🦸‍♂️`, `⚽`, `🎨`, `🚀`, `👑`, `🐶`) plus a **`+ אימוג׳י מהמקלדת`** input box that accepts any single emoji character from the native OS emoji keyboard.
  - **Background Color Swatches:** 8 tactile color swatches (`bg-emerald-200`, `bg-sky-200`, `bg-rose-200`, `bg-amber-200`, `bg-violet-200`, `bg-teal-200`, `bg-orange-200`, `bg-indigo-200`).
  - **Self-Service PIN Card:** 4-digit numeric input (`עדכן קוד סודי`) for any user, plus `הסר קוד (כניסה ללא קוד)` button for `CHILD` users who currently have a PIN.
- **Upgraded `בני המשפחה וקודים סודיים` Section (`AdminView.tsx`):**
  - Each user row displays avatar, `name` (and `nickname` if set), role badge, and PIN status, with two action buttons:
    - `✏️ עריכה וקוד`: toggles an inline edit drawer for that user (`name`, `nickname`, `role`, `avatarEmoji` preset + custom keyboard input, `avatarBgColor`, and a 4-digit new PIN field + "Remove PIN" button for children).
    - `🗑️ מחיקה`: inline confirmation (`בטוחים שברצונכם למחוק את {name} וכל ההיסטוריה שלו/ה?` $\rightarrow$ `כן, מחק` / `ביטול`) calling `DELETE /api/v1/admin/users/:id`. Disabled on the currently logged-in parent's own row.
