import { describe, expect, it } from 'vitest';
import { staffInviteFromEnv } from './env';

// Settings are required, with no defaults (SR-06 keeps the key to this function; nothing else is guessed).
const FULL = {
  SUPABASE_URL: 'https://proj.example',
  SUPABASE_SERVICE_ROLE_KEY: 'k',
  STAFF_INVITE_SIGNING_SECRET: 's',
  PLATFORM_DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  STAFF_INVITE_MAX_SKEW_SECONDS: '30',
  STAFF_INVITE_MAX_BODY_BYTES: '8192',
};
describe('staffInviteFromEnv', () => {
  it('names every missing setting and starts nothing', () => {
    expect(() => staffInviteFromEnv({})).toThrow(/SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY.*STAFF_INVITE_SIGNING_SECRET/);
    const { STAFF_INVITE_SIGNING_SECRET: _omit, ...rest } = FULL;
    expect(() => staffInviteFromEnv(rest)).toThrow(/STAFF_INVITE_SIGNING_SECRET/);
  });
  it('the numbers must be whole and above zero', () => {
    for (const bad of ['0', '-1', 'x', '1.5']) expect(() => staffInviteFromEnv({ ...FULL, STAFF_INVITE_MAX_SKEW_SECONDS: bad }), bad).toThrow(/whole number/);
  });
  it('with everything set it builds a handler', () => {
    expect(typeof staffInviteFromEnv(FULL)).toBe('function');
  });
});
