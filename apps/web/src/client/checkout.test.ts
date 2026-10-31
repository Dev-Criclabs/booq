import { describe, expect, it } from 'vitest';
import en from '../../../../locales/en.json';
import th from '../../../../locales/th.json';
import f04 from '../../../../locales/pending/f04.json';
import f04c from '../../../../locales/pending/f04-checkout.json';
import f03 from '../../../../locales/pending/f03.json';
import { hasKey } from './i18n';
import { bangkokTime, baht, billRows, codeRefusalKey, isCodeRefusal, loadQuote, parseChoice, pay, refusalFor, requestBody, type QuoteView } from './checkout';

// F04-T17, T18 (R4-AC5, R8-AC1 to AC4): the choice in the address, the request bodies and the answers sorted into screen states.
const COURT = '3f2b8f0e-7c1d-4a55-9d0a-1c2e3f4a5b6c';
const q = (o: Record<string, string>) => new URLSearchParams({ court: '2', courtId: COURT, date: '2027-01-09', from: '18:00', to: '19:00', ...o }).toString();

describe('parseChoice', () => {
  it('turns the address into the hour starts the server prices, one per hour', () => {
    expect(parseChoice(q({}))).toMatchObject({ courtName: '2', courtId: COURT, date: '2027-01-09', hours: ['2027-01-09T18:00:00+07:00'] });
    expect(parseChoice(q({ from: '22:00', to: '24:00' }))!.hours).toEqual(['2027-01-09T22:00:00+07:00', '2027-01-09T23:00:00+07:00']);
    expect(parseChoice(q({ from: '06:00', to: '09:00' }))!.hours).toHaveLength(3);
  });
  it('refuses anything that is not a whole run of hours on one court', () => {
    for (const bad of [{ courtId: 'x' }, { date: '2027-02-30' }, { date: 'x' }, { from: '18:30' }, { to: '18:00' }, { to: '17:00' }, { to: '25:00' }, { from: '06:00', to: '23:00' }, { court: '' }]) {
      expect(parseChoice(q(bad)), JSON.stringify(bad)).toBeNull();
    }
    expect(parseChoice('')).toBeNull();
  });
});

describe('requestBody', () => {
  it('carries choices only: court, hours, coach, add-ons and a trimmed code; never an amount', () => {
    const c = parseChoice(q({}))!;
    const b = requestBody(c, { coachId: null, addOnIds: ['a1'], code: '  spring10 ' });
    expect(b).toEqual({ courtId: COURT, hours: c.hours, coachId: null, coachSource: 'checkout', addOnIds: ['a1'], code: 'spring10' });
    expect(requestBody(c, { coachId: 'c', addOnIds: [], code: '   ' })['code']).toBeNull();
    expect(JSON.stringify(b)).not.toMatch(/satang|price|total/i);
  });
});

const quote = (over: Partial<QuoteView> = {}): QuoteView => ({ lines: [], subtotalSatang: 50000, discountSatang: 0, totalSatang: 50000, creditValueSatang: 0, walletSatang: 0, moneySatang: 50000, codeNotApplied: false, quoteHash: 'h'.repeat(64), ...over });
const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

describe('loadQuote and pay', () => {
  const c = parseChoice(q({}))!;
  const want = { coachId: null, addOnIds: [], code: null };
  it('a quote answers the server amounts; a refusal keeps its code and its values', async () => {
    expect(await loadQuote('hunter', c, want, reply(200, quote()))).toMatchObject({ ok: true, value: { moneySatang: 50000 } });
    expect(await loadQuote('hunter', c, want, reply(422, { code: 'code_below_minimum', params: { amount: 100000 } }))).toEqual({ ok: false, status: 422, code: 'code_below_minimum', params: { amount: 100000 } });
    expect(await loadQuote('hunter', c, want, reply(409, { code: 'club_paused' }))).toMatchObject({ ok: false, code: 'club_paused' });
  });
  it('offline: a failed request is code offline with status 0, so nothing is claimed to have happened', async () => {
    const down = (async () => { throw new TypeError('network'); }) as typeof fetch;
    expect(await loadQuote('hunter', c, want, down)).toEqual({ ok: false, status: 0, code: 'offline' });
    expect(await pay('hunter', c, want, 'h', 'k', down)).toEqual({ ok: false, status: 0, code: 'offline' });
  });
  it('Pay sorts its answers: confirmed with no money, started with a payment, price changed with the new quote; the key goes in the header', async () => {
    let seen: { headers: Record<string, string>; body: string } | null = null;
    const spy = ((_: string, init: RequestInit) => {
      seen = { headers: init.headers as Record<string, string>, body: String(init.body) };
      return Promise.resolve(new Response(JSON.stringify({ orderId: 'o1', holdExpiresAt: null, payment: null, confirmed: true }), { status: 200 }));
    }) as unknown as typeof fetch;
    expect(await pay('hunter', c, want, 'a'.repeat(64), 'pay-key', spy)).toEqual({ ok: true, value: { kind: 'confirmed', orderId: 'o1' } });
    expect(seen!.headers['idempotency-key']).toBe('pay-key');
    expect(JSON.parse(seen!.body)).toMatchObject({ quoteHash: 'a'.repeat(64), courtId: COURT });
    const started = { orderId: 'o2', holdExpiresAt: '2027-01-09T10:15:00Z', payment: { id: 'p', amountSatang: 50000, qrImageBase64: 'x', qrExpiresAt: '2027-01-09T10:10:00Z' }, confirmed: false };
    expect(await pay('hunter', c, want, 'h', 'k', reply(200, started))).toMatchObject({ ok: true, value: { kind: 'started', started: { orderId: 'o2' } } });
    expect(await pay('hunter', c, want, 'h', 'k', reply(200, { priceChanged: true, quote: quote({ moneySatang: 60000 }) }))).toMatchObject({ ok: true, value: { kind: 'price_changed', quote: { moneySatang: 60000 } } });
    expect(await pay('hunter', c, want, 'h', 'k', reply(409, { code: 'slot_unavailable', params: { by: 'other' } }))).toMatchObject({ ok: false, code: 'slot_unavailable' });
  });
});

describe('refusals', () => {
  it('maps a code to a locale key; paused and taken are P-0442 and the slot text, and a taken slot sends the player back to pick again', () => {
    expect(refusalFor('club_paused')).toMatchObject({ key: 'P-0442', pickAgain: false });
    expect(refusalFor('slot_unavailable')).toMatchObject({ key: 'P-new.slot_unavailable_court', pickAgain: true });
    expect(refusalFor('payment_unavailable')).toMatchObject({ key: 'P-new.payment_unavailable' });
    expect(refusalFor('nothing_like_it')).toBeNull();
    expect(refusalFor('code_below_minimum')).toBeNull();
  });
  it('a code refusal stays on the code field and names its own key', () => {
    for (const c of ['code_not_valid', 'code_expired', 'code_used_up', 'one_code_per_order']) expect(isCodeRefusal(c)).toBe(true);
    expect(isCodeRefusal('slot_unavailable')).toBe(false);
    expect(codeRefusalKey('code_expired')).toBe('P-new.code_expired');
  });
  it('values the server sends reach the text as variables', () => {
    expect(refusalFor('limit_reached', { hours: 4 })!.vars).toEqual({ hours: 4 });
  });
});

describe('bangkokTime', () => {
  it('shows the Bangkok hour of a UTC instant, across midnight too', () => {
    expect(bangkokTime('2027-01-09T11:00:00.000Z')).toBe('18:00');
    expect(bangkokTime('2027-01-09T17:00:00.000Z')).toBe('00:00');
  });
});

describe('bundle offer', () => {
  it('is carried as the server sends it: product, price in satang, hours and the one hour used now', async () => {
    const offer = { productId: 'p', priceSatang: 450000, hours: 10, hoursUsedNow: 1 };
    const r = await loadQuote('hunter', parseChoice(q({}))!, { coachId: null, addOnIds: [], code: null }, reply(200, quote({ bundleOffer: offer, cancelWindowHours: 12 })));
    expect(r).toMatchObject({ ok: true, value: { bundleOffer: offer, cancelWindowHours: 12 } });
  });
});

describe('baht and the bill', () => {
  it('whole baht have no decimals and thousands are grouped', () => {
    expect(baht(50000)).toBe('฿500');
    expect(baht(450050)).toBe('฿4,500.50');
    expect(baht(0)).toBe('฿0');
    expect(baht(-1000)).toBe('-฿10');
  });
  it('groups the lines as the board does', () => {
    const l = (kind: QuoteView['lines'][number]['kind']) => ({ kind }) as QuoteView['lines'][number];
    const g = billRows([l('court_hour'), l('add_on'), l('coach'), l('court_hour')]);
    expect([g.courtHours.length, g.coaching.length, g.addOns.length]).toEqual([2, 1, 1]);
  });
});

describe('text keys (TEXT-01, TEXT-06)', () => {
  const CODES = ['club_paused', 'club_not_available', 'slot_unavailable', 'selection_invalid', 'bad_input', 'resource_inactive', 'coach_unavailable', 'coach_price_not_set',
    'coach_at_checkout_disabled', 'price_not_set', 'add_on_not_for_sale', 'birthday_not_available', 'credit_unavailable', 'payment_unavailable', 'limit_reached', 'too_many_attempts',
    'student_item_not_allowed', 'rest_rule'];
  const CODE_KEYS = ['code_not_valid', 'code_expired', 'code_wrong_audience', 'code_out_of_scope', 'code_below_minimum', 'code_first_booking_only', 'code_used_up', 'code_not_for_solo_class', 'one_code_per_order'];
  it('every refusal and code key is in both languages', () => {
    const keys = [...CODES.map((c) => refusalFor(c)!.key), ...CODE_KEYS.map(codeRefusalKey)];
    for (const k of keys) for (const lang of ['th', 'en'] as const) expect(hasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
  it('the new keys have the same variables in both languages and no existing key is edited', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const c = f04c as unknown as { en: Record<string, string>; th: Record<string, string> };
    expect(Object.keys(c.en).sort()).toEqual(Object.keys(c.th).sort());
    for (const k of Object.keys(c.en)) {
      expect(vars(c.en[k]!), k).toEqual(vars(c.th[k]!));
      expect(Object.hasOwn(en, k) || Object.hasOwn(th, k), `${k} already exists`).toBe(false);
      expect(Object.hasOwn((f04 as unknown as { en: object }).en, k) || Object.hasOwn((f03 as unknown as { en: object }).en, k), `${k} duplicates a pending key`).toBe(false);
    }
  });
  it('the screen keys that are not refusals exist in both languages', () => {
    for (const k of ['P-0058', 'P-0060', 'P-0061', 'P-0062', 'P-0063', 'P-0064', 'P-0065', 'P-0070', 'P-0071', 'P-0074', 'P-0075', 'P-0076', 'P-0077', 'P-0078', 'P-0079', 'P-0080', 'P-0081', 'P-0082', 'P-0029', 'P-0143', 'P-0364', 'P-0365', 'P-0436', 'P-0326', 'P-0327', 'P-0328', 'P-0332', 'P-0442', 'P-new.checkout_price_changed', 'P-new.checkout_discount', 'P-new.checkout_no_coach', 'P-new.checkout_working', 'P-new.checkout_back_to_courts', 'P-new.checkout_hold_note', 'P-new.checkout_code_hint_not_applied', 'P-new.checkout_bad_input']) {
      for (const lang of ['th', 'en'] as const) expect(hasKey(lang, k), `${lang} ${k}`).toBe(true);
    }
  });
});
