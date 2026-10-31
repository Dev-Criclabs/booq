import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, type ClubContext } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T07 / migration 1008: app.mark_no_show, app.mark_late_cancel, app.reverse_mark (F09 design 4.5; CANCEL-04-AC3
// to AC12; D118, D158, A-5, A-6). Front desk and owner only, a written reason always, audited. A no show is marked only
// after the slot ends; a late cancel only before it ends. A reversal gives the credit back by a new ledger row, never
// an edit, and is refused when a late cancelled slot has ended or been taken meanwhile.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-12-01T03:00:00Z';
const H = (h: number) => new Date(Date.parse('2026-12-03T00:00:00+07:00') + h * 3_600_000).toISOString();

let tdb: TestDatabase;
let db: Db;
const desk = (reason?: string): ClubContext => ({ clubId: A, userId: DESK, roles: ['front_desk', 'player'], requestId: 'r', source: 'admin', ...(reason ? { reason } : {}) });
const player = (u = P1): ClubContext => ({ clubId: A, userId: u, roles: ['player'], requestId: 'r', source: 'player_app' });

/** A confirmed hour paid by one credit of a package, through the real claim, confirm and reserve. */
async function book(hour: number, customer = P1) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
  const r = await db.withClubTx(player(customer), async (tx) => (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[]) as r`, [order, COURT, [H(hour)]])).rows[0]!.r);
  const booking = r.booking_ids[0] as string;
  await db.withClubTx(desk(), (tx) => tx.query(`select app.confirm_booking($1)`, [order]));
  const product = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang) values ($1,'แพ็ก','Pack','court_hour',10,3,100000) returning id`, [A])).rows[0].id;
  const pkg = (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                               values ($1,$2,$3,'{"credit_type":"court_hour"}',10,'2026-11-01T00:00:00Z','2027-06-01T00:00:00Z') returning id`, [A, customer, product])).rows[0].id;
  const c = await tdb.pool.connect();
  let line: string;
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    line = (await c.query(
      `insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_package_id, credit_units, credit_value_satang)
       values ($1,$2,1,'court_hour',$3,'k','ก','x',30000,30000,$4,1,30000) returning id`, [A, order, booking, pkg])).rows[0].id;
    await c.query(`update public.orders set status = 'paid' where id = $1`, [order]);
    await c.query('commit');
  } finally {
    c.release();
  }
  const o = await tdb.pool.connect();
  try {
    await o.query('begin');
    await o.query('set local role booq_owner');
    await o.query(`select set_config('app.club_id', $1, true)`, [A]);
    await o.query('select app.credit_reserve($1, $2, $3)', [pkg, booking, line!]);
    await o.query('commit');
  } finally {
    o.release();
  }
  return { order, booking, pkg };
}
const call = (c: ClubContext, fn: string, booking: string, reason: string | null) =>
  db.withClubTx(c, async (tx) => (await tx.query(`select app.${fn}($1, $2) as r`, [booking, reason])).rows[0]!.r as Record<string, any>);
const status = async (id: string) => (await tdb.query(`select status from public.booking where id = $1`, [id])).rows[0].status as string;
const occupancy = async (id: string) => (await tdb.query(`select count(*)::int n from public.occupancy where booking_id = $1`, [id])).rows[0].n as number;
const ledger = async (pkg: string) => (await tdb.query(`select reason, change, staff_id, note from public.credit_ledger where package_id = $1 order by created_at, reason`, [pkg])).rows;
const cancels = async (id: string) => (await tdb.query(`select kind, outcome, version, reason, by_user from public.booking_cancel where booking_id = $1 order by version`, [id])).rows;
const at = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  for (const [u, roles] of [[P1, ['player']], [P2, ['player']], [DESK, ['front_desk', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT, LOC]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15'), ($1,'cancel_window_hours','12')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('mark_no_show (CANCEL-04-AC3, AC6, D118)', () => {
  it('before the slot ends it is refused; after, the booking is No show, the credit forfeited with the staff and reason', async () => {
    const b = await book(18);
    await tdb.setNow(at(H(18), 0.5));
    await expect(call(desk('did not come'), 'mark_no_show', b.booking, 'did not come')).rejects.toThrow(/mark:not_ended/);
    await tdb.setNow(at(H(18), 1));
    expect(await call(desk('did not come'), 'mark_no_show', b.booking, 'did not come')).toMatchObject({ kind: 'no_show_mark', version: 1 });
    expect(await status(b.booking)).toBe('no_show');
    expect((await ledger(b.pkg)).map((x) => [x.reason, x.change, x.staff_id, x.note])).toEqual([['reserve', -1, null, null], ['forfeit', 0, DESK, 'did not come']]);
    expect(await cancels(b.booking)).toEqual([{ kind: 'no_show_mark', outcome: 'forfeited', version: 1, reason: 'did not come', by_user: DESK }]);
  });

  it('a reason is required, front desk or owner only, and only a confirmed booking (AC3, AC10)', async () => {
    const b = await book(18);
    await tdb.setNow(at(H(18), 2));
    await expect(call(desk(), 'mark_no_show', b.booking, '  ')).rejects.toThrow(/mark:reason_required/);
    await expect(call(player(), 'mark_no_show', b.booking, 'x')).rejects.toThrow(/mark:forbidden/);
    await call(desk('x'), 'mark_no_show', b.booking, 'x');
    await expect(call(desk('x'), 'mark_no_show', b.booking, 'x')).rejects.toThrow(/mark:not_confirmed/);
  });

  it('no setting is read for the no show timing (D118: after the slot ends, nothing else)', async () => {
    const b = await book(18);
    await tdb.setNow(at(H(18), 1));
    await tdb.query(`delete from public.club_setting where club_id = $1 and key = 'cancel_window_hours'`, [A]);
    expect((await call(desk('x'), 'mark_no_show', b.booking, 'x')).kind).toBe('no_show_mark');
  });
});

describe('mark_late_cancel (CANCEL-04-AC4, A-5)', () => {
  it('a cancel phoned in late: forfeited, and a future slot is freed', async () => {
    const b = await book(18);
    await tdb.setNow(at(H(18), -2));
    expect(await call(desk('phoned in'), 'mark_late_cancel', b.booking, 'phoned in')).toMatchObject({ kind: 'late_cancel_mark' });
    expect(await status(b.booking)).toBe('late_cancelled');
    expect(await occupancy(b.booking)).toBe(0);
    expect((await ledger(b.pkg)).map((x) => x.reason)).toEqual(['reserve', 'forfeit']);
  });

  it('a slot that has started keeps its row; a slot that has ended is refused (staff use No show)', async () => {
    const b = await book(18);
    await tdb.setNow(at(H(18), 0.5));
    await call(desk('left early'), 'mark_late_cancel', b.booking, 'left early');
    expect(await occupancy(b.booking)).toBe(1);
    const c = await book(20);
    await tdb.setNow(at(H(20), 1));
    await expect(call(desk('x'), 'mark_late_cancel', c.booking, 'x')).rejects.toThrow(/mark:ended/);
  });
});

describe('reverse_mark (CANCEL-04-AC5, A-6)', () => {
  it('a reversed no show is confirmed again (reads Played) and the credit comes back by a new return row', async () => {
    const b = await book(18);
    await tdb.setNow(at(H(18), 1));
    await call(desk('x'), 'mark_no_show', b.booking, 'x');
    expect(await call(desk('desk error'), 'reverse_mark', b.booking, 'desk error')).toMatchObject({ kind: 'reversal', version: 2 });
    expect(await status(b.booking)).toBe('confirmed');
    const state = await db.withClubTx(desk(), async (tx) => (await tx.query(`select state from public.booking_state where booking_id = $1`, [b.booking])).rows);
    expect(state).toEqual([{ state: 'played' }]);   // confirmed and the slot has ended (D158)
    expect((await ledger(b.pkg)).map((x) => x.reason)).toEqual(['reserve', 'forfeit', 'return']);
    expect((await cancels(b.booking)).map((x) => x.kind)).toEqual(['no_show_mark', 'reversal']);
  });

  it('a reversed late cancel claims its hour again while the slot is still free', async () => {
    const b = await book(18);
    await tdb.setNow(at(H(18), -3));
    await call(desk('x'), 'mark_late_cancel', b.booking, 'x');
    await call(desk('mistake'), 'reverse_mark', b.booking, 'mistake');
    expect(await status(b.booking)).toBe('confirmed');
    expect(await occupancy(b.booking)).toBe(1);
    expect((await tdb.query(`select status from public.orders where id = $1`, [b.order])).rows[0].status).toBe('paid');
  });

  it('refused when the late cancelled hour was taken meanwhile, or has ended: staff adjust instead', async () => {
    const b = await book(18);
    await tdb.setNow(at(H(18), -3));
    await call(desk('x'), 'mark_late_cancel', b.booking, 'x');
    await book(18, P2);   // someone took the freed hour
    await expect(call(desk('mistake'), 'reverse_mark', b.booking, 'mistake')).rejects.toThrow(/reverse:slot_unavailable/);
    expect(await status(b.booking)).toBe('late_cancelled');
    const c = await book(20);
    await call(desk('x'), 'mark_late_cancel', c.booking, 'x');
    await tdb.setNow(at(H(20), 2));
    await expect(call(desk('mistake'), 'reverse_mark', c.booking, 'mistake')).rejects.toThrow(/reverse:slot_unavailable/);
  });

  it('only a marked booking can be reversed, with a reason, by staff', async () => {
    const b = await book(18);
    await expect(call(desk('x'), 'reverse_mark', b.booking, 'x')).rejects.toThrow(/reverse:not_marked/);
    await tdb.setNow(at(H(18), 1));
    await call(desk('x'), 'mark_no_show', b.booking, 'x');
    await expect(call(desk(), 'reverse_mark', b.booking, '')).rejects.toThrow(/mark:reason_required/);
    await expect(call(player(), 'reverse_mark', b.booking, 'x')).rejects.toThrow(/mark:forbidden/);
  });
});
