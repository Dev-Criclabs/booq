import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T02 / migration 1002: closure, closure_resource and the foreign key from occupancy.closure_id
// (CANCEL-03-AC1, AC9, AC13; F09 design 3.2; FA 3.1). A closed range is occupancy rows of kind closure, one per
// court per occurrence, so the exclusion constraint keeps it apart from every booking and hold.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000009';
const P1 = '00000000-0000-4000-8000-000000000001';
const DESK = '00000000-0000-4000-8000-0000000000d1';

let tdb: TestDatabase;
let db: Db;
const H = (h: number) => new Date(`2026-12-02T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

async function closure(o: { club?: string; reason?: string; start?: string; end?: string; repeat?: unknown; courts?: string[] } = {}) {
  const club = o.club ?? A;
  const id = (
    await tdb.query(
      `insert into public.closure (club_id, reason, range_start, range_end, repeat_rule, created_by) values ($1,$2,$3,$4,$5::jsonb,$6) returning id`,
      [club, o.reason ?? 'resurfacing', o.start ?? H(8), o.end ?? H(10), o.repeat === undefined ? null : JSON.stringify(o.repeat), DESK],
    )
  ).rows[0].id as string;
  for (const court of o.courts ?? [COURT1]) await tdb.query(`insert into public.closure_resource (club_id, closure_id, resource_id) values ($1,$2,$3)`, [club, id, court]);
  return id;
}
const closedSlot = (club: string, court: string, closureId: string, start: string, end: string) =>
  tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id) values ($1,'closure',$2,$3,$4,'confirmed',$5)`, [club, court, start, end, closureId]);
const as = <T>(clubId: string, userId: string, roles: string[], sql: string, params: unknown[] = []) =>
  db.withClubTx({ clubId, userId, roles }, async (tx) => (await tx.query(sql, params)).rows as T[]);

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
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('closure slots carry the exclusion constraint (CANCEL-03-AC1, FA 3.1)', () => {
  it('a closed range refuses a hold on it, and a closure cannot be laid over a live hold', async () => {
    const id = await closure();
    await closedSlot(A, COURT1, id, H(8), H(10));
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id;
    await expect(db.withClubTx({ clubId: A, userId: P1, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
      tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order, COURT1, [H(9)]]))).rejects.toMatchObject({ message: 'slot_unavailable' });
    const order2 = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id;
    await db.withClubTx({ clubId: A, userId: P1, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
      tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order2, COURT2, [H(18)]]));
    const over = await closure({ courts: [COURT2], start: H(17), end: H(20) });
    await expect(closedSlot(A, COURT2, over, H(17), H(20))).rejects.toThrow(/occupancy_no_overlap_resource/);
  });

  it('an occupancy closure row must name a closure of the same club', async () => {
    await expect(closedSlot(A, COURT1, 'ffffffff-0000-4000-8000-000000000000', H(8), H(10))).rejects.toThrow(/foreign key/);
    const other = await closure({ club: B, courts: [COURT_B] });
    await expect(closedSlot(A, COURT1, other, H(8), H(10))).rejects.toThrow(/foreign key/);
  });

  it('closure_resource names courts of the closure\'s own club only', async () => {
    const id = await closure();
    await expect(tdb.query(`insert into public.closure_resource (club_id, closure_id, resource_id) values ($1,$2,$3)`, [A, id, COURT_B])).rejects.toThrow(/foreign key/);
    await expect(tdb.query(`insert into public.closure_resource (club_id, closure_id, resource_id) values ($1,$2,$3)`, [A, id, COURT1])).rejects.toThrow(/duplicate key/);
  });

  it('a booking_cancel row may name its closure, and only a real one', async () => {
    const id = await closure();
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    const b = (await tdb.query(
      `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by) values ($1,$2,'court',$3,$4,$5,$6,'cancelled','online',$6) returning id`,
      [A, order, COURT1, H(8), H(9), P1])).rows[0].id as string;
    const row = (cid: string, v: number) => tdb.query(
      `insert into public.booking_cancel (club_id, booking_id, order_id, kind, outcome, version, reason, closure_id) values ($1,$2,$3,'closure','returned',$4,'resurfacing',$5)`, [A, b, order, v, cid]);
    await expect(row('ffffffff-0000-4000-8000-000000000000', 1)).rejects.toThrow(/foreign key/);
    await row(id, 1);
  });
});

describe('the closure definition (design 3.2, CANCEL-03-AC9, AC14)', () => {
  it('stores a repeat rule: weekly on named weekdays with an optional end, or daily', async () => {
    const weekly = await closure({ repeat: { kind: 'weekly', weekdays: [1, 3], until: '2027-03-31' } });
    const daily = await closure({ repeat: { kind: 'daily' }, start: H(6), end: H(7) });
    const rows = (await tdb.query(`select id, repeat_rule from public.closure where id = any($1)`, [[weekly, daily]])).rows;
    expect(rows.find((r) => r.id === weekly)?.repeat_rule).toEqual({ kind: 'weekly', weekdays: [1, 3], until: '2027-03-31' });
    expect(rows.find((r) => r.id === daily)?.repeat_rule).toEqual({ kind: 'daily' });
  });

  it('refuses a malformed repeat, an empty range, a blank reason and an inconsistent end', async () => {
    await expect(closure({ repeat: { kind: 'monthly' } })).rejects.toThrow(/closure_repeat_rule/);
    await expect(closure({ repeat: { kind: 'weekly' } })).rejects.toThrow(/closure_repeat_rule/);
    await expect(closure({ repeat: { kind: 'weekly', weekdays: [0, 8] } })).rejects.toThrow(/closure_repeat_rule/);
    await expect(closure({ repeat: { kind: 'weekly', weekdays: 'mon' } })).rejects.toThrow(/closure_repeat_rule/);
    await expect(closure({ repeat: { kind: 'weekly', weekdays: [] } })).rejects.toThrow(/closure_repeat_rule/);
    await expect(closure({ repeat: { kind: 'daily', until: 'soon' } })).rejects.toThrow(/closure_repeat_rule/);
    await expect(closure({ start: H(10), end: H(10) })).rejects.toThrow(/closure_range/);
    await expect(closure({ reason: '  ' })).rejects.toThrow(/closure_reason/);
    const id = await closure();
    await expect(tdb.query(`update public.closure set status = 'ended' where id = $1`, [id])).rejects.toThrow(/closure_ended_together/);
    await tdb.query(`update public.closure set status = 'ended', ended_at = now(), ended_by = $2 where id = $1`, [id, DESK]);
  });

  it("front desk and owner read their club's closures; a player reads none; another club's are never reachable", async () => {
    await closure();
    await closure({ club: B, courts: [COURT_B] });
    expect(await as(A, DESK, ['front_desk', 'player'], 'select club_id from public.closure')).toEqual([{ club_id: A }]);
    expect(await as(A, DESK, ['owner', 'player'], 'select club_id from public.closure_resource')).toEqual([{ club_id: A }]);
    expect(await as(A, P1, ['player'], 'select id from public.closure')).toEqual([]);
    expect(await as(A, P1, ['player'], 'select closure_id from public.closure_resource')).toEqual([]);
  });

  it('no app role writes closures directly: the F09 functions do', async () => {
    for (const t of ['closure', 'closure_resource']) {
      for (const priv of ['insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_app', `public.${t}`, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
  });
});
