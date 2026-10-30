import { describe, expect, it } from 'vitest';
import type { Db } from '../../../db/src/tx';
import { createDbDirectory } from './directory';

// The real directory calls two definer functions (migrations 0022, 0023). This pins what it asks and returns;
// session.test.ts runs it against the real functions.
function fakeDb(rows: Record<string, unknown>[], seen: { sql: string; params: unknown[]; ctx: unknown }[]): Db {
  return {
    withClubTx: async (ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ query: async (sql: string, params: unknown[] = []) => (seen.push({ sql, params, ctx }), { rows }) }),
    end: async () => undefined,
  } as unknown as Db;
}

describe('createDbDirectory', () => {
  it('finds a club by slug through app.club_sign_in_target and returns the server-side fields', async () => {
    const seen: { sql: string; params: unknown[]; ctx: any }[] = [];
    const d = createDbDirectory(fakeDb([{ club_id: 'c1', status: 'live', liff_id: 'L', login_channel_id: 'LC', default_language: 'en' }], seen));
    expect(await d.clubBySlug('hunter')).toEqual({ clubId: 'c1', status: 'live', liffId: 'L', loginChannelId: 'LC', defaultLanguage: 'en' });
    expect(seen[0]).toMatchObject({ sql: 'select club_id, status, liff_id, login_channel_id, default_language from app.club_sign_in_target($1)', params: ['hunter'] });
    expect(seen[0]!.ctx.userId).toBeNull();
  });
  it('a club with no LINE connection yet cannot sign anyone in', async () => {
    const d = createDbDirectory(fakeDb([{ club_id: 'c1', status: 'live', liff_id: null, login_channel_id: null }], []));
    expect(await d.clubBySlug('hunter')).toBeNull();
  });
  it('an unknown slug is null', async () => {
    expect(await createDbDirectory(fakeDb([], [])).clubBySlug('nope')).toBeNull();
  });
  it('finds a person through app.person_by_line_id inside the guest transaction', async () => {
    const seen: { sql: string; params: unknown[]; ctx: unknown }[] = [];
    const d = createDbDirectory(fakeDb([], []));
    const tx = { query: async (sql: string, params: unknown[] = []) => (seen.push({ sql, params, ctx: null }), { rows: [{ id: 'u1', active: true }] }) };
    expect(await d.personByLineId(tx, 'U1')).toEqual({ id: 'u1', active: true });
    expect(seen[0]).toMatchObject({ sql: 'select id, active from app.person_by_line_id($1)', params: ['U1'] });
    expect(await d.personByLineId({ query: async () => ({ rows: [] }) }, 'U2')).toBeNull();
  });
});
