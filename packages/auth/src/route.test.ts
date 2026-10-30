import { describe, expect, it, vi } from 'vitest';
import { can, canAll, permissionNames, ROLES, type Role } from './permissions';
import { route, validateDeclaration, checkRouteTable, type RouteSession } from './route';
import { findUndeclaredRoutes } from './check';

// F01-T13: ROLE-01-AC2, ROLE-AC1 to AC4, PLAT-05-AC2.

const CLUB = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const session = (...roles: Role[]): RouteSession => ({ clubId: CLUB, userId: USER, roles });
const featuresOn = { hasFeature: async () => true };
const featuresOff = { hasFeature: async () => false };

describe('permission matrix', () => {
  it('rights are the union of the roles and nothing more (ROLE-01-AC2)', () => {
    expect(can(['player'], 'datarequest.handle')).toBe(false);
    expect(can(['front_desk'], 'datarequest.handle')).toBe(true);
    expect(can(['player', 'front_desk'], 'datarequest.handle')).toBe(true);
    expect(can(['coach', 'player'], 'club.read')).toBe(true);
    expect(can(['coach', 'player'], 'settings.write')).toBe(false);
  });

  it('front desk is refused revenue, prices, rules, staff and coach pay (ROLE-AC1)', () => {
    for (const p of ['report.revenue.read', 'price.write', 'rules.write', 'staff.manage', 'roles.assign', 'coach.pay.read', 'settings.read']) {
      expect(can(['front_desk'], p), p).toBe(false);
    }
    expect(can(['front_desk'], 'booking.write')).toBe(true);
  });

  it('an accountant reads but changes nothing, and never reads phone or date of birth (ROLE-AC2, D35)', () => {
    for (const p of ['booking.write', 'price.write', 'rules.write', 'settings.write', 'club.business.write', 'staff.manage', 'roles.assign', 'import.run']) {
      expect(can(['accountant'], p), p).toBe(false);
    }
    expect(can(['accountant'], 'customer.contact.read')).toBe(false);
    expect(can(['accountant'], 'customer.names.read')).toBe(true);
    expect(can(['accountant'], 'settings.business.read')).toBe(true);
    expect(can(['accountant'], 'settings.read')).toBe(false);
    expect(can(['accountant'], 'report.revenue.read')).toBe(true);
  });

  it('a coach has no payments or revenue (ROLE-AC3) and a player no staff rights', () => {
    expect(can(['coach'], 'report.revenue.read')).toBe(false);
    expect(can(['coach'], 'customer.contact.read')).toBe(false);
    for (const p of permissionNames()) if (!['club.read', 'datarequest.own'].includes(p)) expect(can(['player'], p), p).toBe(false);
  });

  it('the owner holds every permission', () => {
    for (const p of permissionNames()) expect(can(['owner'], p), p).toBe(true);
  });

  it('fails closed: unknown permission, unknown role, empty set', () => {
    expect(can(['owner'], 'no.such.permission')).toBe(false);
    expect(can(['guest' as Role], 'club.read')).toBe(false);
    expect(can([], 'club.read')).toBe(false);
    expect(canAll(['front_desk'], ['booking.write', 'price.write'])).toBe(false);
  });

  it('knows exactly the five club roles', () => {
    expect([...ROLES].sort()).toEqual(['accountant', 'coach', 'front_desk', 'owner', 'player']);
  });
});

describe('route() declaration', () => {
  it('refuses a route with no permission, feature or public declaration', () => {
    expect(() => route({ method: 'GET', path: '/x' } as never, async () => 1)).toThrow(/declare/);
    expect(validateDeclaration({ method: 'GET', path: '/x' } as never)).not.toEqual([]);
  });

  it('refuses permission together with public, an unknown permission, and a bad method or path', () => {
    expect(() => route({ method: 'GET', path: '/x', permission: 'club.read', public: true } as never, async () => 1)).toThrow();
    expect(() => route({ method: 'GET', path: '/x', permission: 'club.raed' }, async () => 1)).toThrow(/unknown permission/);
    expect(() => route({ method: 'FETCH', path: '/x', public: true } as never, async () => 1)).toThrow();
    expect(() => route({ method: 'GET', path: 'x', public: true }, async () => 1)).toThrow();
  });

  it('a feature alone is not enough: it still needs a permission or public', () => {
    expect(() => route({ method: 'GET', path: '/x', feature: 'coaches' } as never, async () => 1)).toThrow(/declare/);
  });

  it('build check over a route table fails an undeclared entry', () => {
    const ok = route({ method: 'GET', path: '/club', permission: 'club.read' }, async () => 1);
    expect(checkRouteTable([ok.def])).toEqual([]);
    const bad = checkRouteTable([ok.def, { method: 'POST', path: '/oops' } as never]);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ path: '/oops' });
    const dup = checkRouteTable([ok.def, ok.def]);
    expect(dup[0]?.problem).toMatch(/twice/);
  });
});

describe('route() at run time', () => {
  it('a route with customer.contact.read rejects an accountant and never runs the handler (ROLE-AC2)', async () => {
    const handler = vi.fn(async () => ({ phone: '0812345678' }));
    const r = route({ method: 'GET', path: '/customers/:id', permission: 'customer.contact.read' }, handler);
    const res = await r.handle({ session: session('accountant', 'player'), input: {} }, featuresOn);
    expect(res).toEqual({ ok: false, status: 403, code: 'forbidden' });
    expect(handler).not.toHaveBeenCalled();
    const ok = await r.handle({ session: session('front_desk', 'player'), input: {} }, featuresOn);
    expect(ok).toEqual({ ok: true, status: 200, body: { phone: '0812345678' } });
  });

  it('no session is refused as unauthenticated', async () => {
    const handler = vi.fn(async () => 1);
    const r = route({ method: 'GET', path: '/club', permission: 'club.read' }, handler);
    expect(await r.handle({ session: null, input: {} }, featuresOn)).toEqual({ ok: false, status: 401, code: 'unauthenticated' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('a feature that is off is refused by the server whatever the role (PLAT-05-AC2)', async () => {
    const handler = vi.fn(async () => 1);
    const r = route({ method: 'GET', path: '/coaches', permission: 'club.read', feature: 'coaches' }, handler);
    const seen: Array<[string, string]> = [];
    const deps = { hasFeature: async (club: string, key: string) => (seen.push([club, key]), false) };
    const res = await r.handle({ session: session('owner', 'player'), input: {} }, deps);
    expect(res).toEqual({ ok: false, status: 403, code: 'feature_disabled' });
    expect(seen).toEqual([[CLUB, 'coaches']]);
    expect(handler).not.toHaveBeenCalled();
    expect((await r.handle({ session: session('player'), input: {} }, featuresOn)).ok).toBe(true);
  });

  it('permission is checked before the feature, so a forbidden caller learns nothing about switches', async () => {
    const r = route({ method: 'GET', path: '/x', permission: 'staff.manage', feature: 'coaches' }, async () => 1);
    const res = await r.handle({ session: session('player'), input: {} }, featuresOff);
    expect(res).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('a public route runs without a session; a public route with a feature still checks the switch', async () => {
    const pub = route({ method: 'GET', path: '/health', public: true }, async () => 'up');
    expect(await pub.handle({ session: null, input: {} }, featuresOn)).toEqual({ ok: true, status: 200, body: 'up' });
    const gated = route({ method: 'GET', path: '/join', public: true, feature: 'referrals' }, async () => 'x');
    // No club is known without a session, so a gated public route needs one and fails closed.
    expect(await gated.handle({ session: null, input: {} }, featuresOn)).toEqual({ ok: false, status: 401, code: 'unauthenticated' });
  });

  it('passes club, user and roles from the session to the handler, never from the input', async () => {
    const handler = vi.fn(async (ctx: { clubId: string }) => ctx.clubId);
    const r = route({ method: 'POST', path: '/x', permission: 'club.read' }, handler);
    const res = await r.handle({ session: session('player'), input: { clubId: 'evil' } }, featuresOn);
    expect(res).toMatchObject({ ok: true, body: CLUB });
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ clubId: CLUB, userId: USER, roles: ['player'] });
  });

  it('a handler that throws a typed error becomes its status and code; other errors become 500 with no message', async () => {
    const { RouteError } = await import('./route');
    const nf = route({ method: 'GET', path: '/a', permission: 'club.read' }, async () => { throw new RouteError(404, 'not_found'); });
    expect(await nf.handle({ session: session('player'), input: {} }, featuresOn)).toEqual({ ok: false, status: 404, code: 'not_found' });
    const boom = route({ method: 'GET', path: '/b', permission: 'club.read' }, async () => { throw new Error('secret detail'); });
    expect(await boom.handle({ session: session('player'), input: {} }, featuresOn)).toEqual({ ok: false, status: 500, code: 'internal' });
  });
});

describe('source scan: routes without a declaration fail the build', () => {
  const file = (text: string) => [{ path: 'apps/web/src/app/api/c/[slug]/club/route.ts', text }];

  it('flags a bare exported handler', () => {
    const v = findUndeclaredRoutes(file('export async function GET() { return new Response("x"); }'));
    expect(v).toEqual([{ path: 'apps/web/src/app/api/c/[slug]/club/route.ts', line: 1, method: 'GET' }]);
  });

  it('flags a const handler that is not wrapped in route()', () => {
    expect(findUndeclaredRoutes(file('export const POST = async () => {};'))).toHaveLength(1);
  });

  it('accepts handlers wrapped in route(), also across lines', () => {
    const text = [
      "import { route } from '@booq/auth';",
      "export const GET = route({ method: 'GET', path: '/club', permission: 'club.read' }, async () => 1);",
      'export const PUT = route(',
      "  { method: 'PUT', path: '/club', permission: 'club.business.write' },",
      '  async () => 1,',
      ');',
    ].join('\n');
    expect(findUndeclaredRoutes(file(text))).toEqual([]);
  });

  it('flags only the unwrapped method when a file mixes both', () => {
    const text = ["export const GET = route({}, h);", 'export async function DELETE() {}'].join('\n');
    expect(findUndeclaredRoutes(file(text)).map((v) => v.method)).toEqual(['DELETE']);
  });

  it('flags re-exported handlers it cannot see through', () => {
    expect(findUndeclaredRoutes(file("export { GET } from './impl';"))).toHaveLength(1);
  });

  it('ignores files that are not route files and non-method exports', () => {
    expect(findUndeclaredRoutes([{ path: 'apps/web/src/lib/util.ts', text: 'export async function GET() {}' }])).toEqual([]);
    expect(findUndeclaredRoutes(file('export const dynamic = "force-dynamic";'))).toEqual([]);
  });
});
