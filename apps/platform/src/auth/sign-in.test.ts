import { beforeEach, describe, expect, it } from 'vitest';
import { ControllableClock } from '@booq/time';
import {
  createMemoryAuthStore,
  createPlatformAuth,
  PLATFORM_COOKIE,
  type AuditEvent,
  type IdentityProvider,
  type StaffRecord,
} from './sign-in';

// F01-T17: ROLE-02-AC1 to AC5, SR-16 (TOTP only, lockout, session limits, step-up), SR-06.
const KEY = 'k'.repeat(48);
const MIN = 60_000;

const ADMIN: StaffRecord = { id: 's-admin', authUserId: 'u-admin', displayName: 'Ada Admin', role: 'platform_admin', active: true };
const SPEC: StaffRecord = { id: 's-spec', authUserId: 'u-spec', displayName: 'Sam Specialist', role: 'onboarding_specialist', active: true };

let clock: ControllableClock;
let staff: Map<string, StaffRecord>;
let audit: AuditEvent[];
let auth: ReturnType<typeof createPlatformAuth>;

const identity: IdentityProvider = {
  async verifyPassword(email, password) {
    if (email === 'ada@booq.example' && password === 'pw-ada') return { authUserId: 'u-admin' };
    if (email === 'sam@booq.example' && password === 'pw-sam') return { authUserId: 'u-spec' };
    return null;
  },
  async verifyTotp(authUserId, code) {
    return code === `totp-${authUserId}`;
  },
};

function build(overrides: { signingKey?: string } = {}) {
  return createPlatformAuth({
    identity,
    staff: { findByAuthUser: async (id) => [...staff.values()].find((s) => s.authUserId === id) ?? null, findById: async (id) => staff.get(id) ?? null },
    audit: { write: async (e) => void audit.push(e) },
    store: createMemoryAuthStore(),
    clock,
    signingKey: overrides.signingKey ?? KEY,
  });
}

async function signInFully(email = 'ada@booq.example', password = 'pw-ada', code = 'totp-u-admin') {
  const first = await auth.signIn({ email, password });
  if (!first.ok) throw new Error(`first step failed: ${first.code}`);
  const second = await auth.verifySecondFactor({ challengeId: first.challengeId, code });
  if (!second.ok) throw new Error(`second step failed: ${second.code}`);
  return second.cookie;
}

beforeEach(() => {
  clock = new ControllableClock('2026-12-01T03:00:00Z');
  staff = new Map([[ADMIN.id, { ...ADMIN }], [SPEC.id, { ...SPEC }]]);
  audit = [];
  auth = build();
});

describe('second factor (ROLE-02-AC1)', () => {
  it('a correct password alone creates no session, only a challenge', async () => {
    const first = await auth.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
    expect(first.ok).toBe(true);
    expect(JSON.stringify(first)).not.toContain('cookie');
    expect((await auth.authenticate('anything')).ok).toBe(false);
  });

  it('a wrong code creates no session; the right code does, and the challenge is single use', async () => {
    const first = await auth.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
    if (!first.ok) throw new Error('x');
    expect(await auth.verifySecondFactor({ challengeId: first.challengeId, code: '000000' })).toEqual({ ok: false, code: 'bad_code' });
    const ok = await auth.verifySecondFactor({ challengeId: first.challengeId, code: 'totp-u-admin' });
    expect(ok.ok).toBe(true);
    expect(await auth.verifySecondFactor({ challengeId: first.challengeId, code: 'totp-u-admin' })).toEqual({ ok: false, code: 'challenge_invalid' });
  });

  it('a challenge expires after a few minutes', async () => {
    const first = await auth.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
    if (!first.ok) throw new Error('x');
    clock.advance(6 * MIN);
    expect(await auth.verifySecondFactor({ challengeId: first.challengeId, code: 'totp-u-admin' })).toEqual({ ok: false, code: 'challenge_invalid' });
  });

  it('a wrong password and an unknown address give the same answer', async () => {
    const a = await auth.signIn({ email: 'ada@booq.example', password: 'nope' });
    const b = await auth.signIn({ email: 'who@booq.example', password: 'nope' });
    expect(a).toEqual({ ok: false, code: 'invalid_credentials' });
    expect(b).toEqual(a);
  });

  it('a signed-in session carries the staff id and role, and the cookie has the platform name', async () => {
    const cookie = await signInFully();
    const me = await auth.authenticate(cookie);
    expect(me).toMatchObject({ ok: true, staff: { id: 's-admin', role: 'platform_admin', displayName: 'Ada Admin' } });
    expect(PLATFORM_COOKIE).toBe('__Host-booq-platform');
  });
});

describe('a club session is not a platform session (ROLE-02-AC2, AC3)', () => {
  it('a cookie signed with another key, or a LINE session id, is refused', async () => {
    const cookie = await signInFully();
    const other = build({ signingKey: 'z'.repeat(48) });
    expect((await other.authenticate(cookie)).ok).toBe(false);
    expect(await auth.authenticate('line-session-abc')).toEqual({ ok: false, code: 'session_invalid' });
    expect(await auth.authenticate(`${cookie.split('.')[0]}.forged`)).toEqual({ ok: false, code: 'session_invalid' });
    expect(await auth.authenticate('')).toEqual({ ok: false, code: 'session_invalid' });
  });

  it('refuses a signing key that is too short', () => {
    expect(() => build({ signingKey: 'short' })).toThrow(/signing key/i);
  });
});

describe('deactivation (ROLE-02-AC4)', () => {
  it('a deactivated account cannot sign in', async () => {
    staff.set('s-spec', { ...SPEC, active: false });
    const first = await auth.signIn({ email: 'sam@booq.example', password: 'pw-sam' });
    expect(first).toEqual({ ok: false, code: 'invalid_credentials' });
  });

  it('a deactivated account loses the open session on its next request and every other session', async () => {
    const c1 = await signInFully('sam@booq.example', 'pw-sam', 'totp-u-spec');
    const c2 = await signInFully('sam@booq.example', 'pw-sam', 'totp-u-spec');
    expect((await auth.authenticate(c1)).ok).toBe(true);
    staff.set('s-spec', { ...SPEC, active: false });
    expect(await auth.authenticate(c1)).toEqual({ ok: false, code: 'session_invalid' });
    expect(await auth.authenticate(c2)).toEqual({ ok: false, code: 'session_invalid' });
    staff.set('s-spec', { ...SPEC, active: true });
    expect((await auth.authenticate(c1)).ok).toBe(false); // reactivation does not revive the old session
  });

  it('endSessionsFor ends every session at once', async () => {
    const c = await signInFully();
    await auth.endSessionsFor('s-admin');
    expect((await auth.authenticate(c)).ok).toBe(false);
  });
});

describe('P6 log (ROLE-02-AC5)', () => {
  it('records a sign in, each failure kind, and a sign out, with the staff name when known', async () => {
    await auth.signIn({ email: 'ada@booq.example', password: 'nope' });
    await auth.signIn({ email: 'who@booq.example', password: 'nope' });
    const first = await auth.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
    if (!first.ok) throw new Error('x');
    await auth.verifySecondFactor({ challengeId: first.challengeId, code: 'bad' });
    const cookie = await signInFully();
    await auth.signOut(cookie);
    expect(audit.map((e) => [e.action, e.detail['reason'] ?? null, e.staffId])).toEqual([
      ['auth.sign_in_failed', 'bad_credentials', null],
      ['auth.sign_in_failed', 'bad_credentials', null],
      ['auth.sign_in_failed', 'bad_code', 's-admin'],
      ['auth.sign_in', null, 's-admin'],
      ['auth.sign_out', null, 's-admin'],
    ]);
    expect(audit[2]?.staffName).toBe('Ada Admin');
  });

  it('logs a refused deactivated account, and never stores a password, code or session id', async () => {
    staff.set('s-spec', { ...SPEC, active: false });
    await auth.signIn({ email: 'sam@booq.example', password: 'pw-sam' });
    expect(audit[0]).toMatchObject({ action: 'auth.sign_in_failed', staffId: 's-spec', detail: { reason: 'deactivated' } });
    const first = await auth.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
    if (!first.ok) throw new Error('x');
    const done = await auth.verifySecondFactor({ challengeId: first.challengeId, code: 'totp-u-admin' });
    if (!done.ok) throw new Error('y');
    const text = JSON.stringify(audit);
    for (const secret of ['pw-ada', 'pw-sam', 'totp-u-admin', first.challengeId, done.cookie, done.cookie.split('.')[0] as string]) {
      expect(text).not.toContain(secret);
    }
  });

  it('a failed log write refuses the sign in (no unlogged session)', async () => {
    const failing = createPlatformAuth({
      identity,
      staff: { findByAuthUser: async () => ADMIN, findById: async () => ADMIN },
      audit: { write: async () => { throw new Error('p6 down'); } },
      store: createMemoryAuthStore(),
      clock,
      signingKey: KEY,
    });
    const first = await failing.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
    if (!first.ok) throw new Error('first step should not need the log');
    await expect(failing.verifySecondFactor({ challengeId: first.challengeId, code: 'totp-u-admin' })).rejects.toThrow('p6 down');
    // The failed attempt left no session behind: the challenge is still open and nothing authenticates.
    expect((await failing.authenticate('x.y')).ok).toBe(false);
  });
});

describe('lockout, session limits and step up (SR-16)', () => {
  async function challenge() {
    const first = await auth.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
    if (!first.ok) throw new Error(first.code);
    return first.challengeId;
  }

  it('five wrong codes lock the account for 15 minutes, even for the right code, and write an alert entry', async () => {
    for (let i = 0; i < 5; i++) await auth.verifySecondFactor({ challengeId: await challenge(), code: 'wrong' });
    expect(audit.some((e) => e.action === 'auth.locked')).toBe(true);
    expect(await auth.verifySecondFactor({ challengeId: await challenge(), code: 'totp-u-admin' })).toEqual({ ok: false, code: 'locked' });
    clock.advance(14 * MIN);
    expect(await auth.verifySecondFactor({ challengeId: await challenge(), code: 'totp-u-admin' })).toEqual({ ok: false, code: 'locked' });
    clock.advance(2 * MIN);
    expect((await auth.verifySecondFactor({ challengeId: await challenge(), code: 'totp-u-admin' })).ok).toBe(true);
  });

  it('a right code resets the failure count', async () => {
    for (let i = 0; i < 4; i++) await auth.verifySecondFactor({ challengeId: await challenge(), code: 'wrong' });
    expect((await auth.verifySecondFactor({ challengeId: await challenge(), code: 'totp-u-admin' })).ok).toBe(true);
    for (let i = 0; i < 4; i++) await auth.verifySecondFactor({ challengeId: await challenge(), code: 'wrong' });
    expect((await auth.verifySecondFactor({ challengeId: await challenge(), code: 'totp-u-admin' })).ok).toBe(true);
  });

  it('a session ends after 30 minutes idle, but activity keeps it alive', async () => {
    const c = await signInFully();
    clock.advance(25 * MIN);
    expect((await auth.authenticate(c)).ok).toBe(true);
    clock.advance(25 * MIN);
    expect((await auth.authenticate(c)).ok).toBe(true);
    clock.advance(31 * MIN);
    expect(await auth.authenticate(c)).toEqual({ ok: false, code: 'session_invalid' });
  });

  it('a session ends after 8 hours whatever the activity', async () => {
    const c = await signInFully();
    for (let i = 0; i < 17; i++) {
      clock.advance(29 * MIN);
      if (!(await auth.authenticate(c)).ok) break;
    }
    expect((await auth.authenticate(c)).ok).toBe(false);
  });

  it('a fresh second factor within 5 minutes is reported; after that step up is required', async () => {
    const c = await signInFully();
    expect(await auth.authenticate(c)).toMatchObject({ ok: true, stepUpFresh: true });
    clock.advance(6 * MIN);
    expect(await auth.authenticate(c)).toMatchObject({ ok: true, stepUpFresh: false });
    expect(await auth.stepUp(c, 'wrong')).toEqual({ ok: false, code: 'bad_code' });
    expect(await auth.stepUp(c, 'totp-u-admin')).toEqual({ ok: true });
    expect(await auth.authenticate(c)).toMatchObject({ ok: true, stepUpFresh: true });
    expect(audit.filter((e) => e.action === 'auth.step_up')).toHaveLength(1);
    expect(audit.filter((e) => e.action === 'auth.step_up_failed')).toHaveLength(1);
  });

  it('step up failures count toward the lockout', async () => {
    const c = await signInFully();
    for (let i = 0; i < 5; i++) await auth.stepUp(c, 'wrong');
    expect(await auth.stepUp(c, 'totp-u-admin')).toEqual({ ok: false, code: 'locked' });
  });
});

describe('provider state between the two steps (D148, D160)', () => {
  // A provider whose second step only works with the state its first step returned, as Supabase's does.
  const seen: Array<{ code: string; state: string | undefined }> = [];
  const stateful: IdentityProvider = {
    async verifyPassword(email, password) {
      return email === 'ada@booq.example' && password === 'pw-ada' ? { authUserId: 'u-admin', state: `first-step-${seen.length}` } : null;
    },
    async verifyTotp(_id, code, state) {
      seen.push({ code, state });
      return state?.startsWith('first-step-') === true && code === '123456';
    },
  };
  const buildStateful = () =>
    createPlatformAuth({
      identity: stateful,
      staff: { findByAuthUser: async (id) => [...staff.values()].find((s) => s.authUserId === id) ?? null, findById: async (id) => staff.get(id) ?? null },
      audit: { write: async (e) => void audit.push(e) },
      store: createMemoryAuthStore(),
      clock,
      signingKey: KEY,
    });

  it('the state of the first step goes back with the code of the second, and only through the challenge id', async () => {
    seen.length = 0;
    const a = buildStateful();
    const first = await a.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
    if (!first.ok) throw new Error(first.code);
    expect(JSON.stringify(first)).not.toContain('first-step');
    const wrong = await a.verifySecondFactor({ challengeId: first.challengeId, code: '000000' });
    expect(wrong).toEqual({ ok: false, code: 'bad_code' });
    const done = await a.verifySecondFactor({ challengeId: first.challengeId, code: '123456' }); // the same challenge still carries the state
    expect(done.ok).toBe(true);
    expect(seen).toEqual([{ code: '000000', state: 'first-step-0' }, { code: '123456', state: 'first-step-0' }]);
    expect(JSON.stringify(audit)).not.toContain('first-step');
  });

  it('a step-up has no first step, so the provider is asked without state', async () => {
    seen.length = 0;
    const a = buildStateful();
    const first = await a.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
    if (!first.ok) throw new Error(first.code);
    const done = await a.verifySecondFactor({ challengeId: first.challengeId, code: '123456' });
    if (!done.ok) throw new Error(done.code);
    seen.length = 0;
    expect(await a.stepUp(done.cookie, '123456')).toEqual({ ok: false, code: 'bad_code' }); // this provider needs the state
    expect(seen).toEqual([{ code: '123456', state: undefined }]);
  });
});
