import { describe, expect, it } from 'vitest';
import { call, formatBaht } from './api';
import { appendPage, csvHref, listPath, loadCustomers, nameOf, profilePath, type CustomerRow } from './customers';
import { adminHasKey } from './i18n';

// F11-T15 A5 Customers (ADMIN-06): the client side of the list.
const row = (id: string, over: Partial<CustomerRow> = {}): CustomerRow => ({ customerId: id, name: 'Ploy', phone: '+66812345678', tags: [], claimState: null, signedIn: true, lastBookingAt: null, bookingCount: 0, createdAt: '2026-12-01T03:00:00Z', ...over });
const reply = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

describe('list address', () => {
  it('sends only what was typed, trimmed, and the cursor of the next page', () => {
    expect(listPath({ q: '', tag: '' })).toBe('/staff/customers');
    expect(listPath({ q: ' ploy ', tag: ' Partner gym ' })).toBe('/staff/customers?q=ploy&tag=Partner+gym');
    expect(listPath({ q: '', tag: '', cursor: 'abc' })).toBe('/staff/customers?cursor=abc');
  });
  it('addresses stay inside the club', () => {
    expect(profilePath('hunter', 'u1')).toBe('/c/hunter/admin/customers/u1');
    expect(csvHref('hunter')).toBe('/api/c/hunter/staff/customers/csv');
  });
});

describe('paging', () => {
  it('the next page joins the rows and a customer already shown is not shown twice', () => {
    expect(appendPage([row('a'), row('b')], { customers: [row('b'), row('c')], next: null }).map((r) => r.customerId)).toEqual(['a', 'b', 'c']);
  });
  it('a name is what the customer gave, else nothing', () => {
    expect(nameOf(row('a', { name: '  Ploy ' }))).toBe('Ploy');
    expect(nameOf(row('a', { name: null }))).toBe('');
  });
});

describe('outcomes', () => {
  it('ok, guest, forbidden, not found, a refusal with its code, a server fault and a lost network each say what they are', async () => {
    expect(await loadCustomers('hunter', { q: '', tag: '' }, reply(200, { customers: [], next: null }))).toEqual({ kind: 'ok', body: { customers: [], next: null } });
    expect(await call('hunter', '/x', reply(401, { code: 'unauthenticated' }))).toEqual({ kind: 'guest' });
    expect(await call('hunter', '/x', reply(403, { code: 'forbidden' }))).toEqual({ kind: 'forbidden' });
    expect(await call('hunter', '/x', reply(404, { code: 'not_found' }))).toEqual({ kind: 'not_found' });
    expect(await call('hunter', '/x', reply(409, { code: 'reason_required' }))).toEqual({ kind: 'refused', status: 409, code: 'reason_required' });
    expect(await call('hunter', '/x', reply(400, { code: 'bad_input', params: { field: 'name' } }))).toEqual({ kind: 'refused', status: 400, code: 'bad_input', params: { field: 'name' } });
    expect(await call('hunter', '/x', reply(500, {}))).toEqual({ kind: 'offline' });
    expect(await call('hunter', '/x', (async () => { throw new Error('x'); }) as unknown as typeof fetch)).toEqual({ kind: 'offline' });
  });
});

describe('money and text', () => {
  it('whole baht without satang, satang only when there are some, negative with a minus', () => {
    expect(formatBaht(50000)).toBe('฿500');
    expect(formatBaht(50050)).toBe('฿500.50');
    expect(formatBaht(-20000)).toBe('-฿200');
    expect(formatBaht(1234500)).toBe('฿12,345');
    expect(formatBaht(5)).toBe('฿0.05');
  });
  it('every key the list uses exists in both languages', () => {
    const keys = ['A-0003', 'A-0065', 'A-0066', 'A-0067', 'A-0074', 'A-0075', 'A-0076', 'A-0080', 'A-0081', 'A-0083', 'A-0086', 'A-0098',
      'A-new.cust_empty', 'A-new.cust_no_match', 'A-new.cust_more', 'A-new.cust_tag_label', 'A-new.cust_tag_placeholder', 'A-new.cust_search_label', 'A-new.cust_load_failed',
      'A-new.cust_forbidden', 'A-new.cust_retry', 'A-new.cust_no_name', 'A-new.cust_list_label', 'A-new.cust_open'];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
