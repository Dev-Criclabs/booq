import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F07-T01 / migration 0801: the coach tables (COACH-01, COACH-02-AC3, R2, CC-1; D156).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const COACH = '11111111-1111-4111-8111-111111111111';
const OWNER = '44444444-4444-4444-8444-444444444444';
const BCOACH = '55555555-5555-4555-8555-555555555555';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
let tdb: TestDatabase;

async function person(club: string, id: string, roles: string[]) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, 'L' + id.slice(0, 4)]);
    for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const q = (sql: string, params: unknown[] = []) => tdb.query(sql, params);
const addCoach = (club = A, id = COACH, extra = '') => q(`insert into public.coach (club_id, id ${extra ? ',' + extra.split('|')[0] : ''}) values ($1, $2 ${extra ? ',' + extra.split('|')[1] : ''})`, [club, id]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await q(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await person(A, COACH, ['coach', 'player']);
  await person(A, OWNER, ['owner', 'player']);
  await person(B, BCOACH, ['coach', 'player']);
});
afterEach(async () => {
  await tdb.close();
});

describe('coach', () => {
  it('is a person of the club: composite key, and another club’s person is refused', async () => {
    await addCoach();
    await expect(addCoach(A, BCOACH)).rejects.toThrow(/foreign key/i);
    await expect(addCoach(A, '99999999-9999-4999-8999-999999999999')).rejects.toThrow(/foreign key/i);
  });

  it('starts active, not published, with no tier and no consent', async () => {
    await addCoach();
    expect((await q(`select active, published, tier_id, profile_consent_at from public.coach`)).rows[0]).toEqual({ active: true, published: false, tier_id: null, profile_consent_at: null });
  });

  it('is published only with the owner’s record of the coach’s consent (R1-AC7)', async () => {
    await addCoach();
    await expect(q(`update public.coach set published = true`)).rejects.toThrow(/coach_published_needs_consent/);
    await q(`update public.coach set profile_consent_at = now(), profile_consent_by = $1, published = true`, [OWNER]);
    await expect(q(`update public.coach set profile_consent_by = $1`, [BCOACH])).rejects.toThrow(/foreign key/i);
  });

  it('takes a tier of its own club only, and a photo is a path, never a URL', async () => {
    const tierB = (await q(`insert into public.coach_tier (club_id, name_th, name_en) values ($1,'ก','Head') returning id`, [B])).rows[0].id;
    await addCoach();
    await expect(q(`update public.coach set tier_id = $1`, [tierB])).rejects.toThrow(/foreign key/i);
    await expect(q(`update public.coach set photo_path = 'https://example.com/x.jpg'`)).rejects.toThrow(/coach_photo_is_a_path/);
    await q(`update public.coach set photo_path = 'coaches/11/photo.jpg'`);
  });

  it('is a test row, with its rules and leave, when the person is a test account (D100)', async () => {
    const T = '66666666-6666-4666-8666-666666666666';
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, is_test) values ($1,$2,'Ltest',true)`, [A, T]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'coach'), ($1,$2,'player')`, [A, T]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await addCoach(A, T);
    await q(`insert into public.coach_availability_rule (club_id, coach_id, kind, weekday, start_time, end_time) values ($1,$2,'weekly',1,'09:00','10:00')`, [A, T]);
    await q(`insert into public.coach_leave (club_id, coach_id, start_date, end_date) values ($1,$2,'2026-12-29','2026-12-29')`, [A, T]);
    expect((await q(`select is_test from public.coach where id = $1`, [T])).rows[0].is_test).toBe(true);
    expect((await q(`select is_test from public.coach_availability_rule where coach_id = $1`, [T])).rows[0].is_test).toBe(true);
    expect((await q(`select is_test from public.coach_leave where coach_id = $1`, [T])).rows[0].is_test).toBe(true);
    await addCoach();
    expect((await q(`select is_test from public.coach where id = $1`, [COACH])).rows[0].is_test).toBe(false);
  });
});

describe('coach_availability_rule', () => {
  beforeEach(async () => addCoach());
  const rule = (cols: string, vals: unknown[]) => q(`insert into public.coach_availability_rule (club_id, coach_id, ${cols}) values ($1, $2, ${vals.map((_, i) => '$' + (i + 3)).join(',')})`, [A, COACH, ...vals]);

  it('weekly needs a weekday and no date; open and closed need a date and no weekday', async () => {
    await rule('kind, weekday, start_time, end_time', ['weekly', 1, '09:00', '17:00']);
    await rule('kind, on_date, start_time, end_time', ['open', '2026-12-29', '09:00', '12:00']);
    await rule('kind, on_date, start_time, end_time', ['closed', '2026-12-30', '09:00', '12:00']);
    await expect(rule('kind, start_time, end_time', ['weekly', '09:00', '17:00'])).rejects.toThrow(/coach_rule_shape/);
    await expect(rule('kind, weekday, on_date, start_time, end_time', ['weekly', 1, '2026-12-29', '09:00', '17:00'])).rejects.toThrow(/coach_rule_shape/);
    await expect(rule('kind, weekday, start_time, end_time', ['open', 1, '09:00', '17:00'])).rejects.toThrow(/coach_rule_shape/);
    await expect(rule('kind, weekday, start_time, end_time', ['weekly', 7, '09:00', '17:00'])).rejects.toThrow(/coach_rule_weekday_range/);
    await expect(rule('kind, weekday, start_time, end_time', ['sometimes', 1, '09:00', '17:00'])).rejects.toThrow(/coach_rule_kind_values/);
  });

  it('whole hours only, the end after the start; 24:00 is allowed as an end', async () => {
    await rule('kind, weekday, start_time, end_time', ['weekly', 2, '09:00', '24:00']);
    await expect(rule('kind, weekday, start_time, end_time', ['weekly', 2, '09:30', '17:00'])).rejects.toThrow(/coach_rule_whole_hours/);
    await expect(rule('kind, weekday, start_time, end_time', ['weekly', 2, '09:00', '17:15'])).rejects.toThrow(/coach_rule_whole_hours/);
    await expect(rule('kind, weekday, start_time, end_time', ['weekly', 2, '17:00', '09:00'])).rejects.toThrow(/coach_rule_order/);
  });

  it('another club’s coach is not reachable', async () => {
    await expect(q(`insert into public.coach_availability_rule (club_id, coach_id, kind, weekday, start_time, end_time) values ($1,$2,'weekly',1,'09:00','10:00')`, [B, COACH])).rejects.toThrow(/foreign key/i);
  });
});

describe('coach_leave (D156)', () => {
  beforeEach(async () => addCoach());
  const leave = (cols: string, vals: unknown[]) => q(`insert into public.coach_leave (club_id, coach_id, ${cols}) values ($1, $2, ${vals.map((_, i) => '$' + (i + 3)).join(',')})`, [A, COACH, ...vals]);

  it('a time range on whole hours, optional free text type and note, no list of types', async () => {
    await leave('start_date, end_date', ['2026-12-29', '2026-12-31']);
    await leave('start_date, end_date, from_hour, to_hour, type, note', ['2026-12-29', '2026-12-29', 14, 18, 'anything I like', 'dentist']);
    await expect(leave('start_date, end_date, from_hour, to_hour', ['2026-12-29', '2026-12-30', 14, 18])).rejects.toThrow(/coach_leave_hours/);   // a part day is one date
    await expect(leave('start_date, end_date, from_hour', ['2026-12-29', '2026-12-29', 14])).rejects.toThrow(/coach_leave_hours/);
    await expect(leave('start_date, end_date, from_hour, to_hour', ['2026-12-29', '2026-12-29', 18, 14])).rejects.toThrow(/coach_leave_hours/);
    await expect(leave('start_date, end_date', ['2026-12-31', '2026-12-29'])).rejects.toThrow(/coach_leave_dates/);
  });

  it('overlapping leave for one coach is allowed; only approved rows are decisions', async () => {
    await leave('start_date, end_date', ['2026-12-29', '2026-12-31']);
    await leave('start_date, end_date', ['2026-12-30', '2027-01-02']);
    expect((await q(`select count(*)::int as n from public.coach_leave`)).rows[0].n).toBe(2);
    expect((await q(`select distinct status from public.coach_leave`)).rows).toEqual([{ status: 'pending' }]);
  });

  it('a decision names who decided and when; a pending request names no one', async () => {
    await expect(leave('start_date, end_date, status', ['2026-12-29', '2026-12-29', 'approved'])).rejects.toThrow(/coach_leave_decided/);
    await leave('start_date, end_date, status, decided_by, decided_at', ['2026-12-29', '2026-12-29', 'approved', OWNER, new Date().toISOString()]);
    await expect(leave('start_date, end_date, status, decided_by, decided_at', ['2026-12-29', '2026-12-29', 'maybe', OWNER, new Date().toISOString()])).rejects.toThrow(/coach_leave_status_values/);
  });
});

describe('coach_price_override (D156)', () => {
  it('one price per price group, none means the tier price, and the group is the club’s own', async () => {
    await addCoach();
    const adult = (await q(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'ผู้ใหญ่','Adult','{"min_age": 18}') returning id`, [A])).rows[0].id;
    const student = (await q(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'นักเรียน','Student','{"max_age": 17}') returning id`, [A])).rows[0].id;
    const other = (await q(`insert into public.price_group (club_id, name_th, name_en, rule) values ($1,'x','Other','{"min_age": 1}') returning id`, [B])).rows[0].id;
    await q(`insert into public.coach_price_override (club_id, coach_id, price_group_id, price_satang) values ($1,$2,$3,90000)`, [A, COACH, adult]);
    await expect(q(`insert into public.coach_price_override (club_id, coach_id, price_group_id, price_satang) values ($1,$2,$3,95000)`, [A, COACH, adult])).rejects.toThrow(/duplicate key|pkey/);
    await expect(q(`insert into public.coach_price_override (club_id, coach_id, price_group_id, price_satang) values ($1,$2,$3,-1)`, [A, COACH, student])).rejects.toThrow(/price_satang/);
    await expect(q(`insert into public.coach_price_override (club_id, coach_id, price_group_id, price_satang) values ($1,$2,$3,1)`, [A, COACH, other])).rejects.toThrow(/foreign key/i);
    expect((await q(`select count(*)::int as n from public.coach_price_override where price_group_id = $1`, [student])).rows[0].n).toBe(0);   // no row: the tier price
  });
});

describe('the foreign keys from booking and occupancy', () => {
  beforeEach(async () => {
    await q(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
    await q(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
  });
  const booking = async (coach: string) => {
    const o = (await q(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'staff') returning id`, [A, OWNER])).rows[0].id;
    return q(`insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
              values ($1,$2,'solo_class',$3,$4, date_trunc('hour', now()) + interval '30 hours', date_trunc('hour', now()) + interval '31 hours', $5,'confirmed','staff',$5, now()) returning id`, [A, o, RES, coach, OWNER]);
  };

  it('a solo class needs a coach row, not just a person', async () => {
    await expect(booking(COACH)).rejects.toThrow(/booking_coach_fk/);
    await addCoach();
    await booking(COACH);
  });

  it('an occupancy for a coach needs the coach row', async () => {
    await expect(q(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, hold_expires_at, closure_id)
                    values ($1,'solo_class',$2,$3, date_trunc('hour', now()) + interval '40 hours', date_trunc('hour', now()) + interval '41 hours','held', now() + interval '10 minutes', gen_random_uuid())`, [A, RES, COACH])).rejects.toThrow(/occupancy_coach_fk/);
  });
});

describe('personal data', () => {
  it('the profile fields and the leave note are kept apart in the audit log', async () => {
    await addCoach();
    await q(`update public.coach set bio_en = 'Secret bio text' where id = $1`, [COACH]);
    await q(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, note) values ($1,$2,'2026-12-29','2026-12-29','chemo appointment')`, [A, COACH]);
    const rows = (await q(`select record_type, new_value, pii_new from public.audit_entry where record_type in ('coach', 'coach_leave')`)).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.map((r) => r.new_value))).not.toMatch(/Secret bio|chemo/);
    expect(JSON.stringify(rows.map((r) => r.pii_new))).toMatch(/Secret bio/);
    expect(JSON.stringify(rows.map((r) => r.pii_new))).toMatch(/chemo/);
  });

  it('a coach with future sessions cannot be anonymised; without them the profile and leave notes are cleared', async () => {
    await addCoach();
    await q(`update public.coach set bio_en = 'Secret bio text', photo_path = 'a/b.jpg'`);
    await q(`insert into public.coach_leave (club_id, coach_id, start_date, end_date, note) values ($1,$2,'2026-12-29','2026-12-29','private')`, [A, COACH]);
    await q(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
    await q(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
    const o = (await q(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'staff') returning id`, [A, OWNER])).rows[0].id;
    await q(`insert into public.booking (club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
             values ($1,$2,'solo_class',$3,$4, date_trunc('hour', now()) + interval '30 hours', date_trunc('hour', now()) + interval '31 hours', $5,'confirmed','staff',$5, now())`, [A, o, RES, COACH, OWNER]);
    expect((await q(`select app.f07_deletion_impact($1, $2) as j`, [A, COACH])).rows[0].j).toEqual({ coach_future_sessions: 1 });
    await expect(q(`select app.f07_anonymise($1, $2)`, [A, COACH])).rejects.toThrow(/future sessions/);
    await q(`delete from public.booking`);
    await q(`select app.f07_anonymise($1, $2)`, [A, COACH]);
    expect((await q(`select bio_en, photo_path, published, active from public.coach`)).rows[0]).toEqual({ bio_en: null, photo_path: null, published: false, active: false });
    expect((await q(`select note from public.coach_leave`)).rows[0].note).toBeNull();
  });

  it('is registered with the data request handlers', async () => {
    expect((await q(`select handler_key from app.anonymise_handlers`)).rows.map((r) => r.handler_key)).toContain('f07_coach');
    expect((await q(`select handler_key from app.deletion_impact_handlers`)).rows.map((r) => r.handler_key)).toContain('f07_coach');
  });
});
