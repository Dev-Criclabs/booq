import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import {
  ACTION_ERROR_KEY, actionErrorKey, adjustCredit, adjustWallet, BOOKING_STATUS_KEY, BOOKING_TYPE_KEY, bookingWhat, extendPackage, LEVEL_KEY, nextPackage, ORDER_KIND_KEY, parseBaht, parseCredits, parseDay,
  recent, removeTag, visits, type BookingRow, type PackageRow,
} from './profile';
import { bangkokParts, dateOf, longDayOf, timeOf } from './time';

// F11-T15 A6 Customer profile (ADMIN-07): what is typed becomes a change and a reason; value moves only as ledger rows.
const booking = (n: number, over: Partial<BookingRow> = {}): BookingRow => ({ bookingId: `b${n}`, orderId: `o${n}`, type: 'court', courtName: '1', coachName: null, classNameTh: null, classNameEn: null, startAt: `2027-01-0${n}T10:00:00Z`, endAt: `2027-01-0${n}T11:00:00Z`, status: 'confirmed', source: 'online', cancelKind: null, cancelOutcome: null, ...over });
const pack = (id: string, over: Partial<PackageRow> = {}): PackageRow => ({ packageId: id, nameTh: 'ก', nameEn: 'Bundle', creditType: 'court_hour', creditsTotal: 10, creditsLeft: 7, status: 'active', purchasedAt: '2027-01-05T03:00:00Z', expiresAt: '2027-04-09T03:00:00Z', ...over });

describe('what is typed', () => {
  it('baht become integer satang with no floating point; zero, text and three decimals are refused', () => {
    expect(parseBaht('+200')).toBe(20000);
    expect(parseBaht('-50.5')).toBe(-5050);
    expect(parseBaht('200')).toBe(20000);
    expect(parseBaht(' 0.05 ')).toBe(5);
    expect(parseBaht('1.234.5')).toBeNull();
    for (const bad of ['', '0', '0.00', 'abc', '1.234', '--5', '+', '1e3', '1,000']) expect(parseBaht(bad), bad).toBeNull();
    expect(parseBaht('19.99')).toBe(1999);
  });
  it('credits are whole numbers, not zero', () => {
    expect(parseCredits('+2')).toBe(2);
    expect(parseCredits('-1')).toBe(-1);
    for (const bad of ['', '0', '1.5', 'x', '+']) expect(parseCredits(bad), bad).toBeNull();
  });
  it('a day is a real calendar day', () => {
    expect(parseDay('2027-04-09')).toBe('2027-04-09');
    for (const bad of ['', '2027-02-30', '09/04/2027', '2027-13-01', '2569-01-01x']) expect(parseDay(bad), bad).toBeNull();
  });
});

describe('what the server refuses is said in words', () => {
  it('each typed code has its own key, the rest the general one', () => {
    expect(actionErrorKey({ kind: 'refused', status: 400, code: 'reason_required' })).toBe('A-new.prof_err_reason');
    expect(actionErrorKey({ kind: 'refused', status: 409, code: 'below_zero' })).toBe('A-new.prof_err_below_zero');
    expect(actionErrorKey({ kind: 'refused', status: 409, code: 'customer_not_claimed' })).toBe('A-new.prof_err_unclaimed');
    expect(actionErrorKey({ kind: 'forbidden' })).toBe('A-new.prof_err_forbidden');
    expect(actionErrorKey({ kind: 'offline' })).toBe('A-new.prof_err_general');
    expect(actionErrorKey({ kind: 'refused', status: 400, code: 'something_new' })).toBe('A-new.prof_err_general');
    expect(Object.keys(ACTION_ERROR_KEY).sort()).toEqual(['bad_input', 'below_zero', 'customer_not_claimed', 'not_found', 'reason_required']);
  });
});

describe('requests', () => {
  const seen: Array<{ url: string; method: string; body: unknown }> = [];
  const f = (async (url: string, init: { method?: string; body?: string }) => {
    seen.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  it('a wallet change sends satang and the note, a credit change the package, a tag is encoded in the path, an extension the day and the reason', async () => {
    await adjustWallet('hunter', 'u1', -5050, ' refund ', f);
    await adjustCredit('hunter', 'u1', 'p1', 2, 'gift', f);
    await removeTag('hunter', 'u1', 'Partner gym/VIP', f);
    await extendPackage('hunter', 'p1', '2027-05-01', 'sick', f);
    expect(seen).toEqual([
      { url: '/api/c/hunter/staff/customers/u1/wallet-adjust', method: 'POST', body: { deltaSatang: -5050, note: 'refund' } },
      { url: '/api/c/hunter/staff/customers/u1/credit-adjust', method: 'POST', body: { packageId: 'p1', delta: 2, note: 'gift' } },
      { url: '/api/c/hunter/staff/customers/u1/tags/Partner%20gym%2FVIP', method: 'DELETE', body: undefined },
      { url: '/api/c/hunter/staff/packages/p1/extend', method: 'POST', body: { newExpiresOn: '2027-05-01', reason: 'sick' } },
    ]);
  });
});

describe('overview', () => {
  it('visits are confirmed bookings whose hour is over, since the first of them', () => {
    const now = new Date('2027-01-03T10:30:00Z');
    const v = visits([booking(1), booking(2), booking(3), booking(4, { status: 'cancelled' })], now);
    expect(v).toEqual({ count: 2, since: '2027-01-01T10:00:00Z' });
    expect(visits([], now)).toEqual({ count: 0, since: null });
  });
  it('recent shows the newest first as sent, at most five', () => {
    expect(recent([1, 2, 3, 4, 5, 6].map((n) => booking(n))).map((b) => b.bookingId)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
  });
  it('the tile package is the one with credits left that ends first; used up and expired are not', () => {
    const p = nextPackage([pack('a', { expiresAt: '2027-06-01T00:00:00Z' }), pack('b', { expiresAt: '2027-05-01T00:00:00Z' }), pack('c', { status: 'used_up', creditsLeft: 0, expiresAt: '2027-02-01T00:00:00Z' }), pack('d', { status: 'expired' })]);
    expect(p?.packageId).toBe('b');
    expect(nextPackage([])).toBeNull();
  });
  it('a class shows its name in the language, else the court', () => {
    expect(bookingWhat(booking(1, { classNameEn: 'Clinic', classNameTh: 'คลินิก' }), 'th')).toEqual({ kind: 'class', text: 'คลินิก' });
    expect(bookingWhat(booking(1), 'en')).toEqual({ kind: 'court', text: '1' });
  });
});

describe('Bangkok time', () => {
  it('a moment late in the UTC evening is already the next Bangkok day', () => {
    expect(bangkokParts('2027-01-12T17:30:00Z')).toEqual({ day: '2027-01-13', time: '00:30' });
    expect(timeOf('2027-01-12T17:30:00Z')).toBe('00:30');
    expect(dateOf('en', '2027-01-12T17:30:00Z')).toBe('Wed 13 Jan');
    expect(longDayOf('en', '1994-03-14')).toBe('14 March 1994');
    expect(longDayOf('th', '2027-01-12T17:30:00Z')).toMatch(/13 มกราคม 2027/);
    expect(bangkokParts('nope')).toBeNull();
  });
});

describe('text', () => {
  it('every key the profile uses exists in both languages', () => {
    const keys = new Set<string>(['A-0094', 'A-0096', 'A-0097', 'A-0098', 'A-0099', 'A-0100', 'A-0106', 'A-0107', 'A-0108', 'A-0109', 'A-0115', 'A-0117', 'A-0118', 'A-0120', 'A-0121', 'A-0122', 'A-0123', 'A-0055', 'A-0019',
      'A-0015', 'A-0016', 'A-0017', 'A-0306', 'A-0404', ...Object.values(LEVEL_KEY), ...Object.values(BOOKING_TYPE_KEY), ...Object.values(BOOKING_STATUS_KEY), ...Object.values(ORDER_KIND_KEY), ...Object.values(ACTION_ERROR_KEY),
      'A-new.prof_err_forbidden', 'A-new.prof_err_general', 'A-new.prof_load_failed', 'A-new.prof_not_found', 'A-new.prof_forbidden', 'A-new.prof_born', 'A-new.prof_tabs_label', 'A-new.prof_tag_remove', 'A-new.prof_tag_input', 'A-new.prof_tag_add',
      'A-new.prof_credits_left', 'A-new.prof_no_package', 'A-new.prof_notes_empty', 'A-new.prof_note_label', 'A-new.prof_note_add', 'A-new.prof_note_by', 'A-new.prof_adjust_what', 'A-new.prof_adjust_package', 'A-new.prof_adjust_wallet_hint',
      'A-new.prof_adjust_credit_hint', 'A-new.prof_adjust_no_package', 'A-new.prof_extend_day', 'A-new.prof_extend_reason', 'A-new.prof_saved', 'A-new.prof_bookings_empty', 'A-new.prof_orders_empty', 'A-new.prof_ledger_empty',
      'A-new.prof_wallet_balance', 'A-new.prof_packages', 'A-new.prof_wallet_ledger', 'A-new.prof_credit_ledger', 'A-new.prof_col_when', 'A-new.prof_col_what', 'A-new.prof_col_status', 'A-new.prof_col_total', 'A-new.prof_col_paid',
      'A-new.prof_col_receipts', 'A-new.prof_col_change', 'A-new.prof_col_reason', 'A-new.prof_col_expires', 'A-new.prof_paid_with', 'A-new.prof_visits_since', 'A-new.prof_unclaimed_note', 'A-new.cust_no_name', 'A-new.cust_retry']);
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
