import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F01-T08 / migration 0041: the list of setting keys and the hold-time check
// (PLAT-05 settings, BOOK-03-AC3; design 10). The route-level registry is in packages/domain.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const USER = '11111111-2222-4333-8444-555555555555';

let tdb: TestDatabase;
let db: Db;
const put = (key: string, value: string) =>
  tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, $2, $3::jsonb) on conflict (club_id, key) do update set value = excluded.value`, [A, key, value]);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1, 'a', 'ก', 'A')`, [A]);
  db = createDb({ connectionString: tdb.url, max: 1 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('the list of setting keys', () => {
  it('holds the settings of design 10 and the sport label, and no key for the booking length', async () => {
    const keys = (await tdb.query(`select setting_key from app.setting_keys order by setting_key`)).rows.map((r) => r.setting_key);
    expect(keys).toEqual([
      'auto_slip_check', 'below_min_alert_minutes', 'birthday_discount', 'booking_window_days', 'cancel_window_hours', 'group_max_players', 'group_min_players',
      'hold_minutes', 'max_future_court_hours', 'package_expiry_reminder_days', 'package_qr_minutes', 'resource_label', 'rest_cap_hours',
      'vat_enabled', 'waitlist_claim_minutes', 'waitlist_no_offer_hours', 'wallet_expiry_months',
    ]);
    expect(keys.filter((k) => /length|duration|slot|booking_minutes/.test(k))).toEqual([]);
  });

  it('a club cannot hold a setting that is not on the list: no 60 minute key can exist', async () => {
    for (const k of ['booking_minutes', 'booking_length', 'slot_minutes', 'anything']) {
      await expect(put(k, '60'), k).rejects.toThrow(/foreign key|setting_keys/i);
    }
    expect((await tdb.query(`select count(*)::int as n from public.club_setting`)).rows[0].n).toBe(0);
  });

  it('every key the Tennis template seeds is on the list (the template and the list cannot drift apart)', async () => {
    const r = await tdb.query(`select i.key from platform.template_item i join platform.template t on t.id = i.template_id
                                where t.key = 'tennis' and i.kind = 'setting' and i.key not in (select setting_key from app.setting_keys)`);
    expect(r.rows).toEqual([]);
  });

  it('is written by migrations only', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform', 'anon', 'authenticated']) {
      const r = await tdb.query(`select has_table_privilege($1, 'app.setting_keys', 'insert,update,delete') as w`, [role]);
      expect(r.rows[0].w, role).toBe(false);
    }
  });
});

describe('hold time is 10, 15 or 20 minutes (BOOK-03-AC3)', () => {
  it('refuses anything else, in the table itself', async () => {
    for (const v of ['12', '5', '60', '0', '"15"', '15.5', 'null', 'true']) await expect(put('hold_minutes', v), v).rejects.toThrow(/club_setting_hold_minutes|check/i);
    for (const v of ['10', '15', '20']) await put('hold_minutes', v);
    expect((await tdb.query(`select value from public.club_setting where key = 'hold_minutes'`)).rows).toEqual([{ value: 20 }]);
  });

  it('is refused for the club owner writing straight to the table as well', async () => {
    await expect(db.withClubTx({ clubId: A, userId: USER, roles: ['owner'], source: 'admin' }, (tx) =>
      tx.query(`insert into public.club_setting (club_id, key, value) values ($1, 'hold_minutes', '12')`, [A]))).rejects.toThrow(/club_setting_hold_minutes|check/i);
  });
});
