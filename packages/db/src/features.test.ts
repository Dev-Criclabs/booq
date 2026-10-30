import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T25 / migration 0038: feature switches (PLAT-05-AC1 to AC6; design A-1).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';

let tdb: TestDatabase;
let db: Db;
const ctx = (clubId: string, roles = ['player']) => ({ clubId, userId: USER, roles, source: 'admin' as const });
const has = (club: string, key: string, roles?: string[]) =>
  db.withClubTx(ctx(club, roles), async (tx) => (await tx.query(`select app.has_feature($1) as ok`, [key])).rows[0]?.ok as boolean);
const setFeature = (club: string, key: string, enabled: boolean) =>
  tdb.query(`insert into public.club_feature (club_id, feature_key, enabled) values ($1, $2, $3) on conflict (club_id, feature_key) do update set enabled = excluded.enabled`, [club, key, enabled]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, payment_option) values ($1, 'a', 'ก', 'A', 'slip'), ($2, 'b', 'ข', 'B', 'beam')`, [A, B]);
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('the list of switches (PLAT-05-AC6)', () => {
  it('holds only the switches the spec names (design A-1)', async () => {
    const r = await tdb.query(`select feature_key, requires_payment_option from app.feature_keys order by feature_key`);
    expect(r.rows).toEqual([
      { feature_key: 'backup_mode', requires_payment_option: 'slip' },
      { feature_key: 'coach_add_at_checkout', requires_payment_option: null },
      { feature_key: 'slip_checking', requires_payment_option: 'slip' },
    ]);
  });

  it('a club cannot hold a switch that is not on the list', async () => {
    await expect(setFeature(A, 'gift_vouchers', true)).rejects.toThrow(/foreign key|feature_keys/i);
  });

  it('the list is writable by nobody but the owner role', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'anon', 'authenticated']) {
      const r = await tdb.query(`select has_table_privilege($1, 'app.feature_keys', 'insert,update,delete') as w`, [role]);
      expect(r.rows[0].w, role).toBe(false);
    }
  });
});

describe('app.has_feature (PLAT-05-AC1, AC2, AC4)', () => {
  it('is off by default, and a switch set on one club changes that club only', async () => {
    expect(await has(A, 'coach_add_at_checkout')).toBe(false);
    await setFeature(A, 'coach_add_at_checkout', true);
    expect(await has(A, 'coach_add_at_checkout')).toBe(true);
    expect(await has(B, 'coach_add_at_checkout')).toBe(false);
    await setFeature(B, 'coach_add_at_checkout', true);
    await setFeature(A, 'coach_add_at_checkout', false);
    expect(await has(A, 'coach_add_at_checkout')).toBe(false);
    expect(await has(B, 'coach_add_at_checkout')).toBe(true);
  });

  it('answers for the context club only: it takes no club argument', async () => {
    await setFeature(B, 'coach_add_at_checkout', true);
    expect(await has(A, 'coach_add_at_checkout')).toBe(false);
    const a = await tdb.query(`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'has_feature'`);
    expect(a.rows).toEqual([{ args: 'p_key text' }]);
    await expect(tdb.query(`select app.has_feature('coach_add_at_checkout')`)).resolves.toMatchObject({ rows: [{ has_feature: false }] }); // no context: off
  });

  it('slip checking and backup mode exist only when the club chose slip checking (PLAT-05-AC4)', async () => {
    for (const club of [A, B]) {
      await setFeature(club, 'slip_checking', true);
      await setFeature(club, 'backup_mode', true);
    }
    expect(await has(A, 'slip_checking')).toBe(true);
    expect(await has(A, 'backup_mode')).toBe(true);
    expect(await has(B, 'slip_checking')).toBe(false);  // Beam club: switched on, but it does not exist for it
    expect(await has(B, 'backup_mode')).toBe(false);
    await tdb.query(`update public.club set payment_option = 'beam' where id = $1`, [A]);
    expect(await has(A, 'slip_checking')).toBe(false);
  });

  it('an unknown key is off, for every role', async () => {
    expect(await has(A, 'gift_vouchers')).toBe(false);
    for (const roles of [['owner'], ['accountant'], ['guest'], ['player']]) expect(await has(A, 'coach_add_at_checkout', roles)).toBe(false);
  });

  it('is invoker: another club\'s switch is invisible even when asked about directly', async () => {
    await setFeature(B, 'coach_add_at_checkout', true);
    const r = await db.withClubTx(ctx(A), (tx) => tx.query(`select feature_key from public.club_feature`));
    expect(r.rows).toEqual([]);
  });
});

describe('every change is audited (PLAT-05-AC3)', () => {
  it('a switch change writes an audit entry with old and new value', async () => {
    await setFeature(A, 'coach_add_at_checkout', true);
    await setFeature(A, 'coach_add_at_checkout', false);
    const r = await tdb.query(`select action, old_value, new_value from public.audit_entry where club_id = $1 and record_type = 'club_feature' order by occurred_at, id`, [A]);
    expect(r.rows.map((x) => x.action)).toEqual(['insert', 'update']);
    expect(JSON.stringify(r.rows[1])).toContain('false');
  });
});
