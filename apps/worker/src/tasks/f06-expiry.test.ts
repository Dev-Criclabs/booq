import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { closeTestDatabase } from '../testing/teardown';
import { PACKAGE_EXPIRE, SESSION_START, WALLET_EXPIRE, runPackageExpire, runSessionStart, runWalletExpire } from './f06-expiry';

// F06-T13 package_expire, wallet_expire and session_start (PKG-03-AC3, AC10, R1-AC3; D85, D89, D90). Per club, idempotent,
// on the test clock.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PA = '00000000-0000-4000-8000-000000000001';
const PB = '00000000-0000-4000-8000-000000000002';
const EXPIRES = '2027-04-05T16:59:59.999Z';           // 5 Apr 2027 23:59:59.999 Bangkok

let tdb: TestDatabase;
let worker: Db;
const pkg: Record<string, string> = {};
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live')`, [A, B]);
  for (const [club, u] of [[A, PA], [B, PB]] as const) {
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,$3)`, [club, u, 'L' + club.slice(0, 2)]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player')`, [club, u]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const product = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                                       values ($1,'10','10','court_hour',10,3,450000) returning id`, [club])).rows[0].id;
    pkg[club] = (await tdb.query(`insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
                                  values ($1,$2,$3,'{"credit_type":"court_hour"}',5,'2027-01-04T17:30:00Z',$4) returning id`, [club, u, product, EXPIRES])).rows[0].id;
  }
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await worker.end();
  await closeTestDatabase(tdb);
});
const status = async (club: string) => {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [club]);
    return (await c.query('select status, credits_left from public.package_status where package_id = $1', [pkg[club]])).rows[0];
  } finally {
    await c.query('rollback');
    c.release();
  }
};
const heartbeat = async (task: string) => (await tdb.query(`select runs::int as runs, last_succeeded_at is not null as ok from platform.worker_heartbeat where task_name = $1`, [task])).rows[0];

describe('package_expire (PKG-03-AC3)', () => {
  it('at 23:59:59 Bangkok on the expiry date the package is active; at 00:00:00 the next day it is expired and written off', async () => {
    await tdb.setNow('2027-04-05T16:59:59.000Z');                 // 23:59:59 Bangkok on 5 Apr
    expect(await runPackageExpire(worker)).toEqual({ due: 0, expired: 0, failed: 0 });
    expect(await status(A)).toEqual({ status: 'active', credits_left: 5 });
    await tdb.setNow('2027-04-05T17:00:00.000Z');                 // 00:00:00 Bangkok on 6 Apr
    expect(await runPackageExpire(worker)).toEqual({ due: 2, expired: 2, failed: 0 });
    expect(await status(A)).toEqual({ status: 'expired', credits_left: 0 });
    expect(await status(B)).toEqual({ status: 'expired', credits_left: 0 });
  });
  it('run twice writes once', async () => {
    await tdb.setNow('2027-04-06T03:00:00Z');
    await runPackageExpire(worker);
    expect(await runPackageExpire(worker)).toEqual({ due: 0, expired: 0, failed: 0 });
    expect((await tdb.query(`select count(*)::int as n from public.credit_ledger where reason = 'expire'`)).rows[0].n).toBe(2);
    expect(await heartbeat(PACKAGE_EXPIRE)).toEqual({ runs: 2, ok: true });
  });
  it('a paused club waits for its resume', async () => {
    await tdb.query(`update public.club set status = 'paused' where id = $1`, [A]);
    await tdb.setNow('2027-04-06T03:00:00Z');
    expect(await runPackageExpire(worker)).toEqual({ due: 1, expired: 1, failed: 0 });
    expect(await status(A)).toEqual({ status: 'expired', credits_left: 5 });    // expired by time, nothing written off yet
  });
});

describe('wallet_expire (PKG-03-AC10, D89)', () => {
  const credit = (club: string, u: string, amount: number) =>
    tdb.query(`insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key, created_at) values ($1,$2,$3,'refund',$4,'2027-01-05T03:00:00Z')`, [club, u, amount, 'r:' + club]);
  const balance = async (u: string) => Number((await tdb.query(`select coalesce(sum(change_satang), 0) as n from public.wallet_ledger where customer_id = $1`, [u])).rows[0].n);
  it('does nothing in a club whose wallet expiry is unset; expires once where it is set', async () => {
    await credit(A, PA, 10000);
    await credit(B, PB, 10000);
    await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'wallet_expiry_months','3')`, [A]);
    await tdb.setNow('2027-04-05T17:00:00Z');                     // 6 Apr Bangkok: past 5 Apr 23:59
    expect(await runWalletExpire(worker)).toEqual({ due: 1, expired: 1, failed: 0 });
    expect(await balance(PA)).toBe(0);
    expect(await balance(PB)).toBe(10000);
    expect(await runWalletExpire(worker)).toEqual({ due: 0, expired: 0, failed: 0 });
    expect(await heartbeat(WALLET_EXPIRE)).toEqual({ runs: 2, ok: true });
  });
});

describe('session_start (R1-AC3)', () => {
  it('the reserved credit of a booking that started becomes used, once', async () => {
    const loc = (await tdb.query(`insert into public.location (club_id, name) values ($1,'M') returning id`, [A])).rows[0].id;
    const court = (await tdb.query(`insert into public.resource (club_id, location_id, name, sport) values ($1,$2,'1','tennis') returning id`, [A, loc])).rows[0].id;
    const c = await tdb.pool.connect();
    let booking = '';
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');   // fixture: a paid order and its booking
      const o = (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, PA])).rows[0].id;
      booking = (await c.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
                                values ($1,$2,'court',$3,'2027-02-10T03:00:00Z','2027-02-10T04:00:00Z',$4,'confirmed','online',$4,now()) returning id`, [A, o, court, PA])).rows[0].id;
      const line = (await c.query(`insert into public.order_line (club_id, order_id, position, kind, booking_id, description_key, name_th, name_en, unit_price_satang, net_satang, credit_package_id, credit_units, credit_value_satang)
                                   values ($1,$2,1,'court_hour',$3,'k','ก','x',50000,50000,$4,1,50000) returning id`, [A, o, booking, pkg[A]])).rows[0].id;
      await c.query('commit');
      await c.query('begin');
      await c.query('set local role booq_owner');
      await c.query(`select set_config('app.club_id', $1, true)`, [A]);
      await c.query('select app.credit_reserve($1, $2, $3)', [pkg[A], booking, line]);
      await c.query('commit');
    } finally {
      c.release();
    }
    await tdb.setNow('2027-02-10T02:59:00Z');
    expect(await runSessionStart(worker)).toEqual({ due: 0, expired: 0, failed: 0 });
    await tdb.setNow('2027-02-10T03:00:00Z');
    expect(await runSessionStart(worker)).toEqual({ due: 1, expired: 1, failed: 0 });
    expect(await runSessionStart(worker)).toEqual({ due: 0, expired: 0, failed: 0 });
    expect((await tdb.query(`select count(*)::int as n from public.credit_ledger where booking_id = $1 and reason = 'use'`, [booking])).rows[0].n).toBe(1);
    expect(await heartbeat(SESSION_START)).toEqual({ runs: 3, ok: true });
  });
});
