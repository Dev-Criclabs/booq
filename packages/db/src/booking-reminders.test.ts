import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { A, ctx, order, setup, tdb, worker } from './testing/payment-fixtures';

// F10-T07b / migration 0607: the reminder hours are product constants (PRD change log "Scope": reminders fixed at
// 24 h and 2 h before start; D116: numbers are variables in the text and settings in code), held in the message
// catalogue, and app.enqueue_booking_reminders queues a confirmed booking's reminders from them. LINE-05, D96.
const MONTH = `date_trunc('month', now() at time zone 'Asia/Bangkok')::date`;

beforeEach(async () => {
  await setup();
});
afterEach(async () => {
  await worker.end();
  await tdb.close();
});

/** A confirmed booking whose hour starts within the hour before now + `ahead` (bookings are on the hour). */
async function confirmed(ahead: string, status = 'confirmed') {
  const o = await order('held');
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');   // fixture: skip the booking triggers
    const r = await c.query(
      `update public.booking set status = $2, hold_expires_at = case when $2 = 'confirmed' then null else hold_expires_at end,
              confirmed_at = case when $2 = 'confirmed' then now() end,
              start_at = date_trunc('hour', now() + $3::interval), end_at = date_trunc('hour', now() + $3::interval) + interval '1 hour'
        where order_id = $1 returning id, start_at`, [o, status, ahead]);
    await c.query('commit');
    return r.rows[0] as { id: string; start_at: Date };
  } finally {
    c.release();
  }
}
/** Moves a booking a day later (fixture, triggers off). */
async function shiftDay(booking: string) {
  const c = await tdb.pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update public.booking set start_at = start_at + interval '1 day', end_at = end_at + interval '1 day' where id = $1`, [booking]);
    await c.query('commit');
  } finally {
    c.release();
  }
}
const queue = (booking: string) => worker.withClubTx(ctx(), async (tx) => (await tx.query(`select app.enqueue_booking_reminders($1) as n`, [booking])).rows[0]!.n as number);
const reminders = async () =>
  (await tdb.query(`select kind, dedupe_key, params, status, void_reason, send_at from public.message_outbox where kind like 'reminder%' order by send_at`)).rows;
const iso = (d: Date) => d.toISOString().slice(0, 16) + 'Z';

describe('the reminder hours (PRD "Scope", D116)', () => {
  it('are 24 and 2, held in the catalogue, and are not a club setting', async () => {
    expect((await tdb.query(`select kind, hours_before from app.message_kinds where cap_class = 'R' order by hours_before desc`)).rows)
      .toEqual([{ kind: 'reminder_24h', hours_before: 24 }, { kind: 'reminder_2h', hours_before: 2 }]);
    expect((await tdb.query(`select count(*)::int as n from app.setting_keys where setting_key like '%reminder_hour%'`)).rows[0].n).toBe(0);
    // Only reminders carry hours; every reminder has them.
    await expect(tdb.query(`update app.message_kinds set hours_before = 5 where kind = 'booking_confirmed'`)).rejects.toThrow(/message_kinds_hours_only_reminders/);
    await expect(tdb.query(`update app.message_kinds set hours_before = null where kind = 'reminder_2h'`)).rejects.toThrow(/message_kinds_hours_only_reminders/);
  });
});

describe('enqueue_booking_reminders (F10 design 5.4)', () => {
  it('queues the 24 hour and 2 hour reminders of a confirmed booking at start minus N hours', async () => {
    const b = await confirmed('3 days');
    expect(await queue(b.id)).toBe(2);
    const rows = await reminders();
    expect(rows.map((r) => [r.kind, r.dedupe_key, r.params, r.status])).toEqual([
      ['reminder_24h', `reminder:${b.id}:${iso(b.start_at)}:24`, { booking_id: b.id }, 'pending'],
      ['reminder_2h', `reminder:${b.id}:${iso(b.start_at)}:2`, { booking_id: b.id }, 'pending'],
    ]);
    expect(rows.map((r) => (b.start_at.getTime() - new Date(r.send_at).getTime()) / 3600000)).toEqual([24, 2]);
  });

  it('a booking made less than 24 hours ahead gets only the 2 hour reminder, less than 2 hours none (FA 5.4)', async () => {
    expect(await queue((await confirmed('5 hours')).id)).toBe(1);
    expect((await reminders()).map((r) => r.kind)).toEqual(['reminder_2h']);
    expect(await queue((await confirmed('90 minutes')).id)).toBe(0);
  });

  it('a repeat queues nothing new', async () => {
    const b = await confirmed('3 days');
    await queue(b.id);
    expect(await queue(b.id)).toBe(2);
    expect((await reminders()).length).toBe(2);
  });

  it('a move voids the old reminders and the new start gets its own (key includes the start)', async () => {
    const b = await confirmed('3 days');
    await queue(b.id);
    await worker.withClubTx(ctx(), (tx) => tx.query(`select app.void_messages($1, 'moved')`, [`reminder:${b.id}:`]));
    await shiftDay(b.id);
    expect(await queue(b.id)).toBe(2);
    const rows = await reminders();
    expect(rows.map((r) => [r.status, r.void_reason])).toEqual([['void', 'moved'], ['void', 'moved'], ['pending', null], ['pending', null]]);
  });

  it('a booking that is not confirmed, or of another club, gets none', async () => {
    expect(await queue((await confirmed('3 days', 'awaiting_payment')).id)).toBe(0);
    expect(await queue('99999999-9999-4999-8999-999999999999')).toBe(0);
  });

  it('at 80 percent of the cap no reminder is queued (LINE-07-AC2)', async () => {
    await tdb.query(`insert into platform.club_line_usage (club_id, month, used, message_limit, plan_kind, source) values ($1, ${MONTH}, 800, 1000, 'paid', 'line')`, [A]);
    expect(await queue((await confirmed('3 days')).id)).toBe(0);
    expect(await reminders()).toEqual([]);
  });

  it('only the worker runs it; the player app cannot', async () => {
    const r = await tdb.query(`select has_function_privilege('booq_app', 'app.enqueue_booking_reminders(uuid)', 'execute') as app,
                                      has_function_privilege('booq_worker', 'app.enqueue_booking_reminders(uuid)', 'execute') as wk`);
    expect(r.rows[0]).toEqual({ app: false, wk: true });
  });
});
