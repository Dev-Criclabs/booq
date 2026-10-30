import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T17 / migration 0220: public_slot_state and public_day_state (BOOK-01-AC6, AC7, AC14,
// BOOK-03-AC4, AC6, CC-3). Times are Bangkok: 10:00 on 2026-12-29 is 03:00 UTC.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC_A = '00000000-0000-4000-8000-0000000000a1';
const LOC_B = '00000000-0000-4000-8000-0000000000b1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const CB = '00000000-0000-4000-8000-0000000000cb';
const COACH = '00000000-0000-4000-8000-0000000000d1';
const OWNER = '11111111-1111-4111-8111-111111111111';
const TESTER = '22222222-2222-4222-8222-222222222222';
const PLAYER = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-12-29T02:00:00Z'; // 09:00 Bangkok

const at = (h: number, day = 29, m = 0) => new Date(Date.UTC(2026, 11, day, h - 7, m)).toISOString();

let tdb: TestDatabase;
let web: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.seedCoach(A, COACH);   // a solo class needs a coach row (F07, migration 0801)
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$3,'M'), ($2,$4,'M')`, [A, B, LOC_A, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$3,$5,'1','tennis'), ($1,$4,$5,'2','tennis'), ($2,$6,$7,'1','tennis')`, [A, B, C1, C2, LOC_A, CB, LOC_B]);
  // 2026-12-29 is a Tuesday: ISO weekday 2. Open 08:00 to 22:00 (14 hours); Wednesday open until 24:00.
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,2,'08:00','22:00'), ($1,3,'06:00','24:00'), ($2,2,'08:00','22:00')`, [A, B]);
  for (const [u, club, roles] of [[OWNER, A, ['owner', 'player']], [TESTER, A, ['player']], [PLAYER, A, ['player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.club_tester (club_id, user_id, kind) values ($1,$2,'boq_tester')`, [A, TESTER]);
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

async function claim(o: { club?: string; resource: string; from: string; to: string; kind?: string; state?: string; hold?: string | null; coach?: string | null; closure?: boolean }) {
  const club = o.club ?? A;
  const kind = o.kind ?? (o.closure ? 'closure' : 'court_booking');
  let booking: string | null = null;
  if (!o.closure) {
    const order = (await tdb.query(`insert into public.orders (club_id, source) values ($1,'staff') returning id`, [club])).rows[0].id as string;
    booking = (await tdb.query(
      `insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at, hold_expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'staff',$9,$10,$11) returning id`,
      [club, order, kind === 'solo_class' ? 'solo_class' : 'court', o.resource, o.coach ?? null, o.from, o.to, o.state === 'held' ? 'awaiting_payment' : 'confirmed', PLAYER, o.state === 'held' ? null : NOW, o.state === 'held' ? o.hold : null],
    )).rows[0].id as string;
  }
  await tdb.query(
    `insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, hold_expires_at, booking_id, closure_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [club, kind, o.resource, o.coach ?? null, o.from, o.to, o.state ?? 'confirmed', o.state === 'held' ? o.hold : null, booking, o.closure ? await tdb.seedClosure(club) : null],
  );
}
type Ctx = { clubId: string; userId: string | null; roles: string[]; source: 'player_app' | 'admin' };
const guest = (club = A): Ctx => ({ clubId: club, userId: null, roles: ['guest'], source: 'player_app' });
const slots = (c: Ctx = guest()) => web.withClubTx(c, (tx) => tx.query('select resource_id, start_at, state from public.public_slot_state order by resource_id, start_at'));

describe('public_slot_state', () => {
  it('shows confirmed as taken and a live hold as held; an expired hold is not shown, released or not (BOOK-03-AC6)', async () => {
    await claim({ resource: C1, from: at(10), to: at(11) });
    await claim({ resource: C1, from: at(11), to: at(12), state: 'held', hold: at(9, 29, 30) });  // runs out at 09:30, after now
    await claim({ resource: C1, from: at(12), to: at(13), state: 'held', hold: at(8, 29, 30) });  // ran out at 08:30: gone
    const r = await slots();
    expect(r.rows.map((x) => [new Date(x.start_at).toISOString(), x.state])).toEqual([[at(10), 'taken'], [at(11), 'held']]);
    await tdb.setNow(at(9, 29, 45));   // 09:45: the 09:30 hold has now run out too
    expect((await slots()).rows.map((x) => x.state)).toEqual(['taken']);
  });
  it('a solo class takes the court, and a coach-only row shows nothing', async () => {
    await claim({ resource: C1, from: at(14), to: at(15), kind: 'solo_class', coach: COACH });
    expect((await slots()).rows).toHaveLength(1);
  });
  it('a closure of any range closes every hour it touches', async () => {
    await claim({ resource: C2, from: at(9, 29, 30), to: at(12, 29, 15), closure: true });
    expect((await slots()).rows.map((x) => [new Date(x.start_at).toISOString(), x.state])).toEqual([[at(9), 'closed'], [at(10), 'closed'], [at(11), 'closed'], [at(12), 'closed']]);
  });
  it('exposes only club, court, start and state: no booking, customer, coach or order (snapshot)', async () => {
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_name = 'public_slot_state' order by ordinal_position`)).rows.map((x) => x.column_name);
    expect(cols).toEqual(['club_id', 'resource_id', 'start_at', 'state']);
    const day = (await tdb.query(`select column_name from information_schema.columns where table_name = 'public_day_state' order by ordinal_position`)).rows.map((x) => x.column_name);
    expect(day).toEqual(['club_id', 'resource_id', 'day', 'open_hours']);
  });
  it('is filtered by the club in the context; no context sees nothing', async () => {
    await claim({ resource: C1, from: at(10), to: at(11) });
    await claim({ club: B, resource: CB, from: at(10), to: at(11) });
    expect((await slots(guest(A))).rows.map((x) => x.resource_id)).toEqual([C1]);
    expect((await slots(guest(B))).rows.map((x) => x.resource_id)).toEqual([CB]);
    const c = await tdb.pool.connect();
    try {
      await c.query('set role booq_app');
      expect((await c.query('select 1 from public.public_slot_state')).rowCount).toBe(0);
    } finally {
      c.release();
    }
  });
});

describe('club visibility', () => {
  beforeEach(async () => {
    await claim({ resource: C1, from: at(10), to: at(11) });
  });
  it('a Paused club is visible to a guest', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    expect((await slots()).rows).toHaveLength(1);
  });
  it('a Draft club is invisible to everyone, testers and the owner included', async () => {
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    expect((await slots()).rows).toHaveLength(0);
    expect((await slots({ clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' })).rows).toHaveLength(0);
  });
  it('a club in Testing shows to its owner and named testers, not to guests or ordinary players', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    expect((await slots()).rows).toHaveLength(0);
    expect((await slots({ clubId: A, userId: PLAYER, roles: ['player'], source: 'player_app' })).rows).toHaveLength(0);
    expect((await slots({ clubId: A, userId: TESTER, roles: ['player'], source: 'player_app' })).rows).toHaveLength(1);
    expect((await slots({ clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' })).rows).toHaveLength(1);
  });
  it('a removed tester no longer sees it', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await tdb.query(`update public.club_tester set removed_at = app.now() where user_id = $1`, [TESTER]);
    expect((await slots({ clubId: A, userId: TESTER, roles: ['player'], source: 'player_app' })).rows).toHaveLength(0);
  });
});

describe('public_day_state (BOOK-01-AC14)', () => {
  const days = (club = A) => web.withClubTx(guest(club), (tx) => tx.query(`select resource_id, to_char(day, 'YYYY-MM-DD') as day, open_hours from public.public_day_state order by day, resource_id`));
  it('covers today and the next 30 days, per active court, from the opening hours of the weekday', async () => {
    const r = await days();
    const c1 = r.rows.filter((x) => x.resource_id === C1);
    expect(c1[0]).toMatchObject({ day: '2026-12-29', open_hours: 14 });          // Tuesday 08 to 22
    expect(c1[1]).toMatchObject({ day: '2026-12-30', open_hours: 18 });          // Wednesday 06 to 24
    expect(c1).toHaveLength(10);                                                   // only Tuesdays and Wednesdays have hours: 5 + 5 in the 31 days
    expect(c1[c1.length - 1]?.day).toBe('2027-01-27');                              // day 30 is included
  });
  it('subtracts taken, held and closed hours inside the opening hours, and counts a full day as 0', async () => {
    await claim({ resource: C1, from: at(10), to: at(11) });
    await claim({ resource: C1, from: at(11), to: at(12), state: 'held', hold: at(9, 29, 30) });
    await claim({ resource: C1, from: at(12, 29, 30), to: at(13, 29, 30), closure: true });  // touches 12 and 13
    expect((await days()).rows.find((x) => x.resource_id === C1 && x.day === '2026-12-29')?.open_hours).toBe(14 - 4);
    for (let h = 8; h < 22; h += 1) if (![10, 11, 12, 13].includes(h)) await claim({ resource: C1, from: at(h), to: at(h + 1) });
    expect((await days()).rows.find((x) => x.resource_id === C1 && x.day === '2026-12-29')?.open_hours).toBe(0);
  });
  it('an inactive court has no rows; another club never appears', async () => {
    await tdb.query(`update public.resource set active = false where id = $1`, [C2]);
    expect((await days()).rows.every((x) => x.resource_id === C1)).toBe(true);
    expect((await days(B)).rows.every((x) => x.resource_id === CB)).toBe(true);
  });
  it('follows the Bangkok date: just after midnight Bangkok it is already the next day', async () => {
    await tdb.setNow('2026-12-29T17:30:00Z'); // 00:30 on the 30th in Bangkok
    expect((await days()).rows[0]?.day).toBe('2026-12-30');
  });
  it('a Draft club has no days', async () => {
    await tdb.query(`update public.club set status = 'draft' where id = $1`, [A]);
    expect((await days()).rows).toEqual([]);
  });
});

describe('who can read the views', () => {
  it('the app and worker roles can; BOOQ staff cannot', async () => {
    for (const [role, ok] of [['booq_app', true], ['booq_worker', true], ['booq_platform', false]] as const) {
      expect((await tdb.query(`select has_table_privilege($1, 'public.public_slot_state', 'select') as ok`, [role])).rows[0].ok, role).toBe(ok);
    }
  });
});
