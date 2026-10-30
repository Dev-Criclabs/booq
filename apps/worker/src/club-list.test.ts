import { describe, expect, it } from 'vitest';
import type { Db } from '@booq/db';
import { listClubIds } from './club-list';

// The sweep dispatcher needs the club ids and nothing else. The source is the definer function
// app.worker_club_ids() (Architect): ids of clubs that are Live or Paused, no club data.
describe('listClubIds', () => {
  it('reads ids through the system context and drops anything that is not a uuid', async () => {
    const calls: { sql: string; ctxClub: string }[] = [];
    const db = {
      withClubTx: async (ctx: { clubId: string }, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ query: async (sql: string) => (calls.push({ sql, ctxClub: ctx.clubId }), { rows: [{ id: '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c' }, { id: 'oops' }, { id: null }] }) }),
      end: async () => undefined,
    } as unknown as Db;
    expect(await listClubIds(db)).toEqual(['3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c']);
    expect(calls).toEqual([{ sql: 'select id from app.worker_club_ids() as t(id)', ctxClub: '00000000-0000-0000-0000-000000000000' }]);
  });
});
