import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F12-T10 / migration 1208: coach notes in the player's data export and deleted on anonymisation (PDPA-01, D171; CC-3).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const C1 = '66666666-6666-4666-8666-666666666661';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const R1 = '88888888-8888-4888-8888-888888888881';
const LOC = '99999999-9999-4999-8999-999999999999';

let tdb: TestDatabase;
let web: Db;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'admin' as const });
const owner = ctx(OWNER, ['owner', 'player']);
const desk = ctx(DESK, ['front_desk', 'player']);
const rows = async (c: ReturnType<typeof ctx>, sql: string, args: unknown[] = []) => (await web.withClubTx(c, (tx) => tx.query(sql, args))).rows as Array<Record<string, any>>;
const exported = async (user = P1, c = desk) => (await rows(c, 'select app.f12_export($1) as x', [user]))[0]!.x as { notes: Array<Record<string, any>>; marks: Array<Record<string, any>> };

let solo1: string;
let seat1: string;
let session: string;
async function raw<T>(fn: (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-10T08:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles, name] of [[A, P1, ['player'], 'Ploy'], [A, P2, ['player'], 'Ann'], [A, DESK, ['front_desk', 'player'], 'Desk'], [A, OWNER, ['owner', 'player'], 'Owner'],
    [A, ACC, ['accountant', 'player'], 'Acc'], [A, C1, ['coach', 'player'], 'Coach One'], [B, OWNER_B, ['owner', 'player'], 'Owner B']] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$4)', [club, u, 'L' + u.slice(-2), name]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  await raw(async (c) => {
    await c.query(`insert into public.location (club_id, id, name) values ($1,$2,'Main')`, [A, LOC]);
    await c.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'Court 1','tennis')`, [A, R1, LOC]);
    await c.query(`insert into public.coach (club_id, id) values ($1,$2)`, [A, C1]);
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    solo1 = (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at)
       values ($1,$2,'solo_class',$3,$4,$5,'2026-12-01T03:00:00Z','2026-12-01T04:00:00Z','confirmed','online',$4, now()) returning id`, [A, o, R1, P1, C1])).rows[0].id as string;
    const tpl = (await c.query(`insert into public.class_template (club_id, name_th, name_en, audience, coach_id, resource_id, weekday, start_time, min_players, max_players, created_by)
                                values ($1,'ก','G','adult',$2,$3,1,'10:00',2,6,$4) returning id`, [A, C1, R1, OWNER])).rows[0].id as string;
    session = (await c.query(
      `insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, coach_id, resource_id, min_players, max_players)
       values ($1,$2,'2026-12-02T03:00:00Z','2026-12-02T04:00:00Z','ก','G','adult',$3,$4,2,6) returning id`, [A, tpl, C1, R1])).rows[0].id as string;
    const o2 = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    seat1 = (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, class_session_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at)
       values ($1,$2,'class_seat',$3,$4,$5,'2026-12-02T03:00:00Z','2026-12-02T04:00:00Z','confirmed','online',$5, now()) returning id`, [A, o2, R1, session, P1])).rows[0].id as string;
    await c.query(`insert into public.coach_note (club_id, coach_id, booking_id, customer_id, body, updated_at) values ($1,$2,$3,$4,'work on the split step','2026-12-01T05:00:00Z')`, [A, C1, solo1, P1]);
    await c.query(`insert into public.coach_note (club_id, coach_id, class_session_id, customer_id, body, updated_at) values ($1,$2,$3,$4,'good backhand','2026-12-02T05:00:00Z')`, [A, C1, session, P1]);
    await c.query(`insert into public.coach_note (club_id, coach_id, class_session_id, customer_id, body) values ($1,$2,$3,null,'general: rally drills')`, [A, C1, session]);
    await c.query(`insert into public.coach_note (club_id, coach_id, class_session_id, customer_id, body) values ($1,$2,$3,$4,'about Ann only')`, [A, C1, session, P2]);
    await c.query(`insert into public.coach_attendance (club_id, booking_id, coach_id, mark) values ($1,$2,$3,'present'), ($1,$4,$3,'absent')`, [A, solo1, C1, seat1]);
  });
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

describe('the export (PDPA-01, D171)', () => {
  it('holds the notes about the player and the marks of their bookings, by date and kind, and nothing else', async () => {
    const x = await exported();
    expect(x.notes).toEqual([
      { date: '2026-12-01', kind: 'solo', note: 'work on the split step', written_at: '2026-12-01T12:00:00' },
      { date: '2026-12-02', kind: 'group', note: 'good backhand', written_at: '2026-12-02T12:00:00' },
    ]);
    expect(x.marks).toEqual([{ date: '2026-12-01', kind: 'solo', mark: 'present' }, { date: '2026-12-02', kind: 'group', mark: 'absent' }]);
    const text = JSON.stringify(x);
    expect(text).not.toMatch(/general: rally|about Ann|Coach One/);
    expect(text).not.toContain(C1);
    expect(Object.keys(x.notes[0]!).sort()).toEqual(['date', 'kind', 'note', 'written_at']);
  });
  it('is for the owner and front desk who handle the request; the accountant, a coach and a player are refused; another player and another club get nothing of it', async () => {
    expect((await exported(P1, owner)).notes).toHaveLength(2);
    for (const c of [ctx(ACC, ['accountant', 'player']), ctx(C1, ['coach', 'player']), ctx(P1, ['player'])]) {
      await expect(exported(P1, c), c.roles.join()).rejects.toThrow(/not allowed/);
    }
    expect((await exported(P2)).notes.map((n) => n.note)).toEqual(['about Ann only']);       // each player's export holds the notes about that player only
    expect(await exported(P1, ctx(OWNER_B, ['owner', 'player'], B))).toEqual({ notes: [], marks: [] });
  });
});

describe('deletion (PDPA-01-AC5)', () => {
  it('the impact lists the counts staff see before they confirm', async () => {
    expect(await rows(owner, 'select app.deletion_impact($1) as i', [P1])).toEqual([{ i: expect.objectContaining({ coach_notes_about: 2, coach_marks_of: 2 }) }]);
  });
  it('anonymising a player deletes the notes about them, erases their text from the audit log, and leaves every other note and the marks', async () => {
    // One note written the audited way (as the 1204 function writes it), so the audit log holds its text in pii_new.
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_owner');
      await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.source', 'coach_portal', true)`, [A, C1]);
      await c.query(`insert into public.coach_note (club_id, coach_id, booking_id, customer_id, body) values ($1,$2,$3,$4,'AUDITED-secret-text')`, [A, C1, solo1, null]);
      await c.query(`update public.coach_note set body = 'AUDITED-about-ploy' where class_session_id = $1 and customer_id = $2`, [session, P1]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'coach_note'`)).rows[0].n).toBe(2);
    await rows(owner, 'select app.anonymise_user($1)', [P1]);
    const left = (await tdb.query(`select body, customer_id from public.coach_note`)).rows.sort((a, b) => a.body.localeCompare(b.body));
    expect(left).toEqual([
      { body: 'about Ann only', customer_id: P2 }, { body: 'AUDITED-secret-text', customer_id: null }, { body: 'general: rally drills', customer_id: null }]);
    expect((await tdb.query(`select count(*)::int as n from public.coach_attendance`)).rows[0].n).toBe(2);
    const audit = JSON.stringify((await tdb.query(`select old_value, new_value, pii_old, pii_new from public.audit_entry where record_type = 'coach_note'`)).rows);
    expect(audit).not.toMatch(/AUDITED-about-ploy/);                                           // the text of a note about the player is erased from the audit log
    expect(audit).toContain('AUDITED-secret-text');                                            // a note about nobody in particular is not about the player: it stays
    expect((await exported(P1, owner))).toEqual({ notes: [], marks: [{ date: '2026-12-01', kind: 'solo', mark: 'present' }, { date: '2026-12-02', kind: 'group', mark: 'absent' }] });
  });
  it('anonymising a coach keeps the notes they wrote', async () => {
    await rows(owner, 'select app.anonymise_user($1)', [C1]);
    expect((await tdb.query(`select count(*)::int as n from public.coach_note`)).rows[0].n).toBe(4);   // the four of the fixture
  });
});
