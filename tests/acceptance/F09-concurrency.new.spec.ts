// F09-T18 (QA) concurrency: a Beam callback racing a player's cancel of the held booking (the hold is released as "player"). IDs: CANCEL-01-AC14, CANCEL-02, CC-4.
// Two cancels at once, a repeated return, a cancel racing a closure, and a closure racing a new booking are proved by the lane (cancel-booking.test.ts, return-booking-value.test.ts,
// closure-create.test.ts "exactly one outcome stands"); the no refund route inventory is in F09-cancellation-closures.new.spec.ts and F13-cross-cutting.new.spec.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { raceAll } from '../support/parallel';
import { apply, bookingStatus, ctx, log, order, orderStatus, payment, pay, setup, tdb, teardown, worker } from '../../packages/db/src/testing/payment-fixtures';

describe('F09-T18 a Beam callback and the player leaving the page at the same instant', () => {
  beforeAll(async () => {
    await setup();
  }, 120_000);
  afterAll(teardown);

  it('exactly one outcome: confirmed once, or released with the whole amount in the wallet with its own receipt; the money is never lost or counted twice', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const o = await order('held', { hour: 3 + i });
      const p = await payment(o);
      const receiptsBefore = (await log()).filter((l) => l.port === 'issue_receipt').length;
      const credited = async () => (await log()).filter((l) => l.port === 'credit_wallet').reduce((n, l) => n + Number((l.args as unknown[])[2]), 0);
      const walletBefore = await credited();
      const out = await raceAll([
        () => apply(p),
        () => worker.withClubTx({ ...ctx(), source: 'job' }, async (tx) => (await tx.query(`select app.release_hold($1, 'player') as r`, [o])).rows[0]?.r),
      ], { jitterMs: 2 });
      for (const r of out) if (r.status === 'error') throw new Error(`round ${i}: ${(r.error as Error).message}`);
      const status = await bookingStatus(o);
      const payRow = await pay(p);
      const receipts = (await log()).filter((l) => l.port === 'issue_receipt').length - receiptsBefore;
      const walletAfter = await credited();
      expect(payRow.status, `round ${i}: the payment is final`).toBe('succeeded');
      expect(receipts, `round ${i}: exactly one receipt`).toBe(1);
      if (status === 'confirmed') {
        expect(await orderStatus(o), `round ${i}`).toBe('paid');
        expect(walletAfter - walletBefore, `round ${i}: a confirmed booking leaves the wallet alone`).toBe(0);
        seen.add('confirmed');
      } else {
        expect(status, `round ${i}`).toBe('released');
        expect(walletAfter - walletBefore, `round ${i}: a booking that stays released sends the whole amount to the wallet (the late payment rule, PAY-03)`).toBe(50000);
        seen.add('released');
      }
    }
    expect([...seen].length).toBeGreaterThan(0);
  }, 180_000);
});
