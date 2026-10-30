import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../../db/src/testing/harness';
import { createDataRequestService, DataRequestError } from './service';

// F01-T33, part 1: player copy and delete requests and their handling (PDPA-01-AC3, AC4, AC5, AC6, AC7). Real Postgres.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const P2 = '55555555-5555-4555-8555-555555555555';
const OWNER_B = '44444444-4444-4444-8444-444444444444';

let tdb: TestDatabase;
let db: Db;
const ctx = (userId: string, roles: string[], clubId = A) => ({ clubId, userId, roles, source: 'admin' as const });
const p1 = ctx(P1, ['player']);
const p2 = ctx(P2, ['player']);
const desk = ctx(DESK, ['front_desk', 'player']);
const owner = ctx(OWNER, ['owner', 'player']);
const svc = createDataRequestService();
const as = <T>(c: ReturnType<typeof ctx>, fn: (tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) => Promise<T>) => db.withClubTx(c, fn);

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  for (const [club, id, line, roles] of [
    [A, OWNER, 'L1', ['owner', 'player']], [A, DESK, 'L2', ['front_desk', 'player']], [A, P1, 'L3', ['player']], [A, P2, 'L4', ['player']], [B, OWNER_B, 'L5', ['owner', 'player']],
  ] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, id, line]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, id, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('a player makes a request (PDPA-01-AC3, AC4)', () => {
  it('is stored for that player and audited with the player as actor (AC7)', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    expect(r).toMatchObject({ kind: 'copy', status: 'requested', userId: P1 });
    const e = (await tdb.query(`select actor_user_id, action from public.audit_entry where record_type = 'data_request' and record_id = $1`, [r.id])).rows;
    expect(e).toHaveLength(1);
    expect(e[0].actor_user_id).toBe(P1);
  });
  it('a second tap while one is open returns the same request, not a new one', async () => {
    const a = await as(p1, (tx) => svc.create(tx, p1, { kind: 'delete' }));
    const b = await as(p1, (tx) => svc.create(tx, p1, { kind: 'delete' }));
    expect(b.id).toBe(a.id);
    const c = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    expect(c.id).not.toBe(a.id);
  });
  it('a guest (no user) cannot make one', async () => {
    const guest = { clubId: A, userId: null, roles: ['guest'], source: 'player_app' as const };
    await expect(db.withClubTx(guest, (tx) => svc.create(tx, guest, { kind: 'copy' }))).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('a player lists only their own requests', async () => {
    await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    await as(p2, (tx) => svc.create(tx, p2, { kind: 'delete' }));
    expect((await as(p1, (tx) => svc.listOwn(tx, p1))).map((r) => r.userId)).toEqual([P1]);
  });
});

describe('staff handle requests (PDPA-01-AC4, AC6, AC7)', () => {
  it('owner and front desk see all open requests; a player sees none of them', async () => {
    await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    await as(p2, (tx) => svc.create(tx, p2, { kind: 'delete' }));
    for (const c of [desk, owner]) expect((await as(c, (tx) => svc.listOpen(tx, c))).map((r) => r.userId).sort()).toEqual([P1, P2]);
    await expect(as(p1, (tx) => svc.listOpen(tx, p1))).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('another club’s staff see nothing and cannot handle it', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    const other = ctx(OWNER_B, ['owner', 'player'], B);
    expect(await as(other, (tx) => svc.listOpen(tx, other))).toEqual([]);
    await expect(as(other, (tx) => svc.handle(tx, other, r.id, { action: 'start' }))).rejects.toMatchObject({ code: 'not_found' });
  });
  it('a copy request goes requested, in progress, done, each step audited with who handled it', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    expect(await as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'start' }))).toMatchObject({ status: 'in_progress', handledBy: DESK });
    expect(await as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'done' }))).toMatchObject({ status: 'done' });
    const e = (await tdb.query(`select actor_user_id from public.audit_entry where record_type = 'data_request' and record_id = $1 order by seq`, [r.id])).rows;
    expect(e.map((x) => x.actor_user_id)).toEqual([P1, DESK, DESK]);
  });
  it('a refusal is recorded with the staff note, and the note is kept out of the plain audit columns', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    await as(owner, (tx) => svc.handle(tx, owner, r.id, { action: 'decline', note: 'MARKER-cannot verify identity' }));
    const e = (await tdb.query(`select new_value, pii_new from public.audit_entry where record_type = 'data_request' and record_id = $1 order by seq desc limit 1`, [r.id])).rows[0];
    expect(JSON.stringify(e.new_value)).not.toContain('MARKER');
    expect(JSON.stringify(e.pii_new)).toContain('MARKER-cannot verify identity');
    expect((await as(owner, (tx) => svc.listOpen(tx, owner))).map((x) => x.id)).not.toContain(r.id);
  });
  it('a finished request cannot be handled again', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    await as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'done' }));
    await expect(as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'start' }))).rejects.toMatchObject({ code: 'bad_transition' });
  });
  it('a delete request is not completed here: erasure goes through app.anonymise_user, which is not built yet', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'delete' }));
    expect(await as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'start' }))).toMatchObject({ status: 'in_progress' });
    await expect(as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'done' }))).rejects.toBeInstanceOf(DataRequestError);
    await expect(as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'done' }))).rejects.toMatchObject({ code: 'erasure_not_available' });
    expect((await tdb.query('select status from public.data_request where id = $1', [r.id])).rows[0].status).toBe('in_progress');
  });
  it('a player cannot handle even their own request', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    await expect(as(p1, (tx) => svc.handle(tx, p1, r.id, { action: 'done' }))).rejects.toMatchObject({ code: 'forbidden' });
  });
});
