import { describe, expect, it } from 'vitest';
import { percentHalfUp, priceOrder, type PricingInput } from './pricing';

// F04-T08 (R1-AC1 to AC7, R2-AC1 to AC8, R4-AC1 to AC4, AC6; D22, D23, D62; design 4.1 to 4.3).
// Hunter's values are test data here, never defaults in code.
const ADULT = { id: 'g-adult', minAge: 18, maxAge: null };
const STUDENT = { id: 'g-student', minAge: null, maxAge: 17 };
const COACH_TIER = 'tier-coach';
const HEAD_COACH = 'tier-head';

function hunter(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    onDate: '2026-10-30',
    dob: '1990-05-01',
    priceGroups: [ADULT, STUDENT],
    courtPriceRules: [
      { priceGroupId: ADULT.id, dayType: 'any', peak: 'any', priceSatang: 50000 },
      { priceGroupId: STUDENT.id, dayType: 'any', peak: 'any', priceSatang: 50000 },
    ],
    coachTierPrices: [
      { tierId: COACH_TIER, priceGroupId: ADULT.id, priceSatang: 80000 },
      { tierId: COACH_TIER, priceGroupId: STUDENT.id, priceSatang: 70000 },
      { tierId: HEAD_COACH, priceGroupId: ADULT.id, priceSatang: null },
      { tierId: HEAD_COACH, priceGroupId: STUDENT.id, priceSatang: null },
    ],
    addOns: [
      { id: 'balls', priceSatang: null, active: true },
      { id: 'water', priceSatang: 2000, active: true },
      { id: 'towel', priceSatang: 3000, active: false },
    ],
    selection: { courtId: 'court-1', hours: ['2026-11-02T10:00:00+07:00'], coach: null, addOnIds: [] },
    credits: [],
    walletBalanceSatang: 0,
    ...overrides,
  };
}

function ok(input: PricingInput) {
  const r = priceOrder(input);
  if (!r.ok) throw new Error(`expected a quote, got ${r.code}`);
  return r.quote;
}

describe('price group (R1, D12, D62)', () => {
  it('under 18 on the Bangkok date gets the Student group; the 18th birthday gives Adult (R1-AC1)', () => {
    expect(ok(hunter({ dob: '2008-10-31' })).priceGroupId).toBe(STUDENT.id);
    expect(ok(hunter({ dob: '2008-10-30' })).priceGroupId).toBe(ADULT.id);
  });
  it('no date of birth gets the open-ended adult group (R1-AC2, D12)', () => {
    expect(ok(hunter({ dob: null })).priceGroupId).toBe(ADULT.id);
  });
  it('a corrected date of birth is used by the next quote (R1-AC3)', () => {
    expect(ok(hunter({ dob: '1990-01-01' })).priceGroupId).toBe(ADULT.id);
    expect(ok(hunter({ dob: '2012-01-01' })).priceGroupId).toBe(STUDENT.id);
  });
  it('no group covering the age refuses with price_not_set', () => {
    const r = priceOrder(hunter({ priceGroups: [ADULT], dob: '2012-01-01' }));
    expect(r).toMatchObject({ ok: false, code: 'price_not_set' });
  });
  it('an under 18 player pays the price of their own group; Adult items are not closed to them (R1-AC7)', () => {
    const q = ok(hunter({ dob: '2012-01-01', courtPriceRules: [{ priceGroupId: STUDENT.id, dayType: 'any', peak: 'any', priceSatang: 40000 }] }));
    expect(q.totalSatang).toBe(40000);
  });
});

describe('court hours (R1-AC4, AC5, R2-AC7, BOOK-06)', () => {
  it("Hunter's single rule prices every hour at 50000 for both groups", () => {
    expect(ok(hunter()).totalSatang).toBe(50000);
    expect(ok(hunter({ dob: '2012-01-01' })).totalSatang).toBe(50000);
  });
  it('a two hour selection gives two court lines, one per hour, and the total is the sum', () => {
    const q = ok(hunter({ selection: { courtId: 'court-1', hours: ['2026-11-02T11:00:00+07:00', '2026-11-02T10:00:00+07:00'], coach: null, addOnIds: [] } }));
    expect(q.lines.map((l) => [l.kind, l.hourIndex, l.startsAt])).toEqual([
      ['court_hour', 0, '2026-11-02T03:00:00.000Z'],
      ['court_hour', 1, '2026-11-02T04:00:00.000Z'],
    ]);
    expect(q.subtotalSatang).toBe(100000);
    expect(q.totalSatang).toBe(100000);
  });
  it('no matching rule refuses the hour (R1-AC5); no price is invented', () => {
    const r = priceOrder(hunter({ courtPriceRules: [{ priceGroupId: STUDENT.id, dayType: 'any', peak: 'any', priceSatang: 50000 }] }));
    expect(r).toEqual({ ok: false, code: 'price_not_set', hourIndex: 0 });
  });
  it('weekday and weekend rules use the Bangkok date, and a specific rule beats any', () => {
    const rules = [
      { priceGroupId: ADULT.id, dayType: 'any' as const, peak: 'any' as const, priceSatang: 50000 },
      { priceGroupId: ADULT.id, dayType: 'weekend' as const, peak: 'any' as const, priceSatang: 60000 },
    ];
    // 00:00 on Saturday 7 Nov 2026 in Bangkok is still Friday 6 Nov in UTC.
    const sat = ok(hunter({ courtPriceRules: rules, selection: { courtId: 'c', hours: ['2026-11-06T17:00:00Z'], coach: null, addOnIds: [] } }));
    expect(sat.totalSatang).toBe(60000);
    const fri = ok(hunter({ courtPriceRules: rules, selection: { courtId: 'c', hours: ['2026-11-06T16:00:00Z'], coach: null, addOnIds: [] } }));
    expect(fri.totalSatang).toBe(50000);
  });
  it('a rule set that uses peak or off peak is refused (assumption A-4)', () => {
    const r = priceOrder(hunter({ courtPriceRules: [{ priceGroupId: ADULT.id, dayType: 'any', peak: 'peak', priceSatang: 70000 }, { priceGroupId: ADULT.id, dayType: 'any', peak: 'any', priceSatang: 50000 }] }));
    expect(r).toEqual({ ok: false, code: 'price_not_set', hourIndex: 0 });
  });
  it('an empty selection is refused', () => {
    expect(priceOrder(hunter({ selection: { courtId: 'c', hours: [], coach: null, addOnIds: [] } }))).toMatchObject({ ok: false, code: 'selection_invalid' });
  });
  it('the same hour twice is refused', () => {
    const h = '2026-11-02T10:00:00+07:00';
    expect(priceOrder(hunter({ selection: { courtId: 'c', hours: [h, h], coach: null, addOnIds: [] } }))).toMatchObject({ ok: false, code: 'selection_invalid' });
  });
});

describe('solo class (R2, COACH-02 to COACH-04)', () => {
  const coach = { coachId: 'coach-1', tierId: COACH_TIER, source: 'checkout' as const };
  it('Adult with a Coach tier coach: court 50000 + coach 80000 = 130000 (R2-AC1)', () => {
    const q = ok(hunter({ selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach, addOnIds: [] } }));
    expect(q.lines.map((l) => [l.kind, l.unitPriceSatang])).toEqual([['court_hour', 50000], ['coach', 80000]]);
    expect(q.totalSatang).toBe(130000);
  });
  it('Student with a Coach tier coach: coach 70000 + court 50000 = 120000 (R2-AC2)', () => {
    const q = ok(hunter({ dob: '2012-01-01', selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach, addOnIds: [] } }));
    expect(q.totalSatang).toBe(120000);
  });
  it('a tier with no price set cannot be picked (R2-AC3)', () => {
    const r = priceOrder(hunter({ selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach: { ...coach, tierId: HEAD_COACH }, addOnIds: [] } }));
    expect(r).toEqual({ ok: false, code: 'coach_price_not_set' });
    const missing = priceOrder(hunter({ selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach: { ...coach, tierId: 'tier-unknown' }, addOnIds: [] } }));
    expect(missing).toEqual({ ok: false, code: 'coach_price_not_set' });
  });
  it("the coach's own price, when F07 gives one, wins over the tier price", () => {
    const q = ok(hunter({ selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach: { ...coach, priceSatang: 90000 }, addOnIds: [] } }));
    expect(q.lines[1]?.unitPriceSatang).toBe(90000);
  });
  it('two solo hours give a coach line per hour, each linked to its hour (R2-AC7, R2-AC8)', () => {
    const q = ok(hunter({ selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00', '2026-11-02T11:00:00+07:00'], coach, addOnIds: [] } }));
    expect(q.lines.map((l) => [l.position, l.kind, l.hourIndex])).toEqual([[1, 'court_hour', 0], [2, 'coach', 0], [3, 'court_hour', 1], [4, 'coach', 1]]);
    expect(q.totalSatang).toBe(260000);
  });
  const soloCredit = { packageId: 'pk-solo', lineKind: 'coach' as const, priceGroupId: ADULT.id, coachTierId: COACH_TIER, units: 3 };
  it('a coach picked at court checkout charges the full coaching price even with solo credits (R2-AC4, COACH-03)', () => {
    const q = ok(hunter({ credits: [soloCredit], selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach, addOnIds: [] } }));
    expect(q.creditValueSatang).toBe(0);
    expect(q.moneySatang).toBe(130000);
  });
  it('through Classes a solo credit covers the coach line and the court line is still due (R2-AC5, R4-AC2, COACH-04)', () => {
    const q = ok(hunter({ credits: [soloCredit], selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach: { ...coach, source: 'classes' }, addOnIds: [] } }));
    const [court, coachLine] = q.lines;
    expect(coachLine).toMatchObject({ creditPackageId: 'pk-solo', creditUnits: 1, creditValueSatang: 80000, moneySatang: 0 });
    expect(court).toMatchObject({ creditValueSatang: 0, moneySatang: 50000 });
    expect(q.moneySatang).toBe(50000);
  });
  it('a solo credit of another tier is not applied', () => {
    const q = ok(hunter({ credits: [{ ...soloCredit, coachTierId: HEAD_COACH }], selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach: { ...coach, source: 'classes' }, addOnIds: [] } }));
    expect(q.creditValueSatang).toBe(0);
  });
});

describe('add-ons (R3-AC1, AC2, AC4; D111)', () => {
  it('an add-on with a price and active is a line at that price, linked to the first hour', () => {
    const q = ok(hunter({ selection: { courtId: 'c', hours: ['2026-11-02T11:00:00+07:00', '2026-11-02T10:00:00+07:00'], coach: null, addOnIds: ['water'] } }));
    const addOn = q.lines.at(-1);
    expect(addOn).toMatchObject({ kind: 'add_on', addOnId: 'water', unitPriceSatang: 2000, hourIndex: 0, startsAt: '2026-11-02T03:00:00.000Z' });
    expect(q.totalSatang).toBe(102000);
  });
  it('an add-on with no price is not for sale (R3-AC1)', () => {
    expect(priceOrder(hunter({ selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach: null, addOnIds: ['balls'] } }))).toEqual({ ok: false, code: 'add_on_not_for_sale', addOnId: 'balls' });
  });
  it('an inactive or unknown add-on is not for sale (R3-AC4)', () => {
    expect(priceOrder(hunter({ selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach: null, addOnIds: ['towel'] } }))).toMatchObject({ code: 'add_on_not_for_sale' });
    expect(priceOrder(hunter({ selection: { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00'], coach: null, addOnIds: ['other-club'] } }))).toMatchObject({ code: 'add_on_not_for_sale' });
  });
});

describe('order of use: credit, then wallet, then money (R4, D22)', () => {
  const bundle = { packageId: 'pk-bundle', lineKind: 'court_hour' as const, priceGroupId: null, coachTierId: null, units: 1 };
  const twoHours = { courtId: 'c', hours: ['2026-11-02T10:00:00+07:00', '2026-11-02T11:00:00+07:00'], coach: null, addOnIds: ['water'] };
  it('credit first, then the wallet, then the remainder is money (R4-AC1)', () => {
    const q = ok(hunter({ credits: [bundle], walletBalanceSatang: 30000, selection: twoHours }));
    expect(q.lines.map((l) => [l.kind, l.creditValueSatang, l.walletSatang, l.moneySatang])).toEqual([
      ['court_hour', 50000, 0, 0],
      ['court_hour', 0, 30000, 20000],
      ['add_on', 0, 0, 2000],
    ]);
    expect([q.creditValueSatang, q.walletSatang, q.moneySatang]).toEqual([50000, 30000, 22000]);
  });
  it('a credit with one unit covers one line only', () => {
    const q = ok(hunter({ credits: [bundle], selection: twoHours }));
    expect(q.lines.filter((l) => l.creditUnits === 1)).toHaveLength(1);
  });
  it('a wallet larger than the rest takes only the rest (R4-AC3)', () => {
    const q = ok(hunter({ walletBalanceSatang: 999999, selection: twoHours }));
    expect(q.walletSatang).toBe(102000);
    expect(q.moneySatang).toBe(0);
  });
  it('a credit of the wrong customer type is not applied (R4-AC6)', () => {
    const q = ok(hunter({ credits: [{ ...bundle, priceGroupId: STUDENT.id }] }));
    expect(q.creditValueSatang).toBe(0);
    expect(q.moneySatang).toBe(50000);
  });
  it('a credit of another line kind is not applied', () => {
    const q = ok(hunter({ credits: [{ ...bundle, lineKind: 'coach' }] }));
    expect(q.creditValueSatang).toBe(0);
  });
  it('a negative wallet balance is treated as nothing to spend', () => {
    expect(ok(hunter({ walletBalanceSatang: -100 })).walletSatang).toBe(0);
  });
});

describe('rounding half up (D23, R4-AC4)', () => {
  it('rounds to the nearest satang, a half rounds up', () => {
    expect(percentHalfUp(50000, 1000)).toBe(5000);
    expect(percentHalfUp(12345, 1000)).toBe(1235); // 1234.5
    expect(percentHalfUp(12344, 1000)).toBe(1234); // 1234.4
    expect(percentHalfUp(1, 5000)).toBe(1); // 0.5
    expect(percentHalfUp(1, 4999)).toBe(0);
    expect(percentHalfUp(99999, 10000)).toBe(99999);
  });
  it('refuses a fraction or a value outside 0 to 10000 basis points', () => {
    expect(() => percentHalfUp(100, 10001)).toThrow();
    expect(() => percentHalfUp(100.5, 100)).toThrow();
  });
});

describe('quote hash (design 4.2 step 5, A-9)', () => {
  it('is a SHA-256 hex and the same input gives the same hash', () => {
    const a = ok(hunter());
    expect(a.quoteHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ok(hunter()).quoteHash).toBe(a.quoteHash);
  });
  it('changes when a price changes or the selection changes', () => {
    const a = ok(hunter()).quoteHash;
    expect(ok(hunter({ courtPriceRules: [{ priceGroupId: ADULT.id, dayType: 'any', peak: 'any', priceSatang: 50100 }] })).quoteHash).not.toBe(a);
    expect(ok(hunter({ selection: { courtId: 'court-2', hours: ['2026-11-02T10:00:00+07:00'], coach: null, addOnIds: [] } })).quoteHash).not.toBe(a);
    expect(ok(hunter({ walletBalanceSatang: 100 })).quoteHash).not.toBe(a);
  });
  it('does not depend on the order hours were sent in', () => {
    const h = ['2026-11-02T10:00:00+07:00', '2026-11-02T11:00:00+07:00'];
    const a = ok(hunter({ selection: { courtId: 'c', hours: h, coach: null, addOnIds: [] } })).quoteHash;
    expect(ok(hunter({ selection: { courtId: 'c', hours: [...h].reverse(), coach: null, addOnIds: [] } })).quoteHash).toBe(a);
  });
});

// Property test (design 9): for random prices, selections, credits and wallets, every line splits exactly
// and the order columns equal the sums of the lines. A seeded generator keeps failures reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % n;
  };
}

describe('property: lines always sum to the order total and to credit + wallet + money (R4-AC4)', () => {
  it('holds over 2000 random orders', () => {
    const r = rng(20261030);
    for (let i = 0; i < 2000; i++) {
      const hours = Array.from({ length: 1 + r(4) }, (_, k) => `2026-11-${String(1 + r(28)).padStart(2, '0')}T${String(6 + k * 4 + r(3)).padStart(2, '0')}:00:00+07:00`);
      const unique = [...new Set(hours)];
      const input = hunter({
        dob: r(2) ? null : '2012-03-04',
        courtPriceRules: [
          { priceGroupId: ADULT.id, dayType: 'any', peak: 'any', priceSatang: r(200000) },
          { priceGroupId: STUDENT.id, dayType: 'any', peak: 'any', priceSatang: r(200000) },
          { priceGroupId: ADULT.id, dayType: 'weekend', peak: 'any', priceSatang: r(200000) },
        ],
        coachTierPrices: [
          { tierId: COACH_TIER, priceGroupId: ADULT.id, priceSatang: r(150000) },
          { tierId: COACH_TIER, priceGroupId: STUDENT.id, priceSatang: r(150000) },
        ],
        addOns: [{ id: 'a', priceSatang: r(10000), active: true }, { id: 'b', priceSatang: r(10000), active: true }],
        selection: {
          courtId: 'c',
          hours: unique,
          coach: r(2) ? { coachId: 'k', tierId: COACH_TIER, source: r(2) ? 'checkout' : 'classes' } : null,
          addOnIds: ['a', 'b', 'a'].slice(0, r(4)),
        },
        credits: [
          { packageId: 'p1', lineKind: 'court_hour', priceGroupId: null, coachTierId: null, units: r(3) },
          { packageId: 'p2', lineKind: 'coach', priceGroupId: r(2) ? ADULT.id : STUDENT.id, coachTierId: COACH_TIER, units: r(3) },
        ],
        walletBalanceSatang: r(300000),
      });
      const q = ok(input);
      const sum = (f: (l: (typeof q.lines)[number]) => number) => q.lines.reduce((a, l) => a + f(l), 0);
      for (const l of q.lines) {
        expect(l.netSatang).toBe(l.unitPriceSatang - l.discountSatang);
        expect(l.netSatang).toBe(l.creditValueSatang + l.walletSatang + l.moneySatang);
        for (const v of [l.unitPriceSatang, l.discountSatang, l.creditValueSatang, l.walletSatang, l.moneySatang]) {
          expect(Number.isInteger(v) && v >= 0).toBe(true);
        }
      }
      expect(q.subtotalSatang).toBe(sum((l) => l.unitPriceSatang));
      expect(q.discountSatang).toBe(sum((l) => l.discountSatang));
      expect(q.totalSatang).toBe(q.subtotalSatang - q.discountSatang);
      expect(q.totalSatang).toBe(q.creditValueSatang + q.walletSatang + q.moneySatang);
      expect(q.creditValueSatang).toBe(sum((l) => l.creditValueSatang));
      expect(q.walletSatang).toBe(sum((l) => l.walletSatang));
      expect(q.moneySatang).toBe(sum((l) => l.moneySatang));
      expect(q.walletSatang).toBeLessThanOrEqual(input.walletBalanceSatang);
    }
  });
});

describe('hours are 60 minutes on the hour', () => {
  it('an hour that does not start on the hour in Bangkok is refused', () => {
    expect(priceOrder(hunter({ selection: { courtId: 'c', hours: ['2026-11-02T10:30:00+07:00'], coach: null, addOnIds: [] } }))).toMatchObject({ ok: false, code: 'selection_invalid' });
  });
});
