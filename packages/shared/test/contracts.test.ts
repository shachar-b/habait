import { describe, expect, it } from 'vitest';
import {
  CreateUserRequestSchema,
  ERROR_HTTP_STATUS,
  LogicalDateSchema,
  PoolTaskSchema,
  UpdateUserRequestSchema,
} from '../src/index.js';

const base = { name: 'נועה', avatarEmoji: '🦄', avatarBgColor: 'bg-pink-200' };

describe('CreateUserRequestSchema (PIN enforcement)', () => {
  it('rejects a PARENT without a PIN', () => {
    expect(CreateUserRequestSchema.safeParse({ ...base, role: 'PARENT' }).success).toBe(false);
    expect(CreateUserRequestSchema.safeParse({ ...base, role: 'PARENT', pin: null }).success).toBe(false);
  });

  it('accepts a PARENT with a 4-digit PIN', () => {
    expect(CreateUserRequestSchema.safeParse({ ...base, role: 'PARENT', pin: '1234' }).success).toBe(true);
  });

  it('accepts a CHILD with or without a PIN', () => {
    expect(CreateUserRequestSchema.safeParse({ ...base, role: 'CHILD' }).success).toBe(true);
    expect(CreateUserRequestSchema.safeParse({ ...base, role: 'CHILD', pin: '0000' }).success).toBe(true);
  });

  it('rejects malformed PINs', () => {
    for (const pin of ['123', '12345', 'abcd', '12 4']) {
      expect(CreateUserRequestSchema.safeParse({ ...base, role: 'CHILD', pin }).success).toBe(false);
    }
  });
});

describe('UpdateUserRequestSchema', () => {
  it('accepts a partial update and rejects an empty one', () => {
    expect(UpdateUserRequestSchema.safeParse({ name: 'דנה' }).success).toBe(true);
    expect(UpdateUserRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('LogicalDateSchema', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(LogicalDateSchema.safeParse('2026-10-25').success).toBe(true);
    expect(LogicalDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(LogicalDateSchema.safeParse('25-10-2026').success).toBe(false);
  });
});

describe('PoolTaskSchema (state-discriminated)', () => {
  const task = {
    id: 1,
    title: 'פינוי מדיח',
    iconEmoji: '🍽️',
    stars: 2,
    resetMode: 'AUTO_DISABLE',
    cooldownMinutes: 60,
    isActive: true,
    lastCompletedAt: null,
    createdById: 1,
  };

  it('accepts AVAILABLE with no claim data', () => {
    expect(PoolTaskSchema.safeParse({ ...task, state: 'AVAILABLE' }).success).toBe(true);
  });

  it('rejects CLAIMED without claimer/expiry', () => {
    expect(PoolTaskSchema.safeParse({ ...task, state: 'CLAIMED' }).success).toBe(false);
  });

  it('rejects COOLDOWN without cooldownEndsAt', () => {
    expect(PoolTaskSchema.safeParse({ ...task, state: 'COOLDOWN' }).success).toBe(false);
  });
});

describe('ERROR_HTTP_STATUS', () => {
  it('maps the 1-WIP violation to 409', () => {
    expect(ERROR_HTTP_STATUS.POOL_WIP_LIMIT_REACHED).toBe(409);
  });
});
