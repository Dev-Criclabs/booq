import { describe, expect, it } from 'vitest';
import { splitByPrice } from './discounts';
import { priceOrder, type CodeInput, type PricingInput } from './pricing';

// F04-T09 (PROMO-01-AC2 to AC6, AC8, AC11, AC13, R5, D65, D67, D68; design 4.4; A-2, A-3, A-6).
// Hunter's values and every code value here are test data, never defaults in code.
const ADULT = { id: 'g-adult', minAge: 18, maxAge: null };
const STUDENT = { id: 'g-student', minAge: null, maxAge: 17 };
const COACH = { coachId: 'coach-1', tierId: 'tier-coach', source: 'checkout' as const };
const HOUR = '2026-11-02T10:00:00+07:00';
const HOUR2 = '2026-11-02T11:00:00+07:00';

function code(over: Partial<CodeInput> = {}): CodeInput {
  return {
    source: 'promo',
    id: 'code-1',
    kind: 'percent',
    value: 1000,
    appliesTo: ['court_hour', 'coach', 'solo_class'],
    includesAddOns: false,
    audience: 'any',
    startsOn: null,
    endsOn: null,
    firstTimeOnly: false,
    totalCap: null,
    perCustomerCap: null,
    minSpendSatang: null,
    stackableWithBirthday: false,
    partnerId: null,
    active: true,
    usesCounted: 0,
    customerUsesCounted: 0,
    customerHasPaidBooking: false,
    ...over,
  };
}

function input(over: Partial<PricingInput> = {}): PricingInput {
  return {
    onDate: '2026-11-02',
    dob: '1990-05-01',
    priceGroups: [ADULT, STUDENT],
    courtPriceRules: [
      { priceGroupId: ADULT.id, dayType: 'any', peak: 'any', priceSatang: 50000 },
      { priceGroupId: STUDENT.id, dayType: 'any', peak: 'any', priceSatang: 50000 },
    ],
    coachTierPrices: [
      { tierId: 'tier-coach', priceGroupId: ADULT.id, priceSatang: 80000 },
      { tierId: 'tier-coach', priceGroupId: STUDENT.id, priceSatang: 70000 },
    ],
    addOns: [{ id: 'water', priceSatang: 2000, active: true }],
    selection: { courtId: 'c', hours: [HOUR], coach: null, addOnIds: [] },
    credits: [],
    walletBalanceSatang: 0,
    ...over,
  };
}

function quote(i: PricingInput) {
  const r = priceOrder(i);
  if (!r.ok) throw new Error(`expected a quote, got ${r.code}`);
  return r.quote;
}

describe('percent code (PROMO-01-AC3, D23)', () => {
  it('discounts the in-scope lines, rounded half up per line', () => {
    const q = quote(input({ code: code({ value: 1234 }) })); // 12.34% of 50000 = 6170
    expect(q.lines[0]).toMatchObject({ unitPriceSatang: 50000, codeDiscountSatang: 6170, discountSatang: 6170, netSatang: 43830 });
    expect(q.promoCodeId).toBe('code-1');
    expect(q.discountSatang).toBe(6170);
  });
  it('add-ons are excluded unless the code includes them (R3-AC5)', () => {
    const sel = { courtId: 'c', hours: [HOUR], coach: null, addOnIds: ['water'] };
    expect(quote(input({ selection: sel, code: code() })).lines[1]?.discountSatang).toBe(0);
    expect(quote(input({ selection: sel, code: code({ includesAddOns: true }) })).lines[1]?.discountSatang).toBe(200);
  });
  it('a court-only code on a solo class discounts the court line only', () => {
    const q = quote(input({ selection: { courtId: 'c', hours: [HOUR], coach: COACH, addOnIds: [] }, code: code({ appliesTo: ['court_hour'] }) }));
    expect(q.lines.map((l) => l.discountSatang)).toEqual([5000, 0]);
  });
  it('a solo class code covers both lines of a solo class, and not a court only order', () => {
    const solo = quote(input({ selection: { courtId: 'c', hours: [HOUR], coach: COACH, addOnIds: [] }, code: code({ appliesTo: ['solo_class'] }) }));
    expect(solo.lines.map((l) => l.discountSatang)).toEqual([5000, 8000]);
    expect(priceOrder(input({ code: code({ appliesTo: ['solo_class'] }) }))).toEqual({ ok: false, code: 'code_out_of_scope' });
  });
  it('a 100 percent code makes the money due zero (PROMO-01-AC13)', () => {
    const q = quote(input({ code: code({ value: 10000 }) }));
    expect(q.totalSatang).toBe(0);
    expect(q.moneySatang).toBe(0);
  });
});

describe('fixed code (PROMO-01-AC4, D67, A-6)', () => {
  it('is capped at the price of the in-scope items, never a negative price', () => {
    const q = quote(input({ code: code({ kind: 'fixed', value: 999999 }) }));
    expect(q.lines[0]).toMatchObject({ discountSatang: 50000, netSatang: 0 });
    expect(q.moneySatang).toBe(0);
  });
  it('is split across the hours by each hour price, the shares summing exactly', () => {
    const q = quote(input({ selection: { courtId: 'c', hours: [HOUR, HOUR2], coach: COACH, addOnIds: [] }, code: code({ kind: 'fixed', value: 10001 }) }));
    // prices 50000, 80000, 50000, 80000 of 260000
    expect(q.lines.map((l) => l.codeDiscountSatang)).toEqual([1924, 3077, 1923, 3077]);
    expect(q.discountSatang).toBe(10001);
  });
  it('largest remainder: whole satang, exact sum, ties to the earlier line', () => {
    expect(splitByPrice(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(splitByPrice(1, [3, 3])).toEqual([1, 0]);
    expect(splitByPrice(0, [5, 5])).toEqual([0, 0]);
    expect(splitByPrice(7, [0, 7])).toEqual([0, 7]);
    expect(splitByPrice(5, [])).toEqual([]);
  });
  it('property: shares sum to the amount and never pass a line price', () => {
    let s = 42;
    const r = (n: number) => ((s = (s * 1664525 + 1013904223) >>> 0) % n);
    for (let i = 0; i < 3000; i++) {
      const prices = Array.from({ length: 1 + r(6) }, () => r(100000));
      const total = prices.reduce((a, b) => a + b, 0);
      const amount = r(total + 1);
      const shares = splitByPrice(amount, prices);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
      shares.forEach((v, k) => expect(v >= 0 && v <= prices[k]!).toBe(true));
    }
  });
});

describe('code refusals, each with its typed reason (PROMO-01-AC5, AC6, AC8, AC9)', () => {
  it('an unknown code, another club code or an inactive code: code_not_valid', () => {
    expect(priceOrder(input({ code: 'not_found' }))).toEqual({ ok: false, code: 'code_not_valid' });
    expect(priceOrder(input({ code: code({ active: false }) }))).toEqual({ ok: false, code: 'code_not_valid' });
  });
  it('outside its dates: code_expired', () => {
    expect(priceOrder(input({ code: code({ endsOn: '2026-11-01' }) }))).toEqual({ ok: false, code: 'code_expired' });
    expect(priceOrder(input({ code: code({ startsOn: '2026-11-03' }) }))).toEqual({ ok: false, code: 'code_expired' });
    expect(quote(input({ code: code({ startsOn: '2026-11-02', endsOn: '2026-11-02' }) })).promoCodeId).toBe('code-1');
  });
  it('wrong audience: code_wrong_audience', () => {
    expect(priceOrder(input({ code: code({ audience: 'student' }) }))).toEqual({ ok: false, code: 'code_wrong_audience' });
    expect(quote(input({ dob: '2012-01-01', code: code({ audience: 'student' }) })).promoCodeId).toBe('code-1');
    expect(priceOrder(input({ dob: null, code: code({ audience: 'student' }) }))).toEqual({ ok: false, code: 'code_wrong_audience' });
  });
  it('nothing in scope: code_out_of_scope', () => {
    expect(priceOrder(input({ code: code({ appliesTo: ['package'] }) }))).toEqual({ ok: false, code: 'code_out_of_scope' });
  });
  it('minimum spend is checked on the total before discounts, credits and wallet (D68, A-3)', () => {
    const credit = { packageId: 'p', lineKind: 'court_hour' as const, priceGroupId: null, coachTierId: null, units: 1 };
    expect(quote(input({ credits: [credit], walletBalanceSatang: 999999, code: code({ minSpendSatang: 50000 }) })).promoCodeId).toBe('code-1');
    expect(priceOrder(input({ code: code({ minSpendSatang: 50001 }) }))).toEqual({ ok: false, code: 'code_below_minimum', minSpendSatang: 50001 });
  });
  it('first time only and a player with a paid booking: code_first_booking_only (AC6)', () => {
    expect(priceOrder(input({ code: code({ firstTimeOnly: true, customerHasPaidBooking: true }) }))).toEqual({ ok: false, code: 'code_first_booking_only' });
    expect(quote(input({ code: code({ firstTimeOnly: true }) })).promoCodeId).toBe('code-1');
  });
  it('total cap or per customer cap reached: code_used_up (the final count is at Pay under the lock)', () => {
    expect(priceOrder(input({ code: code({ totalCap: 5, usesCounted: 5 }) }))).toEqual({ ok: false, code: 'code_used_up' });
    expect(priceOrder(input({ code: code({ perCustomerCap: 1, customerUsesCounted: 1 }) }))).toEqual({ ok: false, code: 'code_used_up' });
    expect(quote(input({ code: code({ totalCap: 5, usesCounted: 4 }) })).promoCodeId).toBe('code-1');
  });
  it('a partner code on a solo class: code_not_for_solo_class (AC8, Gaps A4)', () => {
    const sel = { courtId: 'c', hours: [HOUR], coach: COACH, addOnIds: [] };
    expect(priceOrder(input({ selection: sel, code: code({ partnerId: 'partner-1' }) }))).toEqual({ ok: false, code: 'code_not_for_solo_class' });
    expect(quote(input({ code: code({ partnerId: 'partner-1' }) })).promoCodeId).toBe('code-1');
  });
  it('a referral code is the one code of the order (AC11)', () => {
    const q = quote(input({ code: code({ source: 'referral', id: 'ref-1', kind: 'fixed', value: 10000 }) }));
    expect(q.promoCodeId).toBeNull();
    expect(q.referralCodeId).toBe('ref-1');
    expect(q.discountSatang).toBe(10000);
  });
});

describe('birthday discount (R5)', () => {
  const solo = { courtId: 'c', hours: [HOUR], coach: COACH, addOnIds: [] };
  const bday = (over: Partial<NonNullable<PricingInput['birthday']>> = {}) => ({ setting: { kind: 'percent' as const, value: 2000 }, usedKinds: [], ...over });
  it('applies automatically to a solo class in the birth month and shows as its own amount (R5-AC1)', () => {
    const q = quote(input({ dob: '1990-11-20', selection: solo, birthday: bday() }));
    expect(q.lines.map((l) => l.birthdayDiscountSatang)).toEqual([10000, 16000]);
    expect(q.birthdayEntitlement).toBe('solo_class');
    expect(q.totalSatang).toBe(104000);
  });
  it('applies to one solo class only: the first hour of a two hour solo order', () => {
    const q = quote(input({ dob: '1990-11-20', selection: { ...solo, hours: [HOUR, HOUR2] }, birthday: bday() }));
    expect(q.lines.map((l) => l.birthdayDiscountSatang)).toEqual([10000, 16000, 0, 0]);
  });
  it('does not apply to a court only order, an empty setting, outside the month, without a date of birth, or when used (R5-AC2 to AC4)', () => {
    expect(quote(input({ dob: '1990-11-20', birthday: bday() })).birthdayEntitlement).toBeNull();
    expect(quote(input({ dob: '1990-11-20', selection: solo, birthday: bday({ setting: null }) })).birthdayEntitlement).toBeNull();
    expect(quote(input({ dob: '1990-10-20', selection: solo, birthday: bday() })).birthdayEntitlement).toBeNull();
    expect(quote(input({ dob: null, selection: solo, birthday: bday() })).birthdayEntitlement).toBeNull();
    expect(quote(input({ dob: '1990-11-20', selection: solo, birthday: bday({ usedKinds: ['solo_class'] }) })).birthdayEntitlement).toBeNull();
  });
  it('a fixed birthday value is capped at the solo class price and split by price', () => {
    const q = quote(input({ dob: '1990-11-20', selection: solo, birthday: bday({ setting: { kind: 'fixed', value: 13000 } }) }));
    expect(q.lines.map((l) => l.birthdayDiscountSatang)).toEqual([5000, 8000]);
  });
});

describe('stacking (PROMO-01-AC2, D65, R5-AC6, A-2)', () => {
  const solo = { courtId: 'c', hours: [HOUR], coach: COACH, addOnIds: [] };
  const birthday = { setting: { kind: 'percent' as const, value: 2000 }, usedKinds: [] };
  const base = { dob: '1990-11-20', selection: solo, birthday };
  it('a stackable code applies on the amounts after the birthday discount, both used', () => {
    const q = quote(input({ ...base, code: code({ stackableWithBirthday: true, value: 1000 }) }));
    expect(q.lines.map((l) => [l.birthdayDiscountSatang, l.codeDiscountSatang])).toEqual([[10000, 4000], [16000, 6400]]);
    expect(q.promoCodeId).toBe('code-1');
    expect(q.birthdayEntitlement).toBe('solo_class');
  });
  it('not stackable: the larger discount wins and the other is not used', () => {
    const small = quote(input({ ...base, code: code({ value: 1000 }) }));
    expect(small.birthdayEntitlement).toBe('solo_class');
    expect(small.promoCodeId).toBeNull();
    expect(small.discountSatang).toBe(26000);
    const big = quote(input({ ...base, code: code({ value: 3000 }) }));
    expect(big.birthdayEntitlement).toBeNull();
    expect(big.promoCodeId).toBe('code-1');
    expect(big.discountSatang).toBe(39000);
  });
  it('a tie goes to the code (A-2)', () => {
    const q = quote(input({ ...base, code: code({ value: 2000 }) }));
    expect(q.promoCodeId).toBe('code-1');
    expect(q.birthdayEntitlement).toBeNull();
  });
  it('a refused code is refused even when the birthday discount would apply', () => {
    expect(priceOrder(input({ ...base, code: code({ endsOn: '2026-01-01' }) }))).toEqual({ ok: false, code: 'code_expired' });
  });
});

describe('allocation after discounts', () => {
  it('credit covers the net after the discount; the wallet and money follow', () => {
    const credit = { packageId: 'p', lineKind: 'court_hour' as const, priceGroupId: null, coachTierId: null, units: 1 };
    const q = quote(input({ credits: [credit], selection: { courtId: 'c', hours: [HOUR, HOUR2], coach: null, addOnIds: [] }, walletBalanceSatang: 1000, code: code() }));
    expect(q.lines.map((l) => [l.netSatang, l.creditValueSatang, l.walletSatang, l.moneySatang])).toEqual([[45000, 45000, 0, 0], [45000, 0, 1000, 44000]]);
    expect(q.totalSatang).toBe(q.creditValueSatang + q.walletSatang + q.moneySatang);
  });
});

describe('property: with codes and the birthday discount the lines still sum exactly (R4-AC4, D67)', () => {
  it('holds over 2000 random orders', () => {
    let s = 7;
    const r = (n: number) => ((s = (s * 1664525 + 1013904223) >>> 0) % n);
    for (let i = 0; i < 2000; i++) {
      const i2 = input({
        dob: r(2) ? '1990-11-20' : null,
        courtPriceRules: [{ priceGroupId: ADULT.id, dayType: 'any', peak: 'any', priceSatang: r(200000) }],
        coachTierPrices: [{ tierId: 'tier-coach', priceGroupId: ADULT.id, priceSatang: r(150000) }],
        addOns: [{ id: 'water', priceSatang: r(5000), active: true }],
        selection: { courtId: 'c', hours: [HOUR, HOUR2].slice(0, 1 + r(2)), coach: r(2) ? COACH : null, addOnIds: r(2) ? ['water'] : [] },
        code: code({ kind: r(2) ? 'percent' : 'fixed', value: 1 + r(10000), includesAddOns: r(2) === 1, stackableWithBirthday: r(2) === 1, appliesTo: ['court_hour', 'coach', 'add_on'] }),
        birthday: { setting: r(2) ? { kind: 'percent', value: r(10001) } : { kind: 'fixed', value: 1 + r(300000) }, usedKinds: [] },
        credits: [{ packageId: 'p', lineKind: 'court_hour', priceGroupId: null, coachTierId: null, units: r(2) }],
        walletBalanceSatang: r(300000),
      });
      const res = priceOrder(i2);
      if (!res.ok) {
        expect(res.code).toBe('code_out_of_scope'); // a zero price draw leaves nothing in scope
        continue;
      }
      const q = res.quote;
      for (const l of q.lines) {
        expect(l.discountSatang).toBe(l.birthdayDiscountSatang + l.codeDiscountSatang);
        expect(l.discountSatang <= l.unitPriceSatang && l.netSatang >= 0).toBe(true);
        expect(l.netSatang).toBe(l.creditValueSatang + l.walletSatang + l.moneySatang);
      }
      expect(q.totalSatang).toBe(q.subtotalSatang - q.discountSatang);
      expect(q.totalSatang).toBe(q.creditValueSatang + q.walletSatang + q.moneySatang);
    }
  });
});
