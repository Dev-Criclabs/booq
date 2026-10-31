import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import { BOOK_ERROR_KEY, bodyOf, bookErrorKey, canBook, dayText, hoursFrom, hourText, payBooking, quoteBooking, searchCustomers, startFrom, STATUS_KEY } from './booking';

// F11-T14 A02 Booking create and A02b Booking detail (ADMIN-04): the desk sends choices, never amounts; a changed price asks again; hours are Bangkok.
const spy = (body: unknown = {}) => { const calls: Array<{ url: string; init: RequestInit & { headers?: Record<string, string> } }> = []; const f = (async (url: string, init: RequestInit) => { calls.push({ url, init: init as never }); return new Response(JSON.stringify(body), { status: 200 }); }) as unknown as typeof fetch; return { f, calls }; };
const choice = { customerId: 'c1', courtId: 'k1', hours: ['2027-01-18T02:00:00.000Z'], addOnIds: ['a1'], code: ' spring ' };

describe('the start and hours', () => {
  it('keeps only an instant on the hour; a start with minutes or junk is dropped', () => {
    expect(startFrom('2027-01-18T09:00:00+07:00')).toBe('2027-01-18T02:00:00.000Z');
    expect(startFrom('2027-01-18T09:30:00+07:00')).toBeNull();
    expect(startFrom('tomorrow')).toBeNull();
    expect(startFrom(null)).toBeNull();
  });
  it('consecutive hours, shown as Bangkok time', () => {
    const h = hoursFrom('2027-01-18T02:00:00.000Z', 3);
    expect(h).toEqual(['2027-01-18T02:00:00.000Z', '2027-01-18T03:00:00.000Z', '2027-01-18T04:00:00.000Z']);
    expect(h.map(hourText)).toEqual(['09:00', '10:00', '11:00']);
    expect(dayText(h[0]!)).toBe('2027-01-18');
  });
});

describe('quote and pay', () => {
  it('the body is the choices (customer, court, hours, add-ons, a trimmed code); the code is left out when empty; no amount is sent', () => {
    expect(bodyOf(choice)).toEqual({ customerId: 'c1', courtId: 'k1', hours: choice.hours, addOnIds: ['a1'], code: 'spring' });
    expect(bodyOf({ ...choice, code: '  ' })).not.toHaveProperty('code');
  });
  it('quote posts to the staff route; pay adds the quote hash and an Idempotency-Key', async () => {
    const a = spy();
    await quoteBooking('h', choice, a.f);
    expect(a.calls[0]!.url).toBe('/api/c/h/staff/orders/quote');
    const b = spy();
    await payBooking('h', choice, 'f'.repeat(64), 'KEY', b.f);
    expect(b.calls[0]!.url).toBe('/api/c/h/staff/orders/pay');
    expect(b.calls[0]!.init.headers?.['idempotency-key']).toBe('KEY');
    expect(JSON.parse(b.calls[0]!.init.body as string)).toMatchObject({ customerId: 'c1', quoteHash: 'f'.repeat(64) });
  });
});

describe('customers', () => {
  it('searches by text; only a customer who has signed in can be booked', async () => {
    const s = spy({ customers: [{ customerId: 'c1', name: 'Ploy', phone: '+668', claimState: null, signedIn: true }] });
    const r = await searchCustomers('h', ' ploy ', s.f);
    expect(s.calls[0]!.url).toBe('/api/c/h/staff/customers?q=ploy');
    expect(r).toMatchObject({ kind: 'ok', body: [{ customerId: 'c1' }] });
    expect(canBook({ claimState: null })).toBe(true);
    expect(canBook({ claimState: 'unclaimed' })).toBe(false);
  });
});

describe('refusals and text', () => {
  it('each refusal has its own words; the numbers go into the text', () => {
    expect(bookErrorKey({ kind: 'refused', status: 409, code: 'slot_unavailable' })).toEqual({ key: 'A-new.book_err_taken', vars: {} });
    expect(bookErrorKey({ kind: 'refused', status: 409, code: 'limit_reached', params: { hours: 4 } })).toEqual({ key: 'A-new.book_err_limit', vars: { hours: 4 } });
    expect(bookErrorKey({ kind: 'refused', status: 429, code: 'too_many_attempts', params: { seconds: 20 } }).vars).toEqual({ seconds: 20 });
    expect(bookErrorKey({ kind: 'refused', status: 422, code: 'code_expired' }).key).toBe('A-new.book_err_code');
    expect(bookErrorKey({ kind: 'refused', status: 409, code: 'new_thing' }).key).toBe('A-new.book_err_general');
    expect(bookErrorKey({ kind: 'offline' }).key).toBe('A-new.book_err_general');
  });
  it('every key the pages use exists in both languages', () => {
    const keys = ['A-0002', 'A-0012', 'A-0015', 'A-0019', 'A-0039', 'A-0056', 'A-0062', 'A-0067', 'A-0435', 'A-0439', 'A-new.cal_court_pick', 'A-new.sell_pick', 'A-new.cust_no_match', 'A-new.cust_no_name', 'A-new.set_retry', ...Object.values(BOOK_ERROR_KEY), ...Object.values(STATUS_KEY),
      ...['load_failed', 'back', 'slot', 'pick_in_calendar', 'add_hour', 'remove_hour', 'change_customer', 'not_signed_in', 'addons', 'line_court', 'line_coach', 'line_addon', 'discount', 'code_not_applied', 'credit_used', 'wallet_used', 'to_pay', 'policy', 'check', 'confirm',
        'price_changed', 'done_confirmed', 'done_paid', 'qr_alt', 'qr_waiting', 'qr_ended', 'again', 'status_other', 'hold_until', 'hold_ended', 'release', 'release_confirm', 'released', 'history', 'history_none', 'system'].map((k) => `A-new.book_${k}`)];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
