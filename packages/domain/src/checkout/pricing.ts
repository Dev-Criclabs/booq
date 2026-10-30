import { createHash } from 'node:crypto';
import { bangkokDate, bangkokTime } from '../../../time/src/index';
import { ageOn } from '../price-group';
import { checkCode, planDiscounts, type BirthdayInput, type CodeInput, type CodeRefusal } from './discounts';

export { percentHalfUp, splitByPrice, type BirthdayInput, type CodeInput, type CodeRefusal, type CodeScope } from './discounts';

// The pricing engine (F04-T08; design 4.1 to 4.3; R1, R2, R4; D22, D23, D62). A pure function: no
// database, no clock. The route loads the club's rules, prices, the player's eligible credits and wallet
// balance inside its transaction and passes them in, with the Bangkok date of the request (A-5).
// Everything is integer satang; a percentage is integer basis points, rounded half up (D23).
// Results are codes, never text. Promo, referral and birthday discounts are in ./discounts (F04-T09).
//
// Assumptions (obvious defaults, reported with the task):
// - With no date of birth (D12) the player is in the group whose rule has no upper age (Hunter's Adult).
// - A weekday or weekend rule beats an `any` rule for the same group; the weekend is Saturday and Sunday.
// - Every hour of a solo class has its own coach line, linked to that hour (BOOK-06).
// - A credit is never spent on a line whose net is zero.

export type DayType = 'any' | 'weekday' | 'weekend';
export type Peak = 'any' | 'peak' | 'off_peak';
export type LineKind = 'court_hour' | 'coach' | 'add_on';

export interface PriceGroupRule {
  id: string;
  minAge: number | null;
  maxAge: number | null;
}

export interface CourtPriceRule {
  priceGroupId: string;
  dayType: DayType;
  peak: Peak;
  priceSatang: number;
}

export interface CoachTierPrice {
  tierId: string;
  priceGroupId: string;
  /** null: not set, the coach cannot be picked (R2-AC3). */
  priceSatang: number | null;
}

export interface AddOnOffer {
  id: string;
  /** null: not for sale (R3-AC1). */
  priceSatang: number | null;
  active: boolean;
}

/** A credit F06 says the player holds. `null` group or tier means it fits any. */
export interface EligibleCredit {
  packageId: string;
  lineKind: 'court_hour' | 'coach';
  priceGroupId: string | null;
  coachTierId: string | null;
  units: number;
}

export interface CoachChoice {
  coachId: string;
  tierId: string;
  /** `checkout`: picked on C10, never paid by solo credits (COACH-03). `classes`: may be (COACH-04). */
  source: 'checkout' | 'classes';
  /** The coach's own price from F07, when it has one; otherwise the tier price applies. */
  priceSatang?: number | null;
}

/** What the player chose. Never an amount (CC-2). */
export interface Selection {
  courtId: string;
  /** Hour starts as ISO instants; each is one booking (BOOK-06). */
  hours: string[];
  coach: CoachChoice | null;
  addOnIds: string[];
}

export interface PricingInput {
  /** The Bangkok date of the request, YYYY-MM-DD. */
  onDate: string;
  dob: string | null;
  priceGroups: PriceGroupRule[];
  courtPriceRules: CourtPriceRule[];
  coachTierPrices: CoachTierPrice[];
  addOns: AddOnOffer[];
  selection: Selection;
  credits: EligibleCredit[];
  walletBalanceSatang: number;
  /** The one code of the order, as loaded in the club; 'not_found' when no such code exists here (AC9). */
  code?: CodeInput | 'not_found' | null;
  birthday?: BirthdayInput;
}

export interface QuoteLine {
  position: number;
  kind: LineKind;
  /** The hour this line belongs to; an add-on belongs to the first hour (D111). */
  hourIndex: number;
  startsAt: string;
  courtId: string;
  coachId: string | null;
  addOnId: string | null;
  unitPriceSatang: number;
  /** birthdayDiscountSatang + codeDiscountSatang; each hour keeps its own share (D67). */
  discountSatang: number;
  birthdayDiscountSatang: number;
  codeDiscountSatang: number;
  netSatang: number;
  creditPackageId: string | null;
  creditUnits: number;
  creditValueSatang: number;
  walletSatang: number;
  moneySatang: number;
}

export interface Quote {
  priceGroupId: string;
  promoCodeId: string | null;
  referralCodeId: string | null;
  /** The entitlement this order uses, recorded at Pay (R5). */
  birthdayEntitlement: 'solo_class' | null;
  /** A code was entered and is valid but gave way to the larger birthday discount (D65); nothing of it is used. */
  codeNotApplied: boolean;
  lines: QuoteLine[];
  subtotalSatang: number;
  discountSatang: number;
  totalSatang: number;
  creditValueSatang: number;
  walletSatang: number;
  /** The amount due by money (Beam or cash). */
  moneySatang: number;
  quoteHash: string;
}

export type PricingRefusal =
  | { ok: false; code: 'selection_invalid' }
  | { ok: false; code: 'price_not_set'; hourIndex?: number }
  | { ok: false; code: 'coach_price_not_set' }
  | { ok: false; code: 'add_on_not_for_sale'; addOnId: string }
  | CodeRefusal;

export type PricingResult = { ok: true; quote: Quote } | PricingRefusal;

function groupFor(groups: PriceGroupRule[], dob: string | null, onDate: string): PriceGroupRule | null {
  const matches =
    dob === null
      ? groups.filter((g) => g.maxAge === null)
      : groups.filter((g) => {
          const age = ageOn(dob, onDate);
          return (g.minAge === null || age >= g.minAge) && (g.maxAge === null || age <= g.maxAge);
        });
  return matches.length === 1 ? matches[0]! : null;
}

function dayTypeOf(at: Date): 'weekday' | 'weekend' {
  const day = new Date(`${bangkokDate(at)}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

function courtPrice(rules: CourtPriceRule[], groupId: string, at: Date): number | null {
  const own = rules.filter((r) => r.priceGroupId === groupId);
  if (own.some((r) => r.peak !== 'any')) return null; // no peak window in v1 (A-4)
  const day = dayTypeOf(at);
  const rule = own.find((r) => r.dayType === day) ?? own.find((r) => r.dayType === 'any');
  return rule ? rule.priceSatang : null;
}

function parseHours(hours: string[]): Date[] | null {
  if (hours.length === 0) return null;
  const dates = hours.map((h) => new Date(h));
  if (dates.some((d) => Number.isNaN(d.getTime()) || !bangkokTime(d).endsWith(':00:00'))) return null;
  dates.sort((a, b) => a.getTime() - b.getTime());
  if (dates.some((d, i) => i > 0 && d.getTime() === dates[i - 1]!.getTime())) return null;
  return dates;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

type Priced = Omit<QuoteLine, 'creditPackageId' | 'creditUnits' | 'creditValueSatang' | 'walletSatang' | 'moneySatang'>;

/** Package credit first, then the wallet, then money (D22, design 4.3). */
function allocate(lines: Priced[], input: PricingInput, groupId: string, coach: CoachChoice | null): QuoteLine[] {
  const units = input.credits.map((c) => Math.max(0, Math.floor(c.units)));
  let wallet = Math.max(0, Math.floor(input.walletBalanceSatang));
  return lines.map((line) => {
    let creditPackageId: string | null = null;
    let creditValueSatang = 0;
    const creditable = line.kind === 'court_hour' || (line.kind === 'coach' && coach?.source === 'classes');
    if (creditable && line.netSatang > 0) {
      const i = input.credits.findIndex(
        (c, k) =>
          units[k]! > 0 &&
          c.lineKind === line.kind &&
          (c.priceGroupId === null || c.priceGroupId === groupId) &&
          (line.kind !== 'coach' || c.coachTierId === null || c.coachTierId === coach?.tierId),
      );
      if (i >= 0) {
        units[i]! -= 1;
        creditPackageId = input.credits[i]!.packageId;
        creditValueSatang = line.netSatang;
      }
    }
    const walletSatang = Math.min(wallet, line.netSatang - creditValueSatang);
    wallet -= walletSatang;
    return {
      ...line,
      creditPackageId,
      creditUnits: creditPackageId === null ? 0 : 1,
      creditValueSatang,
      walletSatang,
      moneySatang: line.netSatang - creditValueSatang - walletSatang,
    };
  });
}

export function priceOrder(input: PricingInput): PricingResult {
  const { selection } = input;
  const hours = parseHours(selection.hours);
  if (hours === null) return { ok: false, code: 'selection_invalid' };
  const group = groupFor(input.priceGroups, input.dob, input.onDate);
  if (group === null) return { ok: false, code: 'price_not_set' };

  let coachPrice: number | null = null;
  if (selection.coach !== null) {
    const own = selection.coach.priceSatang;
    coachPrice =
      own ?? input.coachTierPrices.find((p) => p.tierId === selection.coach!.tierId && p.priceGroupId === group.id)?.priceSatang ?? null;
    if (coachPrice === null) return { ok: false, code: 'coach_price_not_set' };
  }

  const priced: Priced[] = [];
  const push = (kind: LineKind, hourIndex: number, unit: number, ids: { coachId?: string; addOnId?: string } = {}) =>
    priced.push({
      position: priced.length + 1,
      kind,
      hourIndex,
      startsAt: hours[hourIndex]!.toISOString(),
      courtId: selection.courtId,
      coachId: ids.coachId ?? null,
      addOnId: ids.addOnId ?? null,
      unitPriceSatang: unit,
      discountSatang: 0,
      birthdayDiscountSatang: 0,
      codeDiscountSatang: 0,
      netSatang: unit,
    });

  for (const [hourIndex, at] of hours.entries()) {
    const price = courtPrice(input.courtPriceRules, group.id, at);
    if (price === null) return { ok: false, code: 'price_not_set', hourIndex };
    push('court_hour', hourIndex, price);
    if (selection.coach !== null) push('coach', hourIndex, coachPrice!, { coachId: selection.coach.coachId });
  }
  for (const addOnId of selection.addOnIds) {
    const offer = input.addOns.find((a) => a.id === addOnId);
    if (!offer || !offer.active || offer.priceSatang === null) return { ok: false, code: 'add_on_not_for_sale', addOnId };
    push('add_on', 0, offer.priceSatang, { addOnId });
  }

  const ctx = { onDate: input.onDate, dob: input.dob };
  let code: { input: CodeInput; inScope: boolean[] } | null = null;
  if (input.code !== undefined && input.code !== null) {
    const checked = checkCode(input.code, priced, ctx);
    if (!checked.ok) return checked;
    code = { input: input.code as CodeInput, inScope: checked.inScope };
  }
  const plan = planDiscounts(priced, code, input.birthday, ctx);
  for (const [i, line] of priced.entries()) {
    line.birthdayDiscountSatang = plan.birthday[i]!;
    line.codeDiscountSatang = plan.code[i]!;
    line.discountSatang = line.birthdayDiscountSatang + line.codeDiscountSatang;
    line.netSatang = line.unitPriceSatang - line.discountSatang;
  }

  const lines = allocate(priced, input, group.id, selection.coach);
  const sum = (f: (l: QuoteLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const applied = code !== null && plan.codeApplied ? code.input : null;
  const body = {
    priceGroupId: group.id,
    promoCodeId: applied?.source === 'promo' ? applied.id : null,
    referralCodeId: applied?.source === 'referral' ? applied.id : null,
    birthdayEntitlement: plan.birthdayApplied ? ('solo_class' as const) : null,
    codeNotApplied: code !== null && !plan.codeApplied,
    lines,
    subtotalSatang: sum((l) => l.unitPriceSatang),
    discountSatang: sum((l) => l.discountSatang),
    totalSatang: sum((l) => l.netSatang),
    creditValueSatang: sum((l) => l.creditValueSatang),
    walletSatang: sum((l) => l.walletSatang),
    moneySatang: sum((l) => l.moneySatang),
  };
  const quoteHash = createHash('sha256').update(canonical(body)).digest('hex');
  return { ok: true, quote: { ...body, quoteHash } };
}
