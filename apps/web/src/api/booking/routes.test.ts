import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { publicScheduleRoutes } from './routes';

// F03-T20 public schedule routes (BOOK-01-AC6, AC14, BOOK-02-AC1, AC2, AC5; design 5.1): thin handlers
// over the schedule service. The service's states are tested in packages/domain/src/booking/schedule.test.ts.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const P1 = '00000000-0000-4000-8000-000000000001';
const deps = { hasFeature: async () => true };
const SLUGS: Record<string, string> = { 'club-a': A, 'club-b': B };

let tdb: TestDatabase;
let db: Db;
let routes: ReturnType<typeof publicScheduleRoutes>;
const find = (path: string) => routes.find((r) => r.def.path === path)!;
const at = (date: string, h: number) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT1, LOC]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 2 });
  routes = publicScheduleRoutes({ db, clubBySlug: async (slug) => (SLUGS[slug] ? { clubId: SLUGS[slug]! } : null) });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('public schedule routes', () => {
  it('declares GET /courts, /schedule/days and /schedule as public, each answered with no-store', () => {
    expect(routes.map((r) => `${r.def.method} ${r.def.path}`)).toEqual(['GET /courts', 'GET /schedule/days', 'GET /schedule']);
    for (const r of routes) {
      expect(r.def.public).toBe(true);
      expect(r.def.permission).toBeUndefined();
      expect(r.headers).toEqual({ 'Cache-Control': 'no-store' });
    }
  });

  it('a guest with no session opens C4: courts, the date strip and a day (BOOK-02-AC1, AC2, AC5)', async () => {
    const courts = await find('/courts').handle({ session: null, input: { slug: 'club-a' } }, deps);
    expect(courts).toMatchObject({ ok: true, body: { bookingWindowDays: 30, courts: [{ id: COURT1, name: '1', sport: 'tennis' }] } });
    const days = await find('/schedule/days').handle({ session: null, input: { slug: 'club-a', from: '2026-12-01', to: '2026-12-02' } }, deps);
    expect(days).toMatchObject({ ok: true, body: { days: [{ date: '2026-12-01' }, { date: '2026-12-02', courts: [{ id: COURT1, openHours: 18 }], dayFull: false }] } });
    const day = await find('/schedule').handle({ session: null, input: { slug: 'club-a', date: '2026-12-02' } }, deps);
    expect(day.ok).toBe(true);
  });

  it('a signed in player gets My booking; the same slot is Taken for a guest', async () => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    await db.withClubTx({ clubId: A, userId: P1, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
      tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order, COURT1, [at('2026-12-02', 18)]]));
    const state = async (session: { clubId: string; userId: string; roles: ['player'] } | null) => {
      const r = await find('/schedule').handle({ session, input: { slug: 'club-a', date: '2026-12-02' } }, deps);
      if (!r.ok) throw new Error(r.code);
      return (r.body as { courts: Array<{ hours: Array<{ start: string; state: string }> }> }).courts[0]!.hours.find((h) => h.start === '2026-12-02T18:00:00+07:00')!.state;
    };
    expect(await state({ clubId: A, userId: P1, roles: ['player'] })).toBe('mine');
    expect(await state(null)).toBe('held');
  });

  it('an unknown slug, a malformed slug and a session of another club are not found', async () => {
    expect(await find('/courts').handle({ session: null, input: { slug: 'nope' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await find('/courts').handle({ session: null, input: { slug: 'Club A!' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await find('/courts').handle({ session: null, input: {} }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
    const other = { clubId: B, userId: P1, roles: ['player' as const] };
    expect(await find('/schedule').handle({ session: other, input: { slug: 'club-a', date: '2026-12-02' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
  });

  it('a Draft club is not found; a date out of range or malformed is a typed code', async () => {
    expect(await find('/schedule').handle({ session: null, input: { slug: 'club-a', date: '2027-01-01' } }, deps)).toEqual({ ok: false, status: 400, code: 'outside_window' });
    expect(await find('/schedule').handle({ session: null, input: { slug: 'club-a', date: '2026-11-30' } }, deps)).toEqual({ ok: false, status: 400, code: 'in_the_past' });
    expect(await find('/schedule').handle({ session: null, input: { slug: 'club-a' } }, deps)).toEqual({ ok: false, status: 400, code: 'bad_input' });
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    expect(await find('/schedule').handle({ session: null, input: { slug: 'club-a', date: '2026-12-02' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });
  });
});
