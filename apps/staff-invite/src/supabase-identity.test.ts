import { describe, expect, it } from 'vitest';
import { createSupabaseIdentity } from './supabase-identity';

// The provider's sign-in API as the adapter calls it: the anon key in both headers, the first-step token only as a bearer
// on the factor calls, never in an error.
const ANON = 'anon-key-for-tests';
type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

function provider(answers: Array<{ status: number; json?: unknown }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ method: init.method, url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const a = answers.shift() ?? { status: 500 };
    return new Response(a.json === undefined ? '' : JSON.stringify(a.json), { status: a.status });
  }) as unknown as typeof fetch;
  return { calls, identity: createSupabaseIdentity({ url: 'https://p.supabase.example/', anonKey: ANON, fetch: f }) };
}
const GRANT = { status: 200, json: { access_token: 'tok-1', user: { id: 'u-1', factors: [{ id: 'f-pending', factor_type: 'totp', status: 'unverified' }, { id: 'f-1', factor_type: 'totp', status: 'verified' }] } } };

describe('password grant', () => {
  it('sends the anon key and gives the user and a state for the verified authenticator', async () => {
    const { calls, identity } = provider([GRANT]);
    const r = await identity.passwordGrant('a@b.co', 'pw');
    expect(r?.authUserId).toBe('u-1');
    expect(r?.state).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain(ANON);
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://p.supabase.example/auth/v1/token?grant_type=password', body: { email: 'a@b.co', password: 'pw' } });
    expect(calls[0]!.headers['apikey']).toBe(ANON);
  });
  it('a wrong password is null; a provider failure throws without the password or the key', async () => {
    expect(await provider([{ status: 400, json: { error: 'invalid_grant' } }]).identity.passwordGrant('a@b.co', 'pw')).toBeNull();
    const err = await provider([{ status: 503 }]).identity.passwordGrant('a@b.co', 'secret-pw').catch((e: Error) => e);
    expect((err as Error).message).not.toMatch(/secret-pw|anon-key/);
  });
  it('a person with no verified authenticator gets no state, so no second step can pass', async () => {
    const { identity } = provider([{ status: 200, json: { access_token: 't', user: { id: 'u-2', factors: [] } } }]);
    expect(await identity.passwordGrant('a@b.co', 'pw')).toEqual({ authUserId: 'u-2' });
  });
});

describe('code check', () => {
  async function state() {
    const g = provider([GRANT]);
    return (await g.identity.passwordGrant('a@b.co', 'pw'))!.state!;
  }
  it('challenges the factor with the first-step token as bearer, verifies the code, and ends the second provider session', async () => {
    const st = await state();
    const { calls, identity } = provider([{ status: 200, json: { id: 'ch-1' } }, { status: 200, json: { access_token: 'tok-2' } }, { status: 204 }]);
    expect(await identity.verifyCode('u-1', st, '123456')).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://p.supabase.example/auth/v1', '')}`)).toEqual(['POST /factors/f-1/challenge', 'POST /factors/f-1/verify', 'POST /logout']);
    expect(calls[0]!.headers).toMatchObject({ apikey: ANON, authorization: 'Bearer tok-1' });
    expect(calls[1]!.body).toEqual({ challenge_id: 'ch-1', code: '123456' });
    expect(calls[2]!.headers['authorization']).toBe('Bearer tok-2');
  });
  it('a wrong code is false; a state for another person or a damaged state is false and calls nothing', async () => {
    const st = await state();
    expect(await provider([{ status: 200, json: { id: 'ch' } }, { status: 400, json: { error: 'invalid code' } }]).identity.verifyCode('u-1', st, '000000')).toBe(false);
    const none = provider([]);
    expect(await none.identity.verifyCode('u-other', st, '123456')).toBe(false);
    expect(await none.identity.verifyCode('u-1', 'not-a-state', '123456')).toBe(false);
    expect(none.calls).toEqual([]);
  });
  it('a provider failure throws, so the caller can say the provider failed', async () => {
    const st = await state();
    await expect(provider([{ status: 502 }]).identity.verifyCode('u-1', st, '123456')).rejects.toThrow();
  });
});

describe('enrolment of the first authenticator', () => {
  it('signs in with the password, starts a TOTP factor with the first-step token as bearer, and gives the secret and a state', async () => {
    const { calls, identity } = provider([{ status: 200, json: { access_token: 'tok-9', user: { id: 'u-9' } } }, { status: 200, json: { id: 'f-9', totp: { secret: 'BASE32SECRET', uri: 'otpauth://totp/BOOQ:x' } } }]);
    const r = await identity.startEnrolment('a@b.co', 'pw');
    expect(r).toMatchObject({ authUserId: 'u-9', secret: 'BASE32SECRET', uri: 'otpauth://totp/BOOQ:x' });
    expect(r?.state).toBeTruthy();
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://p.supabase.example/auth/v1/factors', body: { factor_type: 'totp', friendly_name: 'BOOQ console', issuer: 'BOOQ' } });
    expect(calls[1]!.headers).toMatchObject({ apikey: ANON, authorization: 'Bearer tok-9' });
  });
  it('the state it gives confirms the factor with a code, and a wrong password is null', async () => {
    const start = provider([{ status: 200, json: { access_token: 'tok-9', user: { id: 'u-9' } } }, { status: 200, json: { id: 'f-9', totp: { secret: 'S', uri: 'U' } } }]);
    const state = (await start.identity.startEnrolment('a@b.co', 'pw'))!.state;
    const { calls, identity } = provider([{ status: 200, json: { id: 'ch' } }, { status: 200, json: { access_token: 'tok-10' } }, { status: 204 }]);
    expect(await identity.verifyCode('u-9', state, '123456')).toBe(true);
    expect(calls[0]!.url).toContain('/factors/f-9/challenge');
    expect(await provider([{ status: 400 }]).identity.startEnrolment('a@b.co', 'no')).toBeNull();
  });
  it('a provider that refuses the factor throws without the token', async () => {
    const err = await provider([{ status: 200, json: { access_token: 'tok-SECRET', user: { id: 'u' } } }, { status: 500 }]).identity.startEnrolment('a@b.co', 'pw').catch((e: Error) => e);
    expect((err as Error).message).not.toContain('tok-SECRET');
  });
});
