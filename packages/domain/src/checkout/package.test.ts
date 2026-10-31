import { describe, expect, it } from 'vitest';
import { pricePackage, type PackagePricingInput } from './package';
import type { CodeInput } from './discounts';

// The price of a package bought alone (PKG-02-AC6, AC7, AC8, R1-AC6, AC7, PROMO-01-AC3, R5, D22, D62; F06 R3).
// Hunter's prices are test data, never defaults in code.
const ADULT = { id: 'g-adult', minAge: 18, maxAge: null };
const STUDENT = { id: 'g-student', minAge: null, maxAge: 17 };
const BUNDLE = { id: 'p-bundle', priceSatang: 450000, active: true, priceGroupId: null };
const STUDENT_PACK = { id: 'p-student', priceSatang: 480000, active: true, priceGroupId: STUDENT.id };
const ADULT_PACK = { id: 'p-adult', priceSatang: 560000, active: true, priceGroupId: ADULT.id };

const input = (over: Partial<PackagePricingInput> = {}): PackagePricingInput => ({
  onDate: '2026-11-02',
  dob: '1990-05-01',
  priceGroups: [ADULT, STUDENT],
  product: BUNDLE,
  walletBalanceSatang: 0,
  ...over,
});
const ok = (i: PackagePricingInput) => {
  const r = pricePackage(i);
  if (!r.ok) throw new Error(`expected a quote, got ${r.code}`);
  return r.quote;
};
const code = (over: Partial<CodeInput> = {}): CodeInput => ({
  source: 'promo', id: 'c1', kind: 'percent', value: 1000, appliesTo: ['package'], includesAddOns: false, audience: 'any', startsOn: null, endsOn: null,
  firstTimeOnly: false, totalCap: null, perCustomerCap: null, minSpendSatang: null, stackableWithBirthday: false, partnerId: null, active: true,
  usesCounted: 0, customerUsesCounted: 0, customerHasPaidBooking: false, ...over,
});

describe('pricePackage', () => {
  it('one package line at the product price, paid by money (PKG-02-AC1)', () => {
    const q = ok(input());
    expect(q.lines).toEqual([expect.objectContaining({ position: 1, kind: 'package', packageProductId: 'p-bundle', unitPriceSatang: 450000, netSatang: 450000, moneySatang: 450000 })]);
    expect(q).toMatchObject({ subtotalSatang: 450000, totalSatang: 450000, moneySatang: 450000, priceGroupId: ADULT.id });
    expect(q.quoteHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a product with no price, or inactive, is not for sale (PKG-02-AC7, AC8)', () => {
    expect(pricePackage(input({ product: { ...BUNDLE, priceSatang: null } }))).toEqual({ ok: false, code: 'package_not_for_sale' });
    expect(pricePackage(input({ product: { ...BUNDLE, active: false } }))).toEqual({ ok: false, code: 'package_not_for_sale' });
  });
  it('a Student package is refused to a player 18 or older and to one with no date of birth (R1-AC6, PKG-02-AC6)', () => {
    expect(pricePackage(input({ product: STUDENT_PACK }))).toEqual({ ok: false, code: 'student_item_not_allowed' });
    expect(pricePackage(input({ dob: null, product: STUDENT_PACK }))).toEqual({ ok: false, code: 'student_item_not_allowed' });
    expect(ok(input({ dob: '2012-01-01', product: STUDENT_PACK })).totalSatang).toBe(480000);
  });
  it('a player under 18 may buy an Adult package (R1-AC7, D62)', () => {
    expect(ok(input({ dob: '2012-01-01', product: ADULT_PACK })).totalSatang).toBe(560000);
  });
  it('the wallet pays before money, and only what is due (R4-AC1, AC3, D22)', () => {
    expect(ok(input({ walletBalanceSatang: 100000 }))).toMatchObject({ walletSatang: 100000, moneySatang: 350000 });
    expect(ok(input({ walletBalanceSatang: 999999 }))).toMatchObject({ walletSatang: 450000, moneySatang: 0 });
  });
  it('a code for packages discounts it; a court-only code is out of scope (PROMO-01-AC3, AC5)', () => {
    expect(ok(input({ code: code() }))).toMatchObject({ discountSatang: 45000, totalSatang: 405000, promoCodeId: 'c1' });
    expect(pricePackage(input({ code: code({ appliesTo: ['court_hour'] }) }))).toEqual({ ok: false, code: 'code_out_of_scope' });
  });
  it('the birthday discount applies to one package a year in the birth month (R5)', () => {
    const birthday = { setting: { kind: 'fixed' as const, value: 50000 }, usedKinds: [] };
    expect(ok(input({ dob: '1990-11-20', birthday }))).toMatchObject({ birthdayEntitlement: 'package', totalSatang: 400000 });
    expect(ok(input({ dob: '1990-11-20', birthday: { ...birthday, usedKinds: ['package'] } }))).toMatchObject({ birthdayEntitlement: null, totalSatang: 450000 });
    expect(ok(input({ dob: '1990-10-20', birthday }))).toMatchObject({ birthdayEntitlement: null });
  });
  it('a 100 percent code makes the money due zero', () => {
    expect(ok(input({ code: code({ value: 10000 }) }))).toMatchObject({ totalSatang: 0, moneySatang: 0 });
  });
  it('the hash changes with the price and the product', () => {
    const a = ok(input()).quoteHash;
    expect(ok(input({ product: { ...BUNDLE, priceSatang: 450100 } })).quoteHash).not.toBe(a);
    expect(ok(input()).quoteHash).toBe(a);
  });
});
