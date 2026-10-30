import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F03-T18 / migration 0221: tenant isolation and the blind suite for the F03 tables (CC-1,
// PLAT-02-AC1, PDPA-01-AC1).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const COACH = '33333333-3333-4333-8333-333333333333';
const DESK = '44444444-4444-4444-8444-444444444444';
const ACC = '55555555-5555-4555-8555-555555555555';
const PB = '66666666-6666-4666-8666-666666666666';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const CB = '00000000-0000-4000-8000-0000000000cb';
const at = (h: number) => new Date(Date.UTC(2026, 11, 29, h - 7)).toISOString();

let tdb: TestDatabase;
let web: Db;
let worker: Db;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1, gen_random_uuid(), 'M')`, [A]);
  const loc = (await tdb.query('select id from public.location')).rows[0].id;
  await tdb.query(`insert into public.location (club_id, id, name) values ($1, '00000000-0000-4000-8000-0000000000b1', 'M')`, [B]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis'), ($4,$5,'00000000-0000-4000-8000-0000000000b1','1','tennis')`, [A, C1, loc, B, CB]);
  for (const [club, u, roles] of [[A, P1, ['player']], [A, P2, ['player']], [A, COACH, ['coach', 'player']], [A, DESK, ['front_desk', 'player']], [A, ACC, ['accountant', 'player']], [B, PB, ['player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [club, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [club, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  // P1 has a court booking, P2 a solo class with COACH, club B has one of its own
  const make = async (club: string, cust: string, res: string, coach: string | null, hour: number) => {
    const order = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'staff') returning id`, [club, cust])).rows[0].id;
    const b = (await tdb.query(
      `insert into public.booking (club_id, order_id, type, resource_id, coach_id, customer_id, start_at, end_at, status, source, created_by, confirmed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed','staff',$6, now()) returning id`,
      [club, order, coach ? 'solo_class' : 'court', res, coach, cust, at(hour), at(hour + 1)],
    )).rows[0].id;
    await tdb.query(`insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, booking_id) values ($1,$2,$3,$4,$5,$6,'confirmed',$7)`, [club, coach ? 'solo_class' : 'court_booking', res, coach, at(hour), at(hour + 1), b]);
  };
  await make(A, P1, C1, null, 10);
  await make(A, P2, C1, COACH, 11);
  await make(B, PB, CB, null, 10);
  web = createDb({ connectionString: tdb.url, max: 2 });
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await web.end();
  await worker.end();
  await tdb.close();
});
const as = (user: string, roles: string[], club = A) => ({ clubId: club, userId: user, roles, source: 'player_app' as const });
const count = (c: ReturnType<typeof as>, table: string) => web.withClubTx(c, (tx) => tx.query(`select 1 from public.${table}`)).then((r) => r.rowCount);

describe('who reads bookings, orders and occupancy', () => {
  it('a player sees their own booking and order only, and no occupancy', async () => {
    expect(await count(as(P1, ['player']), 'booking')).toBe(1);
    expect(await count(as(P1, ['player']), 'orders')).toBe(1);
    expect(await count(as(P1, ['player']), 'occupancy')).toBe(0);
    expect(await count(as(P2, ['player']), 'booking')).toBe(1);
  });
  it('a coach sees the bookings that name them, not other people’s court bookings', async () => {
    const r = await web.withClubTx(as(COACH, ['coach', 'player']), (tx) => tx.query('select customer_id from public.booking'));
    expect(r.rows).toEqual([{ customer_id: P2 }]);
  });
  it('owner, front desk and accountant see the whole club', async () => {
    for (const [u, roles] of [[DESK, ['front_desk', 'player']], [ACC, ['accountant', 'player']]] as const) {
      expect(await count(as(u, [...roles]), 'booking'), roles.join()).toBe(2);
      expect(await count(as(u, [...roles]), 'orders'), roles.join()).toBe(2);
      expect(await count(as(u, [...roles]), 'occupancy'), roles.join()).toBe(2);
    }
  });
  it('club A never sees club B, whatever the role', async () => {
    for (const t of ['booking', 'orders', 'occupancy']) {
      const r = await web.withClubTx(as(DESK, ['front_desk', 'player']), (tx) => tx.query(`select club_id from public.${t}`));
      expect(r.rows.every((x) => x.club_id === A), t).toBe(true);
    }
    expect(await count(as(PB, ['player'], B), 'booking')).toBe(1);
    expect(await count(as(P1, ['owner'], B), 'booking')).toBe(1); // a role claim never reaches another club's rows: only B's own
    const b = await web.withClubTx(as(P1, ['owner'], B), (tx) => tx.query('select customer_id from public.booking'));
    expect(b.rows).toEqual([{ customer_id: PB }]);
  });
  it('no context sees nothing', async () => {
    const c = await tdb.pool.connect();
    try {
      await c.query('set role booq_app');
      for (const t of ['booking', 'orders', 'occupancy']) expect((await c.query(`select 1 from public.${t}`)).rowCount, t).toBe(0);
    } finally {
      c.release();
    }
  });
  it('the worker reads what it acts on, in the club’s context only', async () => {
    const r = await worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) => tx.query('select 1 from public.booking'));
    expect(r.rowCount).toBe(2);
  });
});

describe('no app role writes these tables directly (SR-07)', () => {
  it('insert, update and delete are refused for the app and worker roles, even for the owner', async () => {
    const owner = as(P1, ['owner', 'player']);
    for (const sql of [`update public.booking set status = 'cancelled'`, 'delete from public.booking', `update public.occupancy set state = 'held'`, 'delete from public.occupancy', `update public.orders set status = 'paid'`, 'delete from public.orders']) {
      await expect(web.withClubTx(owner, (tx) => tx.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
    await expect(worker.withClubTx({ clubId: A, userId: null, roles: [], source: 'job' }, (tx) => tx.query('delete from public.occupancy'))).rejects.toThrow(/permission denied/);
  });
});

describe('BOOQ staff are blind to every F03 table (class D)', () => {
  it('booq_platform has no privilege on any table the registry lists for F03', async () => {
    const reg = await collectRegistry();
    const f03 = Object.keys(reg).filter((k) => ['public.orders', 'public.booking', 'public.occupancy', 'public.idempotency_key'].includes(k) || k.startsWith('public.booking') || k.startsWith('public.order'));
    expect(f03.length).toBeGreaterThanOrEqual(3);
    for (const t of f03) {
      expect(reg[t]?.class, t).toBe('D');
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', t, priv])).rows[0].ok, `${t} ${priv}`).toBe(false);
      }
    }
    for (const view of ['public.public_slot_state', 'public.public_day_state']) {
      expect((await tdb.query('select has_table_privilege($1, $2, $3) as ok', ['booq_platform', view, 'select'])).rows[0].ok, view).toBe(false);
    }
  });
});
