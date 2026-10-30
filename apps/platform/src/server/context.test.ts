import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { ControllableClock } from '@booq/time';
import { servePlatform } from '../http/server';
import { createPlatformTable, readPlatformConfig, unavailableIdentity } from './context';

// The console's settings and wiring. Required, no defaults, no value printed on failure.
const ENV = { DATABASE_URL: 'postgres://u:pw@h/db', PLATFORM_SIGNING_KEY: 'k'.repeat(40), PLATFORM_MAX_BODY_BYTES: '100000', APP_BASE_URL: 'https://app.example' };

describe('readPlatformConfig', () => {
  it('reads the required settings; the rate limit is an optional pair', () => {
    expect(readPlatformConfig(ENV)).toEqual({ databaseUrl: ENV.DATABASE_URL, signingKey: ENV.PLATFORM_SIGNING_KEY, maxBodyBytes: 100000, appBaseUrl: 'https://app.example', healthToken: null, staffInvite: null, signInRateLimit: null });
    expect(readPlatformConfig({ ...ENV, APP_BASE_URL: 'https://app.example/', HEALTH_TOKEN: 'h'.repeat(20) })).toMatchObject({ appBaseUrl: 'https://app.example', healthToken: 'h'.repeat(20) });
    expect(readPlatformConfig({ ...ENV, PLATFORM_SIGNIN_RATE_LIMIT: '5', PLATFORM_SIGNIN_RATE_WINDOW_SECONDS: '60' }).signInRateLimit).toEqual({ limit: 5, windowSeconds: 60 });
  });
  it('the staff-invite address and signing secret are an optional pair', () => {
    expect(readPlatformConfig({ ...ENV, STAFF_INVITE_URL: 'https://invite.internal/', STAFF_INVITE_SIGNING_SECRET: 's'.repeat(40) }).staffInvite).toEqual({ url: 'https://invite.internal/', signingSecret: 's'.repeat(40) });
  });
  it('names missing settings and never prints a value', () => {
    let message = '';
    try {
      readPlatformConfig({ DATABASE_URL: 'postgres://secret-user:secret-pw@h/db' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('PLATFORM_SIGNING_KEY');
    expect(message).toContain('PLATFORM_MAX_BODY_BYTES');
    expect(message).not.toContain('secret');
  });
  it.each([
    [{ PLATFORM_SIGNING_KEY: 'short' }],
    [{ PLATFORM_MAX_BODY_BYTES: '0' }],
    [{ APP_BASE_URL: 'http://app.example' }],
    [{ HEALTH_TOKEN: 'short' }],
    [{ STAFF_INVITE_URL: 'https://invite.internal' }],
    [{ STAFF_INVITE_SIGNING_SECRET: 's'.repeat(40) }],
    [{ STAFF_INVITE_URL: 'ftp://x', STAFF_INVITE_SIGNING_SECRET: 's'.repeat(40) }],
    [{ STAFF_INVITE_URL: 'https://invite.internal', STAFF_INVITE_SIGNING_SECRET: 'short' }],
    [{ PLATFORM_SIGNIN_RATE_LIMIT: '5' }],
    [{ PLATFORM_SIGNIN_RATE_WINDOW_SECONDS: '60' }],
    [{ PLATFORM_SIGNIN_RATE_LIMIT: 'x', PLATFORM_SIGNIN_RATE_WINDOW_SECONDS: '60' }],
  ])('refuses %j', (extra) => {
    expect(() => readPlatformConfig({ ...ENV, ...extra })).toThrow();
  });
});

describe('without the password adapter (T17b)', () => {
  let tdb: TestDatabase;
  let pdb: PlatformDb;
  beforeEach(async () => {
    tdb = await createTestDatabase();
    pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
  });
  afterEach(async () => {
    await pdb.end();
    await tdb.close();
  });
  it('sign-in answers 503 identity_unavailable, not a wrong-password 401', async () => {
    const source = createPlatformTable({ db: pdb, clock: new ControllableClock('2026-12-01T03:00:00Z'), identity: unavailableIdentity, config: { signingKey: 'k'.repeat(40), maxBodyBytes: 1000, appBaseUrl: 'https://app.example', healthToken: null, staffInvite: null, signInRateLimit: null } });
    const h = servePlatform(source.table, source.deps);
    const r = await h(new Request('https://console.example/api/auth/sign-in', { method: 'POST', body: JSON.stringify({ email: 'a@b.c', password: 'x' }), headers: { 'content-type': 'application/json' } }), { params: Promise.resolve({ path: ['auth', 'sign-in'] }) });
    expect([r.status, await r.json()]).toEqual([503, { code: 'identity_unavailable' }]);
  });
});
