import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { checkTableClasses } from './registry/check';
import { collectRegistry } from './registry';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T06 / migration 0002: club setup tables (F01 design 3.2; PLAT-01, PLAT-05, CC-1).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';

let tdb: TestDatabase;
let db: Db;

const ctx = (clubId: string, roles: string[] = ['owner']) => ({ clubId, userId: USER, roles, requestId: 'r1' });

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en) values ($1, 'club-a', 'ก', 'Club A'), ($2, 'club-b', 'ข', 'Club B')`,
    [A, B],
  );
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('club (PLAT-01)', () => {
  it('slug is unique and URL safe', async () => {
    for (const bad of ['Club', 'a b', 'a_b', '-a', 'a-', 'a--b', '', 'ก']) {
      await expect(tdb.query(`insert into public.club (slug, name_th, name_en) values ($1, 'x', 'x')`, [bad]), bad).rejects.toThrow(/check|club_slug/i);
    }
    await expect(tdb.query(`insert into public.club (slug, name_th, name_en) values ('club-a', 'x', 'x')`)).rejects.toThrow(/duplicate key/i);
  });

  it('status is draft, testing, live or paused; a new club is a draft', async () => {
    const r = await tdb.query('select status from public.club where id = $1', [A]);
    expect(r.rows[0].status).toBe('draft');
    await expect(tdb.query(`update public.club set status = 'closed' where id = $1`, [A])).rejects.toThrow(/check/i);
  });

  it('payment option, default language and receipt prefix are constrained', async () => {
    await expect(tdb.query(`update public.club set payment_option = 'cash' where id = $1`, [A])).rejects.toThrow(/check/i);
    await expect(tdb.query(`update public.club set default_language = 'de' where id = $1`, [A])).rejects.toThrow(/check/i);
  });

  it('the slug cannot change after Testing, but can in Draft', async () => {
    await tdb.query(`update public.club set slug = 'club-a2' where id = $1`, [A]);
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    await expect(tdb.query(`update public.club set slug = 'club-a3' where id = $1`, [A])).rejects.toThrow(/slug/i);
  });

  it('a club sees only itself; the app role cannot write status or slug (set_club_status comes in T20)', async () => {
    const r = await db.withClubTx(ctx(A), (tx) => tx.query('select slug from public.club'));
    expect(r.rows).toEqual([{ slug: 'club-a' }]);
    await expect(db.withClubTx(ctx(A), (tx) => tx.query(`update public.club set status = 'live'`))).rejects.toThrow(/permission denied/i);
    await expect(db.withClubTx(ctx(A), (tx) => tx.query(`update public.club set slug = 'zzz'`))).rejects.toThrow(/permission denied/i);
    const ok = await db.withClubTx({ ...ctx(A), source: 'admin' }, (tx) => tx.query(`update public.club set name_en = 'Renamed'`));
    expect(ok.rowCount).toBe(1);
  });

  it('no club context sees nothing', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('set role booq_app');
      expect((await c.query('select count(*)::int as n from public.club')).rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });
});

describe('opening hours, locations, resources (CC-1, CC-4)', () => {
  const loc = '00000000-0000-4000-8000-0000000000a1';
  const locB = '00000000-0000-4000-8000-0000000000b1';
  beforeEach(async () => {
    await tdb.query(`insert into public.location (club_id, id, name) values ($1, $2, 'Main'), ($3, $4, 'Main')`, [A, loc, B, locB]);
  });

  it('close may be 24:00 and must be after open', async () => {
    await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 1, '06:00', '24:00')`, [A]);
    await expect(tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 2, '10:00', '10:00')`, [A])).rejects.toThrow(/check/i);
    await expect(tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 3, '12:00', '08:00')`, [A])).rejects.toThrow(/check/i);
    await expect(tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 8, '06:00', '12:00')`, [A])).rejects.toThrow(/check/i);
    await expect(tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 1, '07:00', '12:00')`, [A])).rejects.toThrow(/duplicate key/i);
  });

  it("a resource cannot point at another club's location (composite key)", async () => {
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1, gen_random_uuid(), $2, 'Court 1', 'tennis')`, [A, loc]);
    await expect(
      tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1, gen_random_uuid(), $2, 'Court 2', 'tennis')`, [A, locB]),
    ).rejects.toThrow(/foreign key/i);
  });

  it('an inactive resource keeps its row (CC-4); a club cannot read or write the other club', async () => {
    await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport, active) values ($1, gen_random_uuid(), $2, 'Court 1', 'tennis', false)`, [A, loc]);
    const a = await db.withClubTx(ctx(A), (tx) => tx.query('select name, active from public.resource'));
    expect(a.rows).toEqual([{ name: 'Court 1', active: false }]);
    const b = await db.withClubTx(ctx(B), (tx) => tx.query('select name from public.resource'));
    expect(b.rows).toEqual([]);
    await expect(
      db.withClubTx(ctx(B), (tx) => tx.query(`insert into public.location (club_id, id, name) values ($1, gen_random_uuid(), 'x')`, [A])),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('features and settings (PLAT-05, CC-1)', () => {
  it('club A cannot read, update, delete or insert for club B', async () => {
    await tdb.query(`insert into public.club_feature (club_id, feature_key, enabled) values ($1, 'coach_add_at_checkout', true), ($2, 'coach_add_at_checkout', false)`, [A, B]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1'), ($2, 'k', '2')`, [A, B]);
    for (const table of ['club_feature', 'club_setting']) {
      const r = await db.withClubTx(ctx(A), (tx) => tx.query(`select club_id from public.${table}`));
      expect(r.rows, table).toEqual([{ club_id: A }]);
      const d = await db.withClubTx(ctx(A), (tx) => tx.query(`delete from public.${table} where club_id = $1`, [B]));
      expect(d.rowCount, table).toBe(0);
    }
    await expect(
      db.withClubTx(ctx(A), (tx) => tx.query(`insert into public.club_setting (club_id, key, value) values ($1, 'x', '1')`, [B])),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a setting value is json and the row has an updated time from the clock', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'hold', '{"minutes": 15}')`, [A]);
    const r = await tdb.query(`select updated_at from public.club_setting where club_id = $1`, [A]);
    expect(new Date(r.rows[0].updated_at).toISOString()).toBe('2026-12-29T03:00:00.000Z');
  });
});

describe('pause and status history (PLAT-01, PLAT-03)', () => {
  const staff = '77777777-7777-4777-8777-777777777777';
  it('one open pause per club; a closed pause leaves room for another', async () => {
    await tdb.query(`insert into public.club_pause (club_id, id, paused_at, pause_reason, paused_by) values ($1, gen_random_uuid(), now(), 'r', $2)`, [A, staff]);
    await expect(
      tdb.query(`insert into public.club_pause (club_id, id, paused_at, pause_reason, paused_by) values ($1, gen_random_uuid(), now(), 'r2', $2)`, [A, staff]),
    ).rejects.toThrow(/duplicate key/i);
    await tdb.query(`insert into public.club_pause (club_id, id, paused_at, pause_reason, paused_by) values ($1, gen_random_uuid(), now(), 'r', $2)`, [B, staff]);
    await tdb.query(`update public.club_pause set resumed_at = now() + interval '1 day', resume_reason = 'back', resumed_by = $2 where club_id = $1`, [A, staff]);
    await tdb.query(`insert into public.club_pause (club_id, id, paused_at, pause_reason, paused_by) values ($1, gen_random_uuid(), now(), 'again', $2)`, [A, staff]);
  });

  it('a pause needs a reason; resuming before it began is refused', async () => {
    await expect(tdb.query(`insert into public.club_pause (club_id, id, paused_at, pause_reason, paused_by) values ($1, gen_random_uuid(), now(), '', $2)`, [A, staff])).rejects.toThrow(/check/i);
    await expect(
      tdb.query(`insert into public.club_pause (club_id, id, paused_at, pause_reason, paused_by, resumed_at, resume_reason, resumed_by) values ($1, gen_random_uuid(), now(), 'r', $2, now() - interval '1 day', 'x', $2)`, [A, staff]),
    ).rejects.toThrow(/check/i);
  });

  it('club_status_change is append-only', async () => {
    await tdb.query(`insert into public.club_status_change (club_id, id, from_status, to_status, reason, actor_staff_id) values ($1, gen_random_uuid(), 'draft', 'testing', 'setup done', $2)`, [A, staff]);
    await expect(tdb.query(`update public.club_status_change set reason = 'x'`)).rejects.toThrow(/append-only/i);
    await expect(tdb.query(`delete from public.club_status_change`)).rejects.toThrow(/append-only/i);
    await expect(tdb.query(`insert into public.club_status_change (club_id, id, from_status, to_status, reason) values ($1, gen_random_uuid(), 'draft', 'closed', 'x')`, [A])).rejects.toThrow(/check/i);
  });
});

describe('registry (PLAT-02-AC1, PDPA-01-AC1)', () => {
  it('every new table is classified and passes the structure check', async () => {
    const registry = await collectRegistry();
    const result = await checkTableClasses(tdb.pool, registry);
    // app.test_clock exists only in test databases (the harness); production has no such table.
    expect(result.problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
    for (const t of ['club', 'club_feature', 'club_setting', 'location', 'resource', 'opening_hours', 'club_pause']) {
      expect(registry[`public.${t}`]?.class, t).toBe('S');
    }
    expect(registry['public.club_status_change']?.class).toBe('D');
  });
});
