import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { HOLD_RELEASE, runHoldRelease } from './hold-release';

// F03-T19 hold_release (BOOK-03-AC5, AC6; design 6). Every tick finds the orders whose hold has
// ended, across clubs, and releases each in its own club-context transaction. Correctness never
// depends on it (a late tick blocks nobody), it only finishes the side effects.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const COURT_A = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT_B = 'cbcbcbcb-0000-4000-8000-000000000009';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';

let tdb: TestDatabase;
let worker: Db; // booq_worker: how the job connects
let app: Db; // booq_app: how players connect

const at = (time: string) => new Date(`2026-12-02T${time}+07:00`).toISOString();
const H = (h: number) => at(`${String(h).padStart(2, '0')}:00:00`);

async function hold(club: string, court: string, customer: string, hours: number[]) {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, customer])).rows[0].id as string;
  await app.withClubTx({ clubId: club, userId: customer, roles: ['player'], source: 'player_app' }, (tx) =>
    tx.query(`select app.reserve_court($1, $2, $3::timestamptz[])`, [order, court, hours.map(H)]));
  return order;
}
const statuses = async (order: string) => (await tdb.query(`select status, release_reason from public.booking where order_id = $1 order by start_at`, [order])).rows;
const handlerCalls = async () => (await tdb.query(`select order_id from public.t_release_calls order by order_id`)).rows.map((r) => r.order_id);
const heartbeat = async () => (await tdb.query(`select * from platform.worker_heartbeat where task_name = $1`, [HOLD_RELEASE])).rows[0];

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z'); // 1 Dec 10:00 Bangkok
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live'), ($2,'club-b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main'), ($3,$4,'Main')`, [A, LOC_A, B, LOC_B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($4,$5,$6,'1','tennis')`, [A, COURT_A, LOC_A, B, COURT_B, LOC_B]);
  for (const club of [A, B]) {
    for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [club, d]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [club]);
  }
  await tdb.query(`create table public.t_release_calls (order_id uuid, reason text)`);
  await tdb.query(`grant all on public.t_release_calls to booq_owner`);
  await tdb.query(`create function public.t_release(p_order uuid, p_reason text) returns void language sql as $$ insert into public.t_release_calls values (p_order, p_reason) $$`);
  await tdb.query(`select app.register_release_handler('test', 'public.t_release'::regproc, 100)`);
  worker = createDb({ connectionString: tdb.url, max: 4, role: 'booq_worker' });
  app = createDb({ connectionString: tdb.url, max: 4 });
});
afterEach(async () => {
  await worker.end();
  await app.end();
  await tdb.close();
});

describe('hold_release (BOOK-03-AC5)', () => {
  it('releases the orders of every club whose hold has ended, each order whole, with reason expired', async () => {
    const a1 = await hold(A, COURT_A, P1, [18, 19, 20]);
    const b1 = await hold(B, COURT_B, P2, [18]);
    await tdb.setNow('2026-12-01T03:16:00Z');
    const result = await runHoldRelease(worker);
    expect(result).toMatchObject({ released: 2, failed: 0, due: 2 });
    expect((await statuses(a1)).map((r) => r.status)).toEqual(['released', 'released', 'released']);
    expect((await statuses(b1))[0]).toEqual({ status: 'released', release_reason: 'expired' });
    expect((await tdb.query('select count(*)::int as n from public.occupancy')).rows[0].n).toBe(0);
  });

  it('runs the handlers once per order, not once per hour (D45)', async () => {
    const a1 = await hold(A, COURT_A, P1, [18, 19, 20]);
    await tdb.setNow('2026-12-01T03:16:00Z');
    await runHoldRelease(worker);
    expect(await handlerCalls()).toEqual([a1]);
  });

  it('leaves a hold that is still live, and a confirmed booking', async () => {
    const live = await hold(A, COURT_A, P1, [18]);
    const paid = await hold(A, COURT_A, P2, [20]);
    await worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) => tx.query(`select app.confirm_booking($1)`, [paid]));
    await tdb.setNow('2026-12-01T03:14:59Z');
    expect(await runHoldRelease(worker)).toMatchObject({ released: 0, due: 0 });
    expect((await statuses(live))[0].status).toBe('awaiting_payment');
    await tdb.setNow('2026-12-01T03:30:00Z');
    expect(await runHoldRelease(worker)).toMatchObject({ released: 1 });
    expect((await statuses(paid))[0].status).toBe('confirmed');
  });
});

describe('the job after a lazy release does nothing (BOOK-03-AC6)', () => {
  it('an order the next claim already released is not released again and its handler is not rerun', async () => {
    const old = await hold(A, COURT_A, P1, [18]);
    await tdb.setNow('2026-12-01T03:16:00Z');
    await hold(A, COURT_A, P2, [18]); // the lazy release inside the claim ends the old hold
    expect((await statuses(old))[0].status).toBe('released');
    expect(await handlerCalls()).toEqual([old]);
    const result = await runHoldRelease(worker);
    expect(result).toMatchObject({ released: 0, due: 0, failed: 0 });
    expect(await handlerCalls()).toEqual([old]);
  });

  it('a second tick does nothing', async () => {
    await hold(A, COURT_A, P1, [18]);
    await tdb.setNow('2026-12-01T03:16:00Z');
    expect(await runHoldRelease(worker)).toMatchObject({ released: 1 });
    expect(await runHoldRelease(worker)).toMatchObject({ released: 0, due: 0 });
    expect(await handlerCalls()).toHaveLength(1);
  });
});

describe('batches and failures', () => {
  it('releases at most the batch size per tick and leaves the rest for the next', async () => {
    const orders = [];
    for (let h = 8; h < 13; h += 1) orders.push(await hold(A, COURT_A, P1, [h]));
    await tdb.setNow('2026-12-01T03:16:00Z');
    expect(await runHoldRelease(worker, { batch: 2 })).toMatchObject({ released: 2, due: 2 });
    expect(await runHoldRelease(worker, { batch: 2 })).toMatchObject({ released: 2 });
    expect(await runHoldRelease(worker, { batch: 2 })).toMatchObject({ released: 1 });
    expect(await runHoldRelease(worker, { batch: 2 })).toMatchObject({ released: 0 });
    for (const o of orders) expect((await statuses(o))[0].status).toBe('released');
  });

  it("one order's failure does not stop the others, and the tick reports it by throwing after the batch", async () => {
    const bad = await hold(A, COURT_A, P1, [18]);
    const good = await hold(A, COURT_A, P2, [20]);
    await tdb.query(`create function public.t_bad(p_order uuid, p_reason text) returns void language plpgsql as $$ begin if p_order = '${bad}' then raise exception 'handler failed'; end if; end $$`);
    await tdb.query(`select app.register_release_handler('bad', 'public.t_bad'::regproc, 200)`);
    await tdb.setNow('2026-12-01T03:16:00Z');
    await expect(runHoldRelease(worker)).rejects.toThrow(/1 of 2 orders failed/);
    expect((await statuses(good))[0].status).toBe('released');
    expect((await statuses(bad))[0].status).toBe('awaiting_payment'); // its release rolled back, the next tick retries it
  });

  it('a Paused club still has its holds released', async () => {
    const a1 = await hold(A, COURT_A, P1, [18]);
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    await tdb.setNow('2026-12-01T03:16:00Z');
    expect(await runHoldRelease(worker)).toMatchObject({ released: 1 });
    expect((await statuses(a1))[0].status).toBe('released');
  });
});

describe('the lag heartbeat (design 6)', () => {
  it('records how long the oldest due hold waited, then zero when nothing is due', async () => {
    await hold(A, COURT_A, P1, [18]); // hold ends 03:15:00
    await tdb.setNow('2026-12-01T03:17:00Z'); // 120 seconds late
    await runHoldRelease(worker);
    expect((await heartbeat()).lag_seconds).toBe(120);
    expect(Number((await heartbeat()).runs)).toBe(1);
    await runHoldRelease(worker);
    expect((await heartbeat()).lag_seconds).toBe(0);
    expect(Number((await heartbeat()).runs)).toBe(2);
  });

  it('records a failed run', async () => {
    await hold(A, COURT_A, P1, [18]);
    await tdb.query(`create function public.t_bad2(p_order uuid, p_reason text) returns void language plpgsql as $$ begin raise exception 'handler failed'; end $$`);
    await tdb.query(`select app.register_release_handler('bad2', 'public.t_bad2'::regproc, 200)`);
    await tdb.setNow('2026-12-01T03:16:00Z');
    await expect(runHoldRelease(worker)).rejects.toThrow();
    const hb = await heartbeat();
    expect(Number(hb.failures)).toBe(1);
    expect(hb.last_failed_at).not.toBeNull();
  });
});

describe('who may look across clubs', () => {
  it('the players\' connection role cannot list due orders', async () => {
    await expect(app.withClubTx({ clubId: A, userId: P1, roles: ['player'] }, (tx) => tx.query(`select * from app.due_hold_orders(10)`))).rejects.toThrow(/permission denied|forbidden/i);
  });
});
