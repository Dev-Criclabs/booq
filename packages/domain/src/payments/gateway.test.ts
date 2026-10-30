import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATEWAY_METHODS, keySetFor, qrExpiryTime } from './gateway';

// F05-T03 (PAY-01-AC4, AC10, PAY-02-AC2, PAY-05; D18, D32, D80; design 5.1, 5.7, 5.8).
describe('keySetFor: the key set follows the club status, never typed (PAY-01-AC4)', () => {
  it('Testing uses the test set; Live and Paused the live set; Draft takes no payment', () => {
    expect(keySetFor('testing')).toBe('test');
    expect(keySetFor('live')).toBe('live');
    expect(keySetFor('paused')).toBe('live');
    expect(keySetFor('draft')).toBeNull();
    expect(keySetFor('anything')).toBeNull();
  });
});

describe('qrExpiryTime: the hold end minus the platform margin (D18, D80)', () => {
  const now = new Date('2026-12-02T11:00:00Z');
  const holdEnd = '2026-12-02T11:15:00Z';
  it('is the hold end less the margin, in UTC ISO 8601', () => {
    expect(qrExpiryTime(holdEnd, 30, now)).toEqual({ ok: true, expiryTime: '2026-12-02T11:14:30.000Z' });
  });
  it('with the margin unset, payment is unavailable: no value is built into code', () => {
    expect(qrExpiryTime(holdEnd, null, now)).toEqual({ ok: false, code: 'payment_unavailable', reason: 'margin_unset' });
  });
  it('a margin that leaves no time before the hold ends is payment_unavailable too', () => {
    expect(qrExpiryTime(holdEnd, 900, now)).toEqual({ ok: false, code: 'payment_unavailable', reason: 'no_time_left' });
    expect(qrExpiryTime(holdEnd, -1, now)).toEqual({ ok: false, code: 'payment_unavailable', reason: 'margin_unset' });
  });
});

describe('no refund, no credit (PAY-01-AC10, PAY-05, CANCEL-02)', () => {
  it('the gateway has exactly create and get', () => {
    expect([...GATEWAY_METHODS]).toEqual(['createCharge', 'getCharge']);
  });
  it('no source file of the payment code names a refund', () => {
    const roots = [join(__dirname), join(__dirname, '../../../beam/src')];
    for (const root of roots) {
      for (const f of readdirSync(root)) {
        if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
        expect(readFileSync(join(root, f), 'utf8'), `${root}/${f}`).not.toMatch(/refund/i);
      }
    }
  });
});
