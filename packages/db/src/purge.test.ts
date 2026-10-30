import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T27 / migration 0013: the Go live purge (PLAT-07-AC3, AC4, AC8, PLAT-01-AC6; D100, D101; SR-15).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const TESTER = '22222222-2222-4222-8222-222222222222';
const STAFF = '77777777-7777-4777-8777-777777777777';

let tdb: TestDatabase;
let db: Db;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','testing'), ($2,'b','ข','B','testing')`, [A, B]);
  // a fixture ledger: append-only, carries the test flag from the club status
  await tdb.query(`
    create table public.t_ledger (club_id uuid not null references public.club (id), id uuid not null default gen_random_uuid(), amount integer not null, is_test boolean not null default false, primary key (club_id, id));
    alter table public.t_ledger enable row level security; alter table public.t_ledger force row level security;
    create trigger t_ledger_append_only before update or delete on public.t_ledger for each row execute function app.refuse_change();
    select app.register_test_table('public.t_ledger', 150);`);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

async function person(club: string, id: string, line: string, roles: string[], test = false) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('insert into public.app_user (club_id, id, line_user_id, is_test) values ($1,$2,$3,$4)', [club, id, line, test]);
    for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const purge = (club = A, extra: Record<string, string> = {}) => {
  const c = tdb.pool.connect();
  return c.then(async (cl) => {
    try {
      await cl.query('begin');
      await cl.query('set local role booq_owner');
      for (const [k, v] of Object.entries({ 'app.club_id': club, ...extra })) await cl.query('select set_config($1,$2,true)', [k, v]);
      const r = await cl.query('select app.go_live_purge() as counts');
      await cl.query('commit');
      return r.rows[0].counts as Record<string, number>;
    } catch (e) {
      await cl.query('rollback');
      throw e;
    } finally {
      cl.release();
    }
  });
};
const count = async (table: string, club = A, test?: boolean) =>
  (await tdb.query(`select count(*)::int as n from public.${table} where club_id = $1 ${test === undefined ? '' : `and is_test = ${test}`}`, [club])).rows[0].n as number;

describe('what the purge removes and what it keeps', () => {
  beforeEach(async () => {
    await person(A, OWNER, 'L1', ['owner', 'player']);                 // owner: never a test row (D100)
    await person(A, TESTER, 'L2', ['player'], true);                   // tester account: test data
    await tdb.query(`insert into public.t_ledger (club_id, amount) values ($1, 5), ($1, 7), ($2, 9)`, [A, B]); // all test (clubs are in Testing)
    await tdb.query(`insert into public.user_consent (club_id, user_id, notice_version, language) values ($1,$2,'v1','th'), ($1,$3,'v1','th')`, [A, TESTER, OWNER]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'hold', '15')`, [A]);
  });

  it('deletes only the test rows of that club, and nothing of another club', async () => {
    expect(await count('t_ledger', A, true)).toBe(2);
    const counts = await purge();
    expect(counts.t_ledger).toBe(2);
    expect(await count('t_ledger', A)).toBe(0);
    expect(await count('t_ledger', B)).toBe(1);
  });

  it('the owner account, its roles and consent survive; the tester account goes with its roles and consent (D100)', async () => {
    await purge();
    expect((await tdb.query('select id from public.app_user order by id')).rows.map((r) => r.id)).toEqual([OWNER]);
    expect(await count('app_user_role', A)).toBe(2); // owner and player of the owner
    expect((await tdb.query('select user_id from public.user_consent')).rows).toEqual([{ user_id: OWNER }]);
  });

  it('a setting changed in Testing keeps its audit entry; entries about test rows go (D101)', async () => {
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where club_id = $1 and is_test and record_id = $2`, [A, TESTER])).rows[0].n).toBeGreaterThan(0);
    await purge();
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_id = $1`, [TESTER])).rows[0].n).toBe(0);
    const kept = await tdb.query(`select record_type from public.audit_entry where club_id = $1 and record_type = 'club_setting'`, [A]);
    expect(kept.rows).toHaveLength(1);
    const about = await tdb.query(`select count(*)::int as n from public.audit_entry where club_id = $1 and is_test`, [A]);
    expect(about.rows[0].n).toBe(0);
    // the owner's own role grants are live data: their entries stay
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where record_type = 'app_user_role' and club_id = $1`, [A])).rows[0].n).toBeGreaterThan(0);
  });

  it('writes one non-test audit entry with the counts and one P6 entry; no row content', async () => {
    await tdb.query(`insert into platform.platform_staff (id, auth_user_id, email, display_name, role) values ($1, gen_random_uuid(), 'm@booq.test', 'Mali', 'platform_admin')`, [STAFF]);
    const counts = await purge(A, { 'app.actor_platform_staff_id': STAFF });
    const e = (await tdb.query(`select * from public.audit_entry where action = 'go_live.purge'`)).rows;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ club_id: A, is_test: false, record_type: 'club', actor_type: 'platform_staff' });
    expect(e[0].new_value).toMatchObject({ t_ledger: 2, app_user: 1 });
    const p6 = (await tdb.query(`select * from platform.audit_log where action = 'club.test_data_purged'`)).rows;
    expect(p6).toHaveLength(1);
    expect(p6[0]).toMatchObject({ club_id: A, staff_name_at_time: 'Mali' });
    expect(p6[0].detail).toEqual(counts);
  });

  it('a club with no test rows purges nothing but still logs', async () => {
    const C = '5c5c5c5c-5c5c-45c5-85c5-5c5c5c5c5c5c';
    await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'c','ค','C','testing')`, [C]);
    const counts = await purge(C);
    expect(Object.values(counts).filter((n) => n !== 0)).toEqual([]);
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where action = 'go_live.purge' and club_id = $1`, [C])).rows[0].n).toBe(1);
  });
});

describe('the fence (SR-15)', () => {
  beforeEach(async () => {
    await tdb.query(`insert into public.t_ledger (club_id, amount) values ($1, 5)`, [A]);
    await tdb.query(`update public.club set status = 'live' where id = $1`, [B]);
    await tdb.query(`insert into public.t_ledger (club_id, amount) values ($1, 6)`, [B]); // a real row: is_test false
  });
  it('a non-test ledger row cannot be deleted by anyone, including the purge role', async () => {
    expect(await count('t_ledger', B, false)).toBe(1);
    for (const role of [null, 'booq_owner', 'booq_purge']) {
      const c = await tdb.pool.connect();
      try {
        await c.query('begin');
        if (role) await c.query(`set local role ${role}`);
        await c.query(`select set_config('app.club_id', $1, true)`, [B]);
        const out = await c.query('delete from public.t_ledger where club_id = $1', [B]).then((r) => `rows:${r.rowCount}`, (e: Error) => e.message);
        expect(out, String(role)).toMatch(/append-only|permission denied|rows:0/);
        await c.query('rollback');
      } finally {
        c.release();
      }
    }
    expect(await count('t_ledger', B, false)).toBe(1);
  });
  it('a test ledger row cannot be deleted outside the purge, whatever a session setting says', async () => {
    await expect(tdb.query('delete from public.t_ledger where is_test')).rejects.toThrow(/append-only/);
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_owner');
      await c.query(`select set_config('app.go_live_purge', 'on', true), set_config('app.club_id', $1, true)`, [A]);
      const out = await c.query('delete from public.t_ledger').then((r) => `rows:${r.rowCount}`, (e: Error) => e.message);
      expect(out).toMatch(/append-only|permission denied|rows:0/);
      await c.query('rollback');
    } finally {
      c.release();
    }
    expect(await count('t_ledger', A)).toBe(1);
  });
  it('audit entries and updates stay protected: the purge role cannot update or truncate, nor delete a non-test entry', async () => {
    for (const sql of ['update public.t_ledger set amount = 1', 'truncate public.t_ledger', 'update public.audit_entry set action = $$x$$', 'truncate public.audit_entry']) {
      const c = await tdb.pool.connect();
      try {
        await c.query('begin');
        await c.query('set local role booq_purge');
        await c.query(`select set_config('app.club_id', $1, true)`, [A]);
        const out = await c.query(sql).then((r) => `rows:${r.rowCount}`, (e: Error) => e.message);
        expect(out, sql).toMatch(/append-only|permission denied|rows:0/);
        await c.query('rollback');
      } finally {
        c.release();
      }
    }
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where club_id = $1 and not is_test`, [B])).rows[0].n).toBeGreaterThan(0);
  });
});

describe('who may run it, and when', () => {
  it('refuses unless the club is in Testing', async () => {
    for (const status of ['draft', 'live', 'paused']) {
      await tdb.query('update public.club set status = $2 where id = $1', [A, status]);
      await expect(purge(A), status).rejects.toThrow(/only while the club is in Testing/);
    }
  });
  it('refuses with no club in the context', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_owner');
      await expect(c.query('select app.go_live_purge()')).rejects.toThrow(/club in the context/);
      await c.query('rollback');
    } finally {
      c.release();
    }
  });
  it('is executable only by booq_owner (the Go live transition), not by the app roles or BOOQ staff', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'booq_audit', 'booq_anonymiser']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.go_live_purge()', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
    expect((await tdb.query(`select has_function_privilege('booq_owner', 'app.go_live_purge()', 'execute') as ok`)).rows[0].ok).toBe(true);
    expect((await tdb.query(`select pg_get_userbyid(proowner) as o from pg_proc where proname = 'go_live_purge'`)).rows[0].o).toBe('booq_purge');
  });
  it('a failed purge rolls everything back', async () => {
    await tdb.query(`insert into public.t_ledger (club_id, amount) values ($1, 5), ($1, 6)`, [A]);
    await tdb.query(`
      create table public.t_zz (club_id uuid not null references public.club (id), id uuid not null default gen_random_uuid(), is_test boolean not null default false, primary key (club_id, id));
      alter table public.t_zz enable row level security; alter table public.t_zz force row level security;
      create function public.t_zz_fail() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
      select app.register_test_table('public.t_zz', 2000);
      insert into public.t_zz (club_id) values ('${A}');
      create trigger t_zz_fail before delete on public.t_zz for each row execute function public.t_zz_fail();`);
    await expect(purge(A)).rejects.toThrow(/boom/);
    expect(await count('t_ledger', A, true)).toBe(2);
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where action = 'go_live.purge'`)).rows[0].n).toBe(0);
    expect((await tdb.query(`select count(*)::int as n from platform.audit_log`)).rows[0].n).toBe(0);
  });
});
