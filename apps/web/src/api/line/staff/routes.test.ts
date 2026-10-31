import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { lineStaffRoutes } from './routes';

// F10-T15 owner routes (F10 design 5.5, 5.7 to 5.9, 6; LINE-02, LINE-06, D114, D176): GET /staff/line/status for the
// banners, GET /staff/rich-menu and PUT /staff/rich-menu/labels. A save writes the labels and one build request; the
// worker builds (it alone holds the token, D149) and A16 reads the result from GET /staff/rich-menu.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const deps = { hasFeature: async () => true };
let tdb: TestDatabase;
let db: Db;
const owner = { clubId: A, userId: OWNER, roles: ['player', 'owner'] as never };
const find = (method: string, path: string) => lineStaffRoutes({ db }).find((r) => r.def.method === method && r.def.path === path)!;
const call = (method: string, path: string, session: typeof owner | null, body?: unknown) => find(method, path).handle({ session, input: body, body }, deps);
const requests = async () => (await tdb.query(`select club_id, force from public.rich_menu_request`)).rows;
const labels = async () => (await tdb.query(`select tile, label_th, label_en from public.rich_menu_label where club_id = $1 order by tile`, [A])).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const [id, line, role] of [[OWNER, 'L1', 'owner'], [DESK, 'L2', 'front_desk']] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [A, id, line]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player'), ($1,$2,$3)`, [A, id, role]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.line_connection (club_id, line_plan_kind, plan_message_limit) values ($1,'paid',1000)
                   on conflict (club_id) do update set line_plan_kind = excluded.line_plan_kind, plan_message_limit = excluded.plan_message_limit`, [A]);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('who reaches them', () => {
  it('only the owner: front desk, a player and a guest are refused', async () => {
    const desk = { clubId: A, userId: DESK, roles: ['player', 'front_desk'] as never };
    const player = { clubId: A, userId: DESK, roles: ['player'] as never };
    for (const [m, p, body] of [['GET', '/staff/line/status'], ['GET', '/staff/rich-menu'], ['PUT', '/staff/rich-menu/labels', { labels: [{ tile: 1, th: 'จอง', en: 'Book' }] }]] as const) {
      expect(await call(m, p, desk, body)).toMatchObject({ ok: false, status: 403 });
      expect(await call(m, p, player, body)).toMatchObject({ ok: false, status: 403 });
      expect(await call(m, p, null, body)).toMatchObject({ ok: false, status: 401 });
    }
    expect(await requests()).toEqual([]);
  });
});

describe('GET /staff/line/status', () => {
  it('state, percent, plan and health, counts and codes only; never a token (D114)', async () => {
    await tdb.query(`insert into platform.club_line_usage (club_id, month, used, message_limit, plan_kind, source) values ($1, date_trunc('month', now() at time zone 'Asia/Bangkok')::date, 800, 1000, 'paid', 'line')`, [A]);
    await tdb.query(`insert into platform.club_health (club_id, check_key, status, reason) values ($1,'line_token','failed','token_rejected')`, [A]);
    const r = await call('GET', '/staff/line/status', owner);
    expect(r).toMatchObject({ ok: true, body: { state: 'reminders_stopped', used: 800, limit: 1000, percent: 80, plan: 'paid', token: { status: 'failed', reason: 'token_rejected' } } });
    expect(JSON.stringify(r)).not.toMatch(/token_last|ciphertext|secret/i);
  });
});

describe('GET /staff/rich-menu', () => {
  it('six tiles (an unset label is null: the default key, D54), no build yet', async () => {
    const r = await call('GET', '/staff/rich-menu', owner);
    expect(r).toMatchObject({ ok: true, body: { tiles: [1, 2, 3, 4, 5, 6].map((tile) => ({ tile, th: null, en: null })), build: null, requested: false } });
  });

  it('shows the latest build with its error code, and a waiting request', async () => {
    await tdb.query(`insert into public.rich_menu (club_id, image_sha256, labels_hash, status, error) values ($1, repeat('0',64), repeat('0',64), 'failed', 'http_413')`, [A]);
    await tdb.query(`insert into public.rich_menu_request (club_id) values ($1)`, [A]);
    const r = await call('GET', '/staff/rich-menu', owner);
    expect(r).toMatchObject({ ok: true, body: { build: { status: 'failed', error: 'http_413' }, requested: true } });
  });
});

describe('PUT /staff/rich-menu/labels (D114, D176)', () => {
  it('saves the labels and asks for one build; the answer is queued', async () => {
    const r = await call('PUT', '/staff/rich-menu/labels', owner, { labels: [{ tile: 4, th: 'แพ็กเกจของฉัน', en: 'My packages' }, { tile: 2, th: 'คลาสเดี่ยว', en: null }] });
    expect(r).toEqual({ ok: true, status: 200, body: { build: 'queued' } });
    expect(await labels()).toEqual([{ tile: 2, label_th: 'คลาสเดี่ยว', label_en: null }, { tile: 4, label_th: 'แพ็กเกจของฉัน', label_en: 'My packages' }]);
    expect(await requests()).toEqual([{ club_id: A, force: false }]);
    await call('PUT', '/staff/rich-menu/labels', owner, { labels: [{ tile: 4, th: null, en: null }] });
    expect(await labels()).toEqual([{ tile: 2, label_th: 'คลาสเดี่ยว', label_en: null }, { tile: 4, label_th: null, label_en: null }]);
    expect(await requests()).toHaveLength(1);
  });

  it('labels are trimmed; anything else is bad_input and nothing is saved or asked', async () => {
    await call('PUT', '/staff/rich-menu/labels', owner, { labels: [{ tile: 1, th: '  จองคอร์ต ', en: ' Book ' }] });
    expect(await labels()).toEqual([{ tile: 1, label_th: 'จองคอร์ต', label_en: 'Book' }]);
    await tdb.query(`delete from public.rich_menu_request`);
    for (const body of [
      {}, { labels: [] }, { labels: [{ tile: 7, th: 'x', en: 'x' }] }, { labels: [{ tile: 0, th: 'x', en: 'x' }] },
      { labels: [{ tile: 1, th: '   ', en: 'x' }] }, { labels: [{ tile: 1, th: 5, en: 'x' }] }, { labels: [{ tile: 1, th: 'x' }] },
      { labels: [{ tile: 1, th: 'x', en: 'x' }, { tile: 1, th: 'y', en: 'y' }] }, { labels: [{ tile: 1, th: 'x', en: 'x', link: 'https://e' }] },
      { labels: [{ tile: 1, th: 'x', en: 'x' }], force: true }, null, [],
    ]) {
      expect(await call('PUT', '/staff/rich-menu/labels', owner, body), JSON.stringify(body)).toMatchObject({ ok: false, status: 400, code: 'bad_input' });
    }
    expect(await requests()).toEqual([]);
  });

  it('a label change is audited', async () => {
    await call('PUT', '/staff/rich-menu/labels', owner, { labels: [{ tile: 3, th: 'คลาสกลุ่ม', en: 'Group classes' }] });
    const actions = (await tdb.query(`select action from public.audit_entry where record_type = 'rich_menu_label' or action like 'rich_menu.%' order by seq`)).rows.map((r) => r.action);
    expect(actions).toEqual(['insert', 'rich_menu.build_requested']);
  });
});
