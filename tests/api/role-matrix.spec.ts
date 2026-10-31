// API role matrix (RLS test plan RLS-R07, ROLE-AC1 to AC3, ROLE-01-AC2; design 6.2). Every route mounted in apps/web is called
// as every role set and as a guest, through the real transport (serveRoutes) with a database that fails the test if it is touched
// before the permission gate has let the call through. A route that declares a permission must refuse (403, or 401 for a guest)
// exactly the role sets the permission matrix refuses, and a refused call must not reach the database. A new route needs no change here.
import { describe, expect, it } from 'vitest';
import { can, permissionNames, ROLES, serveRoutes, type Role, type RouteSession } from '../../packages/auth/src/index';
import type { Db } from '../../packages/db/src/tx';
import { createWebTable } from '../../apps/web/src/server/context';

const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const USER = '11111111-1111-4111-8111-111111111111';
const SOME_ID = '99999999-9999-4999-8999-999999999999';

let dbTouches = 0;
const db = new Proxy({}, { get: () => { dbTouches++; throw new Error('database touched before the gate let the call through'); } }) as unknown as Db;
const parts = {
  db,
  verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) },
  now: () => new Date('2026-12-07T03:00:00Z'),
  config: { sessionSeconds: 60, maxBodyBytes: 10_000, importLimits: null },
};
const built = createWebTable(parts);
const table = built.table;

/** Role sets a person can hold. Every club person also holds the player role (D115). */
const ROLE_SETS: Role[][] = [
  ['player'],
  ['coach', 'player'],
  ['front_desk', 'player'],
  ['accountant', 'player'],
  ['owner', 'player'],
  ['coach', 'front_desk', 'player'],
  ['accountant', 'front_desk', 'player'],
];

function handler(roles: Role[] | null) {
  return serveRoutes(table, {
    routeDeps: { hasFeature: async () => true },
    maxBodyBytes: 10_000,
    async resolveSession(): Promise<RouteSession | null> {
      return roles ? { clubId: CLUB, userId: USER, roles } : null;
    },
  });
}

async function call(roles: Role[] | null, def: { method: string; path: string }) {
  const segments = def.path.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? SOME_ID : s));
  const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(def.method);
  const res = await handler(roles)(
    new Request(`https://booq.example/${segments.join('/')}`, { method: def.method, headers: { 'content-type': 'application/json', cookie: 'qa=1' }, ...(hasBody ? { body: '{}' } : {}) }),
    { params: Promise.resolve({ slug: 'hunter', path: segments }) },
  );
  return res.status;
}

const permissioned = table.filter((r) => r.def.permission !== undefined);
const personRoutes = table.filter((r) => r.def.needsPerson === true);
const publicRoutes = table.filter((r) => r.def.public === true);

describe('the mounted web routes', () => {
  it('there are routes of each kind to test', () => {
    expect(table.length).toBeGreaterThan(40);
    expect(permissioned.length).toBeGreaterThan(10);
    expect(personRoutes.length).toBeGreaterThan(5);
    expect(publicRoutes.length).toBeGreaterThan(3);
  });

  it('every permission a route declares is in the permission matrix', () => {
    const known = new Set(permissionNames());
    expect(permissioned.filter((r) => !known.has(r.def.permission!)).map((r) => `${r.def.method} ${r.def.path}`)).toEqual([]);
  });

  it('a route that declares a permission refuses exactly the role sets the matrix refuses, and a guest with 401', async () => {
    const wrong: string[] = [];
    for (const r of permissioned) {
      const label = `${r.def.method} ${r.def.path} [${r.def.permission}]`;
      dbTouches = 0;
      const guest = await call(null, r.def);
      if (guest !== 401) wrong.push(`${label}: guest got ${guest}, expected 401`);
      for (const roles of ROLE_SETS) {
        dbTouches = 0;
        const status = await call(roles, r.def);
        const allowed = can(roles, r.def.permission!);
        if (!allowed && status !== 403) wrong.push(`${label}: [${roles}] got ${status}, expected 403`);
        if (!allowed && dbTouches > 0) wrong.push(`${label}: [${roles}] was refused but the database was touched`);
        if (allowed && (status === 401 || status === 403)) wrong.push(`${label}: [${roles}] is allowed by the matrix but got ${status}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('a route for any signed-in person refuses a guest with 401 and lets every role set through the gate', async () => {
    const wrong: string[] = [];
    for (const r of personRoutes) {
      const label = `${r.def.method} ${r.def.path}`;
      dbTouches = 0;
      const guest = await call(null, r.def);
      if (guest !== 401) wrong.push(`${label}: guest got ${guest}, expected 401`);
      if (dbTouches > 0) wrong.push(`${label}: a guest touched the database`);
      for (const roles of ROLE_SETS) {
        const status = await call(roles, r.def);
        if (status === 401 || status === 403) wrong.push(`${label}: [${roles}] got ${status}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('a public route lets a guest through the gate', async () => {
    const wrong: string[] = [];
    for (const r of publicRoutes) {
      const status = await call(null, r.def);
      if (status === 401 || status === 403) wrong.push(`${r.def.method} ${r.def.path}: guest got ${status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('no route is reachable without a declared access: the public list is the sign in, config and browse routes only', () => {
    const names = publicRoutes.map((r) => `${r.def.method} ${r.def.path}`);
    // Anything new in this list is a decision for Security: the test prints it so a reviewer sees it.
    const sensitive = names.filter((n) => /staff|admin|receipt|payment|wallet|credit|export|import|audit|secret|settings|customer|report|booking\/\w+\/cancel/i.test(n));
    expect(sensitive, 'public routes whose path looks like staff, money or personal data').toEqual([]);
  });
});

describe('the permission matrix against the hand-off roles table', () => {
  const who = (permission: string) => ROLES.filter((r) => can([r], permission)).sort();
  const sensitive = (names: string[]) => names.filter((n) => permissionNames().includes(n));

  it('front desk sees no revenue or coach pay and changes no price, rule or staff', () => {
    for (const p of sensitive(['report.revenue.read', 'coach.pay.read', 'price.write', 'rules.write', 'staff.manage', 'roles.assign', 'settings.write', 'audit.read'])) {
      expect(who(p), p).not.toContain('front_desk');
    }
  });

  it('the accountant changes no booking, price, balance or staff, and sees no customer contact detail (D35)', () => {
    for (const p of sensitive(['booking.write', 'booking.create.staff', 'booking.move', 'price.write', 'rules.write', 'staff.manage', 'roles.assign', 'customer.contact.read', 'receipt.void'])) {
      expect(who(p), p).not.toContain('accountant');
    }
  });

  it('a coach sees no payment, revenue, other coach, receipt or customer detail', () => {
    for (const p of permissionNames().filter((n) => /^(report|coach\.pay|receipt|customer|orders\.read(?!\.own)|price|rules|staff|settings|audit|import|export|daily-close)/.test(n))) {
      expect(who(p), p).not.toContain('coach');
    }
  });

  it('a player (without a staff role) holds only the own-data permissions', () => {
    const playerOnly = permissionNames().filter((p) => can(['player'], p));
    expect(playerOnly.sort()).toEqual(['booking.read.own', 'club.read', 'datarequest.own', 'orders.read.own']);
  });

  it('only the owner voids a receipt, assigns roles, reads the audit log, runs an import or export and changes settings (D115)', () => {
    for (const p of sensitive(['receipt.void', 'roles.assign', 'staff.manage', 'audit.read', 'import.run', 'export.run', 'settings.write', 'support-window.write'])) {
      expect(who(p), p).toEqual(['owner']);
    }
  });

  it('BOOQ roles are not club roles: the matrix knows only the five club roles', () => {
    expect([...ROLES].sort()).toEqual(['accountant', 'coach', 'front_desk', 'owner', 'player']);
  });
});
