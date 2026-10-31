import { describe, expect, it } from 'vitest';
import { priceSeat, type SeatPricingInput } from './seat';
import type { CodeInput } from './discounts';

// F04-T22b: a group class seat (CLASS-01-AC14; F04 R4; D22, D157). Credit, then wallet, then money; a null drop in
// price needs a credit. The prices are test data, never defaults in code.
const input = (over: Partial<SeatPricingInput> = {}): SeatPricingInput => ({
  onDate: '2026-12-02', dob: '1990-05-01', dropInSatang: 40000, credits: [], walletBalanceSatang: 0, ...over,
});
const ok = (i: SeatPricingInput) => {
  const r = priceSeat(i);
  if (!r.ok) throw new Error(r.code);
  return r.quote;
};
const code = (over: Partial<CodeInput> = {}): CodeInput => ({
  source: 'promo', id: 'c1', kind: 'percent', value: 2500, appliesTo: ['group_class'], includesAddOns: false, audience: 'any', startsOn: null, endsOn: null,
  firstTimeOnly: false, totalCap: null, perCustomerCap: null, minSpendSatang: null, stackableWithBirthday: false, partnerId: null, active: true,
  usesCounted: 0, customerUsesCounted: 0, customerHasPaidBooking: false, ...over,
});

describe('priceSeat', () => {
  it('money at the drop in price when there is no credit or wallet', () => {
    expect(ok(input())).toMatchObject({ subtotalSatang: 40000, totalSatang: 40000, moneySatang: 40000, lines: [{ kind: 'class_seat', creditUnits: 0 }] });
  });
  it('a group credit pays first and covers the whole net (D22)', () => {
    const q = ok(input({ credits: [{ packageId: 'p1' }, { packageId: 'p2' }], walletBalanceSatang: 99999 }));
    expect(q.lines[0]).toMatchObject({ creditPackageId: 'p1', creditUnits: 1, creditValueSatang: 40000, walletSatang: 0, moneySatang: 0 });
  });
  it('then the wallet, then money', () => {
    expect(ok(input({ walletBalanceSatang: 15000 }))).toMatchObject({ walletSatang: 15000, moneySatang: 25000 });
  });
  it('a null drop in price: a credit pays it at no value; without one it is not for sale (D157)', () => {
    expect(ok(input({ dropInSatang: null, credits: [{ packageId: 'p1' }] }))).toMatchObject({ totalSatang: 0, creditValueSatang: 0, moneySatang: 0, lines: [{ creditUnits: 1 }] });
    expect(priceSeat(input({ dropInSatang: null, walletBalanceSatang: 50000 }))).toEqual({ ok: false, code: 'price_not_set' });
  });
  it('a group_class code discounts the seat; a court code is out of scope (PROMO-01)', () => {
    expect(ok(input({ code: code() }))).toMatchObject({ discountSatang: 10000, totalSatang: 30000, promoCodeId: 'c1' });
    expect(priceSeat(input({ code: code({ appliesTo: ['court_hour'] }) }))).toEqual({ ok: false, code: 'code_out_of_scope' });
  });
});
