import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T09 / migration 0213: the solo class path. Court and coach are claimed in one insert or
// not at all; the coach row is locked (a hook until F07 creates coach) and F07's rules run
// through app.coach_rules_check. BOOK-03-AC11, BOOK-04-AC2, AC3, AC10; D19.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURT1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURT2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let tdb: TestDatabase;
let db: Db;
const at = (time: string) => new Date(`2026-12-02T${time}+07:00`).toISOString();
const H = (h: number) => at(`${String(h).padStart(2, '0')}:00:00`);

const newOrder = async (customer: string) =>
  (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, customer])).rows[0].id as string;

type Outcome = { ok: true; res: { booking_ids: string[] } } | { ok: false; code: string; detail: string | undefined };
async function reserve(customer: string, orderId: string, resource: string, starts: string[], coach: string | null): Promise<Outcome> {
  try {
    const res = await db.withClubTx({ clubId: A, userId: customer, roles: ['player'], requestId: 'r', source: 'player_app' }, async (tx) =>
      (await tx.query(`select app.reserve_court($1, $2, $3::timestamptz[], $4, null) as res`, [orderId, resource, starts, coach])).rows[0]?.res);
    return { ok: true, res };
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    if (err.code === 'BK001') return { ok: false, code: err.message, detail: err.detail };
    throw e;
  }
}
const count = async (table: string) => (await tdb.query(`select count(*)::int as n from public.${table}`)).rows[0].n as number;
const installRules = async () => {
  await tdb.query(`create table public.t_rules_calls (coach uuid, resource uuid, n int)`);
  await tdb.query(`grant all on public.t_rules_calls to booq_owner`);
  await tdb.query(`create function public.t_rules(p_club uuid, p_coach uuid, p_resource uuid, p_starts timestamptz[]) returns void language plpgsql as $$
    begin
      insert into public.t_rules_calls values (p_coach, p_resource, cardinality(p_starts));
      if p_coach = '${COACH2}' then perform app.refuse('coach_unavailable'); end if;
    end $$`);
  await tdb.query(`select app.register_coach_rules('public.t_rules'::regproc)`);
};

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'club-a','ก','A','live')`, [A]);
  await tdb.seedCoach(A, COACH);   // a solo class needs a coach row (F07, migration 0801)
  await tdb.seedCoach(A, COACH2);   // a solo class needs a coach row (F07, migration 0801)
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($1,$4,$3,'2','tennis')`, [A, COURT1, LOC, COURT2]);
  for (let d = 1; d <= 7; d += 1) await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1,$2,'06:00','24:00')`, [A, d]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 12 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('with no rules registered (assumption A-8; F07 registers its own in migration 0803)', () => {
  beforeEach(async () => {
    await tdb.query('delete from app.coach_rules_hook');
    await tdb.query('delete from app.coach_rules_move_hook');
  });
  it('a coach request is refused and leaves nothing', async () => {
    expect(await reserve(uid(1), await newOrder(uid(1)), COURT1, [H(18)], COACH)).toEqual({ ok: false, code: 'coach_rules_not_installed', detail: undefined });
    expect(await count('booking')).toBe(0);
    expect(await count('occupancy')).toBe(0);
  });

  it('a court only booking is not affected', async () => {
    expect(await reserve(uid(1), await newOrder(uid(1)), COURT1, [H(18)], null)).toMatchObject({ ok: true });
  });
});

describe('with the rules installed (BOOK-03-AC11, BOOK-04-AC3)', () => {
  beforeEach(installRules);

  it('claims court and coach together in one occupancy row per hour', async () => {
    const r = await reserve(uid(1), await newOrder(uid(1)), COURT1, [H(18), H(19)], COACH);
    expect(r).toMatchObject({ ok: true });
    const b = (await tdb.query('select type, coach_id, resource_id from public.booking order by start_at')).rows;
    expect(b).toEqual([
      { type: 'solo_class', coach_id: COACH, resource_id: COURT1 },
      { type: 'solo_class', coach_id: COACH, resource_id: COURT1 },
    ]);
    const o = (await tdb.query('select kind, coach_id, resource_id, state from public.occupancy order by start_at')).rows;
    expect(o).toEqual([
      { kind: 'solo_class', coach_id: COACH, resource_id: COURT1, state: 'held' },
      { kind: 'solo_class', coach_id: COACH, resource_id: COURT1, state: 'held' },
    ]);
  });

  it('asks the rules once, with the coach, the court and every hour', async () => {
    await reserve(uid(1), await newOrder(uid(1)), COURT1, [H(18), H(19), H(20)], COACH);
    expect((await tdb.query('select coach, resource, n from public.t_rules_calls')).rows).toEqual([{ coach: COACH, resource: COURT1, n: 3 }]);
  });

  it("a rule refusal (coach_unavailable) comes back typed and leaves nothing", async () => {
    expect(await reserve(uid(1), await newOrder(uid(1)), COURT1, [H(18)], COACH2)).toEqual({ ok: false, code: 'coach_unavailable', detail: undefined });
    expect(await count('booking')).toBe(0);
    expect(await count('occupancy')).toBe(0);
  });

  it('a busy coach on another court is refused by the coach, and nothing is left on the court (BOOK-04-AC3)', async () => {
    await reserve(uid(1), await newOrder(uid(1)), COURT1, [H(18)], COACH);
    const r = await reserve(uid(2), await newOrder(uid(2)), COURT2, [H(18)], COACH);
    expect(r).toEqual({ ok: false, code: 'slot_unavailable', detail: 'coach' });
    expect((await tdb.query('select count(*)::int as n from public.occupancy where resource_id = $1', [COURT2])).rows[0].n).toBe(0);
    expect(await count('booking')).toBe(1);
  });

  it('a busy court with a free coach is refused by the court', async () => {
    await reserve(uid(1), await newOrder(uid(1)), COURT1, [H(18)], null);
    expect(await reserve(uid(2), await newOrder(uid(2)), COURT1, [H(18)], COACH)).toEqual({ ok: false, code: 'slot_unavailable', detail: 'resource' });
  });

  it('a court only booking and a solo class on the same court and hour clash', async () => {
    await reserve(uid(1), await newOrder(uid(1)), COURT1, [H(18)], COACH);
    expect(await reserve(uid(2), await newOrder(uid(2)), COURT1, [H(18)], null)).toEqual({ ok: false, code: 'slot_unavailable', detail: 'resource' });
  });

  it('two solo requests for one coach on different courts give one success; the loser leaves nothing (parallel, FA T2)', async () => {
    for (let round = 0; round < 3; round += 1) {
      const hour = 12 + round;
      const results = await Promise.all([
        reserve(uid(10 + round * 2), await newOrder(uid(10 + round * 2)), COURT1, [H(hour)], COACH),
        reserve(uid(11 + round * 2), await newOrder(uid(11 + round * 2)), COURT2, [H(hour)], COACH),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const lost = results.find((r) => !r.ok);
      expect(lost).toMatchObject({ code: 'slot_unavailable', detail: 'coach' });
    }
    expect(await count('booking')).toBe(3);
    expect(await count('occupancy')).toBe(3);
  });

  it("an expired solo hold of the coach on another court does not block (lazy release)", async () => {
    const o1 = await newOrder(uid(1));
    await reserve(uid(1), o1, COURT1, [H(18)], COACH);
    await tdb.setNow('2026-12-01T03:16:00Z');
    expect(await reserve(uid(2), await newOrder(uid(2)), COURT2, [H(18)], COACH)).toMatchObject({ ok: true });
    expect((await tdb.query('select status from public.booking where order_id = $1', [o1])).rows[0].status).toBe('released');
  });
});
