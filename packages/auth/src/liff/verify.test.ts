import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock, FakeLine, type ClubLineChannel } from '../../../../tests/fakes';
import { createFakeLineVerifier, createLineVerifier, type LineVerifier } from './verify';

// F02-T04 (LINE-01-AC4, AC11; CC-2). The real client is exercised against QA's fake LINE
// over HTTP; the in-process fake verifier is checked against the same contract.
const channels: ClubLineChannel[] = [
  { clubId: 'A', channelAccessToken: 'tokA', loginChannelId: 'loginA', liffId: 'liffA' },
  { clubId: 'B', channelAccessToken: 'tokB', loginChannelId: 'loginB', liffId: 'liffB' },
];
const clock = new FakeClock();
const line = new FakeLine({
  clock,
  channels,
  users: [{ lineUserId: 'U1', displayName: 'Ploy', lineAppLanguage: 'th', friendOf: { A: true } }],
});
let server: { url: string; close(): Promise<void> };
let real: LineVerifier;

beforeAll(async () => {
  server = await line.serve();
  real = createLineVerifier({ baseUrl: server.url, now: () => clock.now() });
});
afterAll(async () => server.close());

describe('real LINE verify client', () => {
  it('accepts a token issued for this club and returns the LINE user id and name only', async () => {
    const r = await real.verifyIdToken({ idToken: line.issueIdToken('U1', 'A'), loginChannelId: 'loginA' });
    expect(r).toEqual({ ok: true, lineUserId: 'U1', displayName: 'Ploy' });
  });

  it("refuses club A's token at club B (LINE-01-AC4, CC-2)", async () => {
    const r = await real.verifyIdToken({ idToken: line.issueIdToken('U1', 'A'), loginChannelId: 'loginB' });
    expect(r).toEqual({ ok: false, code: 'wrong_audience' });
  });

  it('refuses an expired token', async () => {
    const t = line.issueIdToken('U1', 'A', 60);
    clock.advanceMs(120_000);
    expect(await real.verifyIdToken({ idToken: t, loginChannelId: 'loginA' })).toEqual({ ok: false, code: 'expired' });
  });

  it('refuses a token that is not a LINE token', async () => {
    expect(await real.verifyIdToken({ idToken: 'garbage', loginChannelId: 'loginA' })).toEqual({ ok: false, code: 'invalid_token' });
  });

  it('a 200 whose audience differs is still refused (the client checks aud itself)', async () => {
    const lying = createLineVerifier({
      baseUrl: 'http://x',
      now: () => clock.now(),
      fetch: async () => new Response(JSON.stringify({ iss: 'https://access.line.me', sub: 'U1', aud: 'loginB', exp: 9999999999 }), { status: 200 }),
    });
    expect(await lying.verifyIdToken({ idToken: 't', loginChannelId: 'loginA' })).toEqual({ ok: false, code: 'wrong_audience' });
  });

  it('a 200 with a foreign issuer or a past expiry is refused', async () => {
    const mk = (body: object) =>
      createLineVerifier({ baseUrl: 'http://x', now: () => clock.now(), fetch: async () => new Response(JSON.stringify(body), { status: 200 }) });
    const exp = Math.floor(clock.now().getTime() / 1000) + 600;
    expect(await mk({ iss: 'https://evil.example', sub: 'U1', aud: 'loginA', exp }).verifyIdToken({ idToken: 't', loginChannelId: 'loginA' })).toEqual({ ok: false, code: 'invalid_token' });
    expect(await mk({ iss: 'https://access.line.me', sub: 'U1', aud: 'loginA', exp: 1 }).verifyIdToken({ idToken: 't', loginChannelId: 'loginA' })).toEqual({ ok: false, code: 'expired' });
  });

  it('an unreachable LINE, a timeout and a 5xx all give the offline code and nothing else', async () => {
    const boom = createLineVerifier({ baseUrl: 'http://x', now: () => clock.now(), fetch: async () => { throw new TypeError('fetch failed'); } });
    const down = createLineVerifier({ baseUrl: 'http://x', now: () => clock.now(), fetch: async () => new Response('bad gateway', { status: 502 }) });
    const slow = createLineVerifier({
      baseUrl: 'http://x',
      now: () => clock.now(),
      timeoutMs: 20,
      fetch: (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    });
    for (const v of [boom, down, slow]) expect(await v.verifyIdToken({ idToken: 't', loginChannelId: 'loginA' })).toEqual({ ok: false, code: 'offline' });
  });

  it('an unparseable 200 body is a failure, not a sign in', async () => {
    const v = createLineVerifier({ baseUrl: 'http://x', now: () => clock.now(), fetch: async () => new Response('<html>', { status: 200 }) });
    expect((await v.verifyIdToken({ idToken: 't', loginChannelId: 'loginA' })).ok).toBe(false);
  });
});

describe('fake LINE verifier (same contract)', () => {
  it.each([
    ['valid', { ok: true, lineUserId: 'U9', displayName: 'Fake' }],
    ['wrong_audience', { ok: false, code: 'wrong_audience' }],
    ['expired', { ok: false, code: 'expired' }],
    ['bad_signature', { ok: false, code: 'invalid_token' }],
    ['unreachable', { ok: false, code: 'offline' }],
  ] as const)('mode %s', async (mode, expected) => {
    const v = createFakeLineVerifier(mode, { lineUserId: 'U9', displayName: 'Fake' });
    expect(await v.verifyIdToken({ idToken: 't', loginChannelId: 'loginA' })).toEqual(expected);
  });
});
