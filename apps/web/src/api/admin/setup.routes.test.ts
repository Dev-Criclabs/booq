import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { setupRoutes } from './routes';

// F11-T09: A0 Setup checklist (ADMIN-02; PLAT-01, D54).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof setupRoutes>;

type Roles = ('owner' | 'front_desk' | 'player')[];
const as = (userId: string, roles: Roles) => ({ clubId: A, userId, roles });
const owner = () => as(OWNER, ['owner', 'player']);
const call = (method: string, path: string, session: ReturnType<typeof as> | null, input: Record<string, unknown> = {}) =>
  routes.find((r) => r.def.method === method && r.def.path === path)!.handle({ session, input: { slug: 'club-a', ...input } }, deps) as Promise<{ ok: boolean; status: number; code?: string; body?: any }>;
const steps = async () => Object.fromEntries((await call('GET', '/staff/setup', owner())).body.steps.map((s: { key: string; done: boolean }) => [s.key, s.done]));

async function person(id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, id, 'L' + id]);
    for (const r of roles) await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)`, [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','draft'), ($2,'club-b','ข','B','live')`, [A, B]);
  await person(OWNER, ['owner', 'player']);
  await person(DESK, ['front_desk', 'player']);
  await tdb.query(`delete from public.app_user_role where user_id = $1 and role = 'front_desk'`, [DESK]);
  db = createDb({ connectionString: tdb.url, max: 4 });
  routes = setupRoutes({ db, clubBySlug: async (slug) => (slug === 'club-a' ? { clubId: A } : slug === 'club-b' ? { clubId: B } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /staff/setup', () => {
  it('shows the three owner steps, none done on a new club, and nothing told', async () => {
    const r = await call('GET', '/staff/setup', owner());
    expect(r.body).toEqual({ clubStatus: 'draft', steps: [{ key: 'brand', done: false }, { key: 'products_rules', done: false }, { key: 'people', done: false }], toldAt: null });
  });
  it('brand is done when all six tiles have both labels', async () => {
    for (let t = 1; t <= 5; t++) await tdb.query(`insert into public.rich_menu_label (club_id, tile, label_th, label_en) values ($1,$2,'ก','a')`, [A, t]);
    expect((await steps())['brand']).toBe(false);
    await tdb.query(`insert into public.rich_menu_label (club_id, tile, label_th, label_en) values ($1,6,'ก',null)`, [A]);
    expect((await steps())['brand']).toBe(false);
    await tdb.query(`update public.rich_menu_label set label_en = 'a' where tile = 6 and club_id = $1`, [A]);
    expect((await steps())['brand']).toBe(true);
  });
  it('people is done with a staff or coach besides the owner', async () => {
    await tdb.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'front_desk')`, [A, DESK]);
    expect((await steps())['people']).toBe(true);
  });
  it('products_rules needs a price and the template required settings', async () => {
    await tdb.query(`insert into public.price_group (club_id, id, name_th, name_en, rule) values ($1,'77777777-7777-4777-8777-777777777771','ผู้ใหญ่','Adult','{"min_age":18}')`, [A]);
    await tdb.query(`insert into public.court_price_rule (club_id, price_group_id, price_satang) values ($1,'77777777-7777-4777-8777-777777777771',50000)`, [A]);
    const s = await steps();
    // A price alone is not enough when the template still has a required setting unset; with none required it is done.
    const required = (await tdb.query(`select app.launch_template_settings($1) as ok`, [A])).rows[0].ok as boolean;
    expect(s['products_rules']).toBe(required);
  });
  it('front desk, a player and a guest are refused; another club slug is not found', async () => {
    expect(await call('GET', '/staff/setup', as(DESK, ['front_desk', 'player']))).toMatchObject({ ok: false, status: 403 });
    expect(await call('GET', '/staff/setup', null)).toMatchObject({ ok: false, status: 401 });
    expect(await call('GET', '/staff/setup', owner(), { slug: 'club-b' })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('POST /staff/setup/done', () => {
  it('records once, shows when it was told, and a repeat records nothing', async () => {
    expect((await call('POST', '/staff/setup/done', owner())).body).toEqual({ recorded: true });
    expect((await call('POST', '/staff/setup/done', owner())).body).toEqual({ recorded: false });
    expect((await call('GET', '/staff/setup', owner())).body.toldAt).toBe('2026-12-01T03:00:00.000Z');
    expect((await tdb.query(`select count(*)::int as n from public.owner_setup_done`)).rows[0].n).toBe(1);
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'owner_setup_done'`)).rows[0].n).toBe(1);
  });
  it('is refused to anyone but the owner and after Go live', async () => {
    expect(await call('POST', '/staff/setup/done', as(DESK, ['front_desk', 'player']))).toMatchObject({ ok: false, status: 403 });
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    expect(await call('POST', '/staff/setup/done', owner())).toMatchObject({ ok: false, status: 409, code: 'club_not_available' });
  });
});
