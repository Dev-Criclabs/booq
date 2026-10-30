import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// Sign-in rate limit, orchestrator request / migration 0027: a shared counter keyed by (club, HMAC of the client
// IP, window). No raw IP is ever stored; the club comes from the context; the limit and window are arguments
// (config in the caller, no default here).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const K1 = 'a'.repeat(64);
const K2 = 'b'.repeat(64);
let tdb: TestDatabase;
let web: Db;
let worker: Db;

const guest = (club = A) => ({ clubId: club, userId: null, roles: ['guest'] as never, source: 'player_app' as const });
const hit = (key = K1, limit = 3, window = 60, club = A) =>
  web.withClubTx(guest(club), async (tx) => (await tx.query(`select app.hit_rate_limit($1, $2, $3) as ok`, [key, limit, window])).rows[0]!.ok as boolean);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  await tdb.setNow('2026-12-29T03:00:30Z');
  web = createDb({ connectionString: tdb.url, max: 12 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await web.end();
  await worker.end();
  await tdb.close();
});

describe('app.hit_rate_limit', () => {
  it('allows up to the limit in a window and refuses the next hit', async () => {
    expect([await hit(), await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false, false]);
  });

  it('a new window starts again', async () => {
    for (let i = 0; i < 4; i++) await hit();
    expect(await hit()).toBe(false);
    await tdb.advance('60 seconds');
    expect(await hit()).toBe(true);
  });

  it('keys and clubs are counted apart', async () => {
    for (let i = 0; i < 3; i++) await hit(K1);
    expect(await hit(K1)).toBe(false);
    expect(await hit(K2)).toBe(true);
    expect(await hit(K1, 3, 60, B)).toBe(true);
  });

  it('is atomic: ten parallel hits against a limit of five give exactly five allowed', async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => hit(K1, 5, 60)));
    expect(r.filter(Boolean)).toHaveLength(5);
  });

  it('refuses a key that is not an HMAC hash, so a raw IP can never be stored', async () => {
    for (const bad of ['203.0.113.7', '2001:db8::1', 'A'.repeat(64), 'a'.repeat(63), '']) {
      await expect(hit(bad)).rejects.toThrow(/key_hash/);
    }
    expect((await tdb.query(`select count(*)::int as n from public.rate_limit_hit`)).rows[0].n).toBe(0);
  });

  it('refuses a missing or non-positive limit or window: no default is invented', async () => {
    await expect(hit(K1, 0)).rejects.toThrow(/limit/);
    await expect(hit(K1, 3, 0)).rejects.toThrow(/window/);
    await expect(web.withClubTx(guest(), async (tx) => tx.query(`select app.hit_rate_limit($1, null, 60)`, [K1]))).rejects.toThrow(/limit/);
  });

  it('needs a club in the context and is for booq_app only', async () => {
    for (const role of ['booq_worker', 'booq_platform', 'booq_audit', 'booq_anonymiser', 'booq_purge']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.hit_rate_limit(text, integer, integer)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role booq_app');
      await expect(c.query(`select app.hit_rate_limit($1, 3, 60)`, [K1])).rejects.toThrow(/club/);
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  it('the table holds a hash, a window and a count, and no application role can read it', async () => {
    await hit();
    const cols = (await tdb.query(`select column_name from information_schema.columns where table_name = 'rate_limit_hit' order by ordinal_position`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(['club_id', 'key_hash', 'window_start', 'hits']);
    for (const role of ['booq_app', 'booq_worker', 'booq_platform']) {
      expect((await tdb.query(`select has_table_privilege($1, 'public.rate_limit_hit', 'select') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});

describe('app.sweep_rate_limit', () => {
  const sweep = (keep: number) => worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, async (tx) => (await tx.query(`select app.sweep_rate_limit($1) as n`, [keep])).rows[0]!.n as number);

  it('removes windows older than the keep time, in every club, and keeps the rest', async () => {
    await hit(K1, 3, 60);
    await hit(K1, 3, 60, B);
    await tdb.advance('2 hours');
    await hit(K2, 3, 60);
    expect(await sweep(3600)).toBe(2);
    expect((await tdb.query(`select key_hash from public.rate_limit_hit`)).rows).toEqual([{ key_hash: K2 }]);
  });

  it('needs a positive keep time and is for booq_worker only', async () => {
    await expect(sweep(0)).rejects.toThrow(/keep/);
    for (const role of ['booq_app', 'booq_platform']) {
      expect((await tdb.query(`select has_function_privilege($1, 'app.sweep_rate_limit(integer)', 'execute') as ok`, [role])).rows[0].ok, role).toBe(false);
    }
  });
});
