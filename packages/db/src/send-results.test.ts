import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F10-T09 follow-up / migration 0610: the sender's retry values are platform config with no default (0609, A-3);
// BOOQ sets them before the 7 Dec test; the check line_send_retry_set says whether they are set, like the Pay tap
// limit (orchestrator, 30 Oct).
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','testing')`, [CLUB]);
});
afterEach(async () => {
  await tdb.close();
});
const result = async () => (await tdb.query(`select app.launch_result($1, 'line_send_retry_set') as r`, [CLUB])).rows[0].r as string;
const set = (key: string, value: string) => tdb.query(`update platform.config set value = $2::jsonb where key = $1`, [key, value]);

describe('line_send_retry_set', () => {
  it('is pending until both values are positive numbers; nothing is invented', async () => {
    expect(await result()).toBe('pending');
    await set('line_send_max_attempts', '5');
    expect(await result()).toBe('pending');
    await set('line_send_retry_seconds', '0');
    expect(await result()).toBe('pending');
    await set('line_send_retry_seconds', '60');
    expect(await result()).toBe('pass');
    await set('line_send_max_attempts', 'null');
    expect(await result()).toBe('pending');
  });


  it('has a producer, so the key can be put on the Go live list (it is not added here)', async () => {
    expect((await tdb.query(`select kind, task from app.launch_producers where check_key = 'line_send_retry_set'`)).rows[0]).toEqual({ kind: 'derived', task: 'F10-T09 platform config' });
  });
});
