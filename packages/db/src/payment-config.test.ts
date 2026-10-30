import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F05-T03b / migration 0409: platform config rows with no value (PAY-02-AC2, decisions D73, D80).
// A JSON null means "not configured": the feature that needs it refuses; no number is chosen here.
let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
});
afterEach(async () => {
  await tdb.close();
});

const KEYS = ['beam_reconcile_age_seconds', 'beam_reconcile_interval_seconds', 'qr_expiry_margin_seconds'];

describe('the Beam platform config keys', () => {
  it('exist with a null value, so they read as not configured', async () => {
    const r = await tdb.query(`select key, value from platform.config where key = any($1) order by key`, [KEYS]);
    expect(r.rows).toEqual(KEYS.map((key) => ({ key, value: null })));
  });

  it('carry no number: nothing in the database or the code picks a margin or an interval', async () => {
    const r = await tdb.query(`select count(*)::int as n from platform.config where key = any($1) and jsonb_typeof(value) <> 'null'`, [KEYS]);
    expect(r.rows[0].n).toBe(0);
  });

  it('keep an admin’s value when the migration is replayed', async () => {
    await tdb.query(`update platform.config set value = '45'::jsonb where key = 'qr_expiry_margin_seconds'`);
    await tdb.query(`insert into platform.config (key, value) values ('qr_expiry_margin_seconds', 'null'::jsonb) on conflict (key) do nothing`);
    expect((await tdb.query(`select value from platform.config where key = 'qr_expiry_margin_seconds'`)).rows[0].value).toBe(45);
  });
});
