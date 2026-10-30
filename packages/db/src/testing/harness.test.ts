import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createScratchDatabase, createTestDatabase, type TestDatabase } from './harness';

const open: TestDatabase[] = [];
async function track(p: Promise<TestDatabase>) {
  const db = await p;
  open.push(db);
  return db;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe('test database harness (F01-T02, decision D30)', () => {
  it('gives every test its own database', async () => {
    const a = await track(createTestDatabase());
    const b = await track(createTestDatabase());
    await a.query('create table only_in_a (id int)');
    const seen = await b.query("select to_regclass('public.only_in_a') as t");
    expect(seen.rows[0].t).toBeNull();
  });

  it('drops the database on close', async () => {
    const db = await createTestDatabase();
    const name = db.name;
    await db.close();
    const admin = await track(createScratchDatabase());
    const r = await admin.query('select 1 from pg_database where datname = $1', [name]);
    expect(r.rowCount).toBe(0);
  });
});

describe('controllable clock in SQL (PLAT-04-AC11, CC-6)', () => {
  it('reads the real time until the clock is set', async () => {
    const db = await track(createTestDatabase());
    const r = await db.query("select abs(extract(epoch from (app.now() - now()))) < 5 as ok");
    expect(r.rows[0].ok).toBe(true);
  });

  it('shows the Bangkok date at 23:59:59 and at 00:00:01', async () => {
    const db = await track(createTestDatabase());
    await db.setNow('2026-12-29T16:59:59Z');
    const a = await db.query("select (app.now() at time zone 'Asia/Bangkok')::date::text as d");
    expect(a.rows[0].d).toBe('2026-12-29');
    await db.setNow('2026-12-29T17:00:01Z');
    const b = await db.query("select (app.now() at time zone 'Asia/Bangkok')::date::text as d");
    expect(b.rows[0].d).toBe('2026-12-30');
  });

  it('advances by an interval and can be cleared', async () => {
    const db = await track(createTestDatabase());
    await db.setNow('2026-12-29T16:59:59Z');
    await db.advance('2 seconds');
    const a = await db.query("select to_char(app.now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS') as t");
    expect(a.rows[0].t).toBe('2026-12-29T17:00:01');
    await db.clearNow();
    const b = await db.query("select abs(extract(epoch from (app.now() - now()))) < 5 as ok");
    expect(b.rows[0].ok).toBe(true);
  });

  it('is shared by every connection (concurrency tests need one clock)', async () => {
    const db = await track(createTestDatabase());
    await db.setNow('2027-01-09T02:00:00Z');
    const results = await Promise.all([1, 2, 3].map(() => db.query("select app.now()::text as t")));
    expect(new Set(results.map((r) => r.rows[0].t)).size).toBe(1);
  });

  it('cannot be overridden outside the test harness: no production migration mentions it', () => {
    const dir = join(__dirname, '..', '..', 'migrations');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/test_clock|test_now|allow_clock_override/);
    }
  });

  it('a database the harness did not prepare has no clock override table', async () => {
    const db = await track(createScratchDatabase());
    const r = await db.query("select to_regclass('app.test_clock') as t");
    expect(r.rows[0].t).toBeNull();
  });
});
