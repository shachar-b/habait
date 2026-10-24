import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../packages/server/src/app.js';
import { createDb, migrateDb, type DbHandle } from '../packages/server/src/db/connection.js';
import { seedDatabase } from '../packages/server/src/db/seed.js';

const WEB_DIST_PATH = fileURLToPath(new URL('../packages/web/dist', import.meta.url));
const FIXED_NOW = Date.parse('2026-10-25T09:30:00+02:00');
const BASE_URL = 'http://habait.local:3000';

let handle: DbHandle;
let app: FastifyInstance;

test.beforeEach(async ({ page }) => {
  handle = createDb(':memory:');
  migrateDb(handle);
  seedDatabase(handle.db, FIXED_NOW);
  app = await buildApp({
    db: handle.db,
    now: () => FIXED_NOW,
    webDistPath: WEB_DIST_PATH,
  });
  await app.ready();

  let activeCookie = '';

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== BASE_URL) {
      return route.abort();
    }

    const headers: Record<string, string> = { ...req.headers() };
    if (activeCookie) {
      headers['cookie'] = activeCookie;
    }

    const postData = req.postDataBuffer();
    const res = await app.inject({
      method: req.method() as 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
      url: `${url.pathname}${url.search}`,
      headers,
      payload: postData ?? undefined,
    });

    const setCookieHeader = res.headers['set-cookie'];
    const firstCookie = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
    if (typeof firstCookie === 'string') {
      activeCookie = firstCookie.split(';')[0] ?? '';
    }

    const responseHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) {
      if (typeof v === 'string') responseHeaders[k] = v;
      else if (Array.isArray(v)) responseHeaders[k] = v.join(', ');
    }

    await route.fulfill({
      status: res.statusCode,
      headers: responseHeaders,
      body: res.rawPayload,
    });
  });
});

test.afterEach(async () => {
  await app.close();
  handle.sqlite.close();
});

test.describe('habait E2E Suite (Flows 1–5)', () => {
  test('Flow 1 (Lobby & PIN): verifies RTL rendering, non-numeric open-task indicator, PIN-less child login, and mandatory Parent PIN modal', async ({
    page,
  }) => {
    await page.goto(BASE_URL);

    // Verify Hebrew RTL on <html>
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.getByTestId('lobby-app-title')).toContainText('הבית שלנו');

    // Verify non-numeric open-task status indicator on child card (user 3 = Noa)
    const noaStatus = page.getByTestId('profile-status-3');
    await expect(noaStatus).toContainText('יש משימות פתוחות');
    const statusText = await noaStatus.innerText();
    expect(statusText).not.toMatch(/\d/);

    // Child (Noa, id=3) logs in immediately without PIN prompt
    await page.getByTestId('profile-card-3').click();
    await expect(page).toHaveURL(/\/profile\/3$/);
    await expect(page.getByTestId('workspace-greeting')).toContainText('שלום, נוֹעָה');

    // Return to lobby
    await page.getByTestId('switch-user-btn').click();
    await expect(page.getByTestId('lobby-screen')).toBeVisible();

    // Parent (Ima, id=1) requires 4-digit PIN
    await page.getByTestId('profile-card-1').click();
    await expect(page.getByTestId('pin-modal')).toBeVisible();

    // Enter wrong PIN 9999 -> shows error and stays on modal
    for (const d of ['9', '9', '9', '9']) {
      await page.getByTestId(`pin-key-${d}`).click();
    }
    await expect(page.getByTestId('pin-error')).toBeVisible();

    // Enter correct PIN 1234 -> navigates to parent workspace with Admin tab visible
    for (const d of ['1', '2', '3', '4']) {
      await page.getByTestId(`pin-key-${d}`).click();
    }
    await expect(page).toHaveURL(/\/profile\/1$/);
    await expect(page.getByTestId('tab-admin')).toBeVisible();
  });

  test('Flow 2 (קופת המשימות WIP & Cooldown): child claims pool task, verifies 1-WIP block, completes task, and verifies stars + COOLDOWN', async ({
    page,
  }) => {
    await page.goto(BASE_URL);
    await page.getByTestId('profile-card-3').click();
    await expect(page.getByTestId('workspace-stars-count')).toHaveText('0');

    // Switch to קופת המשימות tab
    await page.getByTestId('tab-pool').click();
    await expect(page.getByTestId('pool-tab-content')).toBeVisible();

    // Claim task 2 (סידור הסלון והכריות, 2 stars, COOLDOWN mode)
    await page.getByTestId('claim-pool-btn-2').click();

    // Verify 1-WIP block: helper banner is shown and other claim buttons are disabled with helper text
    await expect(page.getByTestId('pool-wip-helper-banner')).toContainText(
      'כבר לקחת משימה אחת — סיים אותה קודם!',
    );
    await expect(page.getByTestId('claim-pool-btn-1')).toBeDisabled();
    await expect(page.getByTestId('wip-helper-1')).toContainText(
      'כבר לקחת משימה אחת — סיים אותה קודם!',
    );

    // Go back to היום שלי and verify Section 1 Hero Card is at the top
    await page.getByTestId('tab-myDay').click();
    await expect(page.getByTestId('active-claim-hero')).toBeVisible();
    await expect(page.getByTestId('active-claim-hero')).toContainText('סִידּוּר הַסָּלוֹן');

    // Complete the claimed pool task (`בוצע!`)
    await page.getByTestId('hero-complete-pool-btn').click();

    // Stars increase to 2
    await expect(page.getByTestId('workspace-stars-count')).toHaveText('2');

    // On Pool tab, task 2 is now in COOLDOWN
    await page.getByTestId('tab-pool').click();
    await expect(page.getByTestId('pool-cooldown-badge-2')).toContainText('יהיה זמין שוב בעוד');
  });

  test('Flow 3 (Undo/Revert): child clicks ביטול השלמה under בוצעו היום and verifies stars are deducted and task returns to active state', async ({
    page,
  }) => {
    await page.goto(BASE_URL);
    await page.getByTestId('profile-card-3').click();
    await expect(page.getByTestId('workspace-stars-count')).toHaveText('0');

    // Complete One-Off task 1 (סידור מדף הספרים, +3 stars)
    await page.getByTestId('complete-one-off-1').click();
    await expect(page.getByTestId('workspace-stars-count')).toHaveText('3');
    await expect(page.getByTestId('one-off-card-1')).toBeHidden();

    // Undo from `בוצעו היום` (`ביטול השלמה`)
    await expect(page.getByTestId('completed-today-item-0')).toBeVisible();
    await page.getByTestId('undo-completed-0').click();

    // Stars are deducted back to 0 and task returns to active state
    await expect(page.getByTestId('workspace-stars-count')).toHaveText('0');
    await expect(page.getByTestId('one-off-card-1')).toBeVisible();
  });

  test('Flow 4 (Peer Help Request): Child A sends help request to Child B, and Child B completes or declines it', async ({
    page,
  }) => {
    await page.goto(BASE_URL);
    // Child A (Noa, id=3) logs in
    await page.getByTestId('profile-card-3').click();

    // Open Request Help modal and send request to Child B (Yuval, id=4)
    await page.getByTestId('open-request-help-btn').click();
    await expect(page.getByTestId('peer-request-modal')).toBeVisible();
    await page.getByTestId('peer-recipient-select').selectOption('4');
    await page.getByTestId('peer-title-input').fill('בוא תעזור לי לבנות מגדל לגו');
    await page.getByTestId('submit-peer-request-btn').click();
    await expect(page.getByTestId('peer-request-modal')).toBeHidden();

    // Switch to Child B (Yuval, id=4)
    await page.getByTestId('switch-user-btn').click();
    await page.getByTestId('profile-card-4').click();

    // Yuval sees the request under `בקשות עזרה`
    const peerCard = page.getByTestId('peer-request-card-1');
    await expect(peerCard).toBeVisible();
    await expect(peerCard).toContainText('בוא תעזור לי לבנות מגדל לגו');
    await expect(peerCard).toContainText('נוֹעָה');

    // Yuval completes the peer request (`בוצע`) -> 0 stars awarded (anti-gaming rule)
    await page.getByTestId('complete-peer-1').click();
    await expect(peerCard).toBeHidden();
    await expect(page.getByTestId('workspace-stars-count')).toHaveText('0');
  });

  test('Flow 5 (Parent Admin): Parent logs in with PIN, updates Family Announcement, and re-enables an AUTO_DISABLE pool task', async ({
    page,
  }) => {
    await page.goto(BASE_URL);

    // First, Child (Noa, id=3) claims and completes task 1 (פינוי מדיח הכלים, AUTO_DISABLE mode)
    await page.getByTestId('profile-card-3').click();
    await page.getByTestId('tab-pool').click();
    await page.getByTestId('claim-pool-btn-1').click();
    await page.getByTestId('pool-complete-btn-1').click();

    // Task 1 is AUTO_DISABLE, so it disappears from the active pool
    await expect(page.getByTestId('pool-card-1')).toBeHidden();

    // Switch to Parent (Ima, id=1) and enter PIN 1234
    await page.getByTestId('switch-user-btn').click();
    await page.getByTestId('profile-card-1').click();
    for (const d of ['1', '2', '3', '4']) {
      await page.getByTestId(`pin-key-${d}`).click();
    }

    // Open Parent Admin (`ניהול הבית`)
    await page.getByTestId('tab-admin').click();
    await expect(page.getByTestId('admin-view')).toBeVisible();

    // Re-enable Task 1 (`פינוי מדיח הכלים`) in one tap from the Instant Pool Switchboard
    await expect(page.getByTestId('admin-pool-toggle-1')).toHaveText('כבוי');
    await page.getByTestId('admin-pool-toggle-1').click();
    await expect(page.getByTestId('admin-pool-toggle-1')).toHaveText('פעיל');

    // Update Family Announcement & App Title
    await page.getByTestId('admin-app-title-input').fill('הבית של משפחת ישראלי');
    await page.getByTestId('admin-announcement-emoji-input').fill('🍕');
    await page.getByTestId('admin-announcement-text-input').fill('היום בערב מכינים פיצה ביתית!');
    await page.getByTestId('admin-save-settings-btn').click();
    await expect(page.getByTestId('admin-feedback')).toBeVisible();

    // Verify pool screen now shows Task 1 again
    await page.getByTestId('tab-pool').click();
    await expect(page.getByTestId('pool-card-1')).toBeVisible();

    // Verify Lobby screen shows updated App Title and Family Announcement
    await page.getByTestId('switch-user-btn').click();
    await expect(page.getByTestId('lobby-app-title')).toContainText('הבית של משפחת ישראלי');
    await expect(page.getByTestId('lobby-announcement-text')).toHaveText(
      'היום בערב מכינים פיצה ביתית!',
    );
    await expect(page.getByTestId('lobby-announcement-emoji')).toHaveText('🍕');
  });
});
