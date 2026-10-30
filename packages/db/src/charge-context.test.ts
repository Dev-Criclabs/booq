import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F05-T04b-db / migration 0412: app.payment_charge_context and app.record_charge
// (PAY-02-AC1 to AC3, PAY-01-AC1, AC4, AC7; D47, D72, D75).
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DESK = '33333333-3333-4333-8333-333333333333';
const LOC = '00000000-0000-4000-8000-0000000000a1';
const RES = '00000000-0000-4000-8000-0000000000c1';
let tdb: TestDatabase;
let web: Db;

const ctx = (user: string | null, roles: string[]) => ({ clubId: A, userId: user, roles: roles as never, source: 'player_app' as const });
const player = () => ctx(PLAYER, ['player']);

async function setup(status = 'live') {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A',$2)`, [A, status]);
  await tdb.query(`insert into public.location (club_id, id, name) values ($1,$2,'M')`, [A, LOC]);
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) values ($1,$2,$3,'1','tennis')`, [A, RES, LOC]);
  for (const [u, roles] of [[PLAYER, ['player']], [OTHER, ['player']], [DESK, ['front_desk', 'player']]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)', [A, u, 'L' + u.slice(0, 2)]);
      for (const r of roles) await c.query('insert into public.app_user_role (club_id, user_id, role) values ($1,$2,$3)', [A, u, r]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  web = createDb({ connectionString: tdb.url, max: 2 });
}
async function order(opts: { money?: number; priced?: boolean; hold?: 'running' | 'expired' | 'none'; customer?: string } = {}) {
  const money = opts.money ?? 50000;
  const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, opts.customer ?? PLAYER])).rows[0].id as string;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local session_replication_role = replica`);
    if (opts.priced !== false) {
      await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=$2, discount_satang=0, total_satang=$2, credit_value_satang=0, wallet_satang=0, money_satang=$2, quote_hash=repeat('a',64), priced_at=now() where id=$1`, [o, money]);
    }
    if ((opts.hold ?? 'running') !== 'none') {
      const hold = opts.hold === 'expired' ? `now() - interval '1 minute'` : `now() + interval '10 minutes'`;
      await c.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
                     values ($1,$2,'court',$3, date_trunc('hour', now()) + interval '30 hours', date_trunc('hour', now()) + interval '31 hours', $4, 'awaiting_payment','online',$4, ${hold})`, [A, o, RES, opts.customer ?? PLAYER]);
    }
    await c.query('commit');
  } finally {
    c.release();
  }
  return o;
}
const start = (o: string, c = player()) => web.withClubTx(c, async (tx) => (await tx.query(`select app.start_payment($1) as id`, [o])).rows[0]?.id as string);
const context = (p: string, c = player()) => web.withClubTx(c, async (tx) => (await tx.query(`select app.payment_charge_context($1) as j`, [p])).rows[0]?.j as Record<string, unknown>);
const record = (p: string, charge = 'chr_1', qr = 'iVBOR', exp = '2026-12-01T03:10:00Z', c = player()) =>
  web.withClubTx(c, async (tx) => tx.query(`select app.record_charge($1, $2, $3, $4)`, [p, charge, qr, exp]));
const connect = (test: string | null, live: string | null) =>
  tdb.query(`insert into public.payment_connection (club_id, merchant_id_test, merchant_id_live) values ($1,$2,$3)`, [A, test, live]);

afterEach(async () => {
  await web?.end();
  await tdb?.close();
});

describe('app.payment_charge_context', () => {
  beforeEach(async () => {
    await setup('live');
    await tdb.query(`update platform.config set value = '30'::jsonb where key = 'qr_expiry_margin_seconds'`);
  });

  it('gives the live merchant, amount, hold expiry and margin of the caller’s own pending payment', async () => {
    await connect('mt', 'ml');
    const p = await start(await order({ money: 45000 }));
    const j = await context(p);
    expect(j).toMatchObject({ merchant_id: 'ml', environment: 'live', amount_satang: 45000, qr_expiry_margin_seconds: 30 });
    expect(new Date(j.hold_expires_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(Object.keys(j).sort()).toEqual(['amount_satang', 'environment', 'hold_expires_at', 'merchant_id', 'qr_expiry_margin_seconds']);
  });

  it('a Testing club uses the test key set; no merchant or an unset margin is null, not a default', async () => {
    await tdb.query(`update public.club set status = 'testing'`);
    await connect('mt', 'ml');
    expect(await context(await start(await order()))).toMatchObject({ merchant_id: 'mt', environment: 'test' });
    await tdb.query(`update public.payment_connection set merchant_id_test = ''`);
    await tdb.query(`update platform.config set value = 'null'::jsonb where key = 'qr_expiry_margin_seconds'`);
    expect(await context(await start(await order()))).toMatchObject({ merchant_id: null, qr_expiry_margin_seconds: null });
  });

  it('staff may read any, another player may not, and a guest may not; a missing, cash or settled payment is the same refusal', async () => {
    const p = await start(await order());
    expect((await context(p, ctx(DESK, ['front_desk', 'player']))).environment).toBe('live');
    await expect(context(p, ctx(OTHER, ['player']))).rejects.toThrow(/no pending Beam payment/);
    await expect(context(p, ctx(null, ['guest']))).rejects.toThrow(/no pending Beam payment/);
    await expect(context('99999999-9999-4999-8999-999999999999')).rejects.toThrow(/no pending Beam payment/);
    await tdb.query(`update public.payment set status = 'cancelled' where id = $1`, [p]);
    await expect(context(p)).rejects.toThrow(/no pending Beam payment/);
  });

  it('the hold expiry is null when the hold is over', async () => {
    const o = await order();
    const p = await start(o);
    await tdb.advance('30 minutes');
    expect((await context(p)).hold_expires_at).toBeNull();
  });
});

describe('app.record_charge', () => {
  beforeEach(async () => {
    await setup('live');
  });
  const state = async (p: string) => (await tdb.query(`select gateway_charge_id, qr_image, qr_expires_at from public.payment where id = $1`, [p])).rows[0];

  it('writes the charge id, QR and expiry onto a pending Beam payment of the caller’s order; staff may too', async () => {
    const p = await start(await order());
    await record(p);
    expect(await state(p)).toMatchObject({ gateway_charge_id: 'chr_1', qr_image: 'iVBOR' });
    const q = await start(await order({ customer: OTHER }), ctx(OTHER, ['player']));
    await record(q, 'chr_2', 'x', '2026-12-01T03:10:00Z', ctx(DESK, ['front_desk', 'player']));
    expect((await state(q)).gateway_charge_id).toBe('chr_2');
  });

  it('refuses a second write: the first charge stands', async () => {
    const p = await start(await order());
    await record(p);
    await expect(record(p, 'chr_9')).rejects.toThrow(/already recorded/);
    expect((await state(p)).gateway_charge_id).toBe('chr_1');
  });

  it('refuses another player, a guest, a missing, settled or cash payment, and an empty charge', async () => {
    const p = await start(await order());
    await expect(record(p, 'c', 'q', '2026-12-01T03:10:00Z', ctx(OTHER, ['player']))).rejects.toThrow(/no pending Beam payment/);
    await expect(record(p, 'c', 'q', '2026-12-01T03:10:00Z', ctx(null, ['guest']))).rejects.toThrow(/no pending Beam payment/);
    await expect(record('99999999-9999-4999-8999-999999999999')).rejects.toThrow(/no pending Beam payment/);
    await expect(record(p, '')).rejects.toThrow(/invalid charge/);
    await expect(record(p, 'c', ' ')).rejects.toThrow(/invalid charge/);
    await expect(record(p, 'c', 'q', null as never)).rejects.toThrow(/invalid charge/);
    await tdb.query(`update public.payment set status = 'failed' where id = $1`, [p]);
    await expect(record(p)).rejects.toThrow(/no pending Beam payment/);
    expect((await state(p)).gateway_charge_id).toBeNull();
  });

  it('a charge id already on another payment is refused', async () => {
    const p = await start(await order());
    await record(p);
    const q = await start(await order({ customer: OTHER }), ctx(OTHER, ['player']));
    await expect(record(q, 'chr_1', 'q', '2026-12-01T03:10:00Z', ctx(OTHER, ['player']))).rejects.toThrow(/belongs to another payment/);
  });

  it('is granted to booq_app only', async () => {
    for (const f of ['app.payment_charge_context(uuid)', 'app.record_charge(uuid, text, text, timestamptz)']) {
      expect((await tdb.query(`select has_function_privilege('booq_app', $1, 'execute') as ok`, [f])).rows[0].ok).toBe(true);
      for (const r of ['booq_worker', 'booq_platform']) expect((await tdb.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, f])).rows[0].ok).toBe(false);
    }
  });
});
