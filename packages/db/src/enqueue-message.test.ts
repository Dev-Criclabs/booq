import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRegistry } from './registry';
import { createDb, type Db } from './tx';
import { A, PLAYER, ctx, order, setup, tdb, worker } from './testing/payment-fixtures';

// F10-T06 / migration 0605: app.enqueue_message (the fifth payment port), app.void_messages,
// app.void_cap_reminders, app.cap_state, app.mark_undeliverable, the booking_released release handler and the
// outbox anonymise handler. LINE-03, LINE-05, LINE-07-AC1 to AC4, D96; F10 design 5.1, 5.4, 5.9; FA 5.6.
const T = 'c0ffee00-1111-4222-8333-444455556666';
const TP = '33333333-3333-4333-8333-333333333333';
const MONTH = `date_trunc('month', now() at time zone 'Asia/Bangkok')::date`;

let w: Db;
beforeEach(async () => {
  await setup();
  w = worker;
});
afterEach(async () => {
  await w.end();
  await tdb.close();
});

const enqueue = (kind: string, key: string, sendAt = `now() + interval '1 day'`, params: object = { order_id: A }, user: string | null = PLAYER, club = A) =>
  w.withClubTx({ ...ctx(), clubId: club }, async (tx) =>
    (await tx.query(`select app.enqueue_message($1, $2, $3::jsonb, $4, ${sendAt}) as id`, [kind, user, JSON.stringify(params), key])).rows[0]!.id as string | null);
const rowOf = async (id: string) => (await tdb.query(`select kind, status, void_reason, last_error, is_test, user_id, params from public.message_outbox where id = $1`, [id])).rows[0];
const usage = (used: number, limit: number | null, plan = 'paid', club = A) =>
  tdb.query(
    `insert into platform.club_line_usage (club_id, month, used, message_limit, plan_kind, source) values ($1, ${MONTH}, $2, $3, $4, 'line')
     on conflict (club_id, month) do update set used = excluded.used, message_limit = excluded.message_limit, plan_kind = excluded.plan_kind`,
    [club, used, limit, plan]);
const capState = async (club = A) => w.withClubTx({ ...ctx(), clubId: club }, async (tx) => (await tx.query(`select app.cap_state() as s`)).rows[0]!.s as string);

describe('the payment port (D96, Architect review of 30 Oct)', () => {
  it('enqueue_message is registered as the fifth port with the agreed signature', async () => {
    // The shared fixture swaps in a fake; a fresh look at the migration's own registration:
    const fresh = await import('./testing/harness').then((h) => h.createTestDatabase());
    try {
      const r = await fresh.query(`select handler::text as h from app.payment_ports where port = 'enqueue_message'`);
      expect(r.rows[0].h).toBe('app.enqueue_message(text,uuid,jsonb,text,timestamp with time zone)');
      await fresh.query(`delete from app.payment_ports where port = 'enqueue_message'`);
      await expect(fresh.query(`select app.port_of('enqueue_message')`)).rejects.toThrow(/payment:port_missing:enqueue_message/);
    } finally {
      await fresh.close();
    }
  });
});

describe('enqueue_message (F10 design 5.1)', () => {
  it('the same dedupe key enqueues once and returns the same id', async () => {
    const a = await enqueue('booking_confirmed', 'confirmed:1', 'now()');
    const b = await enqueue('booking_confirmed', 'confirmed:1', 'now()');
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect((await tdb.query(`select count(*)::int as n from public.message_outbox`)).rows[0].n).toBe(1);
  });

  it('refuses a kind that is not in the catalogue; no recipient means no message', async () => {
    await expect(enqueue('promo_blast', 'x')).rejects.toThrow(/unknown message kind/);
    expect(await enqueue('booking_confirmed', 'walk-in', 'now()', {}, null)).toBeNull();
    // Not a person of this club: nothing is queued and the caller's transaction is not undone (design 10).
    expect(await enqueue('booking_confirmed', 'stranger', 'now()', {}, '99999999-9999-4999-8999-999999999999')).toBeNull();
    expect((await tdb.query(`select count(*)::int as n from public.message_outbox`)).rows[0].n).toBe(0);
  });

  it('a reminder whose hour has passed is not queued (FA 5.4)', async () => {
    expect(await enqueue('reminder_2h', 'reminder:b:t:2', `now() - interval '1 minute'`)).toBeNull();
    expect(await enqueue('reminder_24h', 'reminder:b:t:24', `now() + interval '1 hour'`)).not.toBeNull();
  });

  it('every row of a Testing club is is_test (D4, D32)', async () => {
    await tdb.query(`insert into public.club (id, slug, name_th, name_en, status) values ($1,'t','ท','T','testing')`, [T]);
    const c = await tdb.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.app_user (club_id, id, line_user_id) values ($1,$2,'LT')`, [T, TP]);
      await c.query(`insert into public.app_user_role (club_id, user_id, role) values ($1,$2,'player')`, [T, TP]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const id = await enqueue('booking_confirmed', 'confirmed:t', 'now()', {}, TP, T);
    expect((await rowOf(id!)).is_test).toBe(true);
    expect((await rowOf((await enqueue('booking_confirmed', 'confirmed:a', 'now()'))!)).is_test).toBe(false);
  });

  it('the catalogue fixes which messages are reminders and which switch controls them (D94)', async () => {
    const r = await tdb.query(`select kind, cap_class, switch_key from app.message_kinds where cap_class = 'R' or switch_key is not null order by kind`);
    expect(r.rows).toEqual([
      { kind: 'birthday_discount', cap_class: 'A', switch_key: 'promotions' },
      { kind: 'referral_reward', cap_class: 'A', switch_key: 'promotions' },
      { kind: 'reminder_24h', cap_class: 'R', switch_key: 'reminders' },
      { kind: 'reminder_2h', cap_class: 'R', switch_key: 'reminders' },
    ]);
    await expect(tdb.query(`insert into public.message_outbox (club_id, user_id, kind, dedupe_key) values ($1,$2,'not_a_kind','k')`, [A, PLAYER]))
      .rejects.toThrow(/message_outbox_kind_fkey/);
  });
});

describe('cap_state (LINE-07, FA 5.6)', () => {
  it('derives the state from this Bangkok month’s usage and the platform thresholds', async () => {
    expect(await capState()).toBe('normal');                 // no row: normal
    await usage(500, null); expect(await capState()).toBe('normal');   // no limit known: normal
    await usage(690, 1000); expect(await capState()).toBe('normal');
    await usage(700, 1000); expect(await capState()).toBe('alert');
    await usage(799, 1000); expect(await capState()).toBe('alert');
    await usage(800, 1000); expect(await capState()).toBe('reminders_stopped');
    await usage(1000, 1000); expect(await capState()).toBe('over_limit');
    await tdb.query(`update platform.club_line_usage set month = (month - interval '1 month')::date where club_id = $1`, [A]);
    expect(await capState()).toBe('normal');                 // last month's row does not count
  });

  it('a mid month upgrade follows the new limit (LINE-07-AC10, D99)', async () => {
    await usage(850, 1000); expect(await capState()).toBe('reminders_stopped');
    await usage(850, 5000); expect(await capState()).toBe('normal');
  });
});

describe('the cap at queue time (LINE-07-AC1 to AC4)', () => {
  it('at 80 percent the confirmation is queued and no reminder row is created', async () => {
    await usage(800, 1000);
    expect(await enqueue('booking_confirmed', 'confirmed:9', 'now()')).not.toBeNull();
    expect(await enqueue('reminder_24h', 'reminder:b9:t:24')).toBeNull();
    expect(await enqueue('package_expiring', 'package_expiring:p:e:14')).not.toBeNull();   // A: always (D29)
    expect((await tdb.query(`select kind from public.message_outbox order by kind`)).rows.map((r) => r.kind)).toEqual(['booking_confirmed', 'package_expiring']);
  });

  it('queued reminders are voided with cap at 80 percent and never revived', async () => {
    const r = (await enqueue('reminder_24h', 'reminder:b1:t:24'))!;
    const c = (await enqueue('booking_confirmed', 'confirmed:b1', 'now()'))!;
    await usage(800, 1000);
    expect(await w.withClubTx(ctx(), async (tx) => (await tx.query(`select app.void_cap_reminders() as n`)).rows[0]!.n)).toBe(1);
    expect(await rowOf(r)).toMatchObject({ status: 'void', void_reason: 'cap' });
    expect(await rowOf(c)).toMatchObject({ status: 'pending' });
    // The month rolls over or the owner upgrades: the voided reminder stays void, and re-queueing its key finds it.
    await usage(10, 1000);
    expect(await enqueue('reminder_24h', 'reminder:b1:t:24')).toBe(r);
    expect(await rowOf(r)).toMatchObject({ status: 'void', void_reason: 'cap' });
    await expect(tdb.query(`update public.message_outbox set status = 'pending', void_reason = null where id = $1`, [r])).rejects.toThrow(/final/);
  });

  it('below 80 percent void_cap_reminders voids nothing', async () => {
    await enqueue('reminder_24h', 'reminder:b2:t:24');
    await usage(790, 1000);
    expect(await w.withClubTx(ctx(), async (tx) => (await tx.query(`select app.void_cap_reminders() as n`)).rows[0]!.n)).toBe(0);
  });

  it('at 100 percent on a free plan a message is queued as undeliverable; on a paid plan it goes', async () => {
    await usage(1000, 1000, 'free');
    expect(await rowOf((await enqueue('booking_confirmed', 'confirmed:f', 'now()'))!)).toMatchObject({ status: 'undeliverable', last_error: 'cap' });
    await usage(1200, 1000, 'paid');
    expect(await rowOf((await enqueue('booking_confirmed', 'confirmed:p', 'now()'))!)).toMatchObject({ status: 'pending' });
  });

  it('mark_undeliverable ends a pending row once (LINE 429, D9 path)', async () => {
    const id = (await enqueue('waitlist_offer', 'offer:e:1', 'now()'))!;
    const mark = () => w.withClubTx(ctx(), async (tx) => (await tx.query(`select app.mark_undeliverable($1, 'cap') as ok`, [id])).rows[0]!.ok);
    expect(await mark()).toBe(true);
    expect(await mark()).toBe(false);
    expect(await rowOf(id)).toMatchObject({ status: 'undeliverable', last_error: 'cap' });
  });
});

describe('void_messages', () => {
  it('voids the pending rows of this club whose key starts with the prefix, with the reason given', async () => {
    const a = (await enqueue('reminder_24h', 'reminder:bk1:t:24'))!;
    const b = (await enqueue('reminder_2h', 'reminder:bk1:t:2'))!;
    const other = (await enqueue('reminder_2h', 'reminder:bk2:t:2'))!;
    const n = await w.withClubTx(ctx(), async (tx) => (await tx.query(`select app.void_messages('reminder:bk1:', 'cancelled') as n`)).rows[0]!.n);
    expect(n).toBe(2);
    expect([(await rowOf(a)).status, (await rowOf(b)).status, (await rowOf(other)).status]).toEqual(['void', 'void', 'pending']);
    await expect(w.withClubTx(ctx(), (tx) => tx.query(`select app.void_messages('reminder:', 'bored')`))).rejects.toThrow(/void reason/);
    await expect(w.withClubTx(ctx(), (tx) => tx.query(`select app.void_messages('', 'cancelled')`))).rejects.toThrow(/prefix/);
  });
});

describe('booking_released (F10 design 5.4; Architect review; F03-T30)', () => {
  const release = (o: string, reason: string) => w.withClubTx(ctx(), (tx) => tx.query(`select app.release_hold($1, $2)`, [o, reason]));
  const released = async () => (await tdb.query(`select dedupe_key, user_id, params from public.message_outbox where kind = 'booking_released'`)).rows;

  it('is queued once for an expired hold', async () => {
    const o = await order('expired');
    await release(o, 'expired');
    expect(await released()).toEqual([{ dedupe_key: `released:${o}`, user_id: PLAYER, params: { order_id: o } }]);
  });

  it('is not queued for the reasons payment_unavailable and offer_ended', async () => {
    await release(await order('held'), 'payment_unavailable');
    await release(await order('held'), 'offer_ended');
    expect(await released()).toEqual([]);
  });
});

describe('anonymise (PDPA-01-AC5, CC-3; migration 0019)', () => {
  it('the handler clears the person’s message params and ends their pending messages', async () => {
    const sent = (await enqueue('booking_confirmed', 'confirmed:s', 'now()', { order_id: A, amount_satang: 50000 }))!;
    await tdb.query(`update public.message_outbox set status = 'sent', sent_at = now() where id = $1`, [sent]);
    const pending = (await enqueue('reminder_24h', 'reminder:x:t:24', `now() + interval '1 day'`, { booking_id: A }))!;
    expect((await tdb.query(`select handler::text as h from app.anonymise_handlers where handler_key = 'f10_outbox'`)).rows[0].h).toBe('app.f10_anonymise(uuid,uuid)');
    await tdb.query(`select app.f10_anonymise($1, $2)`, [A, PLAYER]);
    expect(await rowOf(sent)).toMatchObject({ status: 'sent', params: {} });
    expect(await rowOf(pending)).toMatchObject({ status: 'undeliverable', last_error: 'anonymised', params: {} });
  });
});

describe('grants', () => {
  it('only the worker runs the F10 functions; the app role and the platform role cannot', async () => {
    const fns = ['app.enqueue_message(text,uuid,jsonb,text,timestamptz)', 'app.void_messages(text,text)', 'app.void_cap_reminders()',
      'app.cap_state()', 'app.mark_undeliverable(uuid,text)', 'app.f10_released(uuid,text)', 'app.f10_anonymise(uuid,uuid)'];
    for (const f of fns) {
      const r = await tdb.query(`select has_function_privilege('booq_app', $1, 'execute') as app, has_function_privilege('booq_platform', $1, 'execute') as plat,
                                        has_function_privilege('booq_worker', $1, 'execute') as wk`, [f]);
      expect(r.rows[0], f).toMatchObject({ app: false, plat: false });
      expect(r.rows[0].wk, f).toBe(!['app.f10_released(uuid,text)', 'app.f10_anonymise(uuid,uuid)'].includes(f));
    }
    const reg = await collectRegistry();
    expect(reg['app.message_kinds']).toEqual({ class: 'infra' });
  });

  it('a player cannot enqueue directly', async () => {
    const app = createDb({ connectionString: tdb.url, max: 1 });
    try {
      await expect(app.withClubTx({ clubId: A, userId: PLAYER, roles: ['player'], source: 'player_app' }, (tx) =>
        tx.query(`select app.enqueue_message('booking_confirmed', $1, '{}', 'k', now())`, [PLAYER]))).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });
});
