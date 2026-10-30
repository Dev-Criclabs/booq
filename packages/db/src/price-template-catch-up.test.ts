import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformDb, type PlatformDb } from './platform-tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F04-T06 follow-up / migration 0312: clubs started from Tennis before the F04 handlers existed get their
// groups, court prices and add-on when the handlers are registered (migration 0043's catch-up).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
let tdb: TestDatabase;
let pdb: PlatformDb;
let admin: string;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A')`, [CLUB]);
  admin = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000001', 'admin@booq.example', 'Ada', 'platform_admin') returning id`)).rows[0].id;
  pdb = createPlatformDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await pdb.end();
  await tdb.close();
});

const count = async (t: string) => (await tdb.query(`select count(*)::int as n from public.${t} where club_id = $1`, [CLUB])).rows[0].n as number;

describe('the catch-up for the F04 template kinds', () => {
  it('copies the missing groups, court prices and add-on, in that order, for a club started before the handlers', async () => {
    const tpl = (await tdb.query(`select id from platform.template where key = 'tennis'`)).rows[0].id;
    await pdb.withPlatformTx({ staffId: admin, staffLabel: 'Staff', clubId: CLUB }, async (tx) => tx.query(`select app.apply_template($1)`, [tpl]));
    // Put the club back to how it was before the handlers: nothing copied for the F04 kinds.
    await tdb.query(`delete from public.court_price_rule where club_id = $1`, [CLUB]);
    await tdb.query(`delete from public.price_group where club_id = $1`, [CLUB]);
    await tdb.query(`delete from public.add_on where club_id = $1`, [CLUB]);
    await tdb.query(`delete from public.club_template_copy where club_id = $1 and kind in ('age_band', 'price', 'add_on', 'coach_tier')`, [CLUB]);
    expect(await count('price_group')).toBe(0);
    const order: [string, number][] = [];
    for (const kind of ['age_band', 'price', 'coach_tier', 'add_on']) {
      order.push([kind, (await tdb.query(`select app.catch_up_template_handler($1) as n`, [kind])).rows[0].n]);
    }
    expect(order).toEqual([['age_band', 2], ['price', 1], ['coach_tier', 0], ['add_on', 1]]);
    expect(await count('price_group')).toBe(2);
    expect(await count('court_price_rule')).toBe(2);
    expect(await count('add_on')).toBe(1);
  });

  it('a second catch-up copies nothing more', async () => {
    const tpl = (await tdb.query(`select id from platform.template where key = 'tennis'`)).rows[0].id;
    await pdb.withPlatformTx({ staffId: admin, staffLabel: 'Staff', clubId: CLUB }, async (tx) => tx.query(`select app.apply_template($1)`, [tpl]));
    for (const kind of ['age_band', 'price', 'coach_tier', 'add_on']) {
      expect((await tdb.query(`select app.catch_up_template_handler($1) as n`, [kind])).rows[0].n, kind).toBe(0);
    }
    expect(await count('price_group')).toBe(2);
  });

  it('migration 0312 calls the catch-up for each kind, groups before prices', () => {
    const sql = readFileSync(join(__dirname, '../migrations/0312_price_template_catch_up.sql'), 'utf8');
    const calls = [...sql.matchAll(/app\.catch_up_template_handler\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(calls).toEqual(['age_band', 'price', 'coach_tier', 'add_on']);
  });
});
