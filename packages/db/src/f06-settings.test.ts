import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T12 (no migration): the two settings F06 reads exist in the database list (0041), the Tennis template gives the
// reminder days 14 and 3 and leaves the wallet expiry empty, and app.wallet_expire refuses while it is unset
// (PKG-03-AC1, AC10; D89, D116).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const P = '11111111-1111-4111-8111-111111111111';
let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
});
afterEach(async () => {
  await tdb.close();
});

describe('F06 settings', () => {
  it('both keys are known to the database', async () => {
    const keys = (await tdb.query(`select setting_key from app.setting_keys where setting_key in ('package_expiry_reminder_days', 'wallet_expiry_months') order by 1`)).rows.map((r) => r.setting_key);
    expect(keys).toEqual(['package_expiry_reminder_days', 'wallet_expiry_months']);
  });
  it('the Tennis template gives 14 and 3 days and leaves the wallet expiry empty', async () => {
    const r = (await tdb.query(`select i.key, i.value from platform.template_item i join platform.template t on t.id = i.template_id
                                 where t.key = 'tennis' and i.kind = 'setting' and i.key in ('package_expiry_reminder_days', 'wallet_expiry_months') order by 1`)).rows;
    expect(r).toEqual([{ key: 'package_expiry_reminder_days', value: [14, 3] }, { key: 'wallet_expiry_months', value: null }]);
  });
  it('wallet_expire refuses to run while wallet_expiry_months is unset', async () => {
    await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'L1')`, [A, P]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, P]);
      await c.query('commit');
      await c.query('begin');
      await c.query('set local role booq_owner');
      await c.query(`select set_config('app.club_id', $1, true)`, [A]);
      await expect(c.query('select app.wallet_expire($1)', [P])).rejects.toThrow(/wallet:expiry_not_set/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
