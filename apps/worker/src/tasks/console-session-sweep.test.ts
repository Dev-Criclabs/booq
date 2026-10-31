import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { consoleSessionSweep } from './console-session-sweep';
import { closeTestDatabase } from '../testing/teardown';

// The sweep removes expired challenges, sessions past the absolute limit and empty login states, and nothing else.
let tdb: TestDatabase;
let worker: Db;
let staff: string;
const hash = (c: string) => c.repeat(64);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.setNow('2026-12-01T12:00:00Z');
  staff = (await tdb.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values ('99999999-0000-4000-8000-000000000001','a@booq.example','Ada','platform_admin') returning id`)).rows[0].id;
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await worker.end();
  await closeTestDatabase(tdb);
});

describe('console_session_sweep', () => {
  it('removes what is expired and keeps what is live', async () => {
    await tdb.query(`insert into platform.console_session (id_hash, staff_id, created_at, last_seen_at, step_up_at) values
      ($2,$1, app.now() - interval '9 hours', app.now(), app.now()), ($3,$1, app.now() - interval '1 hour', app.now(), app.now())`, [staff, hash('a'), hash('b')]);
    await tdb.query(`insert into platform.console_challenge (id_hash, staff_id, expires_at) values ($2,$1, app.now() - interval '1 minute'), ($3,$1, app.now() + interval '4 minutes')`, [staff, hash('c'), hash('d')]);
    await tdb.query(`insert into platform.console_login_state (staff_id, failures, locked_until) values ($1, 0, null)`, [staff]);
    expect(await consoleSessionSweep({ db: worker, absoluteSeconds: 8 * 3600 })()).toBe(3);
    expect((await tdb.query('select id_hash from platform.console_session')).rows).toEqual([{ id_hash: hash('b') }]);
    expect((await tdb.query('select id_hash from platform.console_challenge')).rows).toEqual([{ id_hash: hash('d') }]);
  });
  it('also removes staff enrolment links that expired or were used longer ago than the limit, and keeps the rest', async () => {
    const link = (h: string, expires: string, used: string | null) =>
      tdb.query(`insert into platform.staff_enrolment (token_hash, staff_id, purpose, created_by, expires_at, used_at) values ($1,$2,'invite',$2, app.now() + $3::interval, case when $4::text is null then null else app.now() + $4::interval end)`, [hash(h), staff, expires, used]);
    await link('a', '-9 hours', null); // expired long ago
    await link('b', '1 hour', '-9 hours'); // used long ago
    await link('c', '-30 minutes', null); // expired recently
    await link('d', '12 hours', null); // still live
    await link('e', '12 hours', '-1 hour'); // used recently
    expect(await consoleSessionSweep({ db: worker, absoluteSeconds: 8 * 3600 })()).toBe(2);
    expect((await tdb.query('select token_hash from platform.staff_enrolment order by token_hash')).rows.map((r) => r.token_hash)).toEqual([hash('c'), hash('d'), hash('e')]);
  });
  it('keeps a login state that holds failures or a lock', async () => {
    await tdb.query(`insert into platform.console_login_state (staff_id, failures, locked_until) values ($1, 3, null)`, [staff]);
    expect(await consoleSessionSweep({ db: worker, absoluteSeconds: 3600 })()).toBe(0);
    await tdb.query(`update platform.console_login_state set failures = 0, locked_until = app.now() + interval '10 minutes'`);
    expect(await consoleSessionSweep({ db: worker, absoluteSeconds: 3600 })()).toBe(0);
  });
  it('refuses a limit that is not a whole number above zero', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => consoleSessionSweep({ db: worker, absoluteSeconds: bad })).toThrow(/absoluteSeconds/);
  });
});
