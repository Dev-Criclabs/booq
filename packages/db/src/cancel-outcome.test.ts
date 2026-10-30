import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T04 / migration 1004: app.cancel_outcome(booking, by_staff, club_cancel), the one place the cancel rule lives
// (F09 design 4.1). CANCEL-01-AC1 to AC10, AC15, AC18, AC20, D111. Read only: the sheet and the cancel ask the same
// function, so they agree. The client sends no outcome.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT = 'c1c1c1c1-0000-4000-8000-000000000001';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e0e0e0e0-0000-4000-8000-00000000000a';
const NOW = '2026-12-01T03:00:00Z';   // 1 Dec 10:00 Bangkok

let tdb: TestDatabase;
let db: Db;

type Line = { kind?: string; credits?: number; packageId?: string; wallet?: number; money?: number };
/** A confirmed booking with its priced order lines, inserted directly (fixture: triggers off). */
async function confirmed(start: string, o: { lines?: Line[]; customer?: string; type?: 'court' | 'solo_class' | 'class_seat'; order?: string; promo?: boolean; session?: string } = {}) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const customer = o.customer ?? P1;
    const order = o.order ?? (await c.query(
      `insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, customer])).rows[0].id;
    // The outcome reads only whether the order used a code, not its prices (orders_priced_together: all or none).
    if (o.promo) await c.query(`update public.orders set promo_code_id = 'feedfeed-0000-4000-8000-000000000001' where id = $1`, [order]);
    const end = new Date(Date.parse(start) + 3_600_000).toISOString();
    const type = o.type ?? 'court';
    const booking = (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at, class_session_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed','online',$8, now(), $9) returning id`,
      [A, order, type, COURT, type === 'court' ? null : COACH, start, end, customer, o.session ?? null])).rows[0].id as string;
    let pos = (await c.query(`select coalesce(max(position), 0) as p from public.order_line where order_id = $1`, [order])).rows[0].p as number;
    for (const l of o.lines ?? [{ money: 50000 }]) {
      pos += 1;
      const creditValue = (l.credits ?? 0) * 10000;
      const net = creditValue + (l.wallet ?? 0) + (l.money ?? 0);
      await c.query(
        `insert into public.order_line (club_id, order_id, position, kind, booking_id, add_on_id, description_key, name_th, name_en, unit_price_satang, discount_satang, net_satang,
                                        credit_package_id, credit_units, credit_value_satang, wallet_satang, money_satang)
         values ($1,$2,$3,$4,$5, case when $4 = 'add_on' then gen_random_uuid() end, $4,'x','x',$6,0,$6,$7,$8,$9,$10,$11)`,
        [A, order, pos, l.kind ?? 'court_hour', booking, net, l.packageId ?? null, l.credits ?? 0, creditValue, l.wallet ?? 0, l.money ?? 0],
      );
    }
    await c.query('commit');
    return { order: order as string, booking };
  } finally {
    c.release();
  }
}
async function pkg(expires: string) {
  return (await tdb.query(
    `set session_replication_role = replica; insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, purchase_date, expires_at)
     values ('${A}', '${P1}', gen_random_uuid(), '{}', 10, '2026-01-01T00:00:00Z', '2026-01-01', '${expires}') returning id`,
  ) as unknown as Array<{ rows: Array<{ id: string }> }>)[1]!.rows[0]!.id;
}
const outcome = (booking: string, as: { user?: string; roles?: string[] } = {}, byStaff = false, clubCancel = false) =>
  db.withClubTx({ clubId: A, userId: as.user ?? P1, roles: as.roles ?? ['player'] }, async (tx) =>
    (await tx.query(`select app.cancel_outcome($1, $2, $3) as o`, [booking, byStaff, clubCancel])).rows[0]!.o as Record<string, any>);
// Hours from NOW in Bangkok; seconds allowed for the boundary.
const at = (hours: number, seconds = 0) => new Date(Date.parse(NOW) + hours * 3_600_000 + seconds * 1000).toISOString();

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow(NOW);
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, COURT, LOC]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'cancel_window_hours','12')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('in time or late, by the club window (CANCEL-01-AC2)', () => {
  it('exactly 12:00:00 before the start is in time; 11:59:59 is late', async () => {
    const onTime = await confirmed(at(12));
    expect(await outcome(onTime.booking)).toMatchObject({ outcome: 'in_time', windowHours: 12, returned: true, forfeited: false });
    await tdb.setNow(new Date(Date.parse(NOW) + 1000).toISOString());
    expect(await outcome(onTime.booking)).toMatchObject({ outcome: 'late', returned: false, forfeited: true });
  });

  it('a window of 0 hours is in time until the start', async () => {
    await tdb.query(`update public.club_setting set value = '0' where club_id = $1 and key = 'cancel_window_hours'`, [A]);
    const b = await confirmed(at(1));
    await tdb.setNow(at(1, -1));   // one second before the start
    expect((await outcome(b.booking)).outcome).toBe('in_time');
  });

  it('an unset window refuses: no default is invented', async () => {
    await tdb.query(`delete from public.club_setting where club_id = $1 and key = 'cancel_window_hours'`, [A]);
    const b = await confirmed(at(48));
    await expect(outcome(b.booking)).rejects.toThrow(/cancel:window_unset/);
  });
});

describe('what returns, from the stored allocation of each line (AC3 to AC7, D111)', () => {
  it('in time: each part of a mixed line returns to its source; money goes to the wallet', async () => {
    const p = await pkg('2027-06-01T00:00:00Z');
    const b = await confirmed(at(24), { lines: [{ credits: 1, packageId: p, wallet: 2000, money: 3000 }, { kind: 'add_on', money: 5000 }] });
    const o = await outcome(b.booking);
    expect(o.outcome).toBe('in_time');
    expect(o.lines.map((l: any) => ({ kind: l.kind, credits: l.credits, walletSatang: l.walletSatang, moneyToWalletSatang: l.moneyToWalletSatang }))).toEqual([
      { kind: 'court_hour', credits: 1, walletSatang: 2000, moneyToWalletSatang: 3000 },
      { kind: 'add_on', credits: 0, walletSatang: 0, moneyToWalletSatang: 5000 },
    ]);
    expect(o.forfeit).toEqual({ credits: 0, walletSatang: 0, moneySatang: 0 });
    expect(o.creditLost).toBe(0);
  });

  it('late: nothing returns and every part is forfeited, the wallet part too (D158)', async () => {
    const p = await pkg('2027-06-01T00:00:00Z');
    const b = await confirmed(at(2), { lines: [{ credits: 1, packageId: p, wallet: 2000, money: 3000 }] });
    const o = await outcome(b.booking);
    expect(o).toMatchObject({ outcome: 'late', returned: false, forfeited: true, forfeit: { credits: 1, walletSatang: 2000, moneySatang: 3000 } });
    expect(o.lines[0]).toMatchObject({ credits: 0, walletSatang: 0, moneyToWalletSatang: 0 });
  });

  it('one hour of a two hour order counts only its own lines (AC9, AC23)', async () => {
    const first = await confirmed(at(24), { lines: [{ money: 40000 }, { kind: 'add_on', money: 5000 }] });
    const second = await confirmed(at(25), { order: first.order, lines: [{ money: 40000 }] });
    expect((await outcome(second.booking)).lines.map((l: any) => l.moneyToWalletSatang)).toEqual([40000]);
    expect((await outcome(first.booking)).lines.map((l: any) => l.moneyToWalletSatang)).toEqual([40000, 5000]);
  });

  it('a credit whose package expired is lost on a player cancel in time (D85, AC11), not on a club cancel', async () => {
    const p = await pkg('2026-11-30T00:00:00Z');
    const b = await confirmed(at(24), { lines: [{ credits: 1, packageId: p, money: 1000 }] });
    expect(await outcome(b.booking)).toMatchObject({ outcome: 'in_time', creditLost: 1 });
    expect((await outcome(b.booking)).lines[0]).toMatchObject({ credits: 0, moneyToWalletSatang: 1000 });
    const club = await outcome(b.booking, { user: DESK, roles: ['front_desk', 'player'] }, true, true);
    expect(club).toMatchObject({ outcome: 'full', creditLost: 0 });
    expect(club.lines[0]).toMatchObject({ credits: 1 });
  });

  it('the promo code use is restored only when this is the last live hour of the order (D67, AC8)', async () => {
    const first = await confirmed(at(24), { promo: true });
    const second = await confirmed(at(25), { order: first.order });
    expect((await outcome(first.booking)).codeRestore).toBe(false);
    await tdb.query(`set session_replication_role = replica; update public.booking set status = 'cancelled' where id = '${second.booking}'`);
    expect((await outcome(first.booking)).codeRestore).toBe(true);
    const late = await confirmed(at(2), { promo: true });
    expect((await outcome(late.booking)).codeRestore).toBe(false);   // a late cancel forfeits; nothing is restored
  });
});

describe('always in full (AC18, AC20, CANCEL-03-AC2)', () => {
  it('a club cancel by staff is in full whatever the time', async () => {
    const b = await confirmed(at(1));
    expect(await outcome(b.booking, { user: DESK, roles: ['front_desk', 'player'] }, true, true)).toMatchObject({ outcome: 'full', returned: true });
    // A staff cancel that is not a club cancel follows the same window as the player (AC20).
    expect((await outcome(b.booking, { user: DESK, roles: ['front_desk', 'player'] }, true, false)).outcome).toBe('late');
  });

  it('a solo class whose coach the club changed is in full (F07 coach_was_changed)', async () => {
    await tdb.seedCoach(A, COACH);
    await tdb.seedCoach(A, COACH2);
    const b = await confirmed(at(1), { type: 'solo_class' });
    expect((await outcome(b.booking)).outcome).toBe('late');
    await tdb.query(`set session_replication_role = replica; insert into public.coach_substitution (club_id, booking_id, from_coach_id, to_coach_id, by_staff_id, reason)
                     values ('${A}', '${b.booking}', '${COACH}', '${COACH2}', '${DESK}', 'leave')`);
    expect((await outcome(b.booking)).outcome).toBe('full');
  });

  it('a seat in a group session the owner edited is in full (F08 class_session.edited)', async () => {
    await tdb.seedCoach(A, COACH);
    const session = (await tdb.query(
      `set session_replication_role = replica; insert into public.class_session (club_id, template_id, coach_id, resource_id, start_at, end_at, name_th, name_en, audience, min_players, max_players, edited)
       values ('${A}', gen_random_uuid(), '${COACH}', '${COURT}', '${at(1)}', '${at(2)}', 'x', 'x', 'adult', 1, 4, true) returning id`) as unknown as Array<{ rows: Array<{ id: string }> }>)[1]!.rows[0]!.id;
    const b = await confirmed(at(1), { type: 'class_seat', session });
    expect((await outcome(b.booking)).outcome).toBe('full');
  });
});

describe('who may ask, and what is refused (AC15, design 7)', () => {
  it('a booking that has started is refused for everyone', async () => {
    const b = await confirmed(at(0));
    await expect(outcome(b.booking)).rejects.toThrow(/cancel:started/);
    await expect(outcome(b.booking, { user: DESK, roles: ['owner', 'player'] }, true, true)).rejects.toThrow(/cancel:started/);
  });

  it("another player's booking is not found; a player may not ask for a staff or club cancel", async () => {
    const b = await confirmed(at(24));
    await expect(outcome(b.booking, { user: P2 })).rejects.toThrow(/cancel:not_found/);
    await expect(outcome(b.booking, {}, true, false)).rejects.toThrow(/cancel:forbidden/);
    await expect(outcome(b.booking, {}, false, true)).rejects.toThrow(/cancel:forbidden/);
  });

  it('a booking that is not confirmed has no cancel outcome (a hold is released, not cancelled, AC16)', async () => {
    const b = await confirmed(at(24));
    await tdb.query(`set session_replication_role = replica; update public.booking set status = 'cancelled' where id = '${b.booking}'`);
    await expect(outcome(b.booking)).rejects.toThrow(/cancel:not_confirmed/);
  });

  it('reads only: asking twice changes nothing', async () => {
    const b = await confirmed(at(24));
    await outcome(b.booking);
    await outcome(b.booking);
    expect((await tdb.query(`select status from public.booking where id = $1`, [b.booking])).rows[0].status).toBe('confirmed');
    expect((await tdb.query(`select count(*)::int n from public.booking_cancel`)).rows[0].n).toBe(0);
  });
});
