// F05 acceptance criteria with no existing test: written by QA in the F05 sweep.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repoRoot } from './spec-ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/db/src/tx';
import { apply, bookingStatus, ctx, log, order, orderStatus, payment, pay, setup, tdb, teardown, worker } from '../../packages/db/src/testing/payment-fixtures';
import { createWebTable } from '../../apps/web/src/server/context';
import { createPlatformTable, unavailableIdentity } from '../../apps/platform/src/server/context';
import { raceAll } from '../support/parallel';

const ROOT = repoRoot();

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

  // The mounted tables miss a route factory that is written but not mounted yet (the export routes were like that on 31 Oct), so the source is read as well.
  it('F05/PAY-01-AC2 no route path declared anywhere in apps/web/src/api or apps/platform/src names a slip, backup mode or A4', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
      });
    const paths: string[] = [];
    for (const dir of ['apps/web/src/api', 'apps/platform/src']) {
      for (const f of walk(resolve(ROOT, dir))) for (const m of readFileSync(f, 'utf8').matchAll(/\bpath:\s*['"`]([^'"`]+)['"`]/g)) paths.push(`${f.replace(ROOT + '/', '')} ${m[1]}`);
    }
    expect(paths.length, 'the scan found the route declarations').toBeGreaterThan(80);
    expect(paths.filter((x) => /slip|backup-?mode|\ba4\b/i.test(x.split(' ')[1]!)), 'slip route declarations').toEqual([]);
  });
});

// CONC-27 (docs/qa/concurrency-tests.md): a valid callback and the hold release job act on the same order at the same moment.
describe('F05/PAY-02-AC11', () => {
  beforeAll(async () => {
    await setup();
  });
  afterAll(teardown);

  // The two calls are short, so most rounds run one after the other. A test only trigger sleeps inside every booking update, which keeps
  // each transaction open long enough for the other to start: the lock order is then really exercised (mutation checked, docs/qa/mutation-pass.md).
  it('F05/PAY-02-AC11 CONC-27 a callback and the hold release at the same instant leave exactly one outcome, with every booking update slowed', async () => {
    await tdb.query(`create or replace function public.__qa_slow() returns trigger language plpgsql as $$ begin perform pg_sleep(0.04); return new; end $$`);
    await tdb.query(`create trigger __qa_slow before update on public.booking for each row execute function public.__qa_slow()`);
    try {
      await rounds(12, 2);
    } finally {
      await tdb.query(`drop trigger if exists __qa_slow on public.booking`);
    }
  }, 120_000);

  it('F05/PAY-02-AC11 a callback and the hold release at the same instant leave exactly one outcome: confirmed once, one receipt, no lost money', async () => {
    await rounds(25, 40);
  }, 120_000);

  async function rounds(ROUNDS: number, base: number) {
    const seen = new Set<string>();
    for (let i = 0; i < ROUNDS; i++) {
      const o = await order('expired', { hour: base + i });
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
  }
});
