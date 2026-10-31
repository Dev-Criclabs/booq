import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { createTestDatabase, type TestDatabase } from './testing/harness';

// F06-T14 / migration 0514: package_expiring is queued at grant, extension and pause (PKG-03-AC1, AC2, AC6,
// LINE-05-AC7; D116). The days come from the club setting package_expiry_reminder_days.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const OWNER = '44444444-4444-4444-8444-444444444444';

let tdb: TestDatabase;
let web: Db;
let product: string;
beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  for (const [u, roles] of [[PLAYER, ['player']], [OWNER, ['owner', 'player']]] as const) {
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
  await tdb.query(`insert into public.club_setting (club_id, key, value) values ($1,'package_expiry_reminder_days','[14, 3]')`, [A]);
  product = (await tdb.query(`insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_satang)
                              values ($1,'10','10 hours','court_hour',10,3,450000) returning id`, [A])).rows[0].id;
  web = createDb({ connectionString: tdb.url, max: 2 });
  await tdb.setNow('2027-01-05T03:00:00Z');          // 5 Jan 2027 10:00 Bangkok
});
afterEach(async () => {
  await web.end();
  await tdb.close();
});

async function asDefiner<T = unknown>(sql: string, args: unknown[] = []): Promise<T> {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role booq_owner');
    await c.query(`select set_config('app.club_id', $1, true)`, [A]);
    const r = Object.values((await c.query(sql, args)).rows[0] ?? {})[0] as T;
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
async function grant() {
  const c = await tdb.pool.connect();
  let o = '';
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');   // fixture: a paid package order
    o = (await c.query(`insert into public.orders (club_id, customer_id, source, status) values ($1,$2,'online','paid') returning id`, [A, PLAYER])).rows[0].id;
    await c.query(`insert into public.order_line (club_id, order_id, position, kind, package_product_id, description_key, name_th, name_en, unit_price_satang, net_satang, money_satang)
                   values ($1,$2,1,'package',$3,'k','ก','x',450000,450000,450000)`, [A, o, product]);
    await c.query('commit');
  } finally {
    c.release();
  }
  await asDefiner('select app.grant_package($1)', [o]);
  return (await tdb.query(`select id from public.customer_package where order_id = $1`, [o])).rows[0].id as string;
}
const outbox = async () =>
  (await tdb.query(`select kind, user_id, status, void_reason, dedupe_key, send_at, params from public.message_outbox order by send_at, dedupe_key`)).rows;
const bkk = (t: Date) => t.toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' });

describe('reminders at grant (PKG-03-AC1, D116)', () => {
  it('one package_expiring per setting value, at 09:00 Bangkok N days before the expiry date (D169), to the player, once each', async () => {
    const pkg = await grant();                         // expires 5 Apr 2027 23:59:59.999 Bangkok
    const rows = await outbox();
    expect(rows.map((r) => [r.kind, r.user_id, r.status, bkk(r.send_at)])).toEqual([
      ['package_expiring', PLAYER, 'pending', '2027-03-22 09:00:00'],
      ['package_expiring', PLAYER, 'pending', '2027-04-02 09:00:00'],
    ]);
    expect(rows.map((r) => r.dedupe_key)).toEqual([`package_expiring:${pkg}:2027-04-05T16:59:59.999000Z:14`, `package_expiring:${pkg}:2027-04-05T16:59:59.999000Z:3`]);
    expect(rows[0]?.params).toEqual({ package_id: pkg });
    await asDefiner('select app.package_reminder_hook($1)', [pkg]);    // called again: the same keys, no second row
    expect((await outbox()).filter((r) => r.status === 'pending')).toHaveLength(2);
  });
  it('the days come from the setting: another club value gives other dates; unset gives none', async () => {
    await tdb.query(`update public.club_setting set value = '[7]' where club_id = $1`, [A]);
    await grant();
    expect((await outbox()).map((r) => bkk(r.send_at))).toEqual(['2027-03-29 09:00:00']);
    await tdb.query(`delete from public.club_setting where club_id = $1`, [A]);
    await tdb.query(`delete from public.message_outbox`);
    await grant();
    expect(await outbox()).toEqual([]);
  });
  it('the send time is 09:00 Bangkok whatever the UTC date (an expiry on 1 Mar sends on 26 Feb, across the month end)', async () => {
    const pkg = await grant();
    await tdb.query(`update public.customer_package set expires_at = '2027-03-01T16:59:59.999Z' where id = $1`, [pkg]);
    await asDefiner('select app.package_reminder_hook($1)', [pkg]);
    expect((await outbox()).filter((r) => r.status === 'pending').map((r) => [r.send_at.toISOString(), bkk(r.send_at)])).toEqual([
      ['2027-02-15T02:00:00.000Z', '2027-02-15 09:00:00'],
      ['2027-02-26T02:00:00.000Z', '2027-02-26 09:00:00'],
    ]);
  });
  it('a reminder date already past is not queued', async () => {
    await tdb.setNow('2027-03-30T03:00:00Z');          // a later purchase: expiry 30 Jun; nothing past. Then move the clock:
    const pkg = await grant();
    await tdb.query(`delete from public.message_outbox`);
    await tdb.setNow('2027-06-20T03:00:00Z');          // 10 days before expiry: only the 3 day reminder is still ahead
    await asDefiner('select app.package_reminder_hook($1)', [pkg]);
    expect((await outbox()).map((r) => r.dedupe_key.split(':').at(-1))).toEqual(['3']);
  });
  it('a package with no credits left gets no reminder', async () => {
    const pkg = await grant();
    await tdb.query(`delete from public.message_outbox`);
    await tdb.query(`insert into public.credit_ledger (club_id, package_id, change, reason, staff_id, note) values ($1,$2,-10,'adjust',$3,'used up')`, [A, pkg, OWNER]);
    await asDefiner('select app.package_reminder_hook($1)', [pkg]);
    expect(await outbox()).toEqual([]);
  });
});

describe('an extension or a pause moves the reminders (PKG-03-AC6)', () => {
  it('the owner’s extension voids the old rows and queues new ones for the new date', async () => {
    const pkg = await grant();
    await web.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' }, (tx) =>
      tx.query('select app.extend_package($1, $2, $3)', [pkg, '2027-04-20T16:59:59.999Z', 'injury']));
    const rows = await outbox();
    expect(rows.filter((r) => r.status === 'void').map((r) => r.void_reason)).toEqual(['superseded', 'superseded']);
    expect(rows.filter((r) => r.status === 'pending').map((r) => bkk(r.send_at))).toEqual(['2027-04-06 09:00:00', '2027-04-17 09:00:00']);
  });
  it('a reminder already sent is not repeated by an extension; the new date gets its own', async () => {
    const pkg = await grant();
    await tdb.query(`update public.message_outbox set status = 'sent', sent_at = now() where dedupe_key like '%:14'`).catch(async () =>
      tdb.query(`update public.message_outbox set status = 'sent' where dedupe_key like '%:14'`));
    await web.withClubTx({ clubId: A, userId: OWNER, roles: ['owner', 'player'], source: 'admin' }, (tx) =>
      tx.query('select app.extend_package($1, $2, $3)', [pkg, '2027-04-20T16:59:59.999Z', 'injury']));
    const rows = await outbox();
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(1);                     // the old 14 day message stays sent
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(2);                  // the new date's 14 and 3
  });
  it('a resume after a pause moves them too', async () => {
    await grant();
    await tdb.query(`insert into public.club_pause (club_id, paused_at, pause_reason, paused_by, resumed_at, resume_reason, resumed_by)
                     values ($1,'2027-02-01T03:00:00Z','storm',gen_random_uuid(),'2027-02-11T03:00:00Z','fixed',gen_random_uuid())`, [A]);
    await tdb.setNow('2027-02-11T03:00:00Z');
    await asDefiner(`select app.extend_for_pause($1, '2027-02-01T03:00:00Z', '2027-02-11T03:00:00Z')`, [A]);
    const pending = (await outbox()).filter((r) => r.status === 'pending').map((r) => bkk(r.send_at));
    expect(pending).toEqual(['2027-04-01 09:00:00', '2027-04-12 09:00:00']);           // expiry 15 Apr: minus 14 and minus 3
  });
});
