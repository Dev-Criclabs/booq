// Value never goes back as cash (CANCEL-02, PAY-05, PKG-01-AC9; CLAUDE.md). One route and source inventory proves no refund or
// withdraw action exists. Written by QA in the F06 and F09 sweeps. Findings are marked it.fails and turn red when fixed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { permissionNames } from '../../packages/auth/src/index';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';
import type { Db } from '../../packages/db/src/tx';
import { createWebTable } from '../../apps/web/src/server/context';
import { createPlatformTable, unavailableIdentity } from '../../apps/platform/src/server/context';
import { repoRoot } from './spec-ids';

const ROOT = repoRoot();
const touch = new Proxy({}, { get: () => { throw new Error('not reachable in this test'); } });
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

/** Words that mean money leaves the system to the player. "Cash" alone is not one: the desk takes cash IN (PAY-06). */
const MONEY_OUT = /refund|withdraw|cash-?out|payout-?to|pay-?back|bank-?transfer-?out/i;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/test-fixture|testkit|fixtures?\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const productSources = (...roots: string[]) => roots.flatMap((r) => { try { return sources(resolve(ROOT, r)); } catch { return []; } });
const allSrc = () => ['apps', 'packages'].flatMap((d) => readdirSync(resolve(ROOT, d)).flatMap((p) => productSources(`${d}/${p}/src`)));

let tdb: TestDatabase | undefined;
afterAll(async () => tdb?.close());

describe('F09/CANCEL-02-AC1', () => {
  it('F09/CANCEL-02-AC1 F05/PAY-05-AC2 F06/PKG-01-AC9 no route, permission or admin action refunds money or withdraws the wallet', () => {
    const paths = [...web.map((r) => `${r.def.method} ${r.def.path}`), ...platform.map((r) => `${r.def.method} ${r.def.path}`)];
    expect(paths.filter((p) => MONEY_OUT.test(p)), 'routes').toEqual([]);
    expect(permissionNames().filter((p) => MONEY_OUT.test(p)), 'permissions').toEqual([]);
    expect(paths.length).toBeGreaterThan(60);
  });

  it('F09/CANCEL-02-AC1 no database function, view or wallet reason names a refund to the player or a withdrawal', async () => {
    tdb = await createTestDatabase();
    const fns = await tdb.query(`select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app','platform') and p.proname ~* 'refund|withdraw|cash_?out|payout_to'`);
    expect(fns.rows, 'functions').toEqual([]);
    const reasons = (await tdb.query(`select pg_get_constraintdef(c.oid) as d from pg_constraint c where c.conname ilike 'wallet_ledger_reason%'`)).rows.map((r) => r.d as string).join(' ');
    expect(reasons).toContain('late_payment');
    // `refund` is a wallet reason: value that returns to the wallet after a cancel (D78). It never names money to the bank.
    expect(reasons).not.toMatch(/withdraw|cash/i);
  });
});

describe('F09/CANCEL-02-AC3', () => {
  it('F09/CANCEL-02-AC3 F05/PAY-05-AC3 the Beam client has no refund call, and no product code reaches a refund endpoint', () => {
    const beam = productSources('packages/beam/src').map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
    expect(beam).not.toMatch(/refund/i);
    const hits = allSrc().filter((f) => /\/(api\/v1\/)?refunds|createRefund|refundCharge/i.test(stripComments(readFileSync(f, 'utf8'))));
    expect(hits).toEqual([]);
  });
});

describe('F09/CANCEL-02-AC4', () => {
  const texts = () => {
    const out: Array<[string, string]> = [];
    const walk = (file: string, n: unknown) => {
      if (n && typeof n === 'object') for (const [k, v] of Object.entries(n as Record<string, unknown>)) typeof v === 'string' ? out.push([`${file}:${k}`, v]) : walk(file, v);
    };
    for (const f of ['locales/en.json', 'locales/th.json']) walk(f, JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')));
    for (const f of readdirSync(resolve(ROOT, 'locales', 'pending'))) walk(`pending/${f}`, JSON.parse(readFileSync(resolve(ROOT, 'locales', 'pending', f), 'utf8')));
    return out;
  };

  // FINDING QA-F09-1 (severity 3, content): locales/en.json X-0120 still says "Refunds go back by PromptPay" (P2 step 5, Beam option).
  // CANCEL-02-AC4 and PAY-05-AC5: that text is not built; value returns as wallet or package credit only (Gaps A3).
  // The key is not used by any code yet. The writers (or the Content role) must replace it; then remove .fails.
  it.fails('F09/CANCEL-02-AC4 F05/PAY-05-AC5 no language text says money goes back by PromptPay, to the bank or to the card', () => {
    const bad = texts().filter(([, t]) => /refunds?\b.{0,40}\b(go|goes|are|is|returned?)\b.{0,30}\b(back|to)\b.{0,40}(promptpay|bank|card|beam)/i.test(t));
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('F09/CANCEL-02-AC4 the key with that text, X-0120, is used by no code, so it is not built yet', () => {
    const used = allSrc().filter((f) => readFileSync(f, 'utf8').includes('X-0120'));
    expect(used).toEqual([]);
  });
});
