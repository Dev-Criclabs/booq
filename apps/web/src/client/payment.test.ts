import { describe, expect, it } from 'vitest';
import { hasKey } from './i18n';
import { confirmedPath, icsFor, isId, loadPayment, mmss, qrSrc, secondsLeft } from './payment';

// F05-T11 (PAY-01-AC1, AC2): the countdown, the QR source and the poll answers.
const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe('countdown', () => {
  it('counts whole seconds down to zero and never below', () => {
    const now = Date.parse('2027-01-09T03:00:00Z');
    expect(secondsLeft('2027-01-09T03:14:52Z', now)).toBe(892);
    expect(secondsLeft('2027-01-09T03:00:00.200Z', now)).toBe(1);
    expect(secondsLeft('2027-01-09T02:59:00Z', now)).toBe(0);
    expect(secondsLeft(null, now)).toBe(0);
  });
  it('mm:ss', () => {
    expect(mmss(892)).toBe('14:52');
    expect(mmss(5)).toBe('00:05');
    expect(mmss(-3)).toBe('00:00');
  });
});

describe('qrSrc, ids and paths', () => {
  it('makes an image address from base64 and keeps a data address', () => {
    expect(qrSrc('AAAA')).toBe('data:image/png;base64,AAAA');
    expect(qrSrc('data:image/png;base64,BBBB')).toBe('data:image/png;base64,BBBB');
  });
  it('only a uuid is an id', () => {
    expect(isId('3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c')).toBe(true);
    expect(isId('nope')).toBe(false);
    expect(isId(null)).toBe(false);
  });
  it('the confirmation address carries the payment', () => {
    expect(confirmedPath('hunter', 'p 1')).toBe('/c/hunter/confirmed?payment=p%201');
  });
});

describe('loadPayment', () => {
  it('answers the payment, a code on refusal, and offline when the request fails', async () => {
    expect(await loadPayment('hunter', 'p', reply(200, { state: 'waiting', amountSatang: 50000 }))).toMatchObject({ ok: true, value: { state: 'waiting' } });
    expect(await loadPayment('hunter', 'p', reply(404, { code: 'not_found' }))).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await loadPayment('hunter', 'p', (async () => { throw new TypeError('x'); }) as typeof fetch)).toEqual({ ok: false, status: 0, code: 'offline' });
  });
});

describe('icsFor', () => {
  it('is one event in UTC with the title escaped', () => {
    const ics = icsFor('Court 2, Hunter', '2027-01-09T11:00:00.000Z', '2027-01-09T12:00:00.000Z', 'abc');
    expect(ics).toContain('DTSTART:20270109T110000Z');
    expect(ics).toContain('DTEND:20270109T120000Z');
    expect(ics).toContain('SUMMARY:Court 2\\, Hunter');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  });
});

describe('text keys (TEXT-01, TEXT-06)', () => {
  it('every key the payment and confirmation screens use is in both languages', () => {
    for (const k of ['P-0083', 'P-0084', 'P-0085', 'P-0087', 'P-0088', 'P-0089', 'P-0456', 'P-0457', 'P-0329', 'P-0331', 'P-0332', 'P-0021', 'P-0105', 'P-0106', 'P-0107', 'P-0108', 'P-0109', 'P-0110', 'P-0111', 'P-0112', 'P-0113', 'P-0114', 'P-0117',
      'P-new.pay_expired_text', 'P-new.pay_checking_title', 'P-new.pay_checking_text', 'P-new.pay_expired_generic', 'P-new.pay_failed_title', 'P-new.pay_failed_text', 'P-new.pay_wallet_title', 'P-new.pay_wallet_text', 'P-new.pay_save_qr_hint', 'P-new.pay_open_failed', 'P-new.page_not_found']) {
      for (const lang of ['th', 'en'] as const) expect(hasKey(lang, k), `${lang} ${k}`).toBe(true);
    }
  });
});
