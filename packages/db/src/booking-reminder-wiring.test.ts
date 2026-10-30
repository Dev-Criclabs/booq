import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './tx';
import { A, ctx, order, PLAYER, RES, setup, tdb, worker } from './testing/payment-fixtures';

// migration 0230: F03's confirm, reclaim and move keep a booking's reminders in step (F10 design 5.4; LINE-05,
// D96, D116). confirm_booking and reclaim_order queue the 24 hour and 2 hour reminders of each booking they
// confirm (app.enqueue_booking_reminders, 0607); move_booking voids the booking's pending reminders with reason
// moved and queues them again for the new start. The F09 cancel voids them with reason cancelled (F09-T06b).
const RES2 = '00000000-0000-4000-8000-0000000000c2';
const DESK = '00000000-0000-4000-8000-0000000000d1';
let app: Db;

const reminders = async (booking: string) =>
  (await tdb.query(
    `select kind, status, void_reason, send_at from public.message_outbox where dedupe_key like 'reminder:' || $1 || ':%' order by status, send_at`,
    [booking],
  )).rows;
const bookingOf = async (o: string) => (await tdb.query(`select id, start_at from public.booking where order_id = $1`, [o])).rows[0] as { id: string; start_at: Date };
const confirm = (o: string) => worker.withClubTx(ctx(), async (tx) => (await tx.query(`select app.confirm_booking($1) as ok`, [o])).rows[0]!.ok as boolean);
const move = (booking: string, resource: string, start: Date) =>
  app.withClubTx({ clubId: A, userId: DESK, roles: ['front_desk', 'player'], requestId: 'r', source: 'admin' }, (tx) =>
    tx.query(`select app.move_booking($1, $2, $3)`, [booking, resource, start]));

beforeEach(async () => {
  await setup();
  await tdb.query(`insert into public.resource (club_id, id, location_id, name, sport) select club_id, $2, location_id, '2', 'tennis' from public.resource where id = $1`, [RES, RES2]);
  app = createDb({ connectionString: tdb.url, max: 2 });
});
afterEach(async () => {
  await app.end();
  await worker.end();
  await tdb.close();
});

describe('confirm_booking queues the reminders (LINE-05)', () => {
  it('a confirmed booking three days ahead gets the 24 hour and the 2 hour reminder, at start minus N hours', async () => {
    const o = await order('held', { hour: 72 });
    expect(await confirm(o)).toBe(true);
    const b = await bookingOf(o);
    const rows = await reminders(b.id);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([['reminder_24h', 'pending'], ['reminder_2h', 'pending']]);
    expect(rows.map((r) => (b.start_at.getTime() - r.send_at.getTime()) / 3_600_000)).toEqual([24, 2]);
  });

  it('a confirm that finds nothing to confirm queues nothing', async () => {
    const o = await order('expired', { hour: 73 });
    expect(await confirm(o)).toBe(false);
    expect(await reminders((await bookingOf(o)).id)).toEqual([]);
  });
});

describe('reclaim_order queues the reminders of the bookings it confirms (late payment)', () => {
  it('a released order reclaimed while its slot is open gets its reminders', async () => {
    const o = await order('released', { hour: 74 });
    expect(await worker.withClubTx(ctx(), async (tx) => (await tx.query(`select app.reclaim_order($1) as ok`, [o])).rows[0]!.ok)).toBe(true);
    expect((await reminders((await bookingOf(o)).id)).map((r) => [r.kind, r.status])).toEqual([['reminder_24h', 'pending'], ['reminder_2h', 'pending']]);
  });
});

describe('move_booking voids and queues them again (F10 design 5.4)', () => {
  it('the old reminders are voided as moved and new ones are queued for the new start', async () => {
    const o = await order('held', { hour: 75 });
    await confirm(o);
    const b = await bookingOf(o);
    const later = new Date(b.start_at.getTime() + 2 * 3_600_000);
    await move(b.id, RES2, later);
    const rows = await reminders(b.id);
    expect(rows.filter((r) => r.status === 'void').map((r) => [r.kind, r.void_reason])).toEqual([['reminder_24h', 'moved'], ['reminder_2h', 'moved']]);
    const fresh = rows.filter((r) => r.status === 'pending');
    expect(fresh.map((r) => r.kind)).toEqual(['reminder_24h', 'reminder_2h']);
    expect(fresh.map((r) => (later.getTime() - r.send_at.getTime()) / 3_600_000)).toEqual([24, 2]);
  });

  it('a move of a booking still awaiting payment voids nothing and queues nothing', async () => {
    const o = await order('held', { hour: 78 });
    const b = await bookingOf(o);
    await move(b.id, RES2, b.start_at);
    expect(await reminders(b.id)).toEqual([]);
    expect((await tdb.query(`select customer_id from public.booking where id = $1`, [b.id])).rows[0].customer_id).toBe(PLAYER);
  });
});
