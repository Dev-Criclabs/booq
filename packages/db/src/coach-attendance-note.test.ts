import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F12-T01 / migration 1201: coach_attendance and coach_note (CPORT-05, PLAT-04, CC-1, CC-3; D118, D171).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const DESK = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const C1 = '66666666-6666-4666-8666-666666666661';
const C2 = '66666666-6666-4666-8666-666666666662';
const OWNER_B = '77777777-7777-4777-8777-777777777777';
const RES = '88888888-8888-4888-8888-888888888888';

let tdb: TestDatabase;
let web: Db;
let booking: string;
let session: string;
const ctx = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'coach_portal' as const });
const as = async (c: ReturnType<typeof ctx>, sql: string, args: unknown[] = []) => (await web.withClubTx(c, (tx) => tx.query(sql, args))).rows as Array<Record<string, any>>;
/** As the table owner in the club's context, the way the 1204 functions will write. */
async function asOwnerRole<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.source', 'coach_portal', true)`, [A, C1]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u, roles] of [[A, P1, ['player']], [A, DESK, ['front_desk', 'player']], [A, OWNER, ['owner', 'player']], [A, ACC, ['accountant', 'player']],
    [A, C1, ['coach', 'player']], [A, C2, ['coach', 'player']], [B, OWNER_B, ['owner', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id, full_name) values ($1,$2,$3,$3)', [club, u, 'L' + u.slice(-2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`insert into public.coach (club_id, id) values ($1,$2), ($1,$3)`, [A, C1, C2]);
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P1])).rows[0].id as string;
    booking = (await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, customer_id, coach_id, start_at, end_at, status, source, created_by, confirmed_at)
       values ($1,$2,'solo_class',$3,$4,$5,'2026-12-10T03:00:00Z','2026-12-10T04:00:00Z','confirmed','online',$4, now()) returning id`, [A, o, RES, P1, C1])).rows[0].id as string;
    session = (await c.query(
      `insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, coach_id, resource_id, min_players, max_players)
       values ($1, gen_random_uuid(), '2026-12-11T03:00:00Z', '2026-12-11T04:00:00Z', 'ก', 'G', 'adult', $2, $3, 2, 6) returning id`, [A, C1, RES])).rows[0].id as string;
    await c.query('commit');
  } finally {
    c.release();
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

const mark = (b = booking, m = 'present') => tdb.query(`insert into public.coach_attendance (club_id, booking_id, coach_id, mark) values ($1,$2,$3,$4)`, [A, b, C1, m]);
const note = (over: { booking?: string | null; session?: string | null; customer?: string | null; body?: string; coach?: string } = {}) =>
  tdb.query(`insert into public.coach_note (club_id, coach_id, booking_id, class_session_id, customer_id, body) values ($1,$2,$3,$4,$5,$6)`,
    [A, over.coach ?? C1, over.booking === undefined ? booking : over.booking, over.session ?? null, over.customer === undefined ? P1 : over.customer, over.body ?? 'work on the split step']);

describe('shape and constraints', () => {
  it('a mark is present or absent, one per booking, for a coach of the club', async () => {
    await expect(tdb.query(`insert into public.coach_attendance (club_id, booking_id, coach_id, mark) values ($1,$2,$3,'present')`, [A, booking, P1])).rejects.toThrow(/foreign key/i);
    await expect(tdb.query(`insert into public.coach_attendance (club_id, booking_id, coach_id, mark) values ($1,$2,$3,'late')`, [A, booking, C1])).rejects.toThrow(/check/i);
    await mark();
    await expect(mark(booking, 'present')).rejects.toThrow(/duplicate key|unique/i);
  });
  it('a note is on a solo booking or a group session (not both, not neither), not blank, 2000 characters at most, one per coach, session and player', async () => {
    await note();
    await note({ customer: null });                                 // the session note on the same solo class
    await note({ booking: null, session, customer: P1 });          // a player of a group session
    await expect(note()).rejects.toThrow(/duplicate key|unique/i);
    await expect(note({ booking: null, session, customer: P1 })).rejects.toThrow(/duplicate key|unique/i);
    await note({ coach: C2, customer: P1 });                       // another coach may hold their own note on the same player and session
    await expect(note({ booking, session, customer: null })).rejects.toThrow(/check/i);
    await expect(note({ booking: null, session: null })).rejects.toThrow(/check/i);
    await expect(note({ customer: DESK, body: '   ' })).rejects.toThrow(/check/i);
    await expect(note({ customer: DESK, body: 'x'.repeat(2001) })).rejects.toThrow(/check/i);
    await note({ customer: DESK, body: 'x'.repeat(2000) });
  });
});

describe('who reads and writes', () => {
  it('the owner and front desk read both tables; the accountant, a player, a coach and another club read none', async () => {
    await mark();
    await note();
    for (const t of ['coach_attendance', 'coach_note']) {
      for (const c of [ctx(OWNER, ['owner', 'player']), ctx(DESK, ['front_desk', 'player'])]) expect((await as(c, `select * from public.${t}`)).length, `${t} ${c.roles.join()}`).toBe(1);
      for (const c of [ctx(ACC, ['accountant', 'player']), ctx(P1, ['player']), ctx(C1, ['coach', 'player']), ctx(OWNER_B, ['owner', 'player'], B)]) {
        expect(await as(c, `select * from public.${t}`), `${t} ${c.roles.join()}`).toEqual([]);
      }
    }
  });
  it('no app role writes either table, and BOOQ staff and the worker read nothing', async () => {
    await mark();
    await note();
    for (const c of [ctx(C1, ['coach', 'player']), ctx(OWNER, ['owner', 'player']), ctx(DESK, ['front_desk', 'player'])]) {
      await expect(as(c, `insert into public.coach_attendance (club_id, booking_id, coach_id, mark) values ($1,$2,$3,'absent')`, [A, booking, C1]), c.roles.join()).rejects.toThrow(/permission denied/);
      await expect(as(c, `update public.coach_attendance set mark = 'absent'`), c.roles.join()).rejects.toThrow(/permission denied/);
      await expect(as(c, `update public.coach_note set body = 'x'`), c.roles.join()).rejects.toThrow(/permission denied/);
      await expect(as(c, `delete from public.coach_note`), c.roles.join()).rejects.toThrow(/permission denied/);
    }
    for (const role of ['booq_platform', 'booq_worker', 'anon', 'authenticated']) {
      for (const t of ['coach_attendance', 'coach_note']) {
        expect((await tdb.query(`select has_table_privilege($1, $2, 'select') as ok`, [role, `public.${t}`])).rows[0].ok, `${role} ${t}`).toBe(false);
      }
    }
  });
});

describe('only the functions change a row', () => {
  it('the owner role may change a mark and a note, but not who or what they are about, and never delete a mark; superusers cannot slip past the guard', async () => {
    await mark();
    await note();
    await asOwnerRole((c) => c.query(`update public.coach_attendance set mark = 'absent', changed_at = app.now()`));
    expect((await tdb.query(`select mark from public.coach_attendance`)).rows).toEqual([{ mark: 'absent' }]);
    await expect(asOwnerRole((c) => c.query(`update public.coach_attendance set booking_id = gen_random_uuid()`))).rejects.toThrow();
    await expect(asOwnerRole((c) => c.query(`delete from public.coach_attendance`))).rejects.toThrow(/append-only/);
    await asOwnerRole((c) => c.query(`update public.coach_note set body = 'new text', updated_at = app.now()`));
    await expect(asOwnerRole((c) => c.query(`update public.coach_note set customer_id = null`))).rejects.toThrow(/changes only through its function/);
    await expect(tdb.query(`update public.coach_note set body = 'sneaky'`)).rejects.toThrow(/changes only through its function/);
    await expect(tdb.query(`update public.coach_attendance set mark = 'present'`)).rejects.toThrow(/changes only through its function/);
    await asOwnerRole((c) => c.query(`delete from public.coach_note`));
    expect((await tdb.query(`select count(*)::int as n from public.coach_note`)).rows[0].n).toBe(0);
    await expect(tdb.query(`truncate public.coach_attendance`)).rejects.toThrow(/append-only/);
  });
});

describe('audit (PLAT-04) and personal data (CC-3)', () => {
  it('a mark and a note are audited; the note text is a personal value kept in the pii columns, never in old_value or new_value', async () => {
    await asOwnerRole(async (c) => {
      await c.query(`insert into public.coach_attendance (club_id, booking_id, coach_id, mark) values ($1,$2,$3,'present')`, [A, booking, C1]);
      await c.query(`update public.coach_attendance set mark = 'absent'`);
      await c.query(`insert into public.coach_note (club_id, coach_id, booking_id, customer_id, body) values ($1,$2,$3,$4,'first text')`, [A, C1, booking, P1]);
      await c.query(`update public.coach_note set body = 'second text'`);
    });
    const att = (await tdb.query(`select action, old_value, new_value from public.audit_entry where record_type = 'coach_attendance' order by seq`)).rows;
    expect(att.map((r) => r.action)).toEqual(['insert', 'update']);
    expect(att[1].old_value).toMatchObject({ mark: 'present' });
    expect(att[1].new_value).toMatchObject({ mark: 'absent' });
    const n = (await tdb.query(`select action, old_value, new_value, pii_old, pii_new from public.audit_entry where record_type = 'coach_note' order by seq`)).rows;
    expect(n.map((r) => r.action)).toEqual(['insert', 'update']);
    expect(n[1].pii_old).toEqual({ body: 'first text' });
    expect(n[1].pii_new).toEqual({ body: 'second text' });
    expect(JSON.stringify(n.map((r) => [r.old_value, r.new_value]))).not.toMatch(/text/);
  });
  it('test rows follow the coach (is_test), and are purged at Go live', async () => {
    const T = '66666666-6666-4666-8666-666666666663';
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id, full_name, is_test) values ($1,$2,'LT','Test coach', true)`, [A, T]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, T]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await tdb.query(`insert into public.coach (club_id, id) values ($1,$2)`, [A, T]);
    await tdb.query(`insert into public.coach_attendance (club_id, booking_id, coach_id, mark) values ($1,$2,$3,'present')`, [A, booking, T]);
    expect((await tdb.query(`select is_test from public.coach_attendance`)).rows).toEqual([{ is_test: true }]);
    const order = (await tdb.query(`select table_name, delete_order from app.test_tables where table_name in ('coach_attendance', 'coach_note', 'coach', 'booking') order by delete_order`)).rows;
    const pos = Object.fromEntries(order.map((r) => [r.table_name, r.delete_order]));
    expect(pos['coach_note']).toBeLessThan(pos['coach']);
    expect(pos['coach_attendance']).toBeLessThan(pos['booking']);
    expect(pos['coach_attendance']).toBeLessThan(pos['coach']);
  });
});
