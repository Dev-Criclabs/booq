import { describe, expect, it } from 'vitest';
import { createLiffClient, type LiffLike } from './client';

// F02-T18 LIFF client module (LINE-01-AC1 to AC3, AC11; AUTH-01-AC2, AC12). A LIFF stub and a scripted fetch;
// no browser needed because the module touches neither the DOM nor the SDK directly.
function stub(over: Partial<{ inClient: boolean; loggedIn: boolean; token: string | null; initError: Error; language: string }> = {}) {
  const calls: string[] = [];
  const s = { inClient: false, loggedIn: false, token: 'ID-TOKEN-1' as string | null, language: 'th-TH', ...over };
  const liff: LiffLike = {
    async init({ liffId }) {
      calls.push(`init:${liffId}`);
      if (s.initError) throw s.initError;
    },
    isInClient: () => s.inClient,
    isLoggedIn: () => s.loggedIn,
    login: ({ redirectUri }) => void calls.push(`login:${redirectUri}`),
    getIDToken: () => s.token,
    getLanguage: () => s.language,
  };
  return { liff, calls, state: s };
}
type Reply = { status: number; body: unknown } | Error;
function api(script: Record<string, Reply[]>) {
  const seen: { method: string; url: string; body?: unknown }[] = [];
  const fetchFn = async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    seen.push({ method, url, ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
    const next = script[`${method} ${url}`]?.shift();
    if (!next) throw new Error(`unscripted ${method} ${url}`);
    if (next instanceof Error) throw next;
    return { status: next.status, json: async () => next.body } as Response;
  };
  return { fetchFn: fetchFn as unknown as typeof fetch, seen };
}
const CONFIG = { status: 200, body: { liffId: 'liff-1', defaultLanguage: 'th', languages: ['th', 'en'] } };
const ACTIVE = { status: 200, body: { state: 'active' } };
const make = (l: ReturnType<typeof stub>, a: ReturnType<typeof api>) =>
  createLiffClient({ liff: l.liff, fetch: a.fetchFn, slug: 'hunter', origin: 'https://app.example' });

describe('inside LINE', () => {
  it('finishes sign-in with no tap: init, ID token, POST /auth/session', async () => {
    const l = stub({ inClient: true, loggedIn: true });
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG], 'POST /api/c/hunter/auth/session': [ACTIVE] });
    expect(await make(l, a).ensureSession()).toEqual({ state: 'active' });
    expect(l.calls).toEqual(['init:liff-1']);
    expect(a.seen[1]).toEqual({ method: 'POST', url: '/api/c/hunter/auth/session', body: { idToken: 'ID-TOKEN-1' } });
  });
  it('a new LINE user comes back as pending_profile (C2 next)', async () => {
    const l = stub({ inClient: true, loggedIn: true });
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG], 'POST /api/c/hunter/auth/session': [{ status: 200, body: { state: 'pending_profile' } }] });
    expect(await make(l, a).ensureSession()).toEqual({ state: 'pending_profile' });
  });
  it('a lost server session is re-established silently with a fresh token, once', async () => {
    const l = stub({ inClient: true, loggedIn: true });
    const a = api({
      'GET /api/c/hunter/public/config': [CONFIG, CONFIG],
      'POST /api/c/hunter/auth/session': [ACTIVE, ACTIVE],
    });
    const c = make(l, a);
    await c.ensureSession();
    l.state.token = 'ID-TOKEN-2';
    expect(await c.reestablish()).toEqual({ state: 'active' });
    expect(a.seen.filter((r) => r.method === 'POST').map((r) => (r.body as { idToken: string }).idToken)).toEqual(['ID-TOKEN-1', 'ID-TOKEN-2']);
  });
});

describe('in a browser', () => {
  it('not logged in: no call to /auth/session, the UI is told to show Log in with LINE', async () => {
    const l = stub({ inClient: false, loggedIn: false });
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG] });
    expect(await make(l, a).ensureSession()).toEqual({ state: 'needs_login' });
    expect(a.seen.filter((r) => r.method === 'POST')).toEqual([]);
  });
  it('one tap: login() goes to LINE with a return address inside the same club', async () => {
    const l = stub();
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG] });
    const c = make(l, a);
    await c.ensureSession();
    c.login('/c/hunter/book/checkout?slot=2026-12-07T10:00&court=2');
    expect(l.calls.at(-1)).toBe('login:https://app.example/c/hunter/book/checkout?slot=2026-12-07T10:00&court=2');
  });
  it('a return path to another club or another site is not followed: it falls back to the club home', async () => {
    const l = stub();
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG] });
    const c = make(l, a);
    await c.ensureSession();
    c.login('/c/other/book');
    expect(l.calls.at(-1)).toBe('login:https://app.example/c/hunter');
    c.login('https://evil.example/x');
    expect(l.calls.at(-1)).toBe('login:https://app.example/c/hunter');
  });
  it('after LINE sends the person back, logged in: the token is exchanged and the session is active (a reload keeps it)', async () => {
    const l = stub({ loggedIn: true });
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG, CONFIG], 'POST /api/c/hunter/auth/session': [ACTIVE, ACTIVE] });
    expect(await make(l, a).ensureSession()).toEqual({ state: 'active' });
    expect(await make(l, a).ensureSession()).toEqual({ state: 'active' });
  });
});

describe('offline and refusals (LINE-01-AC11, AUTH-01-AC12)', () => {
  it('the club config unreachable is offline: nothing else is tried', async () => {
    const l = stub({ inClient: true, loggedIn: true });
    const a = api({ 'GET /api/c/hunter/public/config': [new TypeError('fetch failed')] });
    expect(await make(l, a).ensureSession()).toEqual({ state: 'offline' });
    expect(l.calls).toEqual([]);
  });
  it('liff.init failing is offline', async () => {
    const l = stub({ inClient: true, loggedIn: true, initError: new Error('network') });
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG] });
    expect(await make(l, a).ensureSession()).toEqual({ state: 'offline' });
  });
  it('POST /auth/session unreachable, or the server saying offline, is offline', async () => {
    const l = stub({ inClient: true, loggedIn: true });
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG, CONFIG], 'POST /api/c/hunter/auth/session': [new TypeError('fetch failed'), { status: 503, body: { code: 'offline' } }] });
    const c = make(l, a);
    expect(await c.ensureSession()).toEqual({ state: 'offline' });
    expect(await c.ensureSession()).toEqual({ state: 'offline' });
  });
  it('a refusal keeps its code for the UI to map to a text', async () => {
    const l = stub({ inClient: true, loggedIn: true });
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG, CONFIG, CONFIG], 'POST /api/c/hunter/auth/session': [{ status: 401, body: { code: 'invalid_token' } }, { status: 403, body: { code: 'account_inactive' } }, { status: 404, body: { code: 'not_found' } }] });
    const c = make(l, a);
    expect(await c.ensureSession()).toEqual({ state: 'refused', code: 'invalid_token' });
    expect(await c.ensureSession()).toEqual({ state: 'refused', code: 'account_inactive' });
    expect(await c.ensureSession()).toEqual({ state: 'refused', code: 'not_found' });
  });
  it('no ID token from LIFF while logged in is a refusal, not a call with an empty token', async () => {
    const l = stub({ inClient: true, loggedIn: true, token: null });
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG] });
    expect(await make(l, a).ensureSession()).toEqual({ state: 'refused', code: 'no_token' });
    expect(a.seen.filter((r) => r.method === 'POST')).toEqual([]);
  });
});

describe('language and the token', () => {
  it('reports the LINE app language so the first screen can start in it', async () => {
    const l = stub({ language: 'en-US' });
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG] });
    const c = make(l, a);
    await c.ensureSession();
    expect(c.preferredLanguage()).toBe('en');
  });
  it('never puts the ID token in a URL', async () => {
    const l = stub({ inClient: true, loggedIn: true });
    const a = api({ 'GET /api/c/hunter/public/config': [CONFIG], 'POST /api/c/hunter/auth/session': [ACTIVE] });
    await make(l, a).ensureSession();
    expect(a.seen.some((r) => r.url.includes('ID-TOKEN'))).toBe(false);
  });
});
