import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import { APPLIES, APPLIES_KEY, AUDIENCE_KEY, discountText, partnerBody, partnerDraft, promoBody, promoDraft, promoErrorKey, PROMO_ERROR_KEY, type Partner, type Promo } from './promos';

// F11-T19 A10 Promotions (ADMIN-12): percent is held as basis points and a fixed amount as satang; what is left empty stays unset; only changes are sent.
const filled = { ...promoDraft(), code: ' spring10 ', amount: '10', appliesTo: ['package' as const, 'court_hour' as const] };
const promo: Promo = {
  id: 'c1', code: 'SPRING10', kind: 'percent', value: 1000, appliesTo: ['court_hour', 'package'], includesAddOns: false, audience: 'any', startsOn: null, endsOn: null, firstTimeOnly: false,
  totalCap: null, perCustomerCap: null, minSpendSatang: null, stackableWithBirthday: false, partnerId: null, active: true,
};

describe('promo codes', () => {
  it('a new percent code is sent in basis points with the code in upper case; empty optional fields are not sent', () => {
    expect(promoBody(undefined, filled)).toEqual({ ok: true, body: {
      code: 'SPRING10', kind: 'percent', value: 1000, appliesTo: ['court_hour', 'package'], includesAddOns: false, audience: 'any', firstTimeOnly: false, stackableWithBirthday: false, active: true,
    } });
  });
  it('a fixed amount is typed in baht and sent in satang; 12.5 percent is 1250', () => {
    expect(promoBody(undefined, { ...filled, kind: 'fixed', amount: '50.5' })).toMatchObject({ ok: true, body: { kind: 'fixed', value: 5050 } });
    expect(promoBody(undefined, { ...filled, amount: '12.5' })).toMatchObject({ ok: true, body: { value: 1250 } });
    expect(promoBody(undefined, { ...filled, amount: '100' })).toMatchObject({ ok: true, body: { value: 10000 } });
  });
  it('wrong input is refused before the server', () => {
    expect(promoBody(undefined, { ...filled, code: 'bad code' })).toEqual({ ok: false, key: 'A-new.promo_err_code' });
    expect(promoBody(undefined, { ...filled, amount: '100.01' })).toEqual({ ok: false, key: 'A-new.promo_err_percent' });
    expect(promoBody(undefined, { ...filled, amount: '0' })).toEqual({ ok: false, key: 'A-new.promo_err_percent' });
    expect(promoBody(undefined, { ...filled, kind: 'fixed', amount: '' })).toEqual({ ok: false, key: 'A-new.promo_err_fixed' });
    expect(promoBody(undefined, { ...filled, appliesTo: [] })).toEqual({ ok: false, key: 'A-new.promo_err_applies' });
    expect(promoBody(undefined, { ...filled, startsOn: '2027-02-01', endsOn: '2027-01-01' })).toEqual({ ok: false, key: 'A-new.promo_err_dates_order' });
    expect(promoBody(undefined, { ...filled, totalCap: '0' })).toEqual({ ok: false, key: 'A-new.promo_err_cap' });
    expect(promoBody(undefined, { ...filled, minSpend: '1.234' })).toEqual({ ok: false, key: 'A-new.promo_err_spend' });
  });
  it('optional fields are sent when filled: dates, caps, minimum spend, partner, audience, stacking', () => {
    expect(promoBody(undefined, { ...filled, startsOn: '2027-01-01', endsOn: '2027-01-31', totalCap: '50', perCustomerCap: '1', minSpend: '500', partnerId: 'pt1', audience: 'student', stackableWithBirthday: true, firstTimeOnly: true })).toMatchObject({
      ok: true, body: { startsOn: '2027-01-01', endsOn: '2027-01-31', totalCap: 50, perCustomerCap: 1, minSpendSatang: 50000, partnerId: 'pt1', audience: 'student', stackableWithBirthday: true, firstTimeOnly: true },
    });
  });
  it('a change sends only what changed, and an emptied cap goes as null; the applies-to order does not matter', () => {
    const d = promoDraft(promo);
    expect(d.amount).toBe('10');
    expect(promoBody(promo, d)).toEqual({ ok: false, key: 'A-new.promo_nothing_changed' });
    expect(promoBody(promo, { ...d, appliesTo: ['package', 'court_hour'] })).toEqual({ ok: false, key: 'A-new.promo_nothing_changed' });
    expect(promoBody(promo, { ...d, active: false })).toEqual({ ok: true, body: { active: false } });
    const capped = { ...promo, totalCap: 20 };
    expect(promoBody(capped, { ...promoDraft(capped), totalCap: '' })).toEqual({ ok: true, body: { totalCap: null } });
    expect(promoBody(promo, { ...d, amount: '12.5' })).toEqual({ ok: true, body: { value: 1250 } });
  });
  it('reads a discount as a percent or a satang amount', () => {
    expect(discountText(promo)).toEqual({ percent: '10' });
    expect(discountText({ kind: 'percent', value: 1250 })).toEqual({ percent: '12.5' });
    expect(discountText({ kind: 'fixed', value: 5000 })).toEqual({ satang: 5000 });
    expect(promoDraft({ ...promo, kind: 'fixed', value: 5050 }).amount).toBe('50.50');
  });
});

describe('partners', () => {
  const partner: Partner = { id: 'p1', name: 'Cafe', type: 'cafe', contact: null };
  it('a new partner needs a name; empty type and contact are not sent; a change sends only itself', () => {
    expect(partnerBody(undefined, { ...partnerDraft(), name: ' Cafe ' })).toEqual({ ok: true, body: { name: 'Cafe' } });
    expect(partnerBody(undefined, partnerDraft())).toEqual({ ok: false, key: 'A-new.promo_err_partner_name' });
    expect(partnerBody(partner, partnerDraft(partner))).toEqual({ ok: false, key: 'A-new.promo_nothing_changed' });
    expect(partnerBody(partner, { ...partnerDraft(partner), type: '', contact: '081' })).toEqual({ ok: true, body: { type: null, contact: '081' } });
  });
});

describe('refusals and text', () => {
  it('each refusal has its own words, the rest the general one', () => {
    expect(promoErrorKey({ kind: 'refused', status: 409, code: 'duplicate' })).toBe('A-new.promo_err_duplicate');
    expect(promoErrorKey({ kind: 'refused', status: 409, code: 'in_use' })).toBe('A-new.promo_err_in_use');
    expect(promoErrorKey({ kind: 'refused', status: 400, code: 'weird' })).toBe('A-new.promo_err_general');
    expect(promoErrorKey({ kind: 'offline' })).toBe('A-new.promo_err_general');
    expect(promoErrorKey({ kind: 'ok', body: {} })).toBeNull();
  });
  it('every key the page uses exists in both languages', () => {
    const keys = ['A-0016', 'A-0017', 'A-0068', 'A-0069', 'A-0070', 'A-0161', 'A-0251', 'A-0252', 'A-0253', 'A-0254', 'A-0255', 'A-0256', 'A-0257', 'A-0258', 'A-0261', 'A-0262', 'A-0263', 'A-0264', 'A-0267', 'A-0268', 'A-0270',
      'A-0321', 'A-new.set_saved', 'A-new.set_retry', ...Object.values(APPLIES_KEY), ...Object.values(AUDIENCE_KEY), ...Object.values(PROMO_ERROR_KEY),
      ...['load_failed', 'none', 'none_partners', 'nothing_changed', 'kind_percent', 'kind_fixed', 'amount_percent', 'amount_baht', 'includes_add_ons', 'starts', 'ends', 'total_cap', 'per_customer_cap', 'min_spend', 'stackable',
        'no_partner', 'active', 'delete', 'confirm_delete', 'add_partner', 'partner_name', 'partner_type', 'partner_contact', 'err_code', 'err_percent', 'err_fixed', 'err_applies', 'err_date', 'err_dates_order', 'err_cap',
        'err_spend', 'err_partner_name', 'err_partner_long', 'err_general'].map((k) => `A-new.promo_${k}`)];
    expect(APPLIES.length).toBe(6);
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
