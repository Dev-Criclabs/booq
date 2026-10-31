// F05 acceptance criteria with no existing test: written by QA in the F05 sweep.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/db/src/tx';
import { apply, bookingStatus, ctx, log, order, orderStatus, payment, pay, setup, tdb, teardown, worker } from '../../packages/db/src/testing/payment-fixtures';
import { createWebTable } from '../../apps/web/src/server/context';
import { createPlatformTable, unavailableIdentity } from '../../apps/platform/src/server/context';
import { raceAll } from '../support/parallel';

describe('F05/PAY-01-AC2', () => {
  it('F05/PAY-01-AC2 a Beam club has no slip route, slip popup or backup slip page: nothing in the web or platform tables names a slip', () => {
    const touch = new Proxy({}, { get: () => { throw new Error('not reachable'); } });
    const web = createWebTable({
      db: touch as unknown as Db,
      verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) },
      now: () => new Date('2026-12-07T03:00:00Z'),
      config: { sessionSeconds: 60, maxBodyBytes: 10_000, importLimits: null },
    }).table;
    const platform = createPlatformTable({
      db: touch as never,
      clock: { now: () => new Date('2026-12-07T03:00:00Z') } as never,
      identity: unavailableIdentity,
      config: { signingKey: 'k'.repeat(40), maxBodyBytes: 10_000, appBaseUrl: 'https://booq.example', healthToken: 'h'.repeat(20), staffInvite: null, signInRateLimit: null },
    }).table;
    const names = [...web, ...platform].map((r) => `${r.def.method} ${r.def.path}`);
    expect(names.length).toBeGreaterThan(60);
    expect(names.filter((n) => /slip|backup-?mode|a4/i.test(n)), 'slip routes').toEqual([]);
  });
});

// CONC-27 (docs/qa/concurrency-tests.md): a valid callback and the hold release job act on the same order at the same moment.
describe('F05/PAY-02-AC11', () => {
  beforeAll(async () => {
    await setup();
  });
  afterAll(teardown);

  it('F05/PAY-02-AC11 a callback and the hold release at the same instant leave exactly one outcome: confirmed once, one receipt, no lost money', async () => {
    const ROUNDS = 25;
    const seen = new Set<string>();
    for (let i = 0; i < ROUNDS; i++) {
      const o = await order('expired', { hour: 2 + i });
      const p = await payment(o);
      const before = (await log()).filter((l) => l.port === 'issue_receipt').length;
      const out = await raceAll([
        () => apply(p),
        () => worker.withClubTx({ ...ctx(), source: 'job' }, async (tx) => (await tx.query(`select app.release_hold($1, 'expired') as r`, [o])).rows[0]?.r),
      ]);
      // Neither side may fail with anything but a business answer (no deadlock, no 500).
      for (const r of out) if (r.status === 'error') throw new Error(`round ${i}: ${(r.error as Error).message}`);
      const status = await bookingStatus(o);
      const payRow = await pay(p);
      const receipts = (await log()).filter((l) => l.port === 'issue_receipt').length - before;
      expect(payRow.status, `round ${i}: the payment is final`).toBe('succeeded');
      expect(status, `round ${i}: the slot was open, so the late payment is approved`).toBe('confirmed');
      expect(await orderStatus(o), `round ${i}`).toBe('paid');
      expect(receipts, `round ${i}: exactly one receipt`).toBe(1);
      seen.add(String(payRow.outcome));
    }
    // Both interleavings are acceptable; at least the payment is never left pending.
    expect([...seen].every((s) => s === 'applied' || s === 'applied_late'), [...seen].join(',')).toBe(true);
  }, 120_000);
});
