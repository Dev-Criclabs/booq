// R4-AC7: a coach substitution is audited with the actor and the reason (PLAT-04). Written by QA after the F07 sweep.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDb, type Db } from '../../packages/db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const COACH2 = 'e1e1e1e1-0000-4000-8000-000000000008';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OWNER = '44444444-4444-4444-8444-444444444444';
let tdb: TestDatabase;
let db: Db;

async function person(id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, id, 'L' + id.slice(0, 4)]);
    for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const H = (h: number) => new Date(`2026-12-02T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, C1, LOC]);
  await tdb.query(`insert into public.opening_hours (club_id, weekday, open, close) select $1, d, '06:00', '24:00' from generate_series(1, 7) d`, [A]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'booking_window_days','30'), ($1,'hold_minutes','15')`, [A]);
  await person(PLAYER, ['player']);
  await person(OWNER, ['owner', 'player']);
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(A, COACH2);
  db = createDb({ connectionString: tdb.url, max: 3 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

it('F07/R4-AC7 a substitution writes an audit entry that names the owner as actor and carries the reason, and a refused one writes none', async () => {
  const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, PLAYER])).rows[0].id;
  const b = (await tdb.query(
    `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
     values ($1,$2,'court',$3,$4,$5,$6,'confirmed','online',$6, app.now()) returning id`, [A, order, C1, H(10), H(11), PLAYER])).rows[0].id as string;
  await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3,$4,'confirmed',$5)`, [A, C1, H(10), H(11), b]);
  await tdb.query(`update public.occupancy set coach_id = $2, kind = 'solo_class' where booking_id = $1`, [b, COACH]);
  await tdb.query(`update public.booking set coach_id = $2, type = 'solo_class' where id = $1`, [b, COACH]);

  const owner = { clubId: A, userId: OWNER, roles: ['owner', 'player'] as never, source: 'admin' as never };
  await expect(db.withClubTx(owner, async (tx) => tx.query(`select app.substitute_coach($1, $2, 'leave')`, [b, COACH]))).rejects.toThrow();   // the same coach: refused
  const none = (await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'coach_substitution'`)).rows[0].n;
  await db.withClubTx(owner, async (tx) => tx.query(`select app.substitute_coach($1, $2, 'leave')`, [b, COACH2]));
  const rows = (await tdb.query(`select * from public.audit_entry where record_type = 'coach_substitution' or (record_type = 'booking' and record_id = $1) order by occurred_at`, [b])).rows;
  expect(none).toBe(0);
  const mine = rows.filter((r) => r.record_type === 'coach_substitution');
  expect(mine.length).toBeGreaterThanOrEqual(1);
  const text = JSON.stringify(mine);
  expect(text).toContain(OWNER);          // the actor
  expect(text).toContain('leave');        // the reason
  expect(text).toContain(COACH2);         // the new coach
});
