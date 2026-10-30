import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F02-T17 / migration 0049: the club behind a LINE webhook token (F02 design 5.4).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
let tdb: TestDatabase;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  await tdb.query(`insert into public.line_connection (club_id, webhook_token_hash) values ($1,$2), ($3,$4)`, [A, H1, B, H2]);
});
afterEach(async () => {
  await tdb.close();
});
const lookup = async (h: string) => (await tdb.query(`select app.club_by_line_webhook($1) as c`, [h])).rows[0].c as string | null;

describe('club by LINE webhook token', () => {
  it('finds the club of a token hash, and nothing for another hash', async () => {
    expect(await lookup(H1)).toBe(A);
    expect(await lookup(H2)).toBe(B);
    expect(await lookup('c'.repeat(64))).toBeNull();
    expect(await lookup('')).toBeNull();
  });
  it('only a 64 character hex hash can be stored, and one token belongs to one club', async () => {
    await expect(tdb.query(`update public.line_connection set webhook_token_hash = 'plain-token' where club_id = $1`, [A])).rejects.toThrow(/line_webhook_token_is_hash/);
    await expect(tdb.query(`update public.line_connection set webhook_token_hash = $2 where club_id = $1`, [A, H2])).rejects.toThrow(/duplicate key|unique/i);
  });
  it('the lookup runs for the app role only; BOOQ staff set the hash but cannot read it back through it', async () => {
    const can = async (role: string) => (await tdb.query(`select has_function_privilege($1, 'app.club_by_line_webhook(text)', 'execute') as ok`, [role])).rows[0].ok;
    expect(await can('booq_app')).toBe(true);
    for (const r of ['booq_platform', 'booq_worker', 'anon', 'authenticated']) expect(await can(r), r).toBe(false);
    expect((await tdb.query(`select has_column_privilege('booq_platform', 'public.line_connection', 'webhook_token_hash', 'update') as ok`)).rows[0].ok).toBe(true);
  });
});
