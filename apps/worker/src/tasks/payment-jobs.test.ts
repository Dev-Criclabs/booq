import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { closeTestDatabase } from '../testing/teardown';
import { runPackageOrderExpiry } from './payment-jobs';
import { closeTestDatabase } from '../testing/teardown';

// F05-T09 package_order_expiry through the worker (PAY-04-AC2, D74): walks the clubs, each in its own context; a package
// order past its QR time is cancelled and its payment expired with no QR, the other club is untouched.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PA = '00000000-0000-4000-8000-000000000001';
const PB = '00000000-0000-4000-8000-000000000002';

let tdb: TestDatabase;
let worker: Db;

async function packageOrder(club: string, player: string, qrEnds: string): Promise<{ order: string; payment: string }> {
  const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [club, player])).rows[0].id as string;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`update public.orders set price_group_snapshot='{}', subtotal_satang=90000, discount_satang=0, total_satang=90000, credit_value_satang=0,
                   wallet_satang=0, money_satang=90000, quote_hash=repeat('c',64), priced_at=now() where id=$1`, [o]);
    const product = (await c.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                                    values ($1,'บันเดิล','Bundle','court_hour',10,6,90000) returning id`, [club])).rows[0].id as string;
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en,
                   unit_price_satang, discount_satang, net_satang, money_satang) values ($1,$2,1,'package',$3,'P-0021','บันเดิล','Bundle',90000,0,90000,90000)`, [club, o, product]);
    await c.query('commit');
  } finally {
    c.release();
  }
  const p = (await tdb.query(`insert into public.payment (club_id, order_id, method, status, environment, gateway, gateway_charge_id, amount_satang, qr_image, qr_expires_at)
                              values ($1,$2,'beam','pending','live','beam','chg_'||gen_random_uuid(),90000,'QR',$3) returning id`, [club, o, qrEnds])).rows[0].id as string;
  return { order: o, payment: p };
}

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, id] of [[A, PA], [B, PB]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [club, id, `L-${club.slice(0, 4)}`]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, id]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await worker.end();
  await closeTestDatabase(tdb);
});

describe('runPackageOrderExpiry', () => {
  it('expires the due package order of each club in its own context and leaves one still within its time', async () => {
    const dueA = await packageOrder(A, PA, '2000-01-01T00:00:00Z');
    const liveB = await packageOrder(B, PB, '2999-01-01T00:00:00Z');
    const r = await runPackageOrderExpiry(worker);
    expect(r).toMatchObject({ acted: 1, failed: 0 });
    expect(r.clubs).toBeGreaterThanOrEqual(2);
    expect((await tdb.query(`select status from public.orders where id = $1`, [dueA.order])).rows[0].status).toBe('cancelled');
    expect((await tdb.query(`select status, qr_image from public.payment where id = $1`, [dueA.payment])).rows[0]).toEqual({ status: 'expired', qr_image: null });
    expect((await tdb.query(`select status from public.orders where id = $1`, [liveB.order])).rows[0].status).toBe('open');
    // A second run does nothing more.
    expect(await runPackageOrderExpiry(worker)).toMatchObject({ acted: 0, failed: 0 });
  });
});
