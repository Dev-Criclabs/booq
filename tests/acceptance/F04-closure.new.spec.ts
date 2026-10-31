// F04-T21 acceptance sweep gate (QA). Every F04 criterion (R1 to R8, PAY-07, PROMO-01) has a real test (a traced pointer or a QA test, not a generated todo),
// or is listed below with its reason. The script fails for an ID without one, and for a listed ID that now has one (a stale reason).
// Also here: no hard coded user text in the checkout code, no client amount in a Pay request. Test orders in reports: F04 R7-AC4 (traced to promo-and-lines.test.ts
// and the report functions' tests) and F13 daily-close.test.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { allCriteria, repoRoot } from './spec-ids';
import { parsePayRequest } from '../../packages/domain/src/checkout/pay';

const dir = fileURLToPath(new URL('.', import.meta.url));
const real = readdirSync(dir)
  .filter((f) => /^F\d\d-.*\.(traced|new)\.spec\.ts$/.test(f) && f !== 'F04-closure.new.spec.ts')
  .map((f) => readFileSync(resolve(dir, f), 'utf8'))
  .join('\n');
const has = (id: string) => new RegExp(`['"\`]${id.replace(/[/.-]/g, '\\$&')}[ '"\`]`).test(real) || new RegExp(`\\b${id.replace(/[/.-]/g, '\\$&')}(?![0-9a-z])`).test(real.replace(/\/\/.*$/gm, ''));

/** F04 criteria with no test yet, and why. A criterion leaves this list when its test lands. */
const OPEN: Record<string, string> = {
  'F04/R2-AC6': 'the live coach refresh on C10 is a screen (Playwright) and F07 owns the coach rule',
  'F04/R2-AC9': 'Add a coach after booking is F07 (the add order); priced and tested in packages/db/src/coach-add.test.ts, which cites F07 R5',
  'F04/R3-AC3': 'add-ons collapse into one row: the C10 screen is not built',
  'F04/R4-AC7': 'credit and wallet ledger rows in the Pay transaction: the lane tests the default (nothing reserved); a test with credit and wallet through the pay path waits for the real reserve port',
  'F04/R4-AC11': 'whole baht without decimals: the player app formatter is not built (only the LINE builder formats money)',
  'F04/R8-AC2': 'offline error with Try again on C10: the C10 screen is not built',
  'F04/R8-AC3': 'longest strings at 375 px on C10: the C10 screen is not built',
  'F04/R8-AC5': 'the coach picker updating live: the C10 screen is not built (F07 owns the rule)',
};

describe('F04-T21 every F04 acceptance criterion has a test, or a reason', () => {
  const f04 = allCriteria().filter((c) => c.id.startsWith('F04/'));
  it('there are F04 criteria to check', () => {
    expect(f04.length).toBeGreaterThan(70);
  });
  it('no criterion is without a test unless it is listed with its reason', () => {
    const missing = f04.map((c) => c.id).filter((id) => !has(id) && !(id in OPEN));
    expect(missing, 'F04 criteria with no test and no reason').toEqual([]);
  });
  it('a listed criterion has no test yet: when it gets one, take it off the list', () => {
    expect(Object.keys(OPEN).filter((id) => has(id)), 'stale entries').toEqual([]);
    expect(Object.keys(OPEN).filter((id) => !f04.some((c) => c.id === id)), 'ids that are not F04 criteria').toEqual([]);
  });
});

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

describe('F04-T21 cross cutting', () => {
  it('CC-2: no Thai text and no sentence is written in the checkout, pricing or promo code: every text comes from the language files', () => {
    const root = repoRoot();
    const files = [...walk(resolve(root, 'packages/domain/src/checkout')), ...walk(resolve(root, 'apps/web/src/api/checkout'))].filter((f) => !/fixture/.test(f));
    expect(files.length).toBeGreaterThan(8);
    const thai = /[ก-ฺเ-๎]/;
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      text.split('\n').forEach((line, i) => {
        const code = line.replace(/\s\/\/.*$/, '');
        if (thai.test(code)) hits.push(`${f.replace(root + '/', '')}:${i + 1} Thai text`);
        // An English sentence in a string: three words or more with a capital letter first and a space, not a code or a key.
        for (const m of code.matchAll(/(['"`])([A-Z][a-z]+(?: [a-z]+){2,}[^'"`]*)\1/g)) hits.push(`${f.replace(root + '/', '')}:${i + 1} "${m[2]!.slice(0, 40)}"`);
      });
    }
    expect(hits, 'user facing text written in the code').toEqual([]);
  });

  it('R4-AC9, CC-2: a Pay request carries no amount: whatever price, total or amount a client sends is dropped and never reaches the quote', () => {
    const body = { courtId: '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c', hours: ['2027-01-09T18:00:00+07:00'], quoteHash: 'a'.repeat(64), amount: 1, total: 1, totalSatang: 1, priceSatang: 1, price: 1, discountSatang: 99999, moneySatang: 1 };
    const parsed = parsePayRequest(body);
    const flat = JSON.stringify(parsed).toLowerCase();
    for (const k of ['amount', 'total', 'price', 'discount', 'money', 'satang']) expect(flat, `the parsed request keeps a client ${k}`).not.toContain(k);
  });
});
