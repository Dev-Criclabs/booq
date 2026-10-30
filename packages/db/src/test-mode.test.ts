import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T26 / migration 0006: the is_test flag (PLAT-07-AC1; FA 2.6).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(
    `insert into public.club (id, slug, name_th, name_en, status) values ($1, 'club-a', 'ก', 'A', 'testing'), ($2, 'club-b', 'ข', 'B', 'live')`,
    [A, B],
  );
  await tdb.query(`
    create table public.t_event (club_id uuid not null references public.club (id), id uuid not null default gen_random_uuid(), is_test boolean not null default false, primary key (club_id, id));
    alter table public.t_event enable row level security; alter table public.t_event force row level security;
    select app.register_test_table('public.t_event', 10);`);
});
afterEach(async () => {
  await tdb.close();
});
const flag = async (club: string) => (await tdb.query('select is_test from public.t_event where club_id = $1', [club])).rows.map((r) => r.is_test);

describe('the is_test flag (PLAT-07-AC1)', () => {
  it('rows made while the club is Testing carry the flag; Live rows do not', async () => {
    await tdb.query('insert into public.t_event (club_id) values ($1), ($2)', [A, B]);
    expect(await flag(A)).toEqual([true]);
    expect(await flag(B)).toEqual([false]);
  });

  it('the status at insert time decides, not the status later', async () => {
    await tdb.query('insert into public.t_event (club_id) values ($1)', [A]);
    await tdb.query(`update public.club set status = 'live' where id = $1`, [A]);
    await tdb.query('insert into public.t_event (club_id) values ($1)', [A]);
    expect((await flag(A)).sort()).toEqual([false, true]);
  });

  it('a value supplied by the writer is overwritten', async () => {
    await tdb.query('insert into public.t_event (club_id, is_test) values ($1, false), ($2, true)', [A, B]);
    expect(await flag(A)).toEqual([true]);
    expect(await flag(B)).toEqual([false]);
  });

  it('the flag cannot be updated, either way', async () => {
    await tdb.query('insert into public.t_event (club_id) values ($1), ($2)', [A, B]);
    await expect(tdb.query(`update public.t_event set is_test = false where club_id = $1`, [A])).rejects.toThrow(/is_test cannot be changed/);
    await expect(tdb.query(`update public.t_event set is_test = true where club_id = $1`, [B])).rejects.toThrow(/is_test cannot be changed/);
  });

  it('the app role writes the flag too (the trigger reads the club past row security)', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('grant insert on public.t_event to booq_app');
      await c.query(`create policy t on public.t_event for all to booq_app using (club_id = app.club_id()) with check (club_id = app.club_id())`);
      await c.query('set local role booq_app');
      await c.query("select set_config('app.club_id', $1, true)", [A]);
      await c.query('insert into public.t_event (club_id) values ($1)', [A]);
      await c.query('rollback');
    } finally {
      c.release();
    }
  });
});

describe('registry and the CI check', () => {
  it('registration needs an is_test column', async () => {
    await tdb.query('create table public.t_plain (club_id uuid, id uuid)');
    await expect(tdb.query(`select app.register_test_table('public.t_plain', 1)`)).rejects.toThrow(/no is_test column/);
  });

  it('the check fails a table with an is_test column that is not registered, and passes once registered', async () => {
    await tdb.query(`
      create table public.t_other (club_id uuid not null references public.club (id), id uuid not null default gen_random_uuid(), is_test boolean not null default false, primary key (club_id, id));
      alter table public.t_other enable row level security; alter table public.t_other force row level security;`);
    const reg = { ...(await collectRegistry()), 'public.t_event': { class: 'D' as const }, 'public.t_other': { class: 'D' as const } };
    const bad = await checkTableClasses(tdb.pool, reg);
    expect(bad.problems.filter((p) => p.table !== 'app.test_clock')).toEqual([{ kind: 'is-test-not-registered', table: 'public.t_other' }]);
    await tdb.query(`select app.register_test_table('public.t_other', 20)`);
    expect((await checkTableClasses(tdb.pool, reg)).problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });

  it('the check fails a registered table whose trigger was dropped', async () => {
    await tdb.query('drop trigger is_test_set on public.t_event');
    const reg = { ...(await collectRegistry()), 'public.t_event': { class: 'D' as const } };
    const r = await checkTableClasses(tdb.pool, reg);
    expect(r.problems.map((p) => p.kind)).toContain('is-test-trigger-missing');
  });

  it('a table whose flag is set by explicit code (app_user, D100) needs no insert trigger', async () => {
    await tdb.query(`
      create table public.t_user (club_id uuid not null references public.club (id), id uuid not null default gen_random_uuid(), is_test boolean not null default false, primary key (club_id, id));
      alter table public.t_user enable row level security; alter table public.t_user force row level security;
      select app.register_test_table('public.t_user', 90, false);`);
    await tdb.query('insert into public.t_user (club_id) values ($1)', [A]);
    expect((await tdb.query('select is_test from public.t_user')).rows).toEqual([{ is_test: false }]);
    await expect(tdb.query('update public.t_user set is_test = true')).rejects.toThrow(/cannot be changed/);
  });
});
