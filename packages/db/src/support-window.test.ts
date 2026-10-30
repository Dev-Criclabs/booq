import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T19 / migration 0031: the owner's window (PLAT-02-AC4, AC5; review SR-02).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';

let tdb: TestDatabase;
let db: Db;
const ctx = (clubId: string, roles: string[]) => ({ clubId, userId: USER, roles, requestId: 'r1', source: 'admin' as const });
const setWindow = (clubId: string, roles: string[], on: boolean) =>
  db.withClubTx(ctx(clubId, roles), (tx) => tx.query(`select app.set_support_window($1) as until`, [on]));
const windowOf = async (club: string) =>
  (await tdb.query(`select allow_booq_changes_until as until, allow_booq_changes_set_at as set_at from public.club where id = $1`, [club])).rows[0];

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, 'a', 'ก', 'A', 'live'), ($2, 'b', 'ข', 'B', 'live')`, [A, B]);
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('app.set_support_window', () => {
  it('on opens 24 hours from now and returns the end; off closes at once', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    const r = await setWindow(A, ['owner', 'player'], true);
    expect(new Date(r.rows[0]?.until).toISOString()).toBe('2026-12-30T03:00:00.000Z');
    const w = await windowOf(A);
    expect(new Date(w.set_at).toISOString()).toBe('2026-12-29T03:00:00.000Z');
    await tdb.advance('2 hours');
    const off = await setWindow(A, ['owner', 'player'], false);
    expect(off.rows[0]?.until).toBeNull();
    expect(await windowOf(A)).toEqual({ until: null, set_at: null });
  });

  it('turning it on again restarts the 24 hours from now, never longer', async () => {
    await tdb.setNow('2026-12-29T03:00:00Z');
    await setWindow(A, ['owner'], true);
    await tdb.advance('10 hours');
    await setWindow(A, ['owner'], true);
    const w = await windowOf(A);
    expect(new Date(w.until).toISOString()).toBe('2026-12-30T13:00:00.000Z');
    expect(new Date(w.until).getTime() - new Date(w.set_at).getTime()).toBe(24 * 3600_000);
  });

  it('only the owner role may call it; every other role is refused and nothing changes', async () => {
    for (const roles of [['player'], ['front_desk', 'player'], ['accountant', 'player'], ['coach', 'player'], []]) {
      await expect(setWindow(A, roles, true), roles.join()).rejects.toThrow(/owner/i);
    }
    expect((await windowOf(A)).until).toBeNull();
  });

  it('changes the caller\'s own club only: the club is never an argument', async () => {
    await setWindow(A, ['owner'], true);
    expect((await windowOf(B)).until).toBeNull();
    const args = await tdb.query(`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'set_support_window'`);
    expect(args.rows).toEqual([{ args: 'p_on boolean' }]);
  });

  it('writes a named entry in the club audit log for each change (the row change itself is audited by the table trigger)', async () => {
    await setWindow(A, ['owner'], true);
    await setWindow(A, ['owner'], false);
    const r = await tdb.query(`select action, actor_type, reason from public.audit_entry where club_id = $1 and action like 'support_window.%' order by occurred_at, id`, [A]);
    expect(r.rows.map((x) => x.action)).toEqual(['support_window.on', 'support_window.off']);
    expect(r.rows[0].actor_type).toBe('club_user');
  });

  it('the app role cannot write the window columns any other way, and the platform role cannot call the function', async () => {
    await expect(db.withClubTx(ctx(A, ['owner']), (tx) => tx.query(`update public.club set allow_booq_changes_until = app.now() + interval '1 hour'`))).rejects.toThrow(/permission denied/i);
    const r = await tdb.query(`select has_function_privilege('booq_platform', 'app.set_support_window(boolean)', 'execute') as ok, has_function_privilege('anon', 'app.set_support_window(boolean)', 'execute') as anon`);
    expect(r.rows[0]).toEqual({ ok: false, anon: false });
  });

  it('refuses a null argument: only an explicit true or false changes the window (review T19 C2)', async () => {
    await setWindow(A, ['owner'], true);
    const before = await windowOf(A);
    await expect(db.withClubTx(ctx(A, ['owner']), (tx) => tx.query(`select app.set_support_window(null)`))).rejects.toThrow(/true or false/i);
    expect(await windowOf(A)).toEqual(before);
    expect((await tdb.query(`select count(*)::int as n from public.audit_entry where action = 'support_window.off'`)).rows[0].n).toBe(0);
  });

  it('does not make up a source: a caller that sets none is refused by the audit writer (review T19 C1)', async () => {
    await expect(
      db.withClubTx({ clubId: A, userId: USER, roles: ['owner'] }, (tx) => tx.query(`select app.set_support_window(true)`)),
    ).rejects.toThrow(/app\.source/);
    expect((await windowOf(A)).until).toBeNull();
  });

  it('with no club in the context it fails', async () => {
    await expect(tdb.query(`select app.set_support_window(true)`)).rejects.toThrow();
  });
});
