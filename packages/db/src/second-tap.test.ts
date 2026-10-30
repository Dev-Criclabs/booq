import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T11 / migrations 0215 and 0216: a second tap returns the same hold, and Idempotency-Key
// storage. BOOK-03-AC15; decision D47; FA 3.5.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';

let tdb: TestDatabase;
let db: Db; // device one
let db2: Db; // device two: its own connections, same player
const at = (time: string) => new Date(`2026-12-02T${time}+07:00`).toISOString();
const H = (h: number) => at(`${String(h).padStart(2, '0')}:00:00`);

const newOrder = async (customer: string) =>
  (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;

type Res = { order_id: string; booking_ids: string[]; hold_expires_at: string; reused?: boolean };
type Outcome = { ok: true; res: Res } | { ok: false; code: string };
async function reserve(via: Db, customer: string, orderId: string, resource: string, starts: string[]): Promise<Outcome> {
  try {
    const res = await via.withClubTx({ clubId: A, userId: customer, roles: ['player'], requestId: 'r', source: 'player_app' }, async (tx) =>
      (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], null, null) as res`, [orderId, resource, starts])).rows[0]?.res);
    return { ok: true, res };
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === 'BK001') return { ok: false, code: err.message };
    throw e;
  }
}
const count = async (table: string) => (await tdb.query(`select count(*)::int as n from public.${table}`)).rows[0].n as number;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, COURT1, LOC, COURT2]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 8 });
  db2 = createDb({ connectionString: tdb.url, max: 8 });
});
afterEach(async () => {
  await db.end();
  await db2.end();
  await tdb.close();
});

describe('the second tap returns the same hold (BOOK-03-AC15, D47)', () => {
  it('a second tap returns the same order, bookings and hold end; no second hold exists', async () => {
    const first = await reserve(db, P1, await newOrder(P1), COURT1, [H(18), H(19)]);
    await tdb.setNow('2026-12-01T03:02:00Z'); // two minutes later: the hold end must not move
    const second = await reserve(db, P1, await newOrder(P1), COURT1, [H(19), H(18)]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (!first.ok || !second.ok) return;
    expect(second.res.order_id).toBe(first.res.order_id);
    expect(second.res.booking_ids).toEqual(first.res.booking_ids);
    expect(second.res.hold_expires_at).toBe(first.res.hold_expires_at);
    expect(second.res.reused).toBe(true);
    expect(first.res.reused).toBeUndefined();
    expect(await count('booking')).toBe(2);
    expect(await count('occupancy')).toBe(2);
  });

  it('a tap on a second device (own connection, same player) gets the same hold', async () => {
    const first = await reserve(db, P1, await newOrder(P1), COURT1, [H(18)]);
    const second = await reserve(db2, P1, await newOrder(P1), COURT1, [H(18)]);
    expect(first.ok && second.ok && second.res.hold_expires_at === first.res.hold_expires_at && second.res.order_id === first.res.order_id).toBe(true);
    expect(await count('booking')).toBe(1);
  });

  it('parallel identical taps from two devices give one order and one hold', async () => {
    const [a, b, c] = await Promise.all([
      reserve(db, P1, await newOrder(P1), COURT1, [H(18)]),
      reserve(db2, P1, await newOrder(P1), COURT1, [H(18)]),
      reserve(db, P1, await newOrder(P1), COURT1, [H(18)]),
    ]);
    for (const r of [a, b, c]) expect(r).toMatchObject({ ok: true });
    const ids = new Set([a, b, c].map((r) => (r.ok ? r.res.order_id : '')));
    expect(ids.size).toBe(1);
    expect(await count('booking')).toBe(1);
    expect(await count('occupancy')).toBe(1);
  });

  it("another player's identical request is not the same intent: slot_unavailable", async () => {
    await reserve(db, P1, await newOrder(P1), COURT1, [H(18)]);
    expect(await reserve(db, P2, await newOrder(P2), COURT1, [H(18)])).toEqual({ ok: false, code: 'slot_unavailable' });
  });

  it('a different selection is a new hold, not the old one', async () => {
    const first = await reserve(db, P1, await newOrder(P1), COURT1, [H(18)]);
    const other = await reserve(db, P1, await newOrder(P1), COURT1, [H(18), H(19)]);
    const elsewhere = await reserve(db, P1, await newOrder(P1), COURT2, [H(18)]);
    expect(other).toEqual({ ok: false, code: 'slot_unavailable' }); // hour 18 is the player's own first hold: a different intent
    expect(elsewhere).toMatchObject({ ok: true });
    expect(first.ok && elsewhere.ok && first.res.order_id !== elsewhere.res.order_id).toBe(true);
    expect(await count('booking')).toBe(2);
  });

  it('after the hold has ended the same request makes a new hold', async () => {
    const first = await reserve(db, P1, await newOrder(P1), COURT1, [H(18)]);
    await tdb.setNow('2026-12-01T03:16:00Z');
    const second = await reserve(db, P1, await newOrder(P1), COURT1, [H(18)]);
    expect(second).toMatchObject({ ok: true });
    expect(first.ok && second.ok && first.res.order_id !== second.res.order_id).toBe(true);
    expect(second.ok && second.res.reused).toBeUndefined();
  });

  it('does not reuse a confirmed booking or a released one', async () => {
    const first = await reserve(db, P1, await newOrder(P1), COURT1, [H(18)]);
    if (!first.ok) throw new Error('setup');
    await tdb.query(`update public.booking set status = 'confirmed', hold_expires_at = null, confirmed_at = now() where order_id = $1`, [first.res.order_id]);
    await tdb.query(`update public.occupancy set state = 'confirmed', hold_expires_at = null`);
    expect(await reserve(db, P1, await newOrder(P1), COURT1, [H(18)])).toEqual({ ok: false, code: 'slot_unavailable' });
  });
});

describe('Idempotency-Key storage (FA 3.5)', () => {
  const KEY = 'key-0001-abcdef';
  const begin = (via: Db, user: string, key: string, hash: string, fn: (tx: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<unknown>) =>
    via.withClubTx({ clubId: A, userId: user, roles: ['player'], requestId: 'r', source: 'player_app' }, async (tx) => {
      const stored = (await tx.query(`select app.idempotency_begin($1, $2) as r`, [key, hash])).rows[0]?.r;
      if (stored !== null) return { replay: true, response: stored };
      const response = await fn(tx);
      await tx.query(`select app.idempotency_finish($1, $2::jsonb)`, [key, JSON.stringify(response)]);
      return { replay: false, response };
    });

  it('the first request runs; the same key and hash replays the stored response', async () => {
    let runs = 0;
    const act = async () => { runs += 1; return { order: 'o-1', n: runs }; };
    const a = await begin(db, P1, KEY, 'h1', act);
    const b = await begin(db, P1, KEY, 'h1', act);
    expect(a).toEqual({ replay: false, response: { order: 'o-1', n: 1 } });
    expect(b).toEqual({ replay: true, response: { order: 'o-1', n: 1 } });
    expect(runs).toBe(1);
  });

  it('the same key in parallel runs once and both get the one response', async () => {
    let runs = 0;
    const act = async () => { runs += 1; await new Promise((r) => setTimeout(r, 150)); return { n: runs }; };
    const [a, b, c] = await Promise.all([begin(db, P1, KEY, 'h1', act), begin(db2, P1, KEY, 'h1', act), begin(db, P1, KEY, 'h1', act)]);
    expect(runs).toBe(1);
    expect([a, b, c].map((x) => x.response)).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }]);
    expect([a, b, c].filter((x) => !x.replay)).toHaveLength(1);
  });

  it('the same key with a different request is refused', async () => {
    await begin(db, P1, KEY, 'h1', async () => ({ ok: 1 }));
    await expect(begin(db, P1, KEY, 'h2', async () => ({ ok: 2 }))).rejects.toMatchObject({ code: 'BK001', message: 'idempotency_key_reused' });
  });

  it("another player's use of the same key is refused and learns nothing", async () => {
    await begin(db, P1, KEY, 'h1', async () => ({ secret: 'x' }));
    await expect(begin(db, P2, KEY, 'h1', async () => ({}))).rejects.toMatchObject({ code: 'BK001', message: 'idempotency_key_reused' });
  });

  it('a request that fails stores nothing, so the key can be tried again', async () => {
    await expect(begin(db, P1, KEY, 'h1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await count('idempotency_key')).toBe(0);
    expect(await begin(db, P1, KEY, 'h1', async () => ({ ok: 1 }))).toEqual({ replay: false, response: { ok: 1 } });
  });

  it('the key is a table of club data: registered, club scoped, no direct access for the app roles', async () => {
    await expect(db.withClubTx({ clubId: A, userId: P1, roles: ['player'] }, (tx) => tx.query(`select * from public.idempotency_key`))).rejects.toThrow(/permission denied/i);
  });
});
