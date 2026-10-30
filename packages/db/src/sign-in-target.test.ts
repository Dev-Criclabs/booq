import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F02 sign-in, lane D request / migration 0022: app.club_sign_in_target(slug). No club in the context;
// zero or one row; booq_app only. login_channel_id is for the server (ID token audience) and is never in a public view.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
let tdb: TestDatabase;

async function as<T>(role: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    const r = await c.query(sql, params);
    await c.query('rollback');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status, default_language) values ($1, 'hunter', 'ฮันเตอร์', 'Hunter', 'live', 'th'), ($2, 'newclub', 'ใหม่', 'New', 'draft', 'en')`, [A, B]);
  await tdb.query(`insert into public.line_connection (club_id, login_channel_id, liff_id, messaging_channel_id) values ($1, '1650000001', '1650000001-AbCdEfGh', 'm-secret-ish')`, [A]);
});
afterEach(async () => {
  await tdb.close();
});

describe('app.club_sign_in_target', () => {
  it('returns the sign-in facts for a slug without any club in the context', async () => {
    const r = await as<Record<string, unknown>>('booq_app', `select * from app.club_sign_in_target('hunter')`);
    expect(r).toEqual([{ club_id: A, status: 'live', name_th: 'ฮันเตอร์', name_en: 'Hunter', default_language: 'th', liff_id: '1650000001-AbCdEfGh', login_channel_id: '1650000001' }]);
  });

  it('a club with no LINE connection yet still answers, with empty ids', async () => {
    const r = await as<Record<string, unknown>>('booq_app', `select * from app.club_sign_in_target('newclub')`);
    expect(r).toEqual([{ club_id: B, status: 'draft', name_th: 'ใหม่', name_en: 'New', default_language: 'en', liff_id: null, login_channel_id: null }]);
  });

  it('an unknown slug returns nothing, not an error; the match is exact', async () => {
    expect(await as('booq_app', `select * from app.club_sign_in_target('nope')`)).toEqual([]);
    expect(await as('booq_app', `select * from app.club_sign_in_target('HUNTER')`)).toEqual([]);
    expect(await as('booq_app', `select * from app.club_sign_in_target('')`)).toEqual([]);
  });

  it('exposes nothing else: only the named columns, no messaging channel', async () => {
    const r = await as<Record<string, unknown>>('booq_app', `select * from app.club_sign_in_target('hunter')`);
    expect(Object.keys(r[0]!).sort()).toEqual(['club_id', 'default_language', 'liff_id', 'login_channel_id', 'name_en', 'name_th', 'status']);
  });

  it('only booq_app may call it', async () => {
    for (const role of ['booq_worker', 'booq_platform', 'booq_audit', 'booq_anonymiser', 'booq_purge']) {
      const ok = (await tdb.query('select has_function_privilege($1, $2, $3) as ok', [role, "app.club_sign_in_target(text)", 'execute'])).rows[0].ok;
      expect(ok, role).toBe(false);
    }
    expect((await tdb.query(`select has_function_privilege('booq_app', 'app.club_sign_in_target(text)', 'execute') as ok`)).rows[0].ok).toBe(true);
  });
});
