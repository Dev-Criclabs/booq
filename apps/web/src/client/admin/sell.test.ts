import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import { byType, cashBody, loadProducts, newKey, payPackageByQr, quotePackage, REASON_KEY, SELL_ERROR_KEY, sellErrorKey, sellForCash, TYPE_KEY, type Product } from './sell';

// F11-T14 A02c Sell a package (ADMIN-04): the cash route needs a reason (a note for "other") and an Idempotency-Key; the QR route quotes then pays by the quote's hash.
const prod = (id: string, creditType: Product['creditType']): Product => ({ productId: id, nameTh: 'ก', nameEn: id, creditType, credits: 10, validityMonths: 3, priceGroupId: null, coachTierId: null, priceSatang: 450000, pricePerCreditSatang: 45000, savingSatang: null });
const spy = (body: unknown = {}) => { const calls: Array<{ url: string; init: RequestInit & { headers?: Record<string, string> } }> = []; const f = (async (url: string, init: RequestInit) => { calls.push({ url, init: init as never }); return new Response(JSON.stringify(body), { status: 200 }); }) as unknown as typeof fetch; return { f, calls }; };

describe('products', () => {
  it('groups by kind in the board order and leaves out empty groups', () => {
    const g = byType([prod('s', 'solo_class'), prod('c', 'court_hour'), prod('c2', 'court_hour')]);
    expect(g.map((x) => [x.type, x.items.length])).toEqual([['court_hour', 2], ['solo_class', 1]]);
  });
  it('reads a list or { products }', async () => {
    expect(await loadProducts('h', spy([prod('a', 'court_hour')]).f)).toMatchObject({ kind: 'ok', body: [{ productId: 'a' }] });
    expect(await loadProducts('h', spy({ products: [prod('b', 'court_hour')] }).f)).toMatchObject({ kind: 'ok', body: [{ productId: 'b' }] });
    expect(await loadProducts('h', spy(null).f)).toMatchObject({ kind: 'ok', body: [] });
  });
});

describe('cash', () => {
  it('needs a reason, and a note when the reason is other; the note is sent trimmed', () => {
    expect(cashBody('p', { reason: '', note: '' })).toEqual({ ok: false, key: 'A-new.sell_err_reason' });
    expect(cashBody('p', { reason: 'other', note: '  ' })).toEqual({ ok: false, key: 'A-new.sell_err_note' });
    expect(cashBody('p', { reason: 'other', note: ' no app ' })).toEqual({ ok: true, body: { productId: 'p', reasonCode: 'other', note: 'no app' } });
    expect(cashBody('p', { reason: 'no_banking_app', note: '' })).toEqual({ ok: true, body: { productId: 'p', reasonCode: 'no_banking_app' } });
  });
  it('posts to the customer with an Idempotency-Key header', async () => {
    const s = spy({ orderId: 'o', paymentId: 'x', cashSatang: 1, walletSatang: 0 });
    await sellForCash('h', 'c1', { productId: 'p', reasonCode: 'other', note: 'n' }, 'KEY-1', s.f);
    expect(s.calls[0]!.url).toBe('/api/c/h/staff/customers/c1/package-sale');
    expect(s.calls[0]!.init.headers?.['idempotency-key']).toBe('KEY-1');
    expect(JSON.parse(s.calls[0]!.init.body as string)).toEqual({ productId: 'p', reasonCode: 'other', note: 'n' });
  });
});

describe('QR', () => {
  it('quotes for the customer, then pays by the quote hash with a key', async () => {
    const a = spy({});
    await quotePackage('h', 'c1', 'p', a.f);
    expect(a.calls[0]!.url).toBe('/api/c/h/staff/orders/package/quote');
    expect(JSON.parse(a.calls[0]!.init.body as string)).toEqual({ customerId: 'c1', productId: 'p' });
    const b = spy({});
    await payPackageByQr('h', 'c1', 'p', 'a'.repeat(64), 'K', b.f);
    expect(b.calls[0]!.init.headers?.['idempotency-key']).toBe('K');
    expect(JSON.parse(b.calls[0]!.init.body as string)).toEqual({ customerId: 'c1', productId: 'p', quoteHash: 'a'.repeat(64) });
  });
});

describe('refusals and text', () => {
  it('each refusal has its own words; keys are fresh each time', () => {
    expect(sellErrorKey({ kind: 'refused', status: 400, code: 'selection_invalid' })).toBe('A-new.sell_err_not_for_customer');
    expect(sellErrorKey({ kind: 'refused', status: 400, code: 'reason_required' })).toBe('A-new.sell_err_note');
    expect(sellErrorKey({ kind: 'refused', status: 503, code: 'payment_unavailable' })).toBe('A-new.sell_err_qr');
    expect(sellErrorKey({ kind: 'refused', status: 400, code: 'xx' })).toBe('A-new.sell_err_general');
    expect(sellErrorKey({ kind: 'forbidden' })).toBe('A-new.sell_err_forbidden');
    expect(newKey()).not.toBe(newKey());
  });
  it('every key the page uses exists in both languages', () => {
    const keys = ['A-0052', 'A-0056', 'A-0062', 'A-0227', 'A-0159', 'A-0428', 'A-0429', 'A-0431', 'A-0432', 'A-0438', 'A-0439', 'A-0440', 'A-new.set_retry', ...Object.values(TYPE_KEY), ...Object.values(REASON_KEY), ...Object.values(SELL_ERROR_KEY),
      ...['load_failed', 'for', 'none', 'detail', 'reason', 'pick', 'note', 'cash_go', 'quote', 'price_changed', 'qr_alt', 'qr_waiting', 'qr_ended', 'again', 'done_cash', 'done_wallet', 'done_paid', 'err_pick', 'err_reason', 'err_forbidden'].map((k) => `A-new.sell_${k}`)];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
