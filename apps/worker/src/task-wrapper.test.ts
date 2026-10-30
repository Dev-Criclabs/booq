import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type ClubContext, type Db, type Tx } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { clubTask, TaskRefusedError } from './task-wrapper';

// F01-T34 club-context task wrapper (FA 5; CC-1). A task runs inside withClubTx for its
// club; a task without a club id is refused and never touches the database.
const CLUB = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';

function fakeDb() {
  const seen: ClubContext[] = [];
  const db: Db = {
    async withClubTx(ctx, fn) {
      seen.push(ctx);
      return fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Tx);
    },
    async end() {},
  };
  return { db, seen };
}

describe('clubTask (F01-T34)', () => {
  it('runs the handler inside withClubTx for the payload club, with no user and no roles', async () => {
    const { db, seen } = fakeDb();
    let ran = 0;
    await clubTask(db, async (_tx, payload) => {
      ran += 1;
      expect(payload.clubId).toBe(CLUB);
    })({ clubId: CLUB, orderId: 'o1' }, { job: { id: '7' } });
    expect(ran).toBe(1);
    expect(seen).toEqual([{ clubId: CLUB, userId: null, roles: [], source: 'job', requestId: 'job:7' }]);
  });

  it.each([[{}], [{ clubId: null }], [{ clubId: '' }], [{ clubId: 'not-a-uuid' }], [null], [undefined], ['x']])(
    'refuses a payload without a valid club id: %j',
    async (payload) => {
      const { db, seen } = fakeDb();
      let ran = false;
      await expect(
        clubTask(db, async () => {
          ran = true;
        })(payload, {}),
      ).rejects.toBeInstanceOf(TaskRefusedError);
      expect(ran).toBe(false);
      expect(seen).toHaveLength(0);
    },
  );

  it('does not put the payload values in the refusal message', async () => {
    const { db } = fakeDb();
    await expect(clubTask(db, async () => {})({ clubId: 'secret-value-123' }, {})).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret-value-123') }),
    );
  });

  it('lets a handler error through so the queue can retry', async () => {
    const { db } = fakeDb();
    await expect(
      clubTask(db, async () => {
        throw new Error('boom');
      })({ clubId: CLUB }, {}),
    ).rejects.toThrow('boom');
  });
});

describe('clubTask against the database (F01-T34)', () => {
  let tdb: TestDatabase;
  let db: Db;
  beforeEach(async () => {
    tdb = await createTestDatabase();
    db = createDb({ connectionString: tdb.url, max: 1, role: 'booq_worker' });
  });
  afterEach(async () => {
    await db.end();
    await tdb.close();
  });

  it('sets the club context for the job and drops it afterwards', async () => {
    let inside: string | undefined;
    await clubTask(db, async (tx) => {
      inside = (await tx.query<{ c: string }>('select app.club_id()::text as c')).rows[0]?.c;
    })({ clubId: CLUB }, {});
    expect(inside).toBe(CLUB);
    await db.withClubTx({ clubId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', userId: null, roles: [] }, async (tx) => {
      expect((await tx.query<{ c: string }>('select app.club_id()::text as c')).rows[0]?.c).not.toBe(CLUB);
    });
  });
});
