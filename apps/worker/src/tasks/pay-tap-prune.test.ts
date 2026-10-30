import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { DEFAULT_JOB_SPEC } from '../policy';
import { clubTask } from '../task-wrapper';
import { PAY_TAP_PRUNE, payTapPruneDispatch, prunePayTaps } from './pay-tap-prune';

// F03-T12 housekeeping (D61; F03 design 4.8): the Pay tap attempts that have left the limit's window are
// dropped, one job per club, each in its own club context (app.prune_pay_taps reads the context club only).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const U = '11111111-1111-4111-8111-111111111111';
let tdb: TestDatabase;
let db: Db;
const count = async (club: string) => (await tdb.query('select count(*)::int n from public.pay_tap where club_id = $1', [club])).rows[0].n as number;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T03:00:00Z');
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  await tdb.query(`insert into platform.config (key, value) values ('pay_tap_limit_count', '5'), ('pay_tap_limit_window_seconds', '60') on conflict (key) do update set value = excluded.value`);
  for (const club of [A, B]) {
    await tdb.query(`insert into public.pay_tap (club_id, user_id, at) values ($1,$2,'2026-12-01T02:58:00Z'), ($1,$2,'2026-12-01T02:59:30Z')`, [club, U]);
  }
  db = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('pay tap prune (F03-T12)', () => {
  it("drops only this club's attempts that have left the window", async () => {
    await clubTask(db, prunePayTaps, { actorLabel: PAY_TAP_PRUNE })({ clubId: A }, {});
    expect(await count(A)).toBe(1);
    expect(await count(B)).toBe(2);   // club B is pruned by its own job
  });

  it('is repeatable: a second run finds nothing more', async () => {
    const run = clubTask(db, prunePayTaps, { actorLabel: PAY_TAP_PRUNE });
    await run({ clubId: A }, {});
    await run({ clubId: A }, {});
    expect(await count(A)).toBe(1);
  });

  it('the dispatch adds one prune per club with the default retry spec and a key per club, skipping anything that is not a club id', async () => {
    const added: { task: string; payload: unknown; spec: unknown }[] = [];
    const task = payTapPruneDispatch({ listClubIds: async () => [A, 'not-a-uuid', B, A] });
    await task({}, { addJob: async (t: string, payload: unknown, spec: unknown) => void added.push({ task: t, payload, spec }) } as never);
    expect(added).toEqual([
      { task: PAY_TAP_PRUNE, payload: { clubId: A }, spec: { ...DEFAULT_JOB_SPEC, jobKey: `${PAY_TAP_PRUNE}:${A}` } },
      { task: PAY_TAP_PRUNE, payload: { clubId: B }, spec: { ...DEFAULT_JOB_SPEC, jobKey: `${PAY_TAP_PRUNE}:${B}` } },
    ]);
  });
});
