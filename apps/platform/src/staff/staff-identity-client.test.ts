import { describe, expect, it } from 'vitest';
import { verifyInternalCall, INTERNAL_SIGNATURE, INTERNAL_TIMESTAMP } from '@booq/auth';
import { IdentityUnavailable } from '../auth/adapters';
import { createStaffIdentityClient } from './staff-identity-client';

// The console's identity client: signed calls to apps/staff-invite, wrong credentials as answers, everything else as
// "identity unavailable" (503), and no provider key anywhere here.
const SECRET = 'shared-between-the-two-apps';
const NOW = new Date('2026-10-30T10:00:00Z');

function other(answer: (path: string, body: Record<string, unknown>) => { status: number; json?: unknown } | 'down') {
  const seen: Array<{ path: string; body: Record<string, unknown>; signed: boolean }> = [];
  const f = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const raw = init.body;
    const path = new URL(url).pathname;
    seen.push({ path, body: JSON.parse(raw), signed: verifyInternalCall(SECRET, NOW, 30, { timestamp: init.headers[INTERNAL_TIMESTAMP] ?? null, signature: init.headers[INTERNAL_SIGNATURE] ?? null }, raw) });
    const a = answer(path, JSON.parse(raw));
    if (a === 'down') throw new Error('unreachable');
    return new Response(a.json === undefined ? '' : JSON.stringify(a.json), { status: a.status });
  }) as unknown as typeof fetch;
  return { seen, client: createStaffIdentityClient({ url: 'https://staff-invite.internal/', signingSecret: SECRET, fetch: f, now: () => NOW }) };
}

describe('password steps', () => {
  it('a good password gives the person and the state, from a signed call', async () => {
    const { seen, client } = other(() => ({ status: 200, json: { authUserId: 'u-1', state: 's-1' } }));
    expect(await client.verifyPassword('a@b.co', 'pw')).toEqual({ authUserId: 'u-1', state: 's-1' });
    expect(seen).toEqual([{ path: '/identity/password', body: { email: 'a@b.co', password: 'pw' }, signed: true }]);
    expect(await client.verifyPasswordFor('u-1', 'pw')).toEqual({ authUserId: 'u-1', state: 's-1' });
    expect(seen[1]).toMatchObject({ path: '/identity/password-for', body: { authUserId: 'u-1', password: 'pw' } });
  });
  it('no authenticator enrolled gives the person without a state', async () => {
    expect(await other(() => ({ status: 200, json: { authUserId: 'u-2' } })).client.verifyPassword('a@b.co', 'pw')).toEqual({ authUserId: 'u-2' });
  });
  it('wrong credentials are null', async () => {
    const { client } = other(() => ({ status: 401, json: { code: 'invalid_credentials' } }));
    expect(await client.verifyPassword('a@b.co', 'no')).toBeNull();
    expect(await client.verifyPasswordFor('u-1', 'no')).toBeNull();
  });
  it('an unreachable app, a refused signature, a provider failure or nonsense is unavailable, never a wrong password', async () => {
    for (const a of ['down', { status: 401, json: { code: 'unauthorized' } }, { status: 502, json: { code: 'provider_failed' } }, { status: 200, json: {} }, { status: 500 }] as const) {
      await expect(other(() => a).client.verifyPassword('a@b.co', 'pw')).rejects.toBeInstanceOf(IdentityUnavailable);
    }
  });
});

describe('code step', () => {
  it('sends the state and code; ok is true, bad_code is false', async () => {
    const yes = other(() => ({ status: 200, json: { ok: true } }));
    expect(await yes.client.verifyTotp('u-1', '123456', 's-1')).toBe(true);
    expect(yes.seen[0]).toEqual({ path: '/identity/totp', body: { authUserId: 'u-1', state: 's-1', code: '123456' }, signed: true });
    expect(await other(() => ({ status: 401, json: { code: 'bad_code' } })).client.verifyTotp('u-1', '000000', 's-1')).toBe(false);
  });
  it('without a state there is nothing to check against: false, and no call is made', async () => {
    const none = other(() => ({ status: 200, json: { ok: true } }));
    expect(await none.client.verifyTotp('u-1', '123456')).toBe(false);
    expect(none.seen).toEqual([]);
  });
  it('an outage is unavailable, not a wrong code', async () => {
    await expect(other(() => 'down').client.verifyTotp('u-1', '123456', 's-1')).rejects.toBeInstanceOf(IdentityUnavailable);
    await expect(other(() => ({ status: 502, json: { code: 'provider_failed' } })).client.verifyTotp('u-1', '123456', 's-1')).rejects.toBeInstanceOf(IdentityUnavailable);
  });
});
