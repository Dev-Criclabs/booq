import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F09-T03 / migration 1003: the registry app.cancel_handlers (CANCEL-01-AC13, AC17, AC19; F09 design 4.3).
// Same pattern as F03's app.release_handlers: each feature registers its own handler from its migration
// (F07 at 20, F08 at 30, F14 at 40), and app.run_cancel_handlers calls them as handler(club, booking, kind)
// in ord order inside the cancel transaction (F09-T06b calls it). A handler failure rolls the cancel back.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const BOOKING = 'b0b0b0b0-0000-4000-8000-000000000001';

let tdb: TestDatabase;

/** Runs statements in one transaction as the database owner role, the way cancel_booking (definer) will. */
async function inTx(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>) => Promise<void>) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    await fn((sql, p) => c.query(sql, p as unknown[]));
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const calls = async () => (await tdb.query('select name, club_id, booking_id, kind from public.t_cancel_calls order by n')).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`create table public.t_cancel_calls (n serial, name text, club_id uuid, booking_id uuid, kind text)`);
  await tdb.query(`grant all on public.t_cancel_calls, public.t_cancel_calls_n_seq to booq_owner`);
  for (const name of ['f07', 'f08']) {
    await tdb.query(`create function public.t_${name}(p_club uuid, p_booking uuid, p_kind text) returns void language sql
                     as $$ insert into public.t_cancel_calls (name, club_id, booking_id, kind) values ('${name}', $1, $2, $3) $$`);
  }
  await tdb.query(`create function public.t_fail(p_club uuid, p_booking uuid, p_kind text) returns void language plpgsql
                   as $$ begin raise exception 'handler failed' using errcode = 'P0001'; end $$`);
  await tdb.query(`create table public.t_cancel_effect (booking_id uuid)`);
  await tdb.query(`grant all on public.t_cancel_effect to booq_owner`);
});
afterEach(async () => {
  await tdb.close();
});

describe('app.cancel_handlers (F09 design 4.3)', () => {
  it('runs the registered handlers in ord order with (club, booking, kind), inside the caller\'s transaction', async () => {
    await tdb.query(`select app.register_cancel_handler('f08', 'public.t_f08(uuid, uuid, text)'::regprocedure, 30)`);
    await tdb.query(`select app.register_cancel_handler('f07', 'public.t_f07(uuid, uuid, text)'::regprocedure, 20)`);
    await inTx(async (q) => {
      await q('insert into public.t_cancel_effect values ($1)', [BOOKING]);
      await q(`select app.run_cancel_handlers($1, 'player_cancel')`, [BOOKING]);
      // The handlers ran in this transaction: their rows are visible before commit.
      expect((await q('select name from public.t_cancel_calls order by n')).rows.map((r) => r.name)).toEqual(['f07', 'f08']);
    });
    expect(await calls()).toEqual([
      { name: 'f07', club_id: A, booking_id: BOOKING, kind: 'player_cancel' },
      { name: 'f08', club_id: A, booking_id: BOOKING, kind: 'player_cancel' },
    ]);
  });

  it('with nothing registered the run does nothing; an unregistered handler is simply absent', async () => {
    await inTx(async (q) => void (await q(`select app.run_cancel_handlers($1, 'staff_cancel')`, [BOOKING])));
    expect(await calls()).toEqual([]);
  });

  it('a handler failure rolls the whole cancel back, including what ran before it', async () => {
    await tdb.query(`select app.register_cancel_handler('f07', 'public.t_f07(uuid, uuid, text)'::regprocedure, 20)`);
    await tdb.query(`select app.register_cancel_handler('broken', 'public.t_fail(uuid, uuid, text)'::regprocedure, 30)`);
    await expect(inTx(async (q) => {
      await q('insert into public.t_cancel_effect values ($1)', [BOOKING]);
      await q(`select app.run_cancel_handlers($1, 'player_cancel')`, [BOOKING]);
    })).rejects.toThrow(/handler failed/);
    expect(await calls()).toEqual([]);
    expect((await tdb.query('select count(*)::int n from public.t_cancel_effect')).rows[0].n).toBe(0);
  });

  it('refuses a kind that is not a booking_cancel kind, and a run with no club in the context', async () => {
    await expect(inTx(async (q) => void (await q(`select app.run_cancel_handlers($1, 'refund')`, [BOOKING])))).rejects.toThrow(/unknown cancel kind/);
    await expect(tdb.query(`select app.run_cancel_handlers($1, 'player_cancel')`, [BOOKING])).rejects.toThrow(/club/);
  });

  it('an overloaded handler name still reaches the registered (club, booking, kind) function', async () => {
    await tdb.query(`create function public.t_f07(p_other integer) returns void language sql as $$ select $$`);
    await tdb.query(`select app.register_cancel_handler('f07', 'public.t_f07(uuid, uuid, text)'::regprocedure, 20)`);
    await inTx(async (q) => void (await q(`select app.run_cancel_handlers($1, 'closure')`, [BOOKING])));
    expect(await calls()).toEqual([{ name: 'f07', club_id: A, booking_id: BOOKING, kind: 'closure' }]);
  });

  it('a handler is registered once by name; a second registration of the name is refused', async () => {
    await tdb.query(`select app.register_cancel_handler('f07', 'public.t_f07(uuid, uuid, text)'::regprocedure, 20)`);
    await expect(tdb.query(`select app.register_cancel_handler('f07', 'public.t_f08(uuid, uuid, text)'::regprocedure, 25)`)).rejects.toThrow(/duplicate key/);
  });

  it('no app role may register a handler, run the handlers or read the registry', async () => {
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      for (const [obj, priv] of [['app.register_cancel_handler(text, regprocedure, integer)', 'execute'], ['app.run_cancel_handlers(uuid, text)', 'execute']] as const) {
        expect((await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, obj, priv])).rows[0].ok, `${role} ${obj}`).toBe(false);
      }
      expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', [role, 'app.cancel_handlers', 'select'])).rows[0].ok, role).toBe(false);
    }
  });
});
