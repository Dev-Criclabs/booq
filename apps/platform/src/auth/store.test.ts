import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { ControllableClock } from '@booq/time';
import { createPlatformAuth, type IdentityProvider } from './sign-in';
import { createDbAuditSink, createDbAuthStore, createDbStaffDirectory } from './adapters';

// The shared console session store (migration 0051): the AuthStore contract over Postgres, the ids hashed at rest,
// the failure count atomic, and one process able to continue what another began.
const KEY = 'k'.repeat(48);
const SEAL = 's'.repeat(48);
const AUTH_USER = '99999999-0000-4000-8000-000000000001';
const identity: IdentityProvider = {
  async verifyPassword(email, password) {
    return email === 'ada@booq.example' && password === 'pw-ada' ? { authUserId: AUTH_USER } : null;
  },
  async verifyTotp(_id, code) {
    return code === '123456';
  },
};

let tdb: TestDatabase;
let pdb: PlatformDb;
let staffId: string;

beforeEach(async () => {
  tdb = await createTestDatabase();
  staffId = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ($1,'ada@booq.example','Ada Admin','platform_admin') returning id`, [AUTH_USER])).rows[0].id;
  pdb = createPlatformDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

describe('AuthStore over Postgres', () => {
  it('keeps a session and a challenge, updates a session, and forgets them', async () => {
    const store = createDbAuthStore(pdb, { sealKey: SEAL });
    await store.putSession({ id: 'sess-1', staffId, createdAt: 1_800_000_000_123, lastSeenAt: 1_800_000_000_123, stepUpAt: 1_800_000_000_123 });
    expect(await store.getSession('sess-1')).toEqual({ id: 'sess-1', staffId, createdAt: 1_800_000_000_123, lastSeenAt: 1_800_000_000_123, stepUpAt: 1_800_000_000_123 });
    await store.putSession({ id: 'sess-1', staffId, createdAt: 5, lastSeenAt: 1_800_000_060_000, stepUpAt: 1_800_000_030_000 });
    expect(await store.getSession('sess-1')).toMatchObject({ createdAt: 1_800_000_000_123, lastSeenAt: 1_800_000_060_000, stepUpAt: 1_800_000_030_000 });
    await store.putChallenge({ id: 'chal-1', staffId, expiresAt: 1_800_000_300_000 });
    expect(await store.getChallenge('chal-1')).toEqual({ id: 'chal-1', staffId, expiresAt: 1_800_000_300_000 });
    await store.deleteChallenge('chal-1');
    expect(await store.getChallenge('chal-1')).toBeNull();
    await store.deleteSession('sess-1');
    expect(await store.getSession('sess-1')).toBeNull();
    expect(await store.getSession('never')).toBeNull();
  });

  it('ends every session of one staff member and only theirs', async () => {
    const store = createDbAuthStore(pdb, { sealKey: SEAL });
    const other = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000002','sam@booq.example','Sam','onboarding_specialist') returning id`)).rows[0].id;
    for (const [id, who] of [['a', staffId], ['b', staffId], ['c', other]] as const) await store.putSession({ id, staffId: who, createdAt: 1, lastSeenAt: 1, stepUpAt: 1 });
    await store.deleteSessionsFor(staffId);
    expect([await store.getSession('a'), await store.getSession('b')]).toEqual([null, null]);
    expect(await store.getSession('c')).not.toBeNull();
  });

  it('counts failures atomically, clears them, and keeps the lock', async () => {
    const store = createDbAuthStore(pdb, { sealKey: SEAL });
    const counts = await Promise.all([1, 2, 3, 4].map(() => store.addFailure(staffId)));
    expect([...counts].sort()).toEqual([1, 2, 3, 4]);
    await store.clearFailures(staffId);
    expect(await store.addFailure(staffId)).toBe(1);
    expect(await store.getLockedUntil(staffId)).toBeNull();
    await store.setLockedUntil(staffId, 1_800_000_900_000);
    expect(await store.getLockedUntil(staffId)).toBe(1_800_000_900_000);
    expect(await store.addFailure(staffId)).toBe(2); // the lock does not reset the count
  });

  it('holds only a hash of each id, and the tables cannot be read or changed by the console role', async () => {
    const store = createDbAuthStore(pdb, { sealKey: SEAL });
    await store.putSession({ id: 'secret-session-id', staffId, createdAt: 1, lastSeenAt: 1, stepUpAt: 1 });
    await store.putChallenge({ id: 'secret-challenge-id', staffId, expiresAt: 2 });
    const stored = JSON.stringify([...(await tdb.query('select * from platform.console_session')).rows, ...(await tdb.query('select * from platform.console_challenge')).rows]);
    expect(stored).not.toContain('secret-session-id');
    expect(stored).not.toContain('secret-challenge-id');
    for (const sql of ['select * from platform.console_session', 'select * from platform.console_challenge', 'select * from platform.console_login_state', `delete from platform.console_session`]) {
      await expect(pdb.withPlatformTx({ staffId: null }, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it('refuses a malformed hash and an unknown staff member', async () => {
    const store = createDbAuthStore(pdb, { sealKey: SEAL });
    await expect(store.putSession({ id: 'x', staffId: '99999999-9999-4999-8999-999999999999', createdAt: 1, lastSeenAt: 1, stepUpAt: 1 })).rejects.toThrow();
  });
});

describe('the provider token', () => {
  it('is kept under the challenge, sealed at rest, returned to the same key, and lost to a different key', async () => {
    const store = createDbAuthStore(pdb, { sealKey: SEAL });
    await store.putChallenge({ id: 'chal-t', staffId, expiresAt: 5, providerToken: 'provider-first-step-token' });
    expect((await store.getChallenge('chal-t'))?.providerToken).toBe('provider-first-step-token');
    const raw = JSON.stringify((await tdb.query('select * from platform.console_challenge')).rows);
    expect(raw).not.toContain('provider-first-step-token');
    expect(raw).toContain('v1.');
    expect((await createDbAuthStore(pdb, { sealKey: 'x'.repeat(48) }).getChallenge('chal-t'))).toEqual({ id: 'chal-t', staffId, expiresAt: 5 });
    await store.putChallenge({ id: 'chal-n', staffId, expiresAt: 5 });
    expect(await store.getChallenge('chal-n')).toEqual({ id: 'chal-n', staffId, expiresAt: 5 });
  });
  it('a short sealing key is refused', () => {
    expect(() => createDbAuthStore(pdb, { sealKey: 'short' })).toThrow(/32/);
  });
  it('a sign-in that carries a token in the challenge is single use like any other', async () => {
    const store = createDbAuthStore(pdb, { sealKey: SEAL });
    await store.putChallenge({ id: 'once', staffId, expiresAt: 5, providerToken: 't' });
    await store.deleteChallenge('once');
    expect(await store.getChallenge('once')).toBeNull();
  });
});

describe('two processes, one store', () => {
  const build = (clock: ControllableClock, db: PlatformDb) =>
    createPlatformAuth({ identity, staff: createDbStaffDirectory(db), audit: createDbAuditSink(db), store: createDbAuthStore(db, { sealKey: SEAL }), clock, signingKey: KEY });

  it('a session begun in one process is accepted by another, and sign-out in one ends it in both', async () => {
    const clock = new ControllableClock('2026-12-01T03:00:00Z');
    const a = build(clock, pdb);
    const second = createPlatformDb({ connectionString: tdb.url, max: 2 });
    try {
      const b = build(clock, second);
      const first = await a.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
      if (!first.ok) throw new Error(first.code);
      const done = await b.verifySecondFactor({ challengeId: first.challengeId, code: '123456' }); // the challenge was made by a
      if (!done.ok) throw new Error(done.code);
      expect(await a.authenticate(done.cookie)).toMatchObject({ ok: true, staff: { id: staffId } });
      await b.signOut(done.cookie);
      expect(await a.authenticate(done.cookie)).toMatchObject({ ok: false });
    } finally {
      await second.end();
    }
  });

  it('failed codes in different processes add up to the lockout', async () => {
    const clock = new ControllableClock('2026-12-01T03:00:00Z');
    const a = build(clock, pdb);
    const second = createPlatformDb({ connectionString: tdb.url, max: 2 });
    try {
      const b = build(clock, second);
      let last: unknown;
      for (let i = 0; i < 5; i += 1) {
        const p = i % 2 === 0 ? a : b;
        const first = await p.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
        if (!first.ok) throw new Error(first.code);
        last = await p.verifySecondFactor({ challengeId: first.challengeId, code: '000000' });
      }
      expect(last).toMatchObject({ ok: false, code: 'bad_code' }); // the fifth wrong code starts the lock
      const again = await a.signIn({ email: 'ada@booq.example', password: 'pw-ada' });
      if (!again.ok) throw new Error(again.code);
      expect(await b.verifySecondFactor({ challengeId: again.challengeId, code: '123456' })).toMatchObject({ ok: false, code: 'locked' });
    } finally {
      await second.end();
    }
  });
});

describe('the provider state through the shared store', () => {
  it('a state made in one process is used for the code in another, and is sealed in the table', async () => {
    const clock = new ControllableClock('2026-12-01T03:00:00Z');
    const provider: IdentityProvider = {
      async verifyPassword(email, password) {
        return email === 'ada@booq.example' && password === 'pw-ada' ? { authUserId: AUTH_USER, state: 'provider-token-xyz' } : null;
      },
      async verifyTotp(_id, code, state) {
        return state === 'provider-token-xyz' && code === '123456';
      },
    };
    const make = (db: PlatformDb) => createPlatformAuth({ identity: provider, staff: createDbStaffDirectory(db), audit: createDbAuditSink(db), store: createDbAuthStore(db, { sealKey: SEAL }), clock, signingKey: KEY });
    const second = createPlatformDb({ connectionString: tdb.url, max: 2 });
    try {
      const first = await make(pdb).signIn({ email: 'ada@booq.example', password: 'pw-ada' });
      if (!first.ok) throw new Error(first.code);
      expect(JSON.stringify((await tdb.query('select * from platform.console_challenge')).rows)).not.toContain('provider-token-xyz');
      expect((await make(second).verifySecondFactor({ challengeId: first.challengeId, code: '123456' })).ok).toBe(true);
      expect((await tdb.query('select count(*)::int as n from platform.console_challenge')).rows[0].n).toBe(0);
    } finally {
      await second.end();
    }
  });
});
