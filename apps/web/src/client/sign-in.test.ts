import { describe, expect, it, vi } from 'vitest';
import { fakeLiff, type LiffFakeState } from './liff';
import { signInFlow, stepFor } from './sign-in';

// The sign-in screen on F02-T18's LIFF client, with a fake LIFF and the server's real answer shapes.
// LINE-01-AC1, AC2; AUTH-01-AC2, AC12, AC14.

const slug = 'hunter';
const next = '/c/hunter/checkout?court=2&date=2027-01-09&from=18:00&to=19:00';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(state: Partial<LiffFakeState>, session: () => Response | Promise<Response>) {
  const go = vi.fn();
  const liff = fakeLiff({ inClient: false, loggedIn: false, idToken: 'id-token', language: 'th', ...state }, go);
  const f = vi.fn(async (url: string) => (url.endsWith('/public/config') ? json(200, { liffId: 'liff-1', nameTh: 'ก', nameEn: 'A' }) : session())) as unknown as typeof fetch;
  return { go, f, flow: signInFlow({ liff, slug, next, origin: 'https://app.test', fetch: f }) };
}
const posts = (f: typeof fetch) => (f as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.filter(([, i]) => i?.method === 'POST');

describe('sign in (design 4.2) on the T18 client', () => {
  it('LINE-01-AC1: inside LINE it finishes with no tap and lands where the player was going', async () => {
    const s = setup({ inClient: true, loggedIn: true }, () => json(200, { state: 'active' }));
    expect(await s.flow.run()).toEqual({ kind: 'go', url: next });
    expect(posts(s.f).map(([u, i]) => [u, i?.body])).toEqual([['/api/c/hunter/auth/session', JSON.stringify({ idToken: 'id-token' })]]);
  });

  it('LINE-01-AC2: in a browser C1 shows until Log in with LINE, and nothing is sent', async () => {
    const s = setup({}, () => json(200, {}));
    expect(await s.flow.run()).toEqual({ kind: 'welcome' });
    expect(posts(s.f)).toEqual([]);
  });

  it('LINE-01-AC2: Log in with LINE comes back to this sign-in page with the same return path', async () => {
    const s = setup({}, () => json(200, {}));
    await s.flow.run();
    s.flow.login();
    expect(s.go).toHaveBeenCalledWith(`https://app.test/c/hunter/sign-in?next=${encodeURIComponent(next)}`);
  });

  it('AUTH-01-AC2: back from LINE in a browser, the player returns to the same slot', async () => {
    const s = setup({ loggedIn: true }, () => json(200, { state: 'active' }));
    expect(await s.flow.run()).toEqual({ kind: 'go', url: next });
  });

  it('a new player (server state pending_profile) goes to C2 with the choice kept (AUTH-02-AC6)', async () => {
    const s = setup({ loggedIn: true }, () => json(200, { state: 'pending_profile' }));
    expect(await s.flow.run()).toEqual({ kind: 'go', url: `/c/hunter/profile-setup?next=${encodeURIComponent(next)}` });
  });

  it('AUTH-01-AC12, LINE-01-AC11: LIFF unreachable or the network dropping is the offline error, nothing sent', async () => {
    const down = setup({ offline: true }, () => json(200, {}));
    expect(await down.flow.run()).toEqual({ kind: 'error', code: 'offline' });
    expect(posts(down.f)).toEqual([]);
    expect(await setup({ loggedIn: true }, () => Promise.reject(new TypeError('net'))).flow.run()).toEqual({ kind: 'error', code: 'offline' });
    expect(await setup({ loggedIn: true }, () => json(503, { code: 'offline' })).flow.run()).toEqual({ kind: 'error', code: 'offline' });
  });

  it('refusals map to codes, never to text', async () => {
    expect(await setup({ loggedIn: true }, () => json(401, { code: 'invalid_token' })).flow.run()).toEqual({ kind: 'error', code: 'sign_in_failed' });
    expect(await setup({ loggedIn: true }, () => json(404, { code: 'not_found' })).flow.run()).toEqual({ kind: 'error', code: 'not_found' });
    expect(await setup({ loggedIn: true }, () => json(403, { code: 'account_inactive' })).flow.run()).toEqual({ kind: 'error', code: 'account_inactive' });
    expect(await setup({ loggedIn: true, idToken: null }, () => json(200, {})).flow.run()).toEqual({ kind: 'error', code: 'sign_in_failed' });
  });

  it('AUTH-01-AC14: a return path outside the club goes to the club home instead', () => {
    expect(stepFor({ state: 'active' }, slug, '/c/other-club/checkout')).toEqual({ kind: 'go', url: '/c/hunter' });
    expect(stepFor({ state: 'active' }, slug, 'https://evil.test/c/hunter')).toEqual({ kind: 'go', url: '/c/hunter' });
  });
});
