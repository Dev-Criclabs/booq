import type { TestDatabase } from '@booq/db/testing';

// The one way a worker test closes its database. Dropping a database terminates every connection still open on it, and a pool that
// sees that emits an unhandled 57P01 error, which fails whichever test happens to be running. So: the test ends its own pools and
// stops its runner first (worker?.stop() waits for the queue's promise), and this helper then waits until no connection but the
// test's own is left on the database, whatever it last ran, and only then drops it. A connection that never goes away fails the
// test with a clear message instead of being killed mid close. apps/worker/src/testing/guard.test.ts fails a worker test that
// creates a database and closes it any other way.
export async function closeTestDatabase(tdb: TestDatabase, options: { timeoutMs?: number } = {}): Promise<void> {
  const until = Date.now() + (options.timeoutMs ?? 15000);
  let left = -1;
  while (Date.now() < until) {
    const { rows } = await tdb.query('select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()');
    left = rows[0].n;
    if (left === 0) {
      await tdb.close();
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  await tdb.close().catch(() => undefined);
  throw new Error(`${left} connection(s) still open on the test database at teardown: end every pool and stop every runner before closeTestDatabase`);
}
