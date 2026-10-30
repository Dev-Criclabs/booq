import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../db/src/tx';
import { createTestDatabase, type TestDatabase } from '../../../db/src/testing/harness';
import { ClaimError, createClaimService } from './service';
import { normalizePhone } from '../phone';

// F01-T31b claim handling (PLAT-06-AC7; D105, SR-05). Real Postgres; requests are made the way F02 makes them.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const IMPORTED = 'a1a1a1a1-0000-4000-8000-000000000001';
const NEW1 = '33333333-3333-4333-8333-333333333333';
const NEW2 = '55555555-5555-4555-8555-555555555555';
const OWNER_B = '44444444-4444-4444-8444-444444444444';

let tdb: TestDatabase;
let db: Db;
const ctx = (userId: string, roles: string[], clubId = A) => ({ clubId, userId, roles, source: 'admin' as const });
const desk = ctx(DESK, ['front_desk', 'player']);
const owner = ctx(OWNER, ['owner', 'player']);
const svc = createClaimService();
const as = <T>(c: ReturnType<typeof ctx>, fn: (tx: Parameters<Parameters<Db['withClubTx']>[1]>[0]) => Promise<T>) => db.withClubTx(c, fn);
/** What the new player's profile transaction does (F02-T09b). */
const requestClaim = (user: string, name: string, phone: string) =>
  db.withClubTx({ clubId: A, userId: user, roles: ['player'], source: 'player_app' }, (tx) => tx.query('select app.request_claim($1, $2, $3, $4)', [user, name, phone, normalizePhone(phone)!.slice(1)]));
const record = async (id = IMPORTED) => (await tdb.query('select claim_state, merged_into, active from public.app_user where id = $1', [id])).rows[0];
const claims = async () => (await tdb.query('select claimant_user_id, status from public.claim_request order by claimant_user_id')).rows;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en) values ($1,'a','ก','A'), ($2,'b','ข','B')`, [A, B]);
  for (const [club, id, line, roles] of [
    [A, OWNER, 'L1', ['owner', 'player']], [A, DESK, 'L2', ['front_desk', 'player']], [A, NEW1, 'L3', ['player']], [A, NEW2, 'L4', ['player']], [B, OWNER_B, 'L5', ['owner', 'player']],
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
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, full_name, phone, phone_normalized, claim_state) values ($1,$2,'Somchai Imported','+66812345678','66812345678','unclaimed')`, [A, IMPORTED]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [A, IMPORTED]);
    await c.query('commit');
  } finally {
    c.release();
  }
  db = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await db.end();
  await tdb.close();
});

describe('listing (A6)', () => {
  it('staff see the imported name beside the typed name and phone; nobody else lists claims', async () => {
    await requestClaim(NEW1, 'Somchai J.', '081-234-5678');
    const open = await as(desk, (tx) => svc.listOpen(tx, desk));
    expect(open).toEqual([expect.objectContaining({ importedUserId: IMPORTED, importedFullName: 'Somchai Imported', claimantUserId: NEW1, typedFullName: 'Somchai J.', typedPhone: '081-234-5678', status: 'open' })]);
    const player = ctx(NEW1, ['player']);
    await expect(as(player, (tx) => svc.listOpen(tx, player))).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('another club’s staff see nothing', async () => {
    await requestClaim(NEW1, 'Somchai J.', '0812345678');
    const other = ctx(OWNER_B, ['owner', 'player'], B);
    expect(await as(other, (tx) => svc.listOpen(tx, other))).toEqual([]);
  });
});

describe('confirm (D105)', () => {
  it('merges the imported record into the claimant, closes the request and audits it', async () => {
    await requestClaim(NEW1, 'Somchai J.', '0812345678');
    const [req] = await as(owner, (tx) => svc.listOpen(tx, owner));
    await as(owner, (tx) => svc.confirm(tx, owner, req!.id));
    expect(await record()).toEqual({ claim_state: 'merged', merged_into: NEW1, active: false });
    expect(await claims()).toEqual([{ claimant_user_id: NEW1, status: 'confirmed' }]);
    const e = (await tdb.query(`select actor_user_id from public.audit_entry where record_type = 'claim_request' order by seq`)).rows;
    expect(e.at(-1).actor_user_id).toBe(OWNER);
  });

  it('two claimants for one record: both stay open until staff choose; the choice rejects the other', async () => {
    await requestClaim(NEW1, 'First', '0812345678');
    await requestClaim(NEW2, 'Second', '0812345678');
    expect(await claims()).toEqual([{ claimant_user_id: NEW1, status: 'open' }, { claimant_user_id: NEW2, status: 'open' }].sort((a, b) => a.claimant_user_id.localeCompare(b.claimant_user_id)));
    expect((await record()).claim_state).toBe('unclaimed');
    const second = (await as(desk, (tx) => svc.listOpen(tx, desk))).find((c) => c.claimantUserId === NEW2)!;
    await as(desk, (tx) => svc.confirm(tx, desk, second.id));
    expect(await record()).toMatchObject({ claim_state: 'merged', merged_into: NEW2 });
    expect((await claims()).find((c) => c.claimant_user_id === NEW1)!.status).toBe('rejected');
  });

  it('a claim already settled cannot be confirmed again', async () => {
    await requestClaim(NEW1, 'Somchai J.', '0812345678');
    const [req] = await as(desk, (tx) => svc.listOpen(tx, desk));
    await as(desk, (tx) => svc.confirm(tx, desk, req!.id));
    await expect(as(desk, (tx) => svc.confirm(tx, desk, req!.id))).rejects.toMatchObject({ code: 'not_open' });
  });

  it('a player cannot confirm, and staff cannot confirm their own claim', async () => {
    await requestClaim(NEW1, 'Somchai J.', '0812345678');
    const [req] = await as(desk, (tx) => svc.listOpen(tx, desk));
    const player = ctx(NEW1, ['player']);
    await expect(as(player, (tx) => svc.confirm(tx, player, req!.id))).rejects.toMatchObject({ code: 'forbidden' });
    expect((await record()).claim_state).toBe('unclaimed');
    const c = await tdb.pool.connect();
    try {
      await c.query(`update public.claim_request set claimant_user_id = $1`, [DESK]);
    } finally {
      c.release();
    }
    await expect(as(desk, (tx) => svc.confirm(tx, desk, req!.id))).rejects.toMatchObject({ code: 'forbidden' });
    expect((await record()).claim_state).toBe('unclaimed');
  });

  it('an unknown request and another club’s request are not found', async () => {
    await requestClaim(NEW1, 'Somchai J.', '0812345678');
    const [req] = await as(desk, (tx) => svc.listOpen(tx, desk));
    const other = ctx(OWNER_B, ['owner', 'player'], B);
    await expect(as(other, (tx) => svc.confirm(tx, other, req!.id))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(desk, (tx) => svc.confirm(tx, desk, '99999999-9999-4999-8999-999999999999'))).rejects.toBeInstanceOf(ClaimError);
  });
});

describe('reject', () => {
  it('rejects the request and leaves the record unclaimed', async () => {
    await requestClaim(NEW1, 'Somchai J.', '0812345678');
    const [req] = await as(desk, (tx) => svc.listOpen(tx, desk));
    await as(desk, (tx) => svc.reject(tx, desk, req!.id));
    expect(await claims()).toEqual([{ claimant_user_id: NEW1, status: 'rejected' }]);
    expect(await record()).toMatchObject({ claim_state: 'unclaimed', merged_into: null });
    await expect(as(desk, (tx) => svc.reject(tx, desk, req!.id))).rejects.toMatchObject({ code: 'not_open' });
  });
  it('a player cannot reject', async () => {
    await requestClaim(NEW1, 'Somchai J.', '0812345678');
    const [req] = await as(desk, (tx) => svc.listOpen(tx, desk));
    const player = ctx(NEW2, ['player']);
    await expect(as(player, (tx) => svc.reject(tx, player, req!.id))).rejects.toMatchObject({ code: 'forbidden' });
  });
});
