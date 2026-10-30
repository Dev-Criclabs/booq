import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// The 20-way race, repeated (BOOK-04-AC1, AC12; FA 3.4, T1). The connection here does NOT retry a deadlock
// (maxRetries 0), so any lock cycle between parallel claims of one slot fails the test at once instead of
// being hidden by withClubTx's retries. Each round claims a fresh hour; the coach rounds claim one coach on
// two courts, so the court and the coach are both contended.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const coachId = (n: number) => `e0e0e0e0-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Round n claims 08:00 + n hours, moving on to the next day after 22:00 (06:00 to 24:00 opening hours).
const slot = (n: number) => new Date(Date.parse('2026-12-02T08:00:00+07:00') + (Math.floor(n / 15) * 24 + (n % 15)) * 3_600_000).toISOString();
const ROUNDS = Number(process.env.STRESS_ROUNDS ?? 10);
const PARALLEL = 20;

let tdb: TestDatabase;
let db: Db;

type Outcome = { ok: true } | { ok: false; code: string };

async function reserve(customer: string, court: string, start: string, coach: string | null): Promise<Outcome> {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;
  try {
    await db.withClubTx({ clubId: A, userId: customer, roles: ['player'], requestId: 'r', source: 'player_app' }, (tx) =>
      tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], $4, null)`, [order, court, [start], coach]));
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    if (err.code === 'BK001' || err.code === 'P0001') return { ok: false, code: err.message };
    return { ok: false, code: `sqlstate ${err.code}: ${err.message} ${err.detail ?? ''}` };   // a deadlock (40P01) lands here, with its cycle
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, COURT1, LOC, COURT2]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  db = createDb({ connectionString: tdb.url, max: PARALLEL + 4, maxRetries: 0 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('parallel claims never deadlock (FA 3.4 lock order)', () => {
  it(`${ROUNDS} rounds of ${PARALLEL} players on one court and hour: one success each, the rest slot_unavailable`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const start = slot(round);
      const results = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => reserve(uid(1000 * (round + 1) + i), COURT1, start, null)));
      const failures = results.filter((r): r is Extract<Outcome, { ok: false }> => !r.ok);
      expect(failures.filter((f) => f.code !== 'slot_unavailable'), `round ${round}`).toEqual([]);
      expect(results.filter((r) => r.ok), `round ${round}`).toHaveLength(1);
    }
    expect((await tdb.query('select count(*)::int n from public.occupancy')).rows[0].n).toBe(ROUNDS);
  }, 180_000);

  it(`${ROUNDS} rounds of ${PARALLEL} players on one coach across two courts: one success each, no deadlock`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) await tdb.seedCoach(A, coachId(round + 1));
    for (let round = 0; round < ROUNDS; round += 1) {
      const start = slot(round);
      const results = await Promise.all(
        Array.from({ length: PARALLEL }, (_, i) => reserve(uid(1000 * (round + 1) + i), i % 2 === 0 ? COURT1 : COURT2, start, coachId(round + 1))),
      );
      const failures = results.filter((r): r is Extract<Outcome, { ok: false }> => !r.ok);
      expect(failures.filter((f) => !['slot_unavailable', 'coach_unavailable'].includes(f.code)), `round ${round}`).toEqual([]);
      expect(results.filter((r) => r.ok), `round ${round}`).toHaveLength(1);
    }
    expect((await tdb.query(`select count(*)::int n from public.occupancy where coach_id is not null`)).rows[0].n).toBe(ROUNDS);
  }, 180_000);
});
