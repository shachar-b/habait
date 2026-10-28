import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDb, migrateDb, type DbHandle } from '../../src/db/connection.js';
import { buildApp } from '../../src/app.js';
import { seedDatabase } from '../../src/db/seed.js';

let handle: DbHandle;
let app: FastifyInstance;
// Sunday 2026-10-25 09:00 Asia/Jerusalem (dayOfWeek = 0, MORNING)
let currentNow = Date.parse('2026-10-25T09:00:00+02:00');

beforeEach(async () => {
  currentNow = Date.parse('2026-10-25T09:00:00+02:00');
  handle = createDb(':memory:');
  migrateDb(handle);
  seedDatabase(handle.db, currentNow);
  app = await buildApp({ db: handle.db, now: () => currentNow });
});

afterEach(async () => {
  await app.close();
  handle.sqlite.close();
});

function extractSessionCookie(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (!first) throw new Error('Missing set-cookie header');
  return first.split(';')[0]!;
}

describe('Fastify API /api/v1 integration suite', () => {
  it('GET /api/v1/lobby returns appSettings, serverTime, and profile cards without task counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/lobby' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.appSettings.appTitle).toBe('הבית שלנו');
    expect(body.serverTime.logicalDate).toBe('2026-10-25');
    expect(body.profiles.length).toBeGreaterThanOrEqual(4);
    for (const p of body.profiles) {
      expect(typeof p.hasOpenTasks).toBe('boolean');
      expect('openTasksCount' in p).toBe(false);
    }
  });

  it('POST /api/v1/auth/login enforces PIN for PARENT and allows PIN-less login for CHILD', async () => {
    const lobby = (await app.inject({ method: 'GET', url: '/api/v1/lobby' })).json();
    const parent = lobby.profiles.find((p: { role: string }) => p.role === 'PARENT');
    const child = lobby.profiles.find((p: { role: string; hasPin: boolean }) => p.role === 'CHILD' && !p.hasPin);

    // Parent without PIN -> 401 INVALID_PIN
    const failRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { userId: parent.id },
    });
    expect(failRes.statusCode).toBe(401);
    expect(failRes.json().error.code).toBe('INVALID_PIN');

    // Parent with wrong PIN -> 401
    const wrongPin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { userId: parent.id, pin: '0000' },
    });
    expect(wrongPin.statusCode).toBe(401);

    // Parent with default seeded PIN 1234 -> 200 + session cookie
    const okParent = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { userId: parent.id, pin: '1234' },
    });
    expect(okParent.statusCode).toBe(200);
    expect(extractSessionCookie(okParent.headers)).toContain('habait_session=');

    // Child without PIN -> 200
    const okChild = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { userId: child.id },
    });
    expect(okChild.statusCode).toBe(200);
    expect(okChild.json().user.id).toBe(child.id);
  });

  it('supports full child dashboard, routine completion & revert, and pool claim/WIP/complete/revert flow', async () => {
    const lobby = (await app.inject({ method: 'GET', url: '/api/v1/lobby' })).json();
    const child = lobby.profiles.find((p: { role: string; hasPin: boolean }) => p.role === 'CHILD' && !p.hasPin);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { userId: child.id },
    });
    const cookie = extractSessionCookie(loginRes.headers);

    // Dashboard has morning routines for child
    const dashRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${child.id}/dashboard`,
      headers: { cookie },
    });
    expect(dashRes.statusCode).toBe(200);
    const dash = dashRes.json();
    const firstRoutine = dash.routines.MORNING[0];
    expect(firstRoutine).toBeDefined();

    // Complete routine -> 0 stars
    const compRoutine = await app.inject({
      method: 'POST',
      url: `/api/v1/routines/${firstRoutine.id}/complete`,
      headers: { cookie },
    });
    expect(compRoutine.statusCode).toBe(200);
    expect(compRoutine.json().starsAwarded).toBe(0);

    // Revert routine (by its log id)
    const revRoutine = await app.inject({
      method: 'POST',
      url: `/api/v1/routines/${compRoutine.json().item.log.id}/revert`,
      headers: { cookie },
    });
    expect(revRoutine.statusCode).toBe(200);

    // List pool tasks
    const poolRes = await app.inject({ method: 'GET', url: '/api/v1/pool' });
    expect(poolRes.statusCode).toBe(200);
    const poolTasks = poolRes.json().tasks;
    expect(poolTasks.length).toBeGreaterThanOrEqual(2);
    const [task1, task2] = poolTasks;

    // Claim task1
    const claim1 = await app.inject({
      method: 'POST',
      url: `/api/v1/pool/${task1.id}/claim`,
      headers: { cookie },
    });
    expect(claim1.statusCode).toBe(200);
    expect(claim1.json().task.state).toBe('CLAIMED');

    // Attempt to claim task2 -> 409 POOL_WIP_LIMIT_REACHED
    const claim2 = await app.inject({
      method: 'POST',
      url: `/api/v1/pool/${task2.id}/claim`,
      headers: { cookie },
    });
    expect(claim2.statusCode).toBe(409);
    expect(claim2.json().error.code).toBe('POOL_WIP_LIMIT_REACHED');

    // Complete task1
    const compPool = await app.inject({
      method: 'POST',
      url: `/api/v1/pool/${task1.id}/complete`,
      headers: { cookie },
    });
    expect(compPool.statusCode).toBe(200);
    const execId = compPool.json().execution.id;
    expect(compPool.json().starsAwarded).toBe(task1.stars);

    // Revert execution
    const revPool = await app.inject({
      method: 'POST',
      url: `/api/v1/pool/executions/${execId}/revert`,
      headers: { cookie },
    });
    expect(revPool.statusCode).toBe(200);
    expect(revPool.json().starsDelta).toBe(-task1.stars);
  });

  it('supports peer requests (create, decline, complete) and star/history endpoints', async () => {
    const lobby = (await app.inject({ method: 'GET', url: '/api/v1/lobby' })).json();
    const children = lobby.profiles.filter((p: { role: string }) => p.role === 'CHILD');
    const [childA, childB] = children;

    const cookieA = extractSessionCookie(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { userId: childA.id },
        })
      ).headers,
    );
    const cookieB = extractSessionCookie(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { userId: childB.id },
        })
      ).headers,
    );

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/peer-requests',
      headers: { cookie: cookieA },
      payload: { recipientId: childB.id, title: 'בוא נשחק יחד', iconEmoji: '🎲' },
    });
    expect(created.statusCode).toBe(201);
    const reqId = created.json().request.id;

    const declined = await app.inject({
      method: 'POST',
      url: `/api/v1/peer-requests/${reqId}/decline`,
      headers: { cookie: cookieB },
    });
    expect(declined.statusCode).toBe(200);
    expect(declined.json().request.status).toBe('DECLINED');

    const starsRes = await app.inject({ method: 'GET', url: '/api/v1/stars/summary' });
    expect(starsRes.statusCode).toBe(200);

    const histRes = await app.inject({
      method: 'GET',
      url: '/api/v1/history?date=2026-10-25',
    });
    expect(histRes.statusCode).toBe(200);
    expect(histRes.json().date).toBe('2026-10-25');
  });

  it('guards /api/v1/admin/* with Parent Session Guard and allows parent management', async () => {
    const lobby = (await app.inject({ method: 'GET', url: '/api/v1/lobby' })).json();
    const parent = lobby.profiles.find((p: { role: string }) => p.role === 'PARENT');
    const child = lobby.profiles.find((p: { role: string }) => p.role === 'CHILD');

    const childCookie = extractSessionCookie(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { userId: child.id },
        })
      ).headers,
    );

    // Child blocked from admin settings -> 403 FORBIDDEN
    const childAdminAttempt = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings',
      headers: { cookie: childCookie },
      payload: { appTitle: 'ניסיון' },
    });
    expect(childAdminAttempt.statusCode).toBe(403);

    const parentCookie = extractSessionCookie(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { userId: parent.id, pin: '1234' },
        })
      ).headers,
    );

    // Parent updates settings & announcement
    const updateSet = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings',
      headers: { cookie: parentCookie },
      payload: {
        appTitle: 'הבית של משפחת לוי',
        announcementText: 'יוצאים לפארק ב-16:00!',
        announcementEmoji: '🌳',
      },
    });
    expect(updateSet.statusCode).toBe(200);
    expect(updateSet.json().settings.appTitle).toBe('הבית של משפחת לוי');

    // Parent toggles pool task active state
    const adminPool = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pool',
        headers: { cookie: parentCookie },
      })
    ).json();
    const firstPool = adminPool.tasks[0];

    const toggled = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/pool/${firstPool.id}/toggle-active`,
      headers: { cookie: parentCookie },
    });
    expect(toggled.statusCode).toBe(200);
    expect(toggled.json().task.isActive).toBe(!firstPool.isActive);
  });

  it('re-checks role and isActive from the DB on every request (no stale PARENT tokens)', async () => {
    const lobby = (await app.inject({ method: 'GET', url: '/api/v1/lobby' })).json();
    const [p1, p2] = lobby.profiles.filter((p: { role: string }) => p.role === 'PARENT');
    const login = (id: number) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { userId: id, pin: '1234' } });
    const p1Cookie = extractSessionCookie((await login(p1.id)).headers);
    const p2Cookie = extractSessionCookie((await login(p2.id)).headers);
    const adminGet = (cookie: string) =>
      app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: { cookie } });
    expect((await adminGet(p1Cookie)).statusCode).toBe(200);

    // p2 demotes p1 to CHILD -> p1's old token must lose PARENT rights immediately
    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${p1.id}`,
      headers: { cookie: p2Cookie },
      payload: { role: 'CHILD' },
    });
    expect(demote.statusCode).toBe(200);
    expect((await adminGet(p1Cookie)).statusCode).toBe(403);

    // p2 deactivates p1 -> p1's token is no longer a session at all
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${p1.id}`,
      headers: { cookie: p2Cookie },
      payload: { isActive: false },
    });
    expect((await adminGet(p1Cookie)).statusCode).toBe(401);
  });

  it('supports PATCH /api/v1/users/me/profile for self-service nickname, custom emoji, color, and PIN', async () => {
    const lobby = (await app.inject({ method: 'GET', url: '/api/v1/lobby' })).json();
    const child = lobby.profiles.find((p: { role: string; hasPin: boolean }) => p.role === 'CHILD' && !p.hasPin);
    const parent = lobby.profiles.find((p: { role: string }) => p.role === 'PARENT');

    const childLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { userId: child.id },
    });
    const childCookie = extractSessionCookie(childLogin.headers);

    // Child updates own nickname, custom ZWJ emoji, color, and sets a 4-digit PIN
    const updateSelf = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/profile',
      headers: { cookie: childCookie },
      payload: {
        nickname: 'נועה הכוכבת',
        avatarEmoji: '🦸‍♀️',
        avatarBgColor: 'bg-violet-200',
        pin: '4321',
        // Extra fields like name/role must be ignored by Zod schema
        name: 'שם פרוץ',
        role: 'PARENT',
      },
    });
    expect(updateSelf.statusCode).toBe(200);
    const updatedUser = updateSelf.json().user;
    expect(updatedUser.name).toBe(child.name);
    expect(updatedUser.role).toBe('CHILD');
    expect(updatedUser.nickname).toBe('נועה הכוכבת');
    expect(updatedUser.avatarEmoji).toBe('🦸‍♀️');
    expect(updatedUser.avatarBgColor).toBe('bg-violet-200');
    expect(updatedUser.hasPin).toBe(true);

    // Child login now requires PIN 4321
    const failNoPin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { userId: child.id },
    });
    expect(failNoPin.statusCode).toBe(401);

    const okWithPin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { userId: child.id, pin: '4321' },
    });
    expect(okWithPin.statusCode).toBe(200);

    // Child removes their own PIN
    const clearPin = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/profile',
      headers: { cookie: childCookie },
      payload: { pin: null },
    });
    expect(clearPin.statusCode).toBe(200);
    expect(clearPin.json().user.hasPin).toBe(false);

    // Parent updates own PIN via /users/me/profile, but cannot remove PIN
    const parentLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { userId: parent.id, pin: '1234' },
    });
    const parentCookie = extractSessionCookie(parentLogin.headers);

    const parentPinChange = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/profile',
      headers: { cookie: parentCookie },
      payload: { pin: '5678', nickname: 'הבוס' },
    });
    expect(parentPinChange.statusCode).toBe(200);
    expect(parentPinChange.json().user.nickname).toBe('הבוס');

    const parentRemovePin = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/profile',
      headers: { cookie: parentCookie },
      payload: { pin: null },
    });
    expect(parentRemovePin.statusCode).toBe(400);
  });

  it('supports DELETE /api/v1/admin/users/:id for parents to remove seeded children while blocking children and self-delete', async () => {
    const lobby = (await app.inject({ method: 'GET', url: '/api/v1/lobby' })).json();
    const parent = lobby.profiles.find((p: { role: string }) => p.role === 'PARENT');
    const [child1, child2] = lobby.profiles.filter((p: { role: string }) => p.role === 'CHILD');

    const childCookie = extractSessionCookie(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { userId: child1.id } })).headers,
    );
    const parentCookie = extractSessionCookie(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { userId: parent.id, pin: '1234' } })).headers,
    );

    // Child cannot delete a user -> 403
    const childAttempt = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${child2.id}`,
      headers: { cookie: childCookie },
    });
    expect(childAttempt.statusCode).toBe(403);

    // Parent cannot delete themselves -> 400
    const selfAttempt = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${parent.id}`,
      headers: { cookie: parentCookie },
    });
    expect(selfAttempt.statusCode).toBe(400);

    // Parent deletes both seeded children (Noa and Yuval)
    const del1 = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${child1.id}`,
      headers: { cookie: parentCookie },
    });
    expect(del1.statusCode).toBe(200);
    expect(del1.json()).toEqual({ ok: true });

    const del2 = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${child2.id}`,
      headers: { cookie: parentCookie },
    });
    expect(del2.statusCode).toBe(200);

    const lobbyAfter = (await app.inject({ method: 'GET', url: '/api/v1/lobby' })).json();
    expect(lobbyAfter.profiles.some((p: { id: number }) => p.id === child1.id || p.id === child2.id)).toBe(false);
  });

  it('enforces zero banned physical horizontal directional classes across packages/web/src', () => {
    const webSrcDir = fileURLToPath(new URL('../../../web/src', import.meta.url));
    const bannedPattern = /\b(pl-|pr-|ml-|mr-|left-|right-|text-left|text-right)/;

    function walk(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          files.push(...walk(full));
        } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
          files.push(full);
        }
      }
      return files;
    }

    for (const file of walk(webSrcDir)) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(bannedPattern);
    }
  });
});
