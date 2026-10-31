import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01 / migration 0054 (QA-F01-2; ROLE-01-AC8; D115): who reads which club setting, in the database itself.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
let tdb: TestDatabase;
let db: Db;
const read = (clubId: string, roles: string[], userId = U(1)) =>
  db.withClubTx({ clubId, userId, roles: roles as never, source: 'admin' as const }, async (tx) => (await tx.query(`select key from public.club_setting order by key`)).rows.map((r) => r.key as string));

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'hold_minutes','15'), ($1,'cancel_window_hours','12'), ($1,'rest_cap_hours','6'), ($1,'vat_enabled','false'), ($2,'vat_enabled','true'), ($2,'hold_minutes','10')`, [A, B]);
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('club_setting read policy (D115)', () => {
  it('the accountant reads the business settings only', async () => {
    expect(await read(A, ['accountant', 'player'])).toEqual(['vat_enabled']);
  });
  it('the owner and front desk read every setting of their club', async () => {
    for (const roles of [['owner', 'player'], ['front_desk', 'player']]) expect(await read(A, roles), roles.join()).toEqual(['cancel_window_hours', 'hold_minutes', 'rest_cap_hours', 'vat_enabled']);
  });
  it('a coach and a player read none, and no one reads another club\'s', async () => {
    expect(await read(A, ['coach', 'player'])).toEqual([]);
    expect(await read(A, ['player'])).toEqual([]);
    expect(await read(B, ['accountant', 'player'])).toEqual(['vat_enabled']);
  });
  it('a key added later without a scope is a rules key: the accountant does not read it until it is marked business', async () => {
    await tdb.query(`insert into app.setting_keys (setting_key) values ('later_key')`);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'later_key', '1')`, [A]);
    expect(await read(A, ['accountant', 'player'])).toEqual(['vat_enabled']);
    await tdb.query(`update app.setting_keys set scope = 'business' where setting_key = 'later_key'`);
    expect(await read(A, ['accountant', 'player'])).toEqual(['later_key', 'vat_enabled']);
  });
  it('the accountant still cannot write a setting', async () => {
    await expect(db.withClubTx({ clubId: A, userId: U(1), roles: ['accountant', 'player'] as never, source: 'admin' as const }, (tx) => tx.query(`update public.club_setting set value = '20' where key = 'hold_minutes'`).then((r) => { if (r.rowCount === 0) throw new Error('no row'); }))).rejects.toThrow();
  });
});
