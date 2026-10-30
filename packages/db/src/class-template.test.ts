import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T01 / migration 0901: class_template (CLASS-01-AC1, AC5, AC10; D157).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const BCOACH = 'e2e2e2e2-0000-4000-8000-000000000007';
const OWNER = '44444444-4444-4444-8444-444444444444';
let tdb: TestDatabase;

const base = { name_th: 'ตีเทนนิสกลุ่ม', name_en: 'Group tennis', audience: 'adult', level: 'beginner', coach_id: COACH, resource_id: RES, weekday: 3, start_time: '18:00', duration_minutes: 60, min_players: 4, max_players: 6 };
async function insert(over: Record<string, unknown> = {}, club = A) {
  const r = { club_id: club, created_by: OWNER, ...base, ...over };
  const cols = Object.keys(r);
  return tdb.query(`insert into public.class_template (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, cols.map((c) => r[c as keyof typeof r]));
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'Lo')`, [A, OWNER]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player')`, [A, OWNER]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await tdb.seedCoach(A, COACH);
  await tdb.seedCoach(B, BCOACH);
});
afterEach(async () => {
  await tdb.close();
});

describe('class_template (CLASS-01-AC1, AC10)', () => {
  it('stores a weekly one hour class; the drop in price is null until the owner sets it (D157)', async () => {
    const r = (await insert()).rows[0];
    expect(r).toMatchObject({ weekday: 3, duration_minutes: 60, min_players: 4, max_players: 6, drop_in_price_satang: null, active: true, ended_on: null, is_test: false });
    expect((await insert({ drop_in_price_satang: 25000 })).rows[0].drop_in_price_satang).toBe(25000);
    expect((await insert({ drop_in_price_satang: 0, weekday: 4 })).rows[0].drop_in_price_satang).toBe(0);
    await expect(insert({ drop_in_price_satang: -1 })).rejects.toThrow(/class_template_drop_in/);
  });

  it('a template cannot be 90 minutes or any other length but 60', async () => {
    for (const d of [30, 90, 120]) await expect(insert({ duration_minutes: d })).rejects.toThrow(/class_template_one_hour/);
  });

  it('starts on the hour inside one day; the weekday is 0 to 6', async () => {
    await expect(insert({ start_time: '18:30' })).rejects.toThrow(/class_template_on_the_hour/);
    await expect(insert({ start_time: '24:00' })).rejects.toThrow(/class_template_on_the_hour/);
    expect((await insert({ start_time: '23:00' })).rowCount).toBe(1);
    await expect(insert({ weekday: 7 })).rejects.toThrow(/class_template_weekday/);
    await expect(insert({ weekday: -1 })).rejects.toThrow(/class_template_weekday/);
  });

  it('the players range is 1 <= min <= max', async () => {
    await expect(insert({ min_players: 0 })).rejects.toThrow(/class_template_players/);
    await expect(insert({ min_players: 7, max_players: 6 })).rejects.toThrow(/class_template_players/);
    expect((await insert({ min_players: 6, max_players: 6 })).rowCount).toBe(1);
  });

  it('audience is adult or student; names are club typed and not empty; level is free text', async () => {
    await expect(insert({ audience: 'kids' })).rejects.toThrow(/class_template_audience/);
    await expect(insert({ name_en: ' ' })).rejects.toThrow(/class_template_names/);
    await expect(insert({ name_th: '' })).rejects.toThrow(/class_template_names/);
    expect((await insert({ audience: 'student', level: 'Intermediate 2' })).rows[0]).toMatchObject({ audience: 'student', level: 'Intermediate 2' });
    expect((await insert({ level: null })).rowCount).toBe(1);
  });

  it('the coach and the court must belong to the club (composite keys); another club’s are not reachable', async () => {
    await expect(insert({ coach_id: BCOACH })).rejects.toThrow(/foreign key/);
    await expect(insert({ coach_id: '99999999-9999-4999-8999-999999999999' })).rejects.toThrow(/foreign key/);
    await expect(insert({ resource_id: '99999999-9999-4999-8999-999999999999' })).rejects.toThrow(/foreign key/);
  });

  it('is club data: forced row security, the owner and tenant policies, no grant to the application roles yet', async () => {
    expect((await tdb.query(`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.class_template'::regclass`)).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_table_privilege($1, 'public.class_template', 'select') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });

  it('a Testing club’s template is a test row, and an update is audited', async () => {
    await tdb.query(`update public.club set status = 'testing' where id = $1`, [A]);
    const r = (await insert()).rows[0];
    expect(r.is_test).toBe(true);
    await tdb.query(`update public.class_template set max_players = 8 where id = $1`, [r.id]);
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'class_template'`)).rows[0].n).toBeGreaterThanOrEqual(2);
  });
});
