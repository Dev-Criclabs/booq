import { describe, expect, it } from 'vitest';
import { route, validateDeclaration, checkRouteTable, type RouteSession } from './route';

// F02-T11 route markers (AUTH-01-AC2, AC3, AC5, AC9, AC10; design 6.2): public, needs_person, or a permission.
const deps = { hasFeature: async () => true };
const player: RouteSession = { clubId: 'c1', userId: 'u1', roles: ['player'] };

describe('needsPerson routes', () => {
  const myBookings = route({ method: 'GET', path: '/me/bookings', needsPerson: true }, async (ctx) => ({ user: ctx.userId }));

  it('a guest gets sign_in_required, not a not-found or a server error', async () => {
    expect(await myBookings.handle({ session: null, input: {} }, deps)).toEqual({ ok: false, status: 401, code: 'sign_in_required' });
  });
  it('a signed-in person passes whatever their roles', async () => {
    expect(await myBookings.handle({ session: player, input: {} }, deps)).toMatchObject({ ok: true, body: { user: 'u1' } });
    expect(await myBookings.handle({ session: { ...player, roles: ['owner', 'player'] }, input: {} }, deps)).toMatchObject({ ok: true });
  });
  it('the pages the spec lists are all declared this way: checkout, bookings, credits, referral, profile', async () => {
    const pages = ['/checkout', '/me/bookings', '/me/credits', '/me/referral', '/me/profile'].map((path) => route({ method: 'GET', path, needsPerson: true }, async () => 'x'));
    for (const p of pages) expect(await p.handle({ session: null, input: {} }, deps), p.def.path).toMatchObject({ ok: false, code: 'sign_in_required' });
  });
  it('a hold request from a guest is refused before the handler runs (AUTH-01-AC3)', async () => {
    let ran = false;
    const hold = route({ method: 'POST', path: '/holds', needsPerson: true }, async () => (ran = true));
    expect(await hold.handle({ session: null, input: { slot: 's1' } }, deps)).toMatchObject({ ok: false, code: 'sign_in_required' });
    expect(ran).toBe(false);
  });
  it('browse pages stay public and need nothing (AUTH-01-AC10)', async () => {
    const browse = route({ method: 'GET', path: '/courts', public: true }, async () => 'open');
    expect(await browse.handle({ session: null, input: {} }, deps)).toMatchObject({ ok: true, body: 'open' });
  });
  it('a feature switch still applies to a person route', async () => {
    const gated = route({ method: 'GET', path: '/me/referral', needsPerson: true, feature: 'referral' }, async () => 'x');
    expect(await gated.handle({ session: player, input: {} }, { hasFeature: async () => false })).toEqual({ ok: false, status: 403, code: 'feature_disabled' });
  });
});

describe('declaration rules', () => {
  it('exactly one of permission, public or needsPerson', () => {
    expect(validateDeclaration({ method: 'GET', path: '/x', needsPerson: true })).toEqual([]);
    expect(validateDeclaration({ method: 'GET', path: '/x' })).not.toEqual([]);
    expect(validateDeclaration({ method: 'GET', path: '/x', needsPerson: true, public: true })).not.toEqual([]);
    expect(validateDeclaration({ method: 'GET', path: '/x', needsPerson: true, permission: 'club.read' })).not.toEqual([]);
  });
  it('the route table check accepts the marker and still flags a route with none', () => {
    expect(checkRouteTable([{ method: 'GET', path: '/a', needsPerson: true }, { method: 'GET', path: '/b', public: true }])).toEqual([]);
    expect(checkRouteTable([{ method: 'GET', path: '/c' }])).toHaveLength(1);
  });
});
