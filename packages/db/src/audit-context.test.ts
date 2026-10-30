import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { collectRegistry } from './registry';
import { checkTableClasses } from './registry/check';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T11: audit context in withClubTx and withPlatformTx; the audited-table check;
// the staff note rule (PLAT-04-AC3, AC4, AC9).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const USER = '11111111-2222-4333-8444-555555555555';
const STAFF = '77777777-7777-4777-8777-777777777777';
const SESSION = '88888888-8888-4888-8888-888888888888';

let tdb: TestDatabase;
let db: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'club-a', 'ก', 'A')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});
const last = async () => (await tdb.query(`select * from public.audit_entry where record_type = 'club_setting' order by seq desc limit 1`)).rows[0] as Record<string, unknown>;

describe('withClubTx sets the audit context (PLAT-04-AC1)', () => {
  const ctx = { clubId: A, userId: USER, roles: ['owner'], requestId: 'req-9' };
  it('actor, label, source, reason and request id reach the entry', async () => {
    await db.withClubTx({ ...ctx, source: 'admin', actorLabel: 'Nok', reason: 'new price list' }, (tx) =>
      tx.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1')`, [A]),
    );
    expect(await last()).toMatchObject({ actor_type: 'club_user', actor_user_id: USER, actor_label: 'Nok', source: 'admin', reason: 'new price list', request_id: 'req-9' });
  });

  it('a club user with no source cannot change audited data (the change rolls back)', async () => {
    await expect(db.withClubTx(ctx, (tx) => tx.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1')`, [A]))).rejects.toThrow(/source/);
    expect((await tdb.query('select count(*)::int as n from public.club_setting')).rows[0].n).toBe(0);
  });

  it('a read needs no source', async () => {
    const r = await db.withClubTx(ctx, (tx) => tx.query('select 1 as one'));
    expect(r.rows[0]?.one).toBe(1);
  });

  it('a job (no user) is a system actor with the job name as label', async () => {
    await db.withClubTx({ clubId: A, userId: null, roles: [], source: 'job', actorLabel: 'hold-release' }, (tx) =>
      tx.query(`select audit.note('booking.released', 'club_setting', $1)`, [A]),
    );
    expect((await tdb.query(`select * from public.audit_entry where action = 'booking.released'`)).rows[0]).toMatchObject({ actor_type: 'system', source: 'job', actor_label: 'hold-release' });
  });

  it('the settings do not leak to the next transaction on the same connection', async () => {
    await db.withClubTx({ ...ctx, source: 'admin', reason: 'x' }, (tx) => tx.query('select 1'));
    const r = await db.withClubTx({ clubId: A, userId: null, roles: [] }, (tx) =>
      tx.query("select current_setting('app.source', true) as s, current_setting('app.reason', true) as r, current_setting('app.actor_label', true) as l"),
    );
    expect(r.rows[0]).toEqual({ s: '', r: '', l: '' });
  });

  it('rejects a source or support session it does not know', async () => {
    await expect(db.withClubTx({ ...ctx, source: 'cli' as never }, (tx) => tx.query('select 1'))).rejects.toThrow(/source/);
  });
});

describe('a platform edit names the BOOQ staff member (PLAT-04-AC4)', () => {
  // withPlatformTx lives in platform-tx.ts (F01-T18, platform lane). Here the same transaction
  // settings are set by hand to prove what the audit writer does with them.
  beforeEach(async () => {
    await tdb.query(`
      grant select, insert, update on public.club_setting to booq_platform;
      create policy t_platform on public.club_setting for all to booq_platform using (club_id = app.club_id()) with check (club_id = app.club_id());`);
  });
  const asStaff = async (settings: Record<string, string>) => {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_platform');
      for (const [k, v] of Object.entries({ 'app.club_id': A, ...settings })) await c.query('select set_config($1, $2, true)', [k, v]);
      await c.query(`insert into public.club_setting (club_id, key, value) values ($1, 'k', '1')`, [A]);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  };
  it('the entry is the staff member, with the support session and reason', async () => {
    await asStaff({ 'app.actor_platform_staff_id': STAFF, 'app.actor_label': 'BOOQ staff: Mali', 'app.support_session_id': SESSION, 'app.reason': 'setup help' });
    expect(await last()).toMatchObject({
      actor_type: 'platform_staff', actor_platform_staff_id: STAFF, actor_user_id: null, actor_label: 'BOOQ staff: Mali', support_session_id: SESSION, source: 'platform', reason: 'setup help',
    });
  });
  it('a club-user source cannot be claimed by a platform transaction', async () => {
    await asStaff({ 'app.actor_platform_staff_id': STAFF, 'app.actor_label': 'x', 'app.source': 'player_app' });
    expect(await last()).toMatchObject({ source: 'platform', actor_type: 'platform_staff' });
  });
});

describe('a staff ledger movement needs a written reason (PLAT-04-AC3)', () => {
  it('the CHECK form every ledger uses refuses a staff movement with no note', async () => {
    await tdb.query(`
      create table public.t_ledger (
        club_id uuid not null references public.club (id), id uuid not null default gen_random_uuid(),
        by_staff boolean not null, amount integer not null, note text,
        primary key (club_id, id),
        constraint staff_movement_needs_note check (not by_staff or nullif(btrim(note), '') is not null)
      )`);
    const ins = (staff: boolean, note: string | null) => tdb.query('insert into public.t_ledger (club_id, by_staff, amount, note) values ($1, $2, 5, $3)', [A, staff, note]);
    await expect(ins(true, null)).rejects.toThrow(/staff_movement_needs_note/);
    await expect(ins(true, '   ')).rejects.toThrow(/staff_movement_needs_note/);
    await ins(true, 'goodwill');
    await ins(false, null); // a system movement (a purchase) needs no note
  });
});

describe('the audited-table check (FA 4.5)', () => {
  const declared = async () => {
    const reg = await collectRegistry();
    return reg;
  };
  it('passes for the migrations as they are', async () => {
    const r = await checkTableClasses(tdb.pool, await declared());
    expect(r.problems.filter((p) => p.table !== 'app.test_clock')).toEqual([]);
  });
  it('fails an audited table whose trigger is missing', async () => {
    await tdb.query('drop trigger audit_row on public.club_setting');
    const r = await checkTableClasses(tdb.pool, await declared());
    expect(r.problems.filter((p) => p.table !== 'app.test_clock')).toEqual([{ kind: 'audit-trigger-missing', table: 'public.club_setting' }]);
  });
  it('fails a table the registry says is audited but audit.registry does not list', async () => {
    const reg = await declared();
    reg['public.club_feature'] = { ...reg['public.club_feature']!, audited: true };
    await tdb.query(`delete from audit.registry where table_name = 'club_feature'`);
    const r = await checkTableClasses(tdb.pool, reg);
    expect(r.problems.filter((p) => p.table !== 'app.test_clock').map((p) => p.kind)).toContain('audit-trigger-missing');
  });
  it('fails an audited table that the TypeScript registry does not declare audited', async () => {
    const reg = await declared();
    reg['public.club_setting'] = { class: 'S' };
    const r = await checkTableClasses(tdb.pool, reg);
    expect(r.problems.filter((p) => p.table !== 'app.test_clock')).toEqual([{ kind: 'audit-undeclared', table: 'public.club_setting' }]);
  });
});
