import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@booq/db';
import { createTestDatabase, type TestDatabase } from '@booq/db/testing';
import type { LineTransport, MessageBuilder } from '@booq/line';
import { FakeClock, FakeLine, type ClubLineChannel } from '../../../../tests/fakes';
import { OUTBOX_SENDER, runOutboxSender } from './line-outbox-sender';

// F10-T08 outbox_sender steps 1 to 4 (F10 design 5.2; FA 5.3): claim due rows with SKIP LOCKED per club, the send
// time preconditions, the cap gate, the language at send time. LINE-03-AC1 to AC3, LINE-05, D93, D94. Against the
// fake LINE; the push and its results in full are F10-T09, the Flex templates F10-T10.
const A = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const T = 'c0ffee00-1111-4222-8333-444455556666';
const P = '11111111-1111-4111-8111-111111111111';
const PB = '22222222-2222-4222-8222-222222222222';
const PT = '33333333-3333-4333-8333-333333333333';
const NOLINE = '44444444-4444-4444-8444-444444444444';
const MONTH = `date_trunc('month', now() at time zone 'Asia/Bangkok')::date`;

let tdb: TestDatabase;
let worker: Db;
let line: FakeLine;
const channels: ClubLineChannel[] = [A, B, T].map((clubId) => ({ clubId, channelAccessToken: `tok-${clubId}`, loginChannelId: `login-${clubId}`, liffId: `liff-${clubId}` }));

// Test doubles at the two seams. The builder records the language it was asked for (the real one, reading
// locales/*, is F10-T10); the transport pushes to the fake LINE with the club's token (the real adapter is F10-T09).
let built: Array<{ kind: string; language: string }>;
const builder: MessageBuilder = {
  build(m) {
    built.push({ kind: m.kind, language: m.language });
    return [{ type: 'text', text: `${m.kind}:${m.language}` }];
  },
};
const transport: LineTransport = {
  async push(input) {
    const r = line.push(`tok-${input.clubId}`, { to: input.to, messages: input.messages });
    return r.status === 200 ? { ok: true } : { ok: false, status: r.status, code: `http_${r.status}` };
  },
};
const run = () => runOutboxSender(worker, { builder, transport });

async function person(club: string, id: string, lineId: string | null, language: string | null) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    // No LINE id: an imported player who has not claimed their record yet (F02, 0103).
    await c.query('insert into public.app_user (club_id, id, line_user_id, language, claim_state) values ($1,$2,$3,$4,$5)',
      [club, id, lineId, language, lineId === null ? 'unclaimed' : null]);
    await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [club, id]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const msg = (kind: string, key: string, o: { club?: string; user?: string; params?: object; sendAt?: string } = {}) =>
  tdb.query(`insert into public.message_outbox (club_id, user_id, kind, params, dedupe_key, send_at) values ($1,$2,$3,$4::jsonb,$5, ${o.sendAt ?? `now() - interval '1 minute'`}) returning id`,
    [o.club ?? A, o.user ?? P, kind, JSON.stringify(o.params ?? {}), key]).then((r) => r.rows[0].id as string);
const rowOf = async (id: string) => (await tdb.query(`select status, void_reason, last_error, sent_at from public.message_outbox where id = $1`, [id])).rows[0];

/** A confirmed booking of P on the hour `ahead` from now, written with triggers off (fixture). */
async function booking(ahead: string, status = 'confirmed') {
  const loc = (await tdb.query(`insert into public.location (club_id, name) values ($1,'M') returning id`, [A])).rows[0].id;
  const res = (await tdb.query(`insert into public.resource (club_id, location_id, name, sport) values ($1,$2,'1','tennis') returning id`, [A, loc])).rows[0].id;
  const o = (await tdb.query(`insert into public.orders (club_id, customer_id, source) values ($1,$2,'online') returning id`, [A, P])).rows[0].id;
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const b = await c.query(
      `insert into public.booking (club_id, order_id, type, resource_id, start_at, end_at, customer_id, status, source, created_by, confirmed_at)
       values ($1,$2,'court',$3, date_trunc('hour', now() + $5::interval), date_trunc('hour', now() + $5::interval) + interval '1 hour', $4, $6, 'online', $4,
               case when $6 = 'confirmed' then now() end) returning id, start_at`, [A, o, res, P, ahead, status]);
    await c.query('commit');
    return b.rows[0] as { id: string; start_at: Date };
  } finally {
    c.release();
  }
}
const reminderKey = (b: { id: string; start_at: Date }, n: number) => `reminder:${b.id}:${b.start_at.toISOString().slice(0, 16)}Z:${n}`;

beforeEach(async () => {
  tdb = await createTestDatabase();
  await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'a','ก','A','live'), ($2,'b','ข','B','live'), ($3,'t','ท','T','testing')`, [A, B, T]);
  await person(A, P, 'Up', 'th');
  await person(B, PB, 'Upb', 'en');
  await person(T, PT, 'Upt', 'en');
  await person(A, NOLINE, null, 'th');
  worker = createDb({ connectionString: tdb.url, max: 3, role: 'booq_worker' });
  line = new FakeLine({ clock: new FakeClock(), channels, users: [
    { lineUserId: 'Up', displayName: 'p', lineAppLanguage: 'th', friendOf: { [A]: true } },
    { lineUserId: 'Upb', displayName: 'pb', lineAppLanguage: 'en', friendOf: { [B]: true } },
    { lineUserId: 'Upt', displayName: 'pt', lineAppLanguage: 'en', friendOf: { [T]: true } },
  ] });
  built = [];
});
afterEach(async () => {
  await worker?.end();
  await tdb?.close();
});

describe('claim and send (FA 5.3)', () => {
  it('sends each due row once with its own club’s token to the person’s LINE id, and leaves rows not yet due', async () => {
    const a = await msg('booking_confirmed', 'confirmed:a');
    const b = await msg('booking_confirmed', 'confirmed:b', { club: B, user: PB });
    const later = await msg('booking_confirmed', 'confirmed:later', { sendAt: `now() + interval '1 hour'` });
    const r = await run();
    expect(r).toMatchObject({ sent: 2 });
    expect(line.pushes().map((p) => [p.clubId, p.channelAccessToken, p.to]).sort()).toEqual([[A, `tok-${A}`, 'Up'], [B, `tok-${B}`, 'Upb']].sort());
    expect((await rowOf(a)).status).toBe('sent');
    expect((await rowOf(b)).status).toBe('sent');
    expect((await rowOf(later)).status).toBe('pending');
    await run();
    expect(line.pushes().length).toBe(2);
  });

  it('two sender processes send each row once (SKIP LOCKED)', async () => {
    for (let i = 0; i < 6; i++) await msg('booking_confirmed', `confirmed:${i}`);
    const slow: LineTransport = { push: async (i) => { await new Promise((r) => setTimeout(r, 30)); return transport.push(i); } };
    const second = createDb({ connectionString: tdb.url, max: 3, role: 'booq_worker' });
    try {
      await Promise.all([runOutboxSender(worker, { builder, transport: slow }), runOutboxSender(second, { builder, transport: slow })]);
    } finally {
      await second.end();
    }
    expect(line.pushes().length).toBe(6);
    expect((await tdb.query(`select count(*)::int as n from public.message_outbox where status = 'sent'`)).rows[0].n).toBe(6);
  });

  it('sends a Testing club’s messages too (D32: they count toward the cap)', async () => {
    const id = await msg('booking_confirmed', 'confirmed:t', { club: T, user: PT });
    await run();
    expect((await rowOf(id)).status).toBe('sent');
    expect(line.pushes({ clubId: T }).length).toBe(1);
  });

  it('records its run in the heartbeat', async () => {
    await run();
    expect((await tdb.query(`select runs from platform.worker_heartbeat where task_name = $1`, [OUTBOX_SENDER])).rows[0].runs).toBe('1');
  });
});

describe('send time preconditions (design 5.2 step 1)', () => {
  it('a cancelled booking voids its reminder, a moved one voids the old reminder, a confirmed one sends', async () => {
    const live = await booking('3 hours');
    const ok = await msg('reminder_2h', reminderKey(live, 2), { params: { booking_id: live.id } });
    const gone = await booking('3 hours', 'cancelled');
    const cancelled = await msg('reminder_2h', reminderKey(gone, 2), { params: { booking_id: gone.id } });
    const moved = await booking('3 hours');
    const stale = await msg('reminder_2h', reminderKey({ id: moved.id, start_at: new Date(moved.start_at.getTime() - 86400000) }, 2), { params: { booking_id: moved.id } });
    await run();
    expect(await rowOf(ok)).toMatchObject({ status: 'sent' });
    expect(await rowOf(cancelled)).toMatchObject({ status: 'void', void_reason: 'cancelled' });
    expect(await rowOf(stale)).toMatchObject({ status: 'void', void_reason: 'moved' });
    expect(line.pushes().length).toBe(1);
  });

  it('a switch turned off voids a reminder, a birthday and a reward message, and not a confirmation (D94)', async () => {
    await tdb.query(`insert into public.notification_pref (club_id, user_id, reminders, promotions) values ($1,$2,false,false)`, [A, P]);
    const b = await booking('3 hours');
    const rem = await msg('reminder_2h', reminderKey(b, 2), { params: { booking_id: b.id } });
    const bday = await msg('birthday_discount', 'birthday:x:2026', { params: { year: 2026 } });
    const reward = await msg('referral_reward', 'reward:r1');
    const conf = await msg('booking_confirmed', 'confirmed:c');
    await run();
    for (const id of [rem, bday, reward]) expect(await rowOf(id)).toMatchObject({ status: 'void', void_reason: 'switch_off' });
    expect(await rowOf(conf)).toMatchObject({ status: 'sent' });
  });

  it('promotions are off until the person opts in (A-2): no switch row means no birthday message', async () => {
    const bday = await msg('birthday_discount', 'birthday:y:2026');
    await run();
    expect(await rowOf(bday)).toMatchObject({ status: 'void', void_reason: 'switch_off' });
  });

  it('a package with no credits left skips its expiry reminder (no_credits)', async () => {
    // F06's app.package_credits_left decides; a package id that does not exist has none left.
    const id = await msg('package_expiring', 'package_expiring:p:e:3', { params: { package_id: '99999999-9999-4999-8999-999999999999' } });
    await run();
    expect(await rowOf(id)).toMatchObject({ status: 'void', void_reason: 'no_credits' });
  });

  it('a person without a LINE id cannot be sent to: undeliverable, not retried', async () => {
    const id = await msg('booking_confirmed', 'confirmed:n', { user: NOLINE });
    await run();
    expect(await rowOf(id)).toMatchObject({ status: 'undeliverable', last_error: 'no_line_id' });
  });
});

describe('the cap gate (design 5.2 step 2, LINE-07-AC2)', () => {
  it('a due reminder at 80 percent is voided with cap and not sent; a confirmation still goes', async () => {
    await tdb.query(`insert into platform.club_line_usage (club_id, month, used, message_limit, plan_kind, source) values ($1, ${MONTH}, 800, 1000, 'paid', 'line')`, [A]);
    const b = await booking('3 hours');
    const rem = await msg('reminder_2h', reminderKey(b, 2), { params: { booking_id: b.id } });
    const conf = await msg('booking_confirmed', 'confirmed:k');
    await run();
    expect(await rowOf(rem)).toMatchObject({ status: 'void', void_reason: 'cap' });
    expect(await rowOf(conf)).toMatchObject({ status: 'sent' });
  });

  it('on a free plan at 100 percent a message is undeliverable and the push is not attempted', async () => {
    await tdb.query(`insert into platform.club_line_usage (club_id, month, used, message_limit, plan_kind, source) values ($1, ${MONTH}, 1000, 1000, 'free', 'line')`, [A]);
    const conf = await msg('booking_confirmed', 'confirmed:f');
    await run();
    expect(await rowOf(conf)).toMatchObject({ status: 'undeliverable', last_error: 'cap' });
    expect(line.pushes().length).toBe(0);
  });
});

describe('language at send time (D93, LINE-03-AC2)', () => {
  it('a profile language change while the row waits changes the language it is sent in', async () => {
    await msg('booking_confirmed', 'confirmed:l');
    await tdb.query(`update public.app_user set language = 'en' where id = $1`, [P]);
    await run();
    expect(built).toEqual([{ kind: 'booking_confirmed', language: 'en' }]);
  });

  it('no language on the person: the club’s default language', async () => {
    await tdb.query(`update public.app_user set language = null where id = $1`, [P]);
    await tdb.query(`update public.club set default_language = 'en' where id = $1`, [A]);
    await msg('booking_confirmed', 'confirmed:d');
    await run();
    expect(built).toEqual([{ kind: 'booking_confirmed', language: 'en' }]);
  });
});
