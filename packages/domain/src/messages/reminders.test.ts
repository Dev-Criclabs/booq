import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { SETTINGS } from '../club/settings-registry';
import { REMINDER_HOURS } from './reminders';

// F10-T07b: the reminder hours are product constants (PRD change log "Scope": reminders fixed at 24 h and 2 h before
// start; D116: settings in code, variables in the text). The code constant and the message catalogue agree, and the
// hours are not a club setting. LINE-05.
let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
});
afterEach(async () => {
  await tdb.close();
});

describe('REMINDER_HOURS', () => {
  it('is 24 and 2', () => {
    expect(REMINDER_HOURS).toEqual({ reminder_24h: 24, reminder_2h: 2 });
  });

  it('agrees with app.message_kinds, which enqueue_booking_reminders reads', async () => {
    const rows = (await tdb.query(`select kind, hours_before from app.message_kinds where hours_before is not null order by kind`)).rows;
    expect(Object.fromEntries(rows.map((r) => [r.kind, r.hours_before]))).toEqual(REMINDER_HOURS);
  });

  it('is not a club setting: not in the settings registry, not in app.setting_keys', async () => {
    expect(Object.keys(SETTINGS).filter((k) => /reminder_hour/.test(k))).toEqual([]);
    expect((await tdb.query(`select setting_key from app.setting_keys where setting_key like '%reminder_hour%'`)).rows).toEqual([]);
  });
});
