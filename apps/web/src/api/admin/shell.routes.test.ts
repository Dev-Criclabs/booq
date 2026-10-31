import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { shellRoutes } from './routes';

// F11-T02: GET /staff/shell (ADMIN-01; D58, D98, D114).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '44444444-4444-4444-8444-444444444444';
const DESK = '33333333-3333-4333-8333-333333333333';
const ACC = '55555555-5555-4555-8555-555555555555';
const BOTH = '66666666-6666-4666-8666-666666666666';
const COACH = '77777777-7777-4777-8777-777777777771';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const PSTAFF = '88888888-8888-4888-8888-888888888888';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof shellRoutes>;

type Roles = ('owner' | 'front_desk' | 'accountant' | 'coach' | 'player')[];
const as = (userId: string, roles: Roles) => ({ clubId: A, userId, roles });
const shell = (session: ReturnType<typeof as> | null, input: Record<string, unknown> = {}) =>
  routes[0]!.handle({ session, input: { slug: 'club-a', ...input } }, deps) as Promise<{ ok: boolean; status: number; code?: string; body?: Record<string, unknown> }>;

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
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  for (const [id, roles] of [[OWNER, ['owner', 'player']], [DESK, ['front_desk', 'player']], [ACC, ['accountant', 'player']], [BOTH, ['front_desk', 'accountant', 'player']], [COACH, ['coach', 'player']], [PLAYER, ['player']]] as const) await person(id, [...roles]);
  db = createDb({ connectionString: tdb.url, max: 4 });
  routes = shellRoutes({ db, clubBySlug: async (slug) => (slug === 'club-a' ? { clubId: A } : slug === 'club-b' ? { clubId: B } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('GET /staff/shell', () => {
  it('front desk gets no Reports, Pricing edit, Settings or Staff page (ADMIN-01-AC)', async () => {
    const r = await shell(as(DESK, ['front_desk', 'player']));
    expect(r.ok).toBe(true);
    const pages = r.body!['pages'] as string[];
    for (const hidden of ['A10', 'A13', 'A14', 'A16', 'A17']) expect(pages).not.toContain(hidden);
    expect(pages).toContain('A1');
  });
  it('a person who is front desk and accountant sees the pages of both', async () => {
    const pages = (await shell(as(BOTH, ['front_desk', 'accountant', 'player']))).body!['pages'] as string[];
    expect(pages).toEqual(expect.arrayContaining(['A1', 'A2', 'A13', 'A14', 'A16']));
  });
  it('a coach, a player and a guest have no console', async () => {
    expect(await shell(as(COACH, ['coach', 'player']))).toMatchObject({ ok: false, status: 403 });
    expect(await shell(as(PLAYER, ['player']))).toMatchObject({ ok: false, status: 403 });
    expect(await shell(null)).toMatchObject({ ok: false, status: 401 });
  });
  it('another club slug is not found', async () => {
    expect(await shell(as(OWNER, ['owner', 'player']), { slug: 'club-b' })).toMatchObject({ ok: false, status: 404 });
  });
  it('returns the club and no banner while live', async () => {
    const b = (await shell(as(OWNER, ['owner', 'player']))).body!;
    expect(b).toMatchObject({ club: { nameEn: 'A', status: 'live' }, paused: null, lineCap: null, lineTokenReason: null });
  });
  it('a Paused club shows the pause reason to every staff role', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    await tdb.query(`insert into public.club_pause (club_id, paused_at, pause_reason, paused_by) values ($1, app.now(), 'maintenance', $2)`, [A, PSTAFF]);
    for (const s of [as(OWNER, ['owner', 'player']), as(DESK, ['front_desk', 'player']), as(ACC, ['accountant', 'player'])]) {
      expect((await shell(s)).body!['paused']).toMatchObject({ reason: 'maintenance' });
    }
  });
  it('the LINE cap and token banners show to the owner only', async () => {
    await tdb.query(`insert into platform.club_line_usage (club_id, month, used, message_limit, source) values ($1,'2026-12-01',75,100,'own_count')`, [A]);
    await tdb.query(`insert into platform.club_health (club_id, check_key, status, reason) values ($1,'line_token','failed','http_401')`, [A]);
    expect((await shell(as(OWNER, ['owner', 'player']))).body).toMatchObject({ lineCap: 'alert', lineTokenReason: 'http_401' });
    expect((await shell(as(DESK, ['front_desk', 'player']))).body).toMatchObject({ lineCap: null, lineTokenReason: null });
  });
  it('the Message BOOQ address shows to the owner only, only while Paused, and only when the platform set one (D178)', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    await tdb.query(`insert into public.club_pause (club_id, paused_at, pause_reason, paused_by) values ($1, app.now(), 'maintenance', $2)`, [A, PSTAFF]);
    expect((await shell(as(OWNER, ['owner', 'player']))).body!['booqSupportLineUrl']).toBeNull();
    await tdb.query(`insert into platform.config (key, value) values ('booq_support_line_url', '"https://line.me/R/ti/p/@booq"'::jsonb)`);
    expect((await shell(as(OWNER, ['owner', 'player']))).body!['booqSupportLineUrl']).toBe('https://line.me/R/ti/p/@booq');
    expect((await shell(as(DESK, ['front_desk', 'player']))).body!['booqSupportLineUrl']).toBeNull();
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    await tdb.query(`update public.club_pause set resumed_at = app.now(), resume_reason = 'ok', resumed_by = $2 where club_id = $1`, [A, PSTAFF]);
    expect((await shell(as(OWNER, ['owner', 'player']))).body!['booqSupportLineUrl']).toBeNull();
  });
  it('A4 is never listed', async () => {
    expect((await shell(as(OWNER, ['owner', 'player']))).body!['pages']).not.toContain('A4');
  });
});
