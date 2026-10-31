import { priceGroupFor } from '../price-group';

// Promo, referral and birthday discounts in the pricing engine (F04-T09; design 4.4; PROMO-01, R5;
// D23, D65, D67, D68; assumptions A-2, A-3, A-6). Pure: the loader reads the code row, its counted uses
// and the player's entitlements; the final count is taken at Pay under the code row lock (D66).
//
// Assumptions (obvious defaults, reported with the task):
// - A code's `solo_class` scope covers the court and coach lines of a solo class; `court_hour` and `coach`
//   cover those lines in any order. Add-ons are in scope only when the code includes them (D23).
// - A code before its start date answers code_expired, as after its end date (one "outside its dates" reason).
// - The birthday discount on a solo class covers the court and coach lines of its first hour (one solo
//   class); on a package order it covers the first package line (one package a year, R5).
// - With a non stackable code that loses to the birthday discount, the quote carries the birthday discount
//   and says the code was not applied; nothing about the code is used up.

export type CodeScope = 'court_hour' | 'coach' | 'add_on' | 'package' | 'solo_class' | 'group_class';

/** The one code of the order: a club promo code or a friend's referral code (F14 resolves it). */
export interface CodeInput {
  source: 'promo' | 'referral';
  id: string;
  kind: 'percent' | 'fixed';
  /** Basis points for percent, satang for fixed. */
  value: number;
  appliesTo: CodeScope[];
  includesAddOns: boolean;
  audience: 'adult' | 'student' | 'any';
  startsOn: string | null;
  endsOn: string | null;
  firstTimeOnly: boolean;
  totalCap: number | null;
  perCustomerCap: number | null;
  minSpendSatang: number | null;
  stackableWithBirthday: boolean;
  partnerId: string | null;
  active: boolean;
  /** `counted` uses of this code (restored rows do not count, D70). */
  usesCounted: number;
  customerUsesCounted: number;
  /** The player has a confirmed, no show or late cancelled booking (A-1). */
  customerHasPaidBooking: boolean;
}

export interface BirthdayInput {
  /** The club's `birthday_discount` setting; null while unset (R5-AC2). */
  setting: { kind: 'percent' | 'fixed'; value: number } | null;
  /** Entitlement kinds already used this year (R5-AC3). */
  usedKinds: ('package' | 'solo_class')[];
}

export type CodeRefusal =
  | { ok: false; code: 'code_not_valid' }
  | { ok: false; code: 'code_expired' }
  | { ok: false; code: 'code_wrong_audience' }
  | { ok: false; code: 'code_out_of_scope' }
  | { ok: false; code: 'code_below_minimum'; minSpendSatang: number }
  | { ok: false; code: 'code_first_booking_only' }
  | { ok: false; code: 'code_used_up' }
  | { ok: false; code: 'code_not_for_solo_class' };

export interface DiscountLine {
  kind: 'court_hour' | 'coach' | 'add_on' | 'package' | 'class_seat';
  hourIndex: number;
  unitPriceSatang: number;
}

export interface DiscountPlan {
  birthday: number[];
  code: number[];
  codeApplied: boolean;
  birthdayApplied: boolean;
  /** Which entitlement the birthday discount uses: one solo class or one package a year (R5). */
  birthdayKind: 'solo_class' | 'package' | null;
}

/** Split `amount` across `prices` in proportion, in whole satang summing exactly; the largest remainders
 *  take the leftover satang, ties to the earlier line (A-6). Needs `amount` <= the sum of `prices`. */
export function splitByPrice(amount: number, prices: number[]): number[] {
  const total = prices.reduce((a, b) => a + b, 0);
  if (amount === 0 || total === 0) return prices.map(() => 0);
  const shares = prices.map((p) => Math.floor((amount * p) / total));
  let left = amount - shares.reduce((a, b) => a + b, 0);
  const order = prices.map((p, i) => ({ i, rem: (amount * p) % total })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

/** `price * bp / 10000`, rounded half up to the satang (D23): `(price * bp + 5000) div 10000`. */
export function percentHalfUp(priceSatang: number, basisPoints: number): number {
  if (!Number.isSafeInteger(priceSatang) || priceSatang < 0) throw new RangeError('price must be whole satang');
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) throw new RangeError('basis points must be 0 to 10000');
  return Math.floor((priceSatang * basisPoints + 5000) / 10000);
}

/** Discount per line for a value on the in-scope lines; percent per line half up, fixed capped and split. */
function discountOn(base: number[], inScope: boolean[], kind: 'percent' | 'fixed', value: number): number[] {
  if (kind === 'percent') return base.map((p, i) => (inScope[i] ? percentHalfUp(p, value) : 0));
  const scoped = base.map((p, i) => (inScope[i] ? p : 0));
  const cap = scoped.reduce((a, b) => a + b, 0);
  return splitByPrice(Math.min(value, cap), scoped);
}

function inCodeScope(code: CodeInput, line: DiscountLine, soloClass: boolean): boolean {
  if (line.kind === 'add_on') return code.includesAddOns;
  if (line.kind === 'class_seat') return code.appliesTo.includes('group_class');   // a group class seat (F04-T22b)
  if (soloClass && code.appliesTo.includes('solo_class')) return true;
  return code.appliesTo.includes(line.kind);
}

/** The code's own checks (PROMO-01-AC5, AC6, AC8, AC9), before any amount is worked out. */
export function checkCode(
  code: CodeInput | 'not_found',
  lines: DiscountLine[],
  ctx: { onDate: string; dob: string | null },
): CodeRefusal | { ok: true; inScope: boolean[] } {
  if (code === 'not_found' || !code.active) return { ok: false, code: 'code_not_valid' };
  if ((code.startsOn !== null && ctx.onDate < code.startsOn) || (code.endsOn !== null && ctx.onDate > code.endsOn)) {
    return { ok: false, code: 'code_expired' };
  }
  if (code.audience !== 'any' && priceGroupFor(ctx.dob, ctx.onDate) !== code.audience) return { ok: false, code: 'code_wrong_audience' };
  const soloClass = lines.some((l) => l.kind === 'coach');
  if (code.partnerId !== null && soloClass) return { ok: false, code: 'code_not_for_solo_class' };
  const inScope = lines.map((l) => inCodeScope(code, l, soloClass));
  if (!inScope.some((s, i) => s && lines[i]!.unitPriceSatang > 0)) return { ok: false, code: 'code_out_of_scope' };
  const subtotal = lines.reduce((a, l) => a + l.unitPriceSatang, 0);
  if (code.minSpendSatang !== null && subtotal < code.minSpendSatang) return { ok: false, code: 'code_below_minimum', minSpendSatang: code.minSpendSatang };
  if (code.firstTimeOnly && code.customerHasPaidBooking) return { ok: false, code: 'code_first_booking_only' };
  if ((code.totalCap !== null && code.usesCounted >= code.totalCap) || (code.perCustomerCap !== null && code.customerUsesCounted >= code.perCustomerCap)) {
    return { ok: false, code: 'code_used_up' };
  }
  return { ok: true, inScope };
}

/** Which lines the birthday discount covers, or null when the player has no entitlement here (R5). */
function birthdayScope(
  lines: DiscountLine[],
  birthday: BirthdayInput | undefined,
  ctx: { onDate: string; dob: string | null },
): { kind: 'solo_class' | 'package'; scope: boolean[] } | null {
  if (!birthday || birthday.setting === null || ctx.dob === null) return null;
  if (ctx.dob.slice(5, 7) !== ctx.onDate.slice(5, 7)) return null;
  if (lines.some((l) => l.kind === 'coach')) {
    if (birthday.usedKinds.includes('solo_class')) return null;
    return { kind: 'solo_class', scope: lines.map((l) => l.hourIndex === 0 && (l.kind === 'court_hour' || l.kind === 'coach')) };
  }
  // One package a year: the first package line of the order (R5).
  const first = lines.findIndex((l) => l.kind === 'package');
  if (first < 0 || birthday.usedKinds.includes('package')) return null;
  return { kind: 'package', scope: lines.map((_, i) => i === first) };
}

/** Both discounts with the stacking rule (D65): stackable gives both, the code on the amounts after the
 *  birthday discount; otherwise the larger total wins and a tie goes to the code (A-2). */
export function planDiscounts(
  lines: DiscountLine[],
  code: { input: CodeInput; inScope: boolean[] } | null,
  birthday: BirthdayInput | undefined,
  ctx: { onDate: string; dob: string | null },
): DiscountPlan {
  const prices = lines.map((l) => l.unitPriceSatang);
  const zero = prices.map(() => 0);
  const b = birthdayScope(lines, birthday, ctx);
  const bday = b === null ? null : discountOn(prices, b.scope, birthday!.setting!.kind, birthday!.setting!.value);
  const kind = b?.kind ?? null;
  if (code === null) return { birthday: bday ?? zero, code: zero, codeApplied: false, birthdayApplied: bday !== null, birthdayKind: bday !== null ? kind : null };
  if (bday === null) return { birthday: zero, code: discountOn(prices, code.inScope, code.input.kind, code.input.value), codeApplied: true, birthdayApplied: false, birthdayKind: null };
  if (code.input.stackableWithBirthday) {
    const after = prices.map((p, i) => p - bday[i]!);
    return { birthday: bday, code: discountOn(after, code.inScope, code.input.kind, code.input.value), codeApplied: true, birthdayApplied: true, birthdayKind: kind };
  }
  const alone = discountOn(prices, code.inScope, code.input.kind, code.input.value);
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  return sum(alone) >= sum(bday)
    ? { birthday: zero, code: alone, codeApplied: true, birthdayApplied: false, birthdayKind: null }
    : { birthday: bday, code: zero, codeApplied: false, birthdayApplied: true, birthdayKind: kind };
}
