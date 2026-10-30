import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T01 / migration 1001: booking_cancel (append only) and the view booking_state with Played derived
// from confirmed and end_at (D158). CANCEL-01-AC11, CANCEL-04-AC1 to AC3, AC12, F07 R5-AC5; F09 design 3.1, 3.3.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000009';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const DESK = '00000000-0000-4000-8000-0000000000d1';

let tdb: TestDatabase;
let db: Db;
const H = (day: string, h: number) => new Date(`2026-12-${day}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

/** A booking inserted as the admin, as the release_hold tests do: status and times are what is being read. */
async function booking(opts: { club?: string; court?: string; customer?: string; status: string; start: string }) {
  const club = opts.club ?? A;
  const customer = opts.customer ?? P1;
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
  const end = new Date(Date.parse(opts.start) + 3_600_000).toISOString();
  const id = (
    await tdb.query(
      `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
       values ($1,$2,'court',$3,$4,$5,$6,$7,'online',$6, case when $7 = 'confirmed' then now() end) returning id`,
      [club, order, opts.court ?? COURT, opts.start, end, customer, opts.status],
    )
  ).rows[0].id as string;
  return { order, id };
}
const cancelRow = (club: string, b: { order: string; id: string }, o: { kind?: string; version?: number; reason?: string | null; outcome?: string } = {}) =>
  tdb.query(
    `insert into public.booking_cancel (club_id, booking_id, order_id, kind, outcome, version, returned, reason, by_user)
     values ($1,$2,$3,$4,$5,$6,'{}'::jsonb,$7,$8)`,
    [club, b.id, b.order, o.kind ?? 'player_cancel', o.outcome ?? 'returned', o.version ?? 1, o.reason === undefined ? null : o.reason, P1],
  );
const as = <T>(clubId: string, userId: string, roles: string[], sql: string, params: unknown[] = []) =>
  db.withClubTx({ clubId, userId, roles }, async (tx) => (await tx.query(sql, params)).rows as T[]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-02T12:00:00Z');   // 19:00 in Bangkok on 2 Dec
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC, B, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($4,$5,$6,'1','tennis')`, [A, COURT, LOC, B, COURT_B, LOC_B]);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('booking_cancel is append only (F09 design 3.1)', () => {
  it('UPDATE, DELETE and TRUNCATE fail for every role, the superuser included', async () => {
    const b = await booking({ status: 'cancelled', start: H('03', 18) });
    await cancelRow(A, b);
    await expect(tdb.query(`update public.booking_cancel set reason = 'x'`)).rejects.toThrow(/append-only/);
    await expect(tdb.query(`delete from public.booking_cancel`)).rejects.toThrow(/append-only/);
    await expect(tdb.query(`truncate public.booking_cancel`)).rejects.toThrow(/append-only/);
    for (const role of ['booq_owner', 'booq_app', 'booq_worker', 'booq_platform']) {
      for (const stmt of [`update public.booking_cancel set reason = 'x'`, `delete from public.booking_cancel`]) {
        const c = await tdb.pool.connect();
        try {
          await c.query('begin');
          await c.query(`set local role ${role}`);
          await c.query(`select set_config('app.club_id', $1, true), set_config('app.roles', 'owner', true)`, [A]);
          await expect(c.query(stmt), `${role}: ${stmt}`).rejects.toThrow(/append-only|permission denied/);
        } finally {
          await c.query('rollback');
          c.release();
        }
      }
      for (const priv of ['insert', 'update', 'delete', 'truncate']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', [role, 'public.booking_cancel', priv])).rows[0].ok, `${role} ${priv}`).toBe(role === 'booq_owner');
      }
    }
    expect((await tdb.query('select count(*)::int n from public.booking_cancel')).rows[0].n).toBe(1);
  });

  it('one row per booking and version: a repeat of the same version is refused', async () => {
    const b = await booking({ status: 'cancelled', start: H('03', 18) });
    await cancelRow(A, b);
    await expect(cancelRow(A, b)).rejects.toThrow(/booking_cancel_one_per_version|duplicate key/);
    await cancelRow(A, b, { kind: 'reversal', version: 2, reason: 'desk error' });
  });

  it('a staff kind needs a written reason; a player cancel carries none', async () => {
    const b = await booking({ status: 'cancelled', start: H('03', 18) });
    await expect(cancelRow(A, b, { kind: 'staff_cancel', reason: null })).rejects.toThrow(/booking_cancel_reason/);
    await expect(cancelRow(A, b, { kind: 'no_show_mark', outcome: 'forfeited', reason: '  ' })).rejects.toThrow(/booking_cancel_reason/);
    await expect(cancelRow(A, b, { kind: 'player_cancel', reason: 'because' })).rejects.toThrow(/booking_cancel_reason/);
    await cancelRow(A, b, { kind: 'staff_cancel', reason: 'rain' });
  });

  it('kind and outcome are from the design lists only, and the version starts at one', async () => {
    const b = await booking({ status: 'cancelled', start: H('03', 18) });
    await expect(cancelRow(A, b, { kind: 'refund', reason: 'x' })).rejects.toThrow(/booking_cancel_kind/);
    await expect(cancelRow(A, b, { outcome: 'cash' })).rejects.toThrow(/booking_cancel_outcome/);
    await expect(cancelRow(A, b, { version: 0 })).rejects.toThrow(/booking_cancel_version/);
  });

  it("staff read their club's rows, a player only their own bookings' rows; another club's rows are never reachable", async () => {
    const mine = await booking({ status: 'cancelled', start: H('03', 18) });
    const theirs = await booking({ status: 'cancelled', start: H('03', 19), customer: P2 });
    const other = await booking({ club: B, court: COURT_B, status: 'cancelled', start: H('03', 18) });
    await cancelRow(A, mine);
    await cancelRow(A, theirs);
    await cancelRow(B, other);
    expect(await as(A, DESK, ['front_desk', 'player'], 'select booking_id from public.booking_cancel order by booking_id')).toHaveLength(2);
    expect(await as(A, P1, ['player'], 'select booking_id from public.booking_cancel')).toEqual([{ booking_id: mine.id }]);
    expect(await as(A, DESK, ['owner', 'player'], 'select booking_id from public.booking_cancel where booking_id = $1', [other.id])).toEqual([]);
    expect(await as(A, DESK, ['accountant', 'player'], 'select booking_id from public.booking_cancel')).toEqual([]);   // staff reasons are front desk and owner only (design 7)
  });
});

describe('booking_state: Played is derived (D158, CANCEL-04-AC1, AC2)', () => {
  it('a confirmed booking whose slot has ended reads Played with no job; before it ends it reads confirmed', async () => {
    const ended = await booking({ status: 'confirmed', start: H('02', 17) });     // 17:00 to 18:00, now is 19:00
    const running = await booking({ status: 'confirmed', start: H('02', 19) });   // started, not ended
    const later = await booking({ status: 'confirmed', start: H('03', 18) });
    const rows = await as<{ booking_id: string; state: string }>(A, DESK, ['front_desk', 'player'], 'select booking_id, state from public.booking_state');
    const state = (id: string) => rows.find((r) => r.booking_id === id)?.state;
    expect(state(ended.id)).toBe('played');
    expect(state(running.id)).toBe('confirmed');
    expect(state(later.id)).toBe('confirmed');
    await tdb.setNow('2026-12-02T13:00:00Z');   // the clock moves; nothing else runs
    const after = await as<{ booking_id: string; state: string }>(A, DESK, ['front_desk', 'player'], 'select booking_id, state from public.booking_state where booking_id = $1', [running.id]);
    expect(after).toEqual([{ booking_id: running.id, state: 'played' }]);
  });

  it('a cancelled, late cancelled, no show or released booking keeps its stored status after the slot ends', async () => {
    const ids: Record<string, string> = {};
    for (const [i, s] of (['cancelled', 'late_cancelled', 'no_show'] as const).entries()) ids[s] = (await booking({ status: s, start: H('02', 10 + i) })).id;
    const rows = await as<{ booking_id: string; state: string }>(A, DESK, ['front_desk', 'player'], 'select booking_id, state from public.booking_state');
    for (const [s, id] of Object.entries(ids)) expect(rows.find((r) => r.booking_id === id)?.state).toBe(s);
  });

  it("the view follows the booking's own row rules: a player sees only their own; another club's never", async () => {
    const mine = await booking({ status: 'confirmed', start: H('02', 10) });
    await booking({ status: 'confirmed', start: H('02', 11), customer: P2 });
    const other = await booking({ club: B, court: COURT_B, status: 'confirmed', start: H('02', 10) });
    expect(await as(A, P1, ['player'], 'select booking_id, state from public.booking_state')).toEqual([{ booking_id: mine.id, state: 'played' }]);
    expect(await as(A, DESK, ['owner', 'player'], 'select booking_id from public.booking_state where booking_id = $1', [other.id])).toEqual([]);
    expect(await as(B, DESK, ['owner', 'player'], 'select club_id from public.booking_state')).toEqual([{ club_id: B }]);
  });
});
