import { createHash } from 'node:crypto';
import { checkCode, planDiscounts, type BirthdayInput, type CodeInput, type CodeRefusal } from './discounts';
import { groupFor, type PriceGroupRule } from './pricing';

// The price of a package bought alone (F05 package-only Pay; F06 R3, PKG-02-AC6 to AC8; F04 R1-AC6, AC7, R4, R5,
// PROMO-01; D22, D23, D62). Pure, like priceOrder: one package line at the product's price, the one code and the birthday
// discount (one package a year), then the wallet before money (no credit pays for a package). Integer satang.
//   * A product with no price, or inactive, is not for sale (an empty setting is not free).
//   * A product of an age-limited group (a Student package) is for a buyer in that group only (R1-AC6); a product of the
//     open-ended group (Adult) or of no group (a court bundle) is for anyone (D62).

export interface PackageProductOffer {
  id: string;
  /** null: not set, not offered (PKG-02-AC7). */
  priceSatang: number | null;
  active: boolean;
  priceGroupId: string | null;
}

export interface PackagePricingInput {
  onDate: string;
  dob: string | null;
  priceGroups: PriceGroupRule[];
  product: PackageProductOffer;
  walletBalanceSatang: number;
  code?: CodeInput | 'not_found' | null;
  birthday?: BirthdayInput;
}

export interface PackageQuoteLine {
  position: 1;
  kind: 'package';
  packageProductId: string;
  unitPriceSatang: number;
  discountSatang: number;
  birthdayDiscountSatang: number;
  codeDiscountSatang: number;
  netSatang: number;
  creditValueSatang: 0;
  walletSatang: number;
  moneySatang: number;
}

export interface PackageQuote {
  priceGroupId: string;
  promoCodeId: string | null;
  referralCodeId: string | null;
  birthdayEntitlement: 'package' | null;
  codeNotApplied: boolean;
  lines: PackageQuoteLine[];
  subtotalSatang: number;
  discountSatang: number;
  totalSatang: number;
  creditValueSatang: 0;
  walletSatang: number;
  moneySatang: number;
  quoteHash: string;
}

export type PackagePricingResult =
  | { ok: true; quote: PackageQuote }
  | { ok: false; code: 'package_not_for_sale' | 'student_item_not_allowed' | 'price_not_set' }
  | CodeRefusal;

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function pricePackage(input: PackagePricingInput): PackagePricingResult {
  const p = input.product;
  if (!p.active || p.priceSatang === null) return { ok: false, code: 'package_not_for_sale' };
  const buyer = groupFor(input.priceGroups, input.dob, input.onDate);
  if (buyer === null) return { ok: false, code: 'price_not_set' };
  const productGroup = p.priceGroupId === null ? null : input.priceGroups.find((g) => g.id === p.priceGroupId) ?? null;
  if (productGroup !== null && productGroup.maxAge !== null && productGroup.id !== buyer.id) return { ok: false, code: 'student_item_not_allowed' };

  const lines = [{ kind: 'package' as const, hourIndex: 0, unitPriceSatang: p.priceSatang }];
  const ctx = { onDate: input.onDate, dob: input.dob };
  let code: { input: CodeInput; inScope: boolean[] } | null = null;
  if (input.code !== undefined && input.code !== null) {
    const checked = checkCode(input.code, lines, ctx);
    if (!checked.ok) return checked;
    code = { input: input.code as CodeInput, inScope: checked.inScope };
  }
  const plan = planDiscounts(lines, code, input.birthday, ctx);
  const birthdayDiscount = plan.birthday[0]!;
  const codeDiscount = plan.code[0]!;
  const net = p.priceSatang - birthdayDiscount - codeDiscount;
  const wallet = Math.min(Math.max(0, Math.floor(input.walletBalanceSatang)), net);
  const line: PackageQuoteLine = {
    position: 1,
    kind: 'package',
    packageProductId: p.id,
    unitPriceSatang: p.priceSatang,
    discountSatang: birthdayDiscount + codeDiscount,
    birthdayDiscountSatang: birthdayDiscount,
    codeDiscountSatang: codeDiscount,
    netSatang: net,
    creditValueSatang: 0,
    walletSatang: wallet,
    moneySatang: net - wallet,
  };
  const applied = code !== null && plan.codeApplied ? code.input : null;
  const body = {
    priceGroupId: buyer.id,
    promoCodeId: applied?.source === 'promo' ? applied.id : null,
    referralCodeId: applied?.source === 'referral' ? applied.id : null,
    birthdayEntitlement: plan.birthdayApplied && plan.birthdayKind === 'package' ? ('package' as const) : null,
    codeNotApplied: code !== null && !plan.codeApplied,
    lines: [line],
    subtotalSatang: line.unitPriceSatang,
    discountSatang: line.discountSatang,
    totalSatang: line.netSatang,
    creditValueSatang: 0 as const,
    walletSatang: line.walletSatang,
    moneySatang: line.moneySatang,
  };
  return { ok: true, quote: { ...body, quoteHash: createHash('sha256').update(canonical(body)).digest('hex') } };
}
