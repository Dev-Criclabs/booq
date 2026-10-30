import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { SETTINGS } from './settings-registry';
import { settingsRoutes } from './settings';

// F01-T08: GET /settings and PUT /settings/{key} (PLAT-05 settings, BOOK-03-AC3, PLAT-04-AC1; design 5.1, 6.2, 10).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';
const deps = { hasFeature: async () => true };

let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof settingsRoutes>;
const as = (...roles: Array<'owner' | 'player' | 'front_desk' | 'accountant' | 'coach'>) => ({ clubId: CLUB, userId: USER, roles });
const owner = as('owner', 'player');
const put = (key: unknown, value: unknown, session = owner) => routes.put.handle({ session, input: { key, value } }, deps);
const list = (session = owner) => routes.list.handle({ session, input: {} }, deps);
const rowOf = async (key: string, club = CLUB) => (await tdb.query(`select value from public.club_setting where club_id = $1 and key = $2`, [club, key])).rows[0]?.value;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, payment_option) values ($1, 'a', 'ก', 'A', 'beam'), ($2, 'b', 'ข', 'B', 'slip')`, [CLUB, OTHER]);
  db = createDb({ connectionString: tdb.url, max: 1 });
  routes = settingsRoutes(db);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('the registry and the database agree', () => {
  it('the keys the database allows are exactly the registry keys', async () => {
    const keys = (await tdb.query(`select setting_key from app.setting_keys order by setting_key`)).rows.map((r) => r.setting_key);
    expect(keys).toEqual(SETTINGS.map((s) => s.key).sort());
  });
});

describe('PUT /settings/{key}', () => {
  it('declares settings.write and the shape { key, value }', () => {
    expect(routes.put.def).toMatchObject({ method: 'PUT', path: '/settings/:key', permission: 'settings.write' });
  });

  it('writes a valid value and returns it; the same value again is fine', async () => {
    expect(await put('hold_minutes', 20)).toEqual({ ok: true, status: 200, body: { key: 'hold_minutes', value: 20 } });
    expect(await rowOf('hold_minutes')).toBe(20);
    expect((await put('hold_minutes', 20)).ok).toBe(true);
    expect((await put('package_expiry_reminder_days', [14, 3])).ok).toBe(true);
    expect(await rowOf('package_expiry_reminder_days')).toEqual([14, 3]);
  });

  it('refuses a hold time of 12 (BOOK-03-AC3) and every other bad value; nothing is written', async () => {
    expect(await put('hold_minutes', 12)).toEqual({ ok: false, status: 400, code: 'invalid_value' });
    expect(await put('booking_window_days', 0)).toEqual({ ok: false, status: 400, code: 'invalid_value' });
    expect(await put('vat_enabled', 'yes')).toEqual({ ok: false, status: 400, code: 'invalid_value' });
    expect(await tdb.query(`select count(*)::int as n from public.club_setting`).then((r) => r.rows[0].n)).toBe(0);
  });

  it('no booking length can be set: the key is unknown (BOOK-01, fixed 60 minutes)', async () => {
    for (const k of ['booking_minutes', 'booking_length', 'slot_minutes', 'duration']) expect(await put(k, 60), k).toEqual({ ok: false, status: 404, code: 'unknown_setting' });
    expect(await put(5, 1)).toEqual({ ok: false, status: 400, code: 'invalid_input' });
  });

  it('a body that is not { key, value } is invalid_input', async () => {
    for (const input of [null, {}, { key: 'hold_minutes' }, { value: 15 }, { key: 'hold_minutes', value: 15, club_id: OTHER }, 'x', []]) {
      expect(await routes.put.handle({ session: owner, input }, deps), JSON.stringify(input)).toEqual({ ok: false, status: 400, code: 'invalid_input' });
    }
  });

  it('only the three TBD settings can be unset: null removes the row; any other key refuses (an unset TBD reads as unset)', async () => {
    await put('max_future_court_hours', 4);
    expect(await put('max_future_court_hours', null)).toEqual({ ok: true, status: 200, body: { key: 'max_future_court_hours', value: null } });
    expect(await rowOf('max_future_court_hours')).toBeUndefined();
    await put('hold_minutes', 15);
    expect(await put('hold_minutes', null)).toEqual({ ok: false, status: 400, code: 'cannot_unset' });
    expect(await rowOf('hold_minutes')).toBe(15);
    expect((await put('wallet_expiry_months', null)).ok).toBe(true);   // already unset: fine
  });

  it('group size: the smallest may not exceed the largest, in either order of writing', async () => {
    await put('group_min_players', 4);
    await put('group_max_players', 6);
    expect(await put('group_min_players', 7)).toEqual({ ok: false, status: 400, code: 'invalid_value' });
    expect(await put('group_max_players', 3)).toEqual({ ok: false, status: 400, code: 'invalid_value' });
    expect((await put('group_min_players', 6)).ok).toBe(true);
    expect(await rowOf('group_min_players')).toBe(6);
  });

  it('auto slip check exists only for a club that chose slip checking', async () => {
    expect(await put('auto_slip_check', true)).toEqual({ ok: false, status: 409, code: 'not_available' });
    const slip = routes.put.handle({ session: { clubId: OTHER, userId: USER, roles: ['owner', 'player'] }, input: { key: 'auto_slip_check', value: true } }, deps);
    expect((await slip).ok).toBe(true);
  });

  it('only the owner writes: front desk, accountant, coach, player and a guest are refused on the server', async () => {
    for (const s of [as('front_desk', 'player'), as('accountant', 'player'), as('coach', 'player'), as('player')]) {
      expect(await put('hold_minutes', 20, s), s.roles.join()).toEqual({ ok: false, status: 403, code: 'forbidden' });
    }
    expect(await routes.put.handle({ session: null, input: { key: 'hold_minutes', value: 20 } }, deps)).toEqual({ ok: false, status: 401, code: 'unauthenticated' });
    expect(await rowOf('hold_minutes')).toBeUndefined();
  });

  it('writes only the session\'s own club', async () => {
    await put('hold_minutes', 20);
    expect(await rowOf('hold_minutes', OTHER)).toBeUndefined();
  });

  it('every write is in the audit log with the old and the new value and the owner as actor (PLAT-04-AC1)', async () => {
    await put('hold_minutes', 15);
    await put('hold_minutes', 20);
    await put('max_future_court_hours', 4);
    await put('max_future_court_hours', null);
    const r = await tdb.query(`select action, record_key, old_value, new_value, actor_type, source from public.audit_entry where club_id = $1 and record_type = 'club_setting' order by seq`, [CLUB]);
    expect(r.rows.map((x) => x.action)).toEqual(['insert', 'update', 'insert', 'delete']);
    expect(JSON.stringify(r.rows[1])).toContain('15');
    expect(JSON.stringify(r.rows[1])).toContain('20');
    expect(r.rows.every((x) => x.actor_type === 'club_user' && x.source === 'admin')).toBe(true);
  });
});

describe('GET /settings', () => {
  it('declares settings.business.read', () => {
    expect(routes.list.def).toMatchObject({ method: 'GET', path: '/settings', permission: 'settings.business.read' });
  });

  it('lists every setting with its value or unset; a Blank club has none set (PLAT-05-AC8) and an unset TBD reads as unset', async () => {
    const r = await list();
    if (!r.ok) throw new Error(r.code);
    const body = r.body as Array<{ key: string; value: unknown; unset: boolean; required: boolean; available: boolean }>;
    expect(body.map((s) => s.key)).toEqual(SETTINGS.map((s) => s.key));
    expect(body.every((s) => s.value === null && s.unset)).toBe(true);
    expect(body.find((s) => s.key === 'max_future_court_hours')).toMatchObject({ unset: true, required: false });
    expect(body.find((s) => s.key === 'hold_minutes')).toMatchObject({ unset: true, required: true });
    expect(body.find((s) => s.key === 'auto_slip_check')).toMatchObject({ available: false, required: false });
  });

  it('shows the values that are set', async () => {
    await put('hold_minutes', 15);
    await put('vat_enabled', false);
    const r = await list();
    const body = (r as { body: Array<{ key: string; value: unknown; unset: boolean }> }).body;
    expect(body.find((s) => s.key === 'hold_minutes')).toMatchObject({ value: 15, unset: false });
    expect(body.find((s) => s.key === 'vat_enabled')).toMatchObject({ value: false, unset: false });   // false is a value, not unset
  });

  it('the owner reads all; the accountant reads the business settings only; everyone else is refused', async () => {
    await put('hold_minutes', 15);
    await put('vat_enabled', true);
    const acct = await list(as('accountant', 'player'));
    expect((acct as { body: Array<{ key: string }> }).body.map((s) => s.key)).toEqual(['vat_enabled']);
    for (const s of [as('front_desk', 'player'), as('coach', 'player'), as('player')]) {
      expect(await list(s), s.roles.join()).toEqual({ ok: false, status: 403, code: 'forbidden' });
    }
  });

  it('reads the session\'s own club only', async () => {
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'hold_minutes', '10')`, [OTHER]);
    const body = ((await list()) as { body: Array<{ key: string; value: unknown }> }).body;
    expect(body.find((s) => s.key === 'hold_minutes')?.value).toBeNull();
  });
});
