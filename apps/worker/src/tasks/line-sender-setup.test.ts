import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import { encryptSecret, generateKeyPair } from '@booq/secrets';
import { FakeClock, FakeLine, collectActions } from '../../../../tests/fakes';
import { closeTestDatabase } from '../testing/teardown';
import { createLineSender, createLineUsageDeps } from './line-sender-setup';
import { runLineUsageSync } from './line-usage';

// The real sender as main.ts builds it (F10-T08 to T10 wired, orchestrator 31 Oct): the HTTP transport against the fake
// LINE's server, the club token decrypted from club_secret with the worker key, the dictionary from locales/*, and View
// booking built by F02's deep link helper from the club's LIFF id. LINE-03-AC1, LINE-04-AC1, D6, D149.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const P = '11111111-1111-4111-8111-111111111111';
const LIFF = '2012300015-WIi1jtLB';
const TOKEN = 'channel-token-of-club-a';

let tdb: TestDatabase;
let worker: Db;
let line: FakeLine;
let served: { url: string; close: () => Promise<void> };
let keys: { publicKey: string; privateKey: string };

beforeEach(async () => {
  tdb = await createTestDatabase();
  keys = generateKeyPair();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live')`, [A]);
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query(`insert into public.app_user (club_id, id, line_user_id, language) values ($1,$2,'Up','en')`, [A, P]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'owner'), ($1,$2,'player')`, [A, P]);
    await c.query('commit');
  } finally {
    c.release();
  }
  const sealed = encryptSecret(keys.publicKey, TOKEN, { clubId: A, kind: 'line_channel_token' });
  await tdb.query(`insert into public.club_secret (club_id, kind, ciphertext, key_id, written_by_user) values ($1,'line_channel_token',$2,$3,$4)`, [A, sealed.ciphertext, sealed.keyId, P]);
  await tdb.query(`insert into public.line_connection (club_id, liff_id) values ($1,$2) on conflict (club_id) do update set liff_id = excluded.liff_id`, [A, LIFF]);
  line = new FakeLine({ clock: new FakeClock(), channels: [{ clubId: A, channelAccessToken: TOKEN, loginChannelId: '2012300015', liffId: LIFF }],
    users: [{ lineUserId: 'Up', displayName: 'p', lineAppLanguage: 'en', friendOf: { [A]: true } }] });
  served = await line.serve();
  worker = createDb({ connectionString: tdb.url, max: 2, role: 'booq_worker' });
});
afterEach(async () => {
  await served?.close();
  await worker?.end();
  if (tdb) await closeTestDatabase(tdb);
});

/** A confirmed one hour booking of P, with its order (fixture rows, triggers off). */
async function booking() {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const loc = (await c.query(`insert into public.location (club_id, name) values ($1,'M') returning id`, [A])).rows[0].id;
    const res = (await c.query(`insert into public.resource (club_id, location_id, name, sport) values ($1,$2,'4','tennis') returning id`, [A, loc])).rows[0].id;
    const o = (await c.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P])).rows[0].id as string;
    const b = (await c.query(`insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
                              values ($1,$2,'court',$3, date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 1 hour', $4, 'confirmed', 'online', $4, now()) returning id`, [A, o, res, P])).rows[0].id as string;
    await c.query('commit');
    return { order: o, booking: b };
  } finally {
    c.release();
  }
}

describe('createLineSender', () => {
  it('sends a queued confirmation over HTTP with the club’s decrypted token; View booking opens the club’s LIFF app', async () => {
    const { order, booking: b } = await booking();
    await tdb.query(`insert into public.message_outbox (club_id, user_id, kind, params, dedupe_key, send_at) values ($1,$2,'booking_confirmed',$3::jsonb,$4, now() - interval '1 minute')`,
      [A, P, JSON.stringify({ order_id: order }), `confirmed:${order}`]);
    const sender = createLineSender(worker, { lineApiBaseUrl: served.url, linePushTimeoutMs: 2000, localesDir: resolve(__dirname, '../../../../locales'), privateKey: keys.privateKey });
    const r = await sender.run();
    expect(r).toMatchObject({ sent: 1 });
    const pushed = line.pushes({ clubId: A });
    expect(pushed.map((p) => [p.channelAccessToken, p.to])).toEqual([[TOKEN, 'Up']]);
    const uris = collectActions(pushed[0]!.messages[0]).map((a) => a.uri);
    expect(uris).toEqual([`https://liff.line.me/${LIFF}/bookings/${b}`, `https://liff.line.me/${LIFF}/bookings/${b}/calendar`]);
  });

  it('a club with no LIFF app yet: the message goes without its buttons', async () => {
    await tdb.query(`update public.line_connection set liff_id = null where club_id = $1`, [A]);
    const { order } = await booking();
    await tdb.query(`insert into public.message_outbox (club_id, user_id, kind, params, dedupe_key, send_at) values ($1,$2,'booking_confirmed',$3::jsonb,$4, now() - interval '1 minute')`,
      [A, P, JSON.stringify({ order_id: order }), `confirmed:${order}`]);
    await createLineSender(worker, { lineApiBaseUrl: served.url, linePushTimeoutMs: 2000, localesDir: resolve(__dirname, '../../../../locales'), privateKey: keys.privateKey }).run();
    expect(collectActions(line.pushes({ clubId: A })[0]!.messages[0])).toEqual([]);
  });
});

describe('createLineUsageDeps (F10-T13)', () => {
  it('reads LINE’s consumption over HTTP with the club’s decrypted token into this month’s usage row', async () => {
    const { order } = await booking();
    await tdb.query(`insert into public.message_outbox (club_id, user_id, kind, params, dedupe_key, send_at) values ($1,$2,'booking_confirmed',$3::jsonb,$4, now() - interval '1 minute')`,
      [A, P, JSON.stringify({ order_id: order }), `confirmed:${order}`]);
    await createLineSender(worker, { lineApiBaseUrl: served.url, linePushTimeoutMs: 2000, localesDir: resolve(__dirname, '../../../../locales'), privateKey: keys.privateKey }).run();
    await tdb.query(`update public.line_connection set line_plan_kind = 'paid', plan_message_limit = 500 where club_id = $1`, [A]);
    const r = await runLineUsageSync(worker, createLineUsageDeps({ lineApiBaseUrl: served.url, linePushTimeoutMs: 2000, privateKey: keys.privateKey }));
    expect(r).toMatchObject({ clubs: 1, fromLine: 1, errors: 0 });
    // The fake LINE has no quota route (its answer is 404): the plan limit from P2 step 4 is used, and the check says so.
    expect((await tdb.query(`select used, line_consumption, message_limit, source from platform.club_line_usage where club_id = $1`, [A])).rows)
      .toEqual([{ used: 1, line_consumption: 1, message_limit: 500, source: 'line' }]);
    expect((await tdb.query(`select status, reason from platform.club_health where club_id = $1 and check_key = 'line_usage'`, [A])).rows[0]).toEqual({ status: 'failed', reason: 'http_404' });
  });
});
