import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T07 / migration 0311: the F04 setting key (R5-AC1, AC4). The cancel window is F01's (0041).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A')`, [CLUB]);
});
afterEach(async () => {
  await tdb.close();
});

const put = (v: unknown) => tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'birthday_discount', $2::jsonb)`, [CLUB, JSON.stringify(v)]);

describe('birthday_discount (R5-AC1)', () => {
  it('is a registered key', async () => {
    expect((await tdb.query(`select 1 from app.setting_keys where setting_key = 'birthday_discount'`)).rowCount).toBe(1);
  });

  it('no club has a value until F14 sets one: Tennis does not carry it', async () => {
    const r = await tdb.query(`select 1 from platform.template_item where key = 'birthday_discount'`);
    expect(r.rowCount).toBe(0);
  });

  it('accepts percent (basis points up to 10000) and fixed satang', async () => {
    await put({ kind: 'percent', value: 1000 });
    expect((await tdb.query(`select value from public.club_setting where club_id = $1 and key = 'birthday_discount'`, [CLUB])).rows[0].value).toEqual({ kind: 'percent', value: 1000 });
  });

  it('refuses a malformed shape in the table itself', async () => {
    for (const v of [{ kind: 'percent', value: 10001 }, { kind: 'percent', value: -1 }, { kind: 'free', value: 1 }, { kind: 'fixed', value: 1.5 }, { kind: 'fixed' }, 10, 'x', { kind: 'fixed', value: 5, extra: 1 }]) {
      await expect(put(v), JSON.stringify(v)).rejects.toThrow(/birthday_discount/);
    }
  });
});
