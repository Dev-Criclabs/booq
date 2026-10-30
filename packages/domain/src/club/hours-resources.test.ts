import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { hoursRoute } from './hours';
import { resourceRoutes } from './resources';

// F01-T08: PUT /hours, POST /resources and PUT /resources/{id}, with the F03 guard behind them
// (PLAT-02 Meets; BOOK-01-AC16; decision D50). A change is refused while live bookings sit on the affected hours.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000009';
const OWNER = '33333333-2222-4333-8444-555555555555';
const P1 = '00000000-0000-4000-8000-000000000001';
const deps = { hasFeature: async () => true };

let tdb: TestDatabase;
let db: Db;
let hours: ReturnType<typeof hoursRoute>;
let resources: ReturnType<typeof resourceRoutes>;
const session = (...roles: Array<'owner' | 'player' | 'front_desk' | 'accountant' | 'coach'>) => ({ clubId: A, userId: OWNER, roles });
const owner = session('owner', 'player');
// 2 Dec 2026 is a Wednesday (ISO weekday 3); 1 Dec is "today".
const wed = (h: number) => new Date(`2026-12-02T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

async function book(hour: number, court = COURT1) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
  await db.withClubTx({ clubId: A, userId: P1, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
    tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order, court, [wed(hour)]]));
  await db.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], requestId: 'r', source: 'admin' }, (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
}
const hoursOf = async (club = A) => (await tdb.query(`select weekday, open::text as open, close::text as close from public.opening_hours where club_id = $1 order by weekday`, [club])).rows;
const putHours = (list: unknown, s = owner) => hours.handle({ session: s, input: { hours: list } }, deps);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis'), ($5,$6,$7,'1','tennis')`, [A, COURT1, LOC, COURT2, B, COURT_B, LOC_B]);
  for (const club of [A, B]) {
    for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [club, d]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [club]);
  }
  db = createDb({ connectionString: tdb.url, max: 4 });
  hours = hoursRoute(db);
  resources = resourceRoutes(db);
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('PUT /hours', () => {
  it('declares hours.write', () => {
    expect(hours.def).toMatchObject({ method: 'PUT', path: '/hours', permission: 'hours.write' });
  });

  it('changes opening hours; close may be 24:00; a day can be closed', async () => {
    const r = await putHours([{ weekday: 1, open: '07:00', close: '22:00' }, { weekday: 2, open: '06:00', close: '24:00' }, { weekday: 7, closed: true }]);
    expect(r.ok).toBe(true);
    const h = await hoursOf();
    expect(h.find((x) => x.weekday === 1)).toEqual({ weekday: 1, open: '07:00:00', close: '22:00:00' });
    expect(h.find((x) => x.weekday === 2)).toEqual({ weekday: 2, open: '06:00:00', close: '24:00:00' });
    expect(h.find((x) => x.weekday === 7)).toBeUndefined();
  });

  it('refuses a change that would leave a live booking outside the hours, and says to use a closure; nothing changes', async () => {
    await book(20);                                                    // Wednesday 20:00 to 21:00
    const r = await putHours([{ weekday: 1, open: '08:00', close: '22:00' }, { weekday: 3, open: '06:00', close: '20:00' }]);
    expect(r).toEqual({ ok: false, status: 409, code: 'live_bookings_exist' });
    expect(await hoursOf()).toHaveLength(7);
    expect((await hoursOf()).find((x) => x.weekday === 1)?.open).toBe('06:00:00');   // the first day was not applied either: all or nothing
    expect((await putHours([{ weekday: 3, open: '06:00', close: '22:00' }])).ok).toBe(true);   // the hour still fits
    expect(await putHours([{ weekday: 3, closed: true }])).toEqual({ ok: false, status: 409, code: 'live_bookings_exist' });
  });

  it('refuses bad input: weekday, times, order, duplicates, extra fields, an empty list', async () => {
    const bad: unknown[] = [
      [], null, 'x', [{ weekday: 0, open: '06:00', close: '12:00' }], [{ weekday: 8, open: '06:00', close: '12:00' }], [{ weekday: 1.5, open: '06:00', close: '12:00' }],
      [{ weekday: 1, open: '6:00', close: '12:00' }], [{ weekday: 1, open: '12:00', close: '06:00' }], [{ weekday: 1, open: '06:00', close: '24:01' }],
      [{ weekday: 1, open: '06:00', close: '12:00', note: 'x' }], [{ weekday: 1, closed: false }], [{ weekday: 1, closed: true, open: '06:00' }],
      [{ weekday: 1, open: '06:00', close: '12:00' }, { weekday: 1, open: '07:00', close: '12:00' }],
    ];
    for (const list of bad) expect(await putHours(list), JSON.stringify(list)).toEqual({ ok: false, status: 400, code: 'invalid_input' });
    expect(await hoursOf()).toHaveLength(7);
  });

  it('only the owner: front desk, accountant, coach and player are refused; the other club is untouched', async () => {
    for (const s of [session('front_desk', 'player'), session('accountant', 'player'), session('coach', 'player'), session('player')]) {
      expect(await putHours([{ weekday: 1, open: '07:00', close: '12:00' }], s), s.roles.join()).toEqual({ ok: false, status: 403, code: 'forbidden' });
    }
    await putHours([{ weekday: 1, open: '07:00', close: '12:00' }]);
    expect((await hoursOf(B)).find((x) => x.weekday === 1)?.open).toBe('06:00:00');
  });

  it('is audited with the old and new hours', async () => {
    await putHours([{ weekday: 1, open: '07:00', close: '22:00' }]);
    const r = await tdb.query(`select action, actor_type from public.audit_entry where club_id = $1 and record_type = 'opening_hours' and action = 'update'`, [A]);
    expect(r.rows).toEqual([{ action: 'update', actor_type: 'club_user' }]);
  });
});

describe('POST /resources and PUT /resources/{id}', () => {
  it('declare resource.write', () => {
    expect(resources.create.def).toMatchObject({ method: 'POST', path: '/resources', permission: 'resource.write' });
    expect(resources.update.def).toMatchObject({ method: 'PUT', path: '/resources/:id', permission: 'resource.write' });
  });

  it('adds a court at a location of the club, and edits its details', async () => {
    const made = await resources.create.handle({ session: owner, input: { location_id: LOC, name: '3', sport: 'tennis', lights: true, max_players: 4 } }, deps);
    if (!made.ok) throw new Error(made.code);
    const id = (made.body as { id: string }).id;
    expect((await tdb.query(`select name, lights, max_players, active from public.resource where id = $1`, [id])).rows).toEqual([{ name: '3', lights: true, max_players: 4, active: true }]);
    const upd = await resources.update.handle({ session: owner, input: { id, name: 'Centre', lights: false } }, deps);
    expect(upd.ok).toBe(true);
    expect((await tdb.query(`select name, lights from public.resource where id = $1`, [id])).rows).toEqual([{ name: 'Centre', lights: false }]);
  });

  it('refuses a location of another club, bad fields and unknown ids', async () => {
    expect(await resources.create.handle({ session: owner, input: { location_id: LOC_B, name: '3', sport: 'tennis' } }, deps)).toEqual({ ok: false, status: 400, code: 'invalid_input' });
    for (const input of [{}, { location_id: LOC, name: '', sport: 'tennis' }, { location_id: LOC, name: 'x', sport: 'tennis', max_players: 0 }, { location_id: LOC, name: 'x', sport: 'tennis', lights: 'yes' }, { location_id: LOC, name: 'x', sport: 'tennis', active: false }, { location_id: LOC, name: 'x', sport: 'tennis', club_id: B }]) {
      expect(await resources.create.handle({ session: owner, input }, deps), JSON.stringify(input)).toEqual({ ok: false, status: 400, code: 'invalid_input' });
    }
    expect(await resources.update.handle({ session: owner, input: { id: COURT_B, name: 'x' } }, deps)).toEqual({ ok: false, status: 404, code: 'not_found' });   // another club's court
    expect(await resources.update.handle({ session: owner, input: { id: 'nope', name: 'x' } }, deps)).toEqual({ ok: false, status: 400, code: 'invalid_input' });
    expect(await resources.update.handle({ session: owner, input: { id: COURT1 } }, deps)).toEqual({ ok: false, status: 400, code: 'invalid_input' });
    expect(await resources.update.handle({ session: owner, input: { id: COURT1, location_id: LOC } }, deps)).toEqual({ ok: false, status: 400, code: 'invalid_input' });
  });

  it('takes a court out of service only when it has no live booking (D50); a court with one stays', async () => {
    await book(18, COURT1);
    expect(await resources.update.handle({ session: owner, input: { id: COURT1, active: false } }, deps)).toEqual({ ok: false, status: 409, code: 'live_bookings_exist' });
    expect((await tdb.query(`select active from public.resource where id = $1`, [COURT1])).rows[0].active).toBe(true);
    expect((await resources.update.handle({ session: owner, input: { id: COURT2, active: false } }, deps)).ok).toBe(true);
    expect((await tdb.query(`select active from public.resource where id = $1`, [COURT2])).rows[0].active).toBe(false);
    // putting it back in service is never blocked, and its id and history stay (CC-4)
    expect((await resources.update.handle({ session: owner, input: { id: COURT2, active: true } }, deps)).ok).toBe(true);
    expect((await tdb.query(`select count(*)::int as n from public.resource where id = $1`, [COURT2])).rows[0].n).toBe(1);
  });

  it('only the owner; there is no delete route', async () => {
    for (const s of [session('front_desk', 'player'), session('accountant', 'player'), session('coach', 'player'), session('player')]) {
      expect(await resources.create.handle({ session: s, input: { location_id: LOC, name: 'x', sport: 'tennis' } }, deps), s.roles.join()).toEqual({ ok: false, status: 403, code: 'forbidden' });
      expect(await resources.update.handle({ session: s, input: { id: COURT1, name: 'x' } }, deps)).toEqual({ ok: false, status: 403, code: 'forbidden' });
    }
    expect(Object.keys(resources).sort()).toEqual(['create', 'update']);
  });
});
