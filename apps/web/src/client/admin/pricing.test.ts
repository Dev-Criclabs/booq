import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import {
  addOnBody, addOnDraft, bahtToSatang, courtRuleOf, groupBody, groupDraft, perHourSatang, priceErrorKey, productBody, productDraft, resultKey, satangToBaht, saveCourtRate, saveTierPrice, tierPriceOf,
  type AddOn, type CourtRule, type PriceGroup, type Product,
} from './pricing';

// F11-T18 A9 Products and pricing, A9b Price groups and add-ons (ADMIN-10, ADMIN-11): money is integer satang, a price nobody set stays unset, only changes are sent.
const ok = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const spy = () => { const calls: Array<{ url: string; init: RequestInit }> = []; const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return ok(); }) as unknown as typeof fetch; return { f, calls }; };
const group: PriceGroup = { id: 'g1', nameTh: 'ผู้ใหญ่', nameEn: 'Adult', rule: { min_age: 18 }, position: 0 };
const bundle: Product = { id: 'p1', nameTh: 'แพ็ก 10', nameEn: '10 hour bundle', creditType: 'court_hour', credits: 10, validityMonths: 3, priceGroupId: null, coachTierId: null, priceSatang: 450000, active: true };

describe('money', () => {
  it('baht to satang without floating point; empty is not set; junk is bad', () => {
    expect(bahtToSatang('500')).toBe(50000);
    expect(bahtToSatang('1,250.5')).toBe(125050);
    expect(bahtToSatang('0.07')).toBe(7);
    expect(bahtToSatang('  ')).toBeNull();
    for (const bad of ['-1', '1.234', 'abc', '5e3', '฿5']) expect(bahtToSatang(bad), bad).toBe('bad');
    expect(bahtToSatang('19.99')).toBe(1999);
  });
  it('satang back to a box value, and an unset price is an empty box', () => {
    expect(satangToBaht(50000)).toBe('500');
    expect(satangToBaht(50050)).toBe('500.50');
    expect(satangToBaht(null)).toBe('');
    expect(perHourSatang(bundle)).toBe(45000);
    expect(perHourSatang({ priceSatang: null, credits: 10 })).toBeNull();
  });
});

describe('court rate', () => {
  const rule: CourtRule = { id: 'r1', priceGroupId: 'g1', dayType: 'any', peak: 'any', priceSatang: 30000 };
  it('finds the every day rule of a group; other day types are not that rule', () => {
    expect(courtRuleOf([rule], 'g1')).toBe(rule);
    expect(courtRuleOf([{ ...rule, dayType: 'weekend' }], 'g1')).toBeUndefined();
  });
  it('creates, changes and clears (not set) through the right route; no change and junk are refused before the server', async () => {
    const a = spy();
    await saveCourtRate('h', undefined, 'g1', '300', a.f);
    expect(a.calls[0]).toMatchObject({ url: '/api/c/h/staff/setup/court-prices', init: { method: 'POST' } });
    expect(JSON.parse(a.calls[0]!.init.body as string)).toEqual({ priceGroupId: 'g1', priceSatang: 30000 });
    const b = spy();
    await saveCourtRate('h', rule, 'g1', '350', b.f);
    expect(b.calls[0]).toMatchObject({ url: '/api/c/h/staff/setup/court-prices/r1', init: { method: 'PUT' } });
    expect(JSON.parse(b.calls[0]!.init.body as string)).toEqual({ priceSatang: 35000 });
    const c = spy();
    await saveCourtRate('h', rule, 'g1', '', c.f);
    expect(c.calls[0]).toMatchObject({ init: { method: 'DELETE' } });
    const d = spy();
    expect(await saveCourtRate('h', rule, 'g1', '300', d.f)).toEqual({ ok: false, key: 'A-new.price_nothing_changed' });
    expect(await saveCourtRate('h', rule, 'g1', 'x', d.f)).toEqual({ ok: false, key: 'A-new.price_err_amount' });
    expect(await saveCourtRate('h', undefined, 'g1', '', d.f)).toEqual({ ok: false, key: 'A-new.price_nothing_changed' });
    expect(d.calls).toHaveLength(0);
  });
});

describe('coach tier prices', () => {
  it('sets or clears one price for a tier and a group', async () => {
    expect(tierPriceOf([{ tierId: 't', priceGroupId: 'g1', priceSatang: 90000 }], 't', 'g1')).toBe(90000);
    expect(tierPriceOf([], 't', 'g1')).toBeNull();
    const a = spy();
    await saveTierPrice('h', 't', 'g1', null, '900', a.f);
    expect(JSON.parse(a.calls[0]!.init.body as string)).toEqual({ tierId: 't', priceGroupId: 'g1', priceSatang: 90000 });
    const b = spy();
    await saveTierPrice('h', 't', 'g1', 90000, '', b.f);
    expect(JSON.parse(b.calls[0]!.init.body as string)).toEqual({ tierId: 't', priceGroupId: 'g1', priceSatang: null });
    expect(await saveTierPrice('h', 't', 'g1', 90000, '900', b.f)).toEqual({ ok: false, key: 'A-new.price_nothing_changed' });
  });
});

describe('packages', () => {
  const filled = { ...productDraft(), nameTh: 'ก', nameEn: 'A', credits: '5', validityMonths: '6' };
  it('a new bundle leaves an unset price out (nothing supplied); a solo pack needs a group and a tier, a group pack a group', () => {
    expect(productBody('court_hour', undefined, filled)).toEqual({ ok: true, body: { nameTh: 'ก', nameEn: 'A', creditType: 'court_hour', credits: 5, validityMonths: 6, active: true } });
    expect(productBody('court_hour', undefined, { ...filled, price: '2250' })).toMatchObject({ ok: true, body: { priceSatang: 225000 } });
    expect(productBody('group_session', undefined, filled)).toEqual({ ok: false, key: 'A-new.price_err_group' });
    expect(productBody('solo_class', undefined, { ...filled, priceGroupId: 'g1' })).toEqual({ ok: false, key: 'A-new.price_err_tier' });
    expect(productBody('solo_class', undefined, { ...filled, priceGroupId: 'g1', coachTierId: 't1' })).toMatchObject({ ok: true, body: { priceGroupId: 'g1', coachTierId: 't1', creditType: 'solo_class' } });
  });
  it('checks names, whole credits and months', () => {
    expect(productBody('court_hour', undefined, { ...filled, nameEn: ' ' })).toEqual({ ok: false, key: 'A-new.price_err_names' });
    expect(productBody('court_hour', undefined, { ...filled, credits: '0' })).toEqual({ ok: false, key: 'A-new.price_err_credits' });
    expect(productBody('court_hour', undefined, { ...filled, credits: '2.5' })).toEqual({ ok: false, key: 'A-new.price_err_credits' });
    expect(productBody('court_hour', undefined, { ...filled, validityMonths: '121' })).toEqual({ ok: false, key: 'A-new.price_err_months' });
    expect(productBody('court_hour', undefined, { ...filled, price: '1.999' })).toEqual({ ok: false, key: 'A-new.price_err_amount' });
  });
  it('a change sends only what changed and never the kind; clearing a price sends null', () => {
    const d = productDraft(bundle);
    expect(productBody('court_hour', bundle, d)).toEqual({ ok: false, key: 'A-new.price_nothing_changed' });
    expect(productBody('court_hour', bundle, { ...d, active: false })).toEqual({ ok: true, body: { active: false } });
    expect(productBody('court_hour', bundle, { ...d, price: '' })).toEqual({ ok: true, body: { priceSatang: null } });
    expect(productBody('court_hour', bundle, { ...d, credits: '12', price: '5000' })).toEqual({ ok: true, body: { credits: 12, priceSatang: 500000 } });
  });
});

describe('price groups and add-ons', () => {
  it('a group is told apart by age: one age at least, whole years, in order', () => {
    expect(groupBody(undefined, { ...groupDraft(), nameTh: 'ก', nameEn: 'A', minAge: '18' })).toEqual({ ok: true, body: { nameTh: 'ก', nameEn: 'A', rule: { min_age: 18 } } });
    expect(groupBody(undefined, { ...groupDraft(), nameTh: 'ก', nameEn: 'A' })).toEqual({ ok: false, key: 'A-new.price_err_age_one' });
    expect(groupBody(undefined, { ...groupDraft(), nameTh: 'ก', nameEn: 'A', minAge: '20', maxAge: '10' })).toEqual({ ok: false, key: 'A-new.price_err_age_order' });
    expect(groupBody(undefined, { ...groupDraft(), nameTh: 'ก', nameEn: 'A', minAge: 'x' })).toEqual({ ok: false, key: 'A-new.price_err_age' });
    expect(groupBody(group, groupDraft(group))).toEqual({ ok: false, key: 'A-new.price_nothing_changed' });
    expect(groupBody(group, { ...groupDraft(group), maxAge: '60' })).toEqual({ ok: true, body: { rule: { min_age: 18, max_age: 60 } } });
  });
  it('an add-on with no price set stays empty and sends no price; a change sends only itself', () => {
    expect(addOnDraft().price).toBe('');
    expect(addOnBody(undefined, { ...addOnDraft(), nameTh: 'ก', nameEn: 'Balls' })).toEqual({ ok: true, body: { nameTh: 'ก', nameEn: 'Balls', active: true } });
    const a: AddOn = { id: 'a1', nameTh: 'ก', nameEn: 'Balls', priceSatang: 5000, active: true, position: 0 };
    expect(addOnBody(a, { ...addOnDraft(a), price: '60' })).toEqual({ ok: true, body: { priceSatang: 6000 } });
    expect(addOnBody(a, { ...addOnDraft(a), price: '' })).toEqual({ ok: true, body: { priceSatang: null } });
  });
});

describe('refusals and text', () => {
  it('each refusal has its own words, the rest the general one', () => {
    expect(priceErrorKey({ kind: 'refused', status: 409, code: 'in_use' })).toBe('A-new.price_err_in_use');
    expect(priceErrorKey({ kind: 'refused', status: 400, code: 'bad_input' })).toBe('A-new.price_err_input');
    expect(priceErrorKey({ kind: 'refused', status: 400, code: 'peak_not_defined' })).toBe('A-new.price_err_general');
    expect(priceErrorKey({ kind: 'forbidden' })).toBe('A-new.price_err_forbidden');
    expect(resultKey({ kind: 'ok', body: {} })).toBeNull();
    expect(resultKey({ ok: false, key: 'k' })).toBe('k');
  });
  it('every key the pages use exists in both languages', () => {
    const keys = ['A-0159', 'A-0160', 'A-0182', 'A-0225', 'A-0226', 'A-0227', 'A-0228', 'A-0229', 'A-0230', 'A-0231', 'A-0234', 'A-0235', 'A-0237', 'A-0238', 'A-0239', 'A-0240', 'A-0241', 'A-0321', 'A-0546', 'A-0547',
      'A-new.set_saved', 'A-new.set_retry', 'A-new.price_tabs_label', 'A-new.price_load_failed', 'A-new.price_nothing_changed', 'A-new.price_not_set', 'A-new.price_none', 'A-new.price_need_group', 'A-new.price_name_th',
      'A-new.price_name_en', 'A-new.price_months_unit', 'A-new.price_baht_unit', 'A-new.price_pick', 'A-new.price_group_label', 'A-new.price_solo_packs', 'A-new.price_group_packs', 'A-new.price_add_pack',
      'A-new.price_credits_classes', 'A-new.price_credits_sessions', 'A-new.price_add_tier', 'A-new.price_tier_prices', 'A-new.price_tier_prices_hint', 'A-new.price_groups_title', 'A-new.price_groups_hint',
      'A-new.price_age_from', 'A-new.price_age_to', 'A-new.price_add_group', 'A-new.price_addons_title', 'A-new.price_addons_hint', 'A-new.price_add_addon', 'A-new.price_delete', 'A-new.price_confirm_delete',
      'A-new.price_err_amount', 'A-new.price_err_names', 'A-new.price_err_credits', 'A-new.price_err_months', 'A-new.price_err_group', 'A-new.price_err_tier', 'A-new.price_err_age', 'A-new.price_err_age_one',
      'A-new.price_err_age_order', 'A-new.price_err_in_use', 'A-new.price_err_input', 'A-new.price_err_not_found', 'A-new.price_err_forbidden', 'A-new.price_err_general'];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
