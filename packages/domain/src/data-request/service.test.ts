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

describe('copy file (PDPA-01-AC3, AC6; A-17)', () => {
  it('holds the player’s profile and consents, nobody else’s, and no staff notes', async () => {
    await as(owner, (tx) => tx.query(`update public.app_user set full_name = 'Somchai Own', phone = '+66812345678', phone_normalized = '66812345678', date_of_birth = '1990-05-01' where id = $1`, [P1]));
    await as(owner, (tx) => tx.query(`update public.app_user set full_name = 'OTHER-PLAYER' where id = $1`, [P2]));
    await tdb.query(`insert into public.user_consent (club_id, user_id, notice_version, language) values ($1,$2,'v1','th')`, [A, P1]);
    await tdb.query(`insert into public.user_staff_note (club_id, user_id, note, created_by) values ($1,$2,'MARKER-staff-note',$3)`, [A, P1, DESK]);
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    const files = await as(desk, (tx) => svc.copyFile(tx, desk, r.id));
    expect(files.map((f) => f.name)).toEqual(['profile.csv', 'consents.csv']);
    const all = files.map((f) => f.data).join('\n');
    expect(all).toContain('Somchai Own');
    expect(all).toContain('1990-05-01');
    expect(all).toContain('v1');
    expect(all).not.toContain('OTHER-PLAYER');
    expect(all).not.toContain('MARKER-staff-note');
  });
  it('is for staff, for a copy request, and not for a request that was already refused', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    await expect(as(p1, (tx) => svc.copyFile(tx, p1, r.id))).rejects.toMatchObject({ code: 'forbidden' });
    const d = await as(p1, (tx) => svc.create(tx, p1, { kind: 'delete' }));
    await expect(as(desk, (tx) => svc.copyFile(tx, desk, d.id))).rejects.toMatchObject({ code: 'bad_transition' });
    await as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'decline' }));
    await expect(as(desk, (tx) => svc.copyFile(tx, desk, r.id))).rejects.toMatchObject({ code: 'bad_transition' });
  });
});

describe('deletion (PDPA-01-AC4, AC5; D104, SR-04)', () => {
  const futureBooking = async (status: 'confirmed' | 'awaiting_payment' = 'confirmed') => {
    const c = await tdb.pool.connect();
    try {
      await c.query('set session_replication_role = replica'); // fixture only: orders and resources are F03's
      await c.query(
        `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at, hold_expires_at)
         values ($1, gen_random_uuid(), 'court', gen_random_uuid(), now() + interval '2 days' - (extract(minute from now()) || ' minutes')::interval - (extract(second from now()) || ' seconds')::interval,
                 now() + interval '2 days' + interval '1 hour' - (extract(minute from now()) || ' minutes')::interval - (extract(second from now()) || ' seconds')::interval,
                 $2, $3, 'staff', $2, case when $3 = 'confirmed' then now() end, case when $3 = 'awaiting_payment' then now() + interval '10 minutes' end)`,
        [A, P1, status],
      );
    } finally {
      await c.query('set session_replication_role = origin');
      c.release();
    }
  };
  const person = async () => (await tdb.query(`select full_name, phone, phone_normalized, active, anonymised_at, line_user_id from public.app_user where id = $1`, [P1])).rows[0];

  it('shows staff what will be lost before they confirm (AC5)', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'delete' }));
    expect(await as(desk, (tx) => svc.deletionImpact(tx, desk, r.id))).toMatchObject({ future_bookings: 0, held_bookings: 0 });
    await futureBooking();
    expect(await as(desk, (tx) => svc.deletionImpact(tx, desk, r.id))).toMatchObject({ future_bookings: 1 });
    await expect(as(p1, (tx) => svc.deletionImpact(tx, p1, r.id))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('only a delete request has a preview', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    await expect(as(desk, (tx) => svc.deletionImpact(tx, desk, r.id))).rejects.toMatchObject({ code: 'bad_transition' });
  });

  it('done on a delete request anonymises the player and no marker value stays in the audit log', async () => {
    await as(owner, (tx) => tx.query(`update public.app_user set full_name = 'MARKER-Somchai', phone = '+66MARKER-0812345678', phone_normalized = '66812345678' where id = $1`, [P1]));
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'delete' }));
    await as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'start' }));
    expect(await as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'done' }))).toMatchObject({ status: 'done' });
    expect(await person()).toMatchObject({ full_name: null, phone: null, phone_normalized: null, active: false, line_user_id: `erased:${P1}` });
    expect((await person()).anonymised_at).not.toBeNull();
    const dump = JSON.stringify((await tdb.query(`select old_value, new_value, pii_old, pii_new from public.audit_entry`)).rows);
    expect(dump).not.toContain('MARKER');
    expect((await tdb.query(`select count(*)::int n from public.audit_erasure where record_id = $1`, [P1])).rows[0].n).toBeGreaterThan(0);
  });

  it('a future booking blocks the erasure: nothing changes and the request stays open (A-18)', async () => {
    await futureBooking();
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'delete' }));
    await as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'start' }));
    await expect(as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'done' }))).rejects.toMatchObject({ code: 'future_booking' });
    expect((await person()).anonymised_at).toBeNull();
    expect((await tdb.query('select status from public.data_request where id = $1', [r.id])).rows[0].status).toBe('in_progress');
  });

  it('a held booking blocks it too, and declining a delete request erases nothing', async () => {
    await futureBooking('awaiting_payment');
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'delete' }));
    await expect(as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'done' }))).rejects.toMatchObject({ code: 'future_booking' });
    await as(desk, (tx) => svc.handle(tx, desk, r.id, { action: 'decline', note: 'booking kept' }));
    expect((await person()).anonymised_at).toBeNull();
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
  it('a player cannot handle even their own request', async () => {
    const r = await as(p1, (tx) => svc.create(tx, p1, { kind: 'copy' }));
    await expect(as(p1, (tx) => svc.handle(tx, p1, r.id, { action: 'done' }))).rejects.toMatchObject({ code: 'forbidden' });
  });
});
