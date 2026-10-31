// F06 acceptance criteria with no existing test: written by QA in the F06 sweep.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';
import { repoRoot } from './spec-ids';

let tdb: TestDatabase;
beforeAll(async () => {
  tdb = await createTestDatabase();
});
afterAll(async () => tdb.close());

const expiry = async (date: string, months: number) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' }).format(
    new Date((await tdb.query(`select app.package_expiry($1::date, $2::int) as e`, [date, months])).rows[0]!.e as Date),
  );

describe('F06/PKG-02-AC3', () => {
  it('F06/PKG-02-AC3 expiry is the purchase date plus the validity in calendar months, at 23:59 Bangkok (the canvas "9 Apr" is wrong)', async () => {
    expect(await expiry('2027-01-05', 3)).toBe('2027-04-05 23:59:59'); // the 10 hour bundle bought 5 Jan (Gaps B5)
    expect(await expiry('2026-12-29', 3)).toBe('2027-03-29 23:59:59'); // across the year end
    expect(await expiry('2026-11-30', 3)).toBe('2027-02-28 23:59:59'); // the day does not exist: last day of the month (D20)
    expect(await expiry('2026-10-31', 5)).toBe('2027-03-31 23:59:59'); // the 20 hour bundle, 5 months
    expect(await expiry('2027-08-31', 3)).toBe('2027-11-30 23:59:59');
  });
});

describe('F06/R3-AC10', () => {
  it('F06/R3-AC10 the reminder days are named variables or settings, never typed into a message text', () => {
    const pending = JSON.parse(readFileSync(resolve(repoRoot(), 'locales', 'pending', 'f10.json'), 'utf8')) as Record<string, unknown>;
    const found: Array<[string, string]> = [];
    const walk = (n: unknown) => {
      if (n && typeof n === 'object') for (const [k, v] of Object.entries(n as Record<string, unknown>)) typeof v === 'string' && k.startsWith('L-new.msg_package_expiring') ? found.push([k, v]) : walk(v);
    };
    walk(pending);
    expect(found.length).toBeGreaterThanOrEqual(4); // title and body, both languages
    for (const [k, t] of found) expect(t, k).not.toMatch(/\b(14|3|fourteen|three)\b/i);
    expect(found.some(([, t]) => t.includes('{dayMonthYear}')), 'the date is a variable').toBe(true);
  });

  it('F06/R3-AC10 the reminder days are a club setting the database accepts (package_expiry_reminder_days), and an unknown setting is refused', async () => {
    const club = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
    await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1, 'a', 'ก', 'A', 'live')`, [club]);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'package_expiry_reminder_days', '[14, 3]')`, [club]);
    const stored = (await tdb.query(`select value from public.club_setting where club_id = $1 and key = 'package_expiry_reminder_days'`, [club])).rows[0]!.value;
    expect(stored).toEqual([14, 3]);
    await expect(tdb.query(`insert into public.club_setting (club_id, key, value) values ($1, 'package_reminder_days_typo', '[1]')`, [club])).rejects.toBeTruthy();
  });
});
