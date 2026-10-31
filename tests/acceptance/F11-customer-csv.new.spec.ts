// ADMIN-06 / PLAT-06-AC13 at the route: what the customer CSV holds. Written by QA after the F11 sweep.
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FileReply } from '../../packages/auth/src/index';
import { createDb, type Db } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';
import { customerRoutes } from '../../apps/web/src/api/admin/routes';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const DESK = '33333333-3333-4333-8333-333333333333';
const EVIL = '11111111-1111-4111-8111-111111111111';
let tdb: TestDatabase;
let db: Db;

async function person(id: string, roles: string[], name: string, phone: string | null) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, display_name, phone, phone_normalized, date_of_birth) values ($1,$2,$3,$4,$5,$6,'1990-02-02')`, [A, id, 'L' + id, name, phone, phone ? phone.replace('+', '') : null]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  await person(DESK, ['front_desk', 'player'], 'Desk', null);
  await person(EVIL, ['player'], '=HYPERLINK("http://evil.example","click")', '+66811111111');
  db = createDb({ connectionString: tdb.url, max: 3 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

// A player chooses their own display name. A cell that starts with = + - or @ runs as a formula when front desk opens the file in a spreadsheet (CSV injection, OWASP).
// The spec is silent; the lane neutralises such cells with a leading apostrophe. This keeps that from regressing (it adds no product rule).
it('F11/ADMIN-06 the customer CSV never writes a cell that starts with = + - or @ as a formula', async () => {
  const routes = customerRoutes({ db, clubBySlug: async () => ({ clubId: A }) });
  const r = (await routes.find((x) => x.def.method === 'GET' && x.def.path === '/staff/customers/csv')!.handle({ session: { clubId: A, userId: DESK, roles: ['front_desk', 'player'] }, input: { slug: 'club-a' } }, { hasFeature: async () => true })) as { ok: boolean; body: FileReply };
  expect(r.ok).toBe(true);
  const text = Buffer.from(r.body.bytes).toString('utf8');
  const line = text.split('\n').find((l) => l.includes('HYPERLINK')) ?? '';
  expect(line).not.toBe('');
  expect(line.startsWith('"\'=HYPERLINK')).toBe(true);
  expect(text).toContain("'+66811111111");   // the phone also starts with +
});
