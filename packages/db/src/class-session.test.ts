import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F08-T02 / migration 0902: class_session (CLASS-01-AC2, AC3, AC9).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
const COACH = 'e0e0e0e0-0000-4000-8000-000000000009';
const OWNER = '44444444-4444-4444-8444-444444444444';
let tdb: TestDatabase;
let tpl: string;

const START = '2026-12-02T18:00:00+07:00';
async function insert(over: Record<string, unknown> = {}) {
  const r: Record<string, unknown> = {
    club_id: A, template_id: tpl, start_at: START, end_at: '2026-12-02T19:00:00+07:00', name_th: 'ก', name_en: 'Group', audience: 'adult', level: null,
    coach_id: COACH, resource_id: RES, min_players: 4, max_players: 6, drop_in_price_satang: null, ...over,
  };
  const cols = Object.keys(r);
  return tdb.query(`insert into public.class_session (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, cols.map((c) => r[c]));
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
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
  tpl = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','G','adult',$2,$3,3,'18:00',4,6,$4) returning id`, [A, COACH, RES, OWNER])).rows[0].id;
});
afterEach(async () => {
  await tdb.close();
});

describe('class_session (CLASS-01-AC2, AC3, AC9)', () => {
  it('a new session is scheduled, not edited, with the snapshot of its template', async () => {
    expect((await insert()).rows[0]).toMatchObject({ status: 'scheduled', edited: false, attention_reason: null, cancel_reason: null, cancelled_at: null, max_players: 6, is_test: false });
  });

  it('a second session for one template and start is refused; another start or template is fine', async () => {
    await insert();
    await expect(insert()).rejects.toThrow(/class_session_one_per_start/);
    expect((await insert({ start_at: '2026-12-09T18:00:00+07:00', end_at: '2026-12-09T19:00:00+07:00' })).rowCount).toBe(1);
    const other = (await tdb.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by) values ($1,'ก','G2','adult',$2,$3,3,'18:00',4,6,$4) returning id`, [A, COACH, RES, OWNER])).rows[0].id;
    expect((await insert({ template_id: other })).rowCount).toBe(1);
  });

  it('is one hour on the hour in Bangkok', async () => {
    await expect(insert({ end_at: '2026-12-02T19:30:00+07:00' })).rejects.toThrow(/class_session_one_hour/);
    await expect(insert({ start_at: '2026-12-03T18:30:00+07:00', end_at: '2026-12-03T19:30:00+07:00' })).rejects.toThrow(/class_session_on_the_hour/);
  });

  it('status values match the design; needs_attention carries a reason and only it does', async () => {
    await expect(insert({ status: 'open' })).rejects.toThrow(/class_session_status_values/);
    await expect(insert({ status: 'needs_attention' })).rejects.toThrow(/class_session_attention_matches/);
    await expect(insert({ attention_reason: 'court_clash' })).rejects.toThrow(/class_session_attention_matches/);
    for (const [i, r] of ['court_clash', 'coach_clash', 'coach_leave', 'coach_rest', 'outside_hours'].entries()) {
      expect((await insert({ status: 'needs_attention', attention_reason: r, start_at: `2026-12-${10 + i}T18:00:00+07:00`, end_at: `2026-12-${10 + i}T19:00:00+07:00` })).rows[0].attention_reason).toBe(r);
    }
    await expect(insert({ status: 'needs_attention', attention_reason: 'weather', start_at: '2026-12-20T18:00:00+07:00', end_at: '2026-12-20T19:00:00+07:00' })).rejects.toThrow(/class_session_attention_values/);
  });

  it('a cancelled session has a reason and a time, and only a cancelled one', async () => {
    await expect(insert({ status: 'cancelled' })).rejects.toThrow(/class_session_cancel_matches/);
    await expect(insert({ cancel_reason: 'owner', cancelled_at: new Date().toISOString() })).rejects.toThrow(/class_session_cancel_matches/);
    for (const [i, r] of ['below_minimum', 'owner', 'template', 'coach'].entries()) {
      expect((await insert({ status: 'cancelled', cancel_reason: r, cancelled_at: new Date().toISOString(), start_at: `2026-12-${10 + i}T18:00:00+07:00`, end_at: `2026-12-${10 + i}T19:00:00+07:00` })).rows[0].cancel_reason).toBe(r);
    }
    await expect(insert({ status: 'cancelled', cancel_reason: 'rain', cancelled_at: new Date().toISOString(), start_at: '2026-12-20T18:00:00+07:00', end_at: '2026-12-20T19:00:00+07:00' })).rejects.toThrow(/class_session_cancel_values/);
  });

  it('a scheduled session is claimed by a group_class occupancy row that points at it (one court and one coach, CC-4)', async () => {
    const s = (await insert()).rows[0].id as string;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, class_session_id) values ($1,'group_class',$2,$3,$4,$5,'confirmed',$6)`, [A, RES, COACH, START, '2026-12-02T19:00:00+07:00', s]);
    await expect(tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, class_session_id) values ($1,'group_class',$2,$3,$4,$5,'confirmed',gen_random_uuid())`, [A, RES, COACH, '2026-12-03T18:00:00+07:00', '2026-12-03T19:00:00+07:00'])).rejects.toThrow(/occupancy_class_session_fk/);
    // The same court or coach cannot hold a second class or a booking at that hour.
    await expect(tdb.query(`insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, booking_id) values ($1,'court_booking',$2,$3,$4,'confirmed',gen_random_uuid())`, [A, RES, START, '2026-12-02T19:00:00+07:00'])).rejects.toThrow();
  });

  it('is club data: forced row security, no grant to the application roles yet; the update is audited', async () => {
    expect((await tdb.query(`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.class_session'::regclass`)).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) expect((await tdb.query(`select has_table_privilege($1, 'public.class_session', 'select') as ok`, [role])).rows[0].ok, role).toBe(false);
    const s = (await insert()).rows[0].id;
    await tdb.query(`update public.class_session set edited = true where id = $1`, [s]);
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'class_session'`)).rows[0].n).toBeGreaterThanOrEqual(2);
  });
});
