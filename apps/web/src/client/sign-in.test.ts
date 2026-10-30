import { describe, expect, it, vi } from 'vitest';
import { fakeLiff, type LiffFakeState } from './liff';
import { exchange, runSignIn } from './sign-in';

// F02-T19 with the LIFF port faked (F02-T18 brings the real one). LINE-01-AC1, AC2; AUTH-01-AC2, AC12.

const slug = 'hunter';
const next = '/c/hunter/checkout?court=2&date=2027-01-09&from=18:00&to=19:00';

function setup(state: Partial<LiffFakeState>, reply: () => Promise<Response> | Response) {
  const go = vi.fn();
  const liff = fakeLiff({ inClient: false, loggedIn: false, idToken: 'id-token', language: 'th', ...state }, go);
  const f = vi.fn(async () => reply()) as unknown as typeof fetch;
  return { go, liff, f, input: { liff, liffId: 'liff-1', slug, next, here: `https://app.test/c/hunter/sign-in?next=${encodeURIComponent(next)}`, fetch: f } };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('sign in (design 4.2)', () => {
  it('LINE-01-AC1: inside LINE it finishes with no tap and lands where the player was going', async () => {
    const s = setup({ inClient: true, loggedIn: true }, () => json(200, { state: 'active' }));
    expect(await runSignIn(s.input)).toEqual({ kind: 'go', url: next });
    expect(s.f).toHaveBeenCalledWith('/api/c/hunter/auth/session', expect.objectContaining({ method: 'POST', body: JSON.stringify({ idToken: 'id-token' }) }));
  });

  it('LINE-01-AC1: inside LINE without a LIFF login it goes to LINE login straight away, no C1', async () => {
    const s = setup({ inClient: true, loggedIn: false }, () => json(200, {}));
    expect(await runSignIn(s.input)).toEqual({ kind: 'redirecting' });
    expect(s.go).toHaveBeenCalledWith(s.input.here);
  });

  it('LINE-01-AC2: in a browser C1 shows until Log in with LINE, and nothing is sent', async () => {
    const s = setup({ inClient: false, loggedIn: false }, () => json(200, {}));
    expect(await runSignIn(s.input)).toEqual({ kind: 'welcome' });
    expect(s.f).not.toHaveBeenCalled();
  });

  it('AUTH-01-AC2: back from LINE login in a browser, the player returns to the same slot', async () => {
    const s = setup({ inClient: false, loggedIn: true }, () => json(200, { state: 'active' }));
    expect(await runSignIn(s.input)).toEqual({ kind: 'go', url: next });
  });

  it('a new player goes to C2 with the choice kept (AUTH-02-AC6)', async () => {
    const s = setup({ loggedIn: true }, () => json(200, { state: 'needs_profile' }));
    expect(await exchange(s.input)).toEqual({ kind: 'go', url: `/c/hunter/profile-setup?next=${encodeURIComponent(next)}` });
  });

  it('AUTH-01-AC12, LINE-01-AC11: LIFF unreachable is the offline error and nothing is sent', async () => {
    const s = setup({ offline: true }, () => json(200, {}));
    expect(await runSignIn(s.input)).toEqual({ kind: 'error', code: 'offline' });
    expect(s.f).not.toHaveBeenCalled();
  });

  it('AUTH-01-AC12: a dropped network or LINE offline at the server is the offline error', async () => {
    const dropped = setup({ loggedIn: true }, () => Promise.reject(new TypeError('network')));
    expect(await runSignIn(dropped.input)).toEqual({ kind: 'error', code: 'offline' });
    const lineDown = setup({ loggedIn: true }, () => json(503, { code: 'offline' }));
    expect(await runSignIn(lineDown.input)).toEqual({ kind: 'error', code: 'offline' });
  });

  it('refusals map to codes, never to text', async () => {
    expect(await exchange(setup({ loggedIn: true }, () => json(401, { code: 'invalid_token' })).input)).toEqual({ kind: 'error', code: 'sign_in_failed' });
    expect(await exchange(setup({ loggedIn: true }, () => json(404, { code: 'not_found' })).input)).toEqual({ kind: 'error', code: 'not_found' });
    expect(await exchange(setup({ loggedIn: true }, () => json(403, { code: 'account_inactive' })).input)).toEqual({ kind: 'error', code: 'account_inactive' });
    expect(await exchange(setup({ loggedIn: true, idToken: null }, () => json(200, {})).input)).toEqual({ kind: 'error', code: 'sign_in_failed' });
  });

  it('a club with no LIFF app is not found; no LIFF port at all is offline', async () => {
    const s = setup({}, () => json(200, {}));
    expect(await runSignIn({ ...s.input, liffId: null })).toEqual({ kind: 'error', code: 'not_found' });
    expect(await runSignIn({ ...s.input, liff: null })).toEqual({ kind: 'error', code: 'offline' });
  });

  it('AUTH-01-AC14: a return path outside the club goes to the club home instead', async () => {
    const s = setup({ loggedIn: true }, () => json(200, { state: 'active' }));
    expect(await runSignIn({ ...s.input, next: '/c/other-club/checkout' })).toEqual({ kind: 'go', url: '/c/hunter' });
    expect(await runSignIn({ ...s.input, next: 'https://evil.test/c/hunter' })).toEqual({ kind: 'go', url: '/c/hunter' });
  });
});
