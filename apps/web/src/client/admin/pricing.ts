import { call, type Outcome } from './api';

// A9 Products and pricing and A9b Price groups and add-ons (F11-T18; ADMIN-10, ADMIN-11; boards H-A09-Pricing, H-A09b-Pricing-groups): the owner's
// price data apart from the screen. Reads and writes the F04 setup routes (price groups, court price rules, coach tiers and their prices, package
// products, add-ons). A price nobody set stays empty; this file never supplies one. Money is integer satang on the wire; the owner types baht.
// A change applies to new purchases only (the server copies prices onto what is sold), which the page says (A-0225).

type Fetch = typeof fetch;

export interface PriceGroup { id: string; nameTh: string; nameEn: string; rule: { min_age?: number; max_age?: number }; position: number }
export interface CourtRule { id: string; priceGroupId: string; dayType: string; peak: string; priceSatang: number }
export interface CoachTier { id: string; nameTh: string; nameEn: string }
export interface TierPrice { tierId: string; priceGroupId: string; priceSatang: number | null }
export type CreditType = 'court_hour' | 'solo_class' | 'group_session';
export interface Product {
  id: string; nameTh: string; nameEn: string; creditType: CreditType; credits: number; validityMonths: number;
  priceGroupId: string | null; coachTierId: string | null; priceSatang: number | null; active: boolean;
}
export interface AddOn { id: string; nameTh: string; nameEn: string; priceSatang: number | null; active: boolean; position: number }

export interface Pricing {
  groups: PriceGroup[]; courtRules: CourtRule[]; tiers: CoachTier[]; tierPrices: TierPrice[]; products: Product[]; addOns: AddOn[];
}

const BASE = '/staff/setup';

/** Everything the two pages show, in one go; one failed read fails the page (it would otherwise show a half truth about prices). */
export async function loadPricing(slug: string, f: Fetch): Promise<Outcome<Pricing>> {
  const [g, c, t, tp, p, a] = await Promise.all([
    call<PriceGroup[]>(slug, `${BASE}/price-groups`, f), call<CourtRule[]>(slug, `${BASE}/court-prices`, f), call<CoachTier[]>(slug, `${BASE}/coach-tiers`, f),
    call<TierPrice[]>(slug, `${BASE}/coach-tier-prices`, f), call<Product[]>(slug, `${BASE}/package-products`, f), call<AddOn[]>(slug, `${BASE}/add-ons`, f),
  ]);
  for (const r of [g, c, t, tp, p, a]) if (r.kind !== 'ok') return r as Outcome<Pricing>;
  if (g.kind !== 'ok' || c.kind !== 'ok' || t.kind !== 'ok' || tp.kind !== 'ok' || p.kind !== 'ok' || a.kind !== 'ok') return { kind: 'offline' };
  return { kind: 'ok', body: { groups: g.body, courtRules: c.body, tiers: t.body, tierPrices: tp.body, products: p.body, addOns: a.body } };
}

// ---- money ------------------------------------------------------------------------------------------------------------------------------------------
/** Baht as typed to integer satang, without floating point. Empty is "not set" (null). Anything else that is not an amount of at most two decimals is 'bad'. */
export function bahtToSatang(text: string): number | null | 'bad' {
  const t = text.trim().replace(/,/g, '');
  if (t === '') return null;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return 'bad';
  return Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0);
}
/** Satang as a box shows it: 50000 -> "500", 50050 -> "500.50"; not set -> "". */
export function satangToBaht(satang: number | null | undefined): string {
  if (satang === null || satang === undefined) return '';
  const baht = Math.floor(satang / 100);
  const rest = satang % 100;
  return rest === 0 ? String(baht) : `${baht}.${String(rest).padStart(2, '0')}`;
}
/** The price of one hour of a bundle, rounded to the nearest satang; nothing while the price is not set. */
export const perHourSatang = (p: { priceSatang: number | null; credits: number }): number | null => (p.priceSatang === null || p.credits <= 0 ? null : Math.round(p.priceSatang / p.credits));

// ---- court rate (A9) --------------------------------------------------------------------------------------------------------------------------------
/** The one price per court hour of a price group, every day and hour (day type any, peak any). Peak and off peak have no definition yet. */
export const courtRuleOf = (rules: readonly CourtRule[], groupId: string): CourtRule | undefined => rules.find((r) => r.priceGroupId === groupId && r.dayType === 'any' && r.peak === 'any');

export type SaveResult = { ok: true } | { ok: false; key: string };
const fail = (key: string): SaveResult => ({ ok: false, key });

export async function saveCourtRate(slug: string, rule: CourtRule | undefined, groupId: string, text: string, f: Fetch): Promise<Outcome<unknown> | SaveResult> {
  const s = bahtToSatang(text);
  if (s === 'bad') return fail('A-new.price_err_amount');
  if (s === null) {
    if (!rule) return fail('A-new.price_nothing_changed');
    return call(slug, `${BASE}/court-prices/${encodeURIComponent(rule.id)}`, f, { method: 'DELETE' });
  }
  if (rule) return rule.priceSatang === s ? fail('A-new.price_nothing_changed') : call(slug, `${BASE}/court-prices/${encodeURIComponent(rule.id)}`, f, { method: 'PUT', body: { priceSatang: s } });
  return call(slug, `${BASE}/court-prices`, f, { method: 'POST', body: { priceGroupId: groupId, priceSatang: s } });
}

// ---- coach tiers and their prices (A9) --------------------------------------------------------------------------------------------------------------
export const tierPriceOf = (prices: readonly TierPrice[], tierId: string, groupId: string): number | null =>
  prices.find((p) => p.tierId === tierId && p.priceGroupId === groupId)?.priceSatang ?? null;

export async function saveTierPrice(slug: string, tierId: string, groupId: string, was: number | null, text: string, f: Fetch): Promise<Outcome<unknown> | SaveResult> {
  const s = bahtToSatang(text);
  if (s === 'bad') return fail('A-new.price_err_amount');
  if (s === was) return fail('A-new.price_nothing_changed');
  return call(slug, `${BASE}/coach-tier-prices`, f, { method: 'PUT', body: { tierId, priceGroupId: groupId, priceSatang: s } });
}

export interface NamesDraft { nameTh: string; nameEn: string }
export const namesOk = (d: NamesDraft): boolean => d.nameTh.trim() !== '' && d.nameEn.trim() !== '';
export const addTier = (slug: string, d: NamesDraft, f: Fetch) => call<CoachTier>(slug, `${BASE}/coach-tiers`, f, { method: 'POST', body: { nameTh: d.nameTh.trim(), nameEn: d.nameEn.trim() } });
export const saveTier = (slug: string, id: string, d: NamesDraft, f: Fetch) => call<CoachTier>(slug, `${BASE}/coach-tiers/${encodeURIComponent(id)}`, f, { method: 'PUT', body: { nameTh: d.nameTh.trim(), nameEn: d.nameEn.trim() } });
export const deleteTier = (slug: string, id: string, f: Fetch) => call(slug, `${BASE}/coach-tiers/${encodeURIComponent(id)}`, f, { method: 'DELETE' });

// ---- package products (A9) --------------------------------------------------------------------------------------------------------------------------
export interface ProductDraft { nameTh: string; nameEn: string; credits: string; validityMonths: string; price: string; priceGroupId: string; coachTierId: string; active: boolean }
export const productDraft = (p?: Product): ProductDraft => ({
  nameTh: p?.nameTh ?? '', nameEn: p?.nameEn ?? '', credits: p ? String(p.credits) : '', validityMonths: p ? String(p.validityMonths) : '', price: satangToBaht(p?.priceSatang),
  priceGroupId: p?.priceGroupId ?? '', coachTierId: p?.coachTierId ?? '', active: p?.active ?? true,
});
const WHOLE = (s: string, max: number): number | null => (/^[1-9]\d{0,3}$/.test(s.trim()) && Number(s.trim()) <= max ? Number(s.trim()) : null);
export type ProductPatch = { ok: true; body: Record<string, unknown> } | { ok: false; key: string };
/** The body of a create (`was` absent: every field) or of a change (only what changed). Solo packs name a coach tier; solo and group packs a price group. */
export function productBody(type: CreditType, was: Product | undefined, now: ProductDraft): ProductPatch {
  if (!namesOk(now)) return { ok: false, key: 'A-new.price_err_names' };
  const credits = WHOLE(now.credits, 1000);
  if (credits === null) return { ok: false, key: 'A-new.price_err_credits' };
  const months = WHOLE(now.validityMonths, 120);
  if (months === null) return { ok: false, key: 'A-new.price_err_months' };
  const price = bahtToSatang(now.price);
  if (price === 'bad') return { ok: false, key: 'A-new.price_err_amount' };
  if (type !== 'court_hour' && now.priceGroupId === '') return { ok: false, key: 'A-new.price_err_group' };
  if (type === 'solo_class' && now.coachTierId === '') return { ok: false, key: 'A-new.price_err_tier' };
  const full: Record<string, unknown> = {
    nameTh: now.nameTh.trim(), nameEn: now.nameEn.trim(), creditType: type, credits, validityMonths: months, priceSatang: price, active: now.active,
    ...(type !== 'court_hour' ? { priceGroupId: now.priceGroupId } : {}), ...(type === 'solo_class' ? { coachTierId: now.coachTierId } : {}),
  };
  if (!was) {
    if (price === null) delete full['priceSatang']; // a price nobody set stays unset on the server
    return { ok: true, body: full };
  }
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) {
    if (k === 'creditType') continue; // a product keeps its kind
    if ((was as unknown as Record<string, unknown>)[k] !== v) body[k] = v;
  }
  return Object.keys(body).length === 0 ? { ok: false, key: 'A-new.price_nothing_changed' } : { ok: true, body };
}
export const addProduct = (slug: string, body: Record<string, unknown>, f: Fetch) => call<Product>(slug, `${BASE}/package-products`, f, { method: 'POST', body });
export const saveProduct = (slug: string, id: string, body: Record<string, unknown>, f: Fetch) => call<Product>(slug, `${BASE}/package-products/${encodeURIComponent(id)}`, f, { method: 'PUT', body });

// ---- price groups (A9b) -----------------------------------------------------------------------------------------------------------------------------
export interface GroupDraft { nameTh: string; nameEn: string; minAge: string; maxAge: string }
export const groupDraft = (g?: PriceGroup): GroupDraft => ({ nameTh: g?.nameTh ?? '', nameEn: g?.nameEn ?? '', minAge: g?.rule.min_age === undefined ? '' : String(g.rule.min_age), maxAge: g?.rule.max_age === undefined ? '' : String(g.rule.max_age) });
const AGE = (s: string): number | null | 'bad' => (s.trim() === '' ? null : /^\d{1,3}$/.test(s.trim()) && Number(s.trim()) <= 150 ? Number(s.trim()) : 'bad');
export type GroupBody = { ok: true; body: Record<string, unknown> } | { ok: false; key: string };
/** A group is told apart by age: at least one of the two ages, whole years, the first not above the second. */
export function groupBody(was: PriceGroup | undefined, now: GroupDraft): GroupBody {
  if (!namesOk(now)) return { ok: false, key: 'A-new.price_err_names' };
  const min = AGE(now.minAge);
  const max = AGE(now.maxAge);
  if (min === 'bad' || max === 'bad') return { ok: false, key: 'A-new.price_err_age' };
  if (min === null && max === null) return { ok: false, key: 'A-new.price_err_age_one' };
  if (min !== null && max !== null && min > max) return { ok: false, key: 'A-new.price_err_age_order' };
  const rule: Record<string, number> = { ...(min !== null ? { min_age: min } : {}), ...(max !== null ? { max_age: max } : {}) };
  const full: Record<string, unknown> = { nameTh: now.nameTh.trim(), nameEn: now.nameEn.trim(), rule };
  if (!was) return { ok: true, body: full };
  const body: Record<string, unknown> = {};
  if (was.nameTh !== full['nameTh']) body['nameTh'] = full['nameTh'];
  if (was.nameEn !== full['nameEn']) body['nameEn'] = full['nameEn'];
  if (was.rule.min_age !== rule['min_age'] || was.rule.max_age !== rule['max_age']) body['rule'] = rule;
  return Object.keys(body).length === 0 ? { ok: false, key: 'A-new.price_nothing_changed' } : { ok: true, body };
}
export const addGroup = (slug: string, body: Record<string, unknown>, f: Fetch) => call<PriceGroup>(slug, `${BASE}/price-groups`, f, { method: 'POST', body });
export const saveGroup = (slug: string, id: string, body: Record<string, unknown>, f: Fetch) => call<PriceGroup>(slug, `${BASE}/price-groups/${encodeURIComponent(id)}`, f, { method: 'PUT', body });
export const deleteGroup = (slug: string, id: string, f: Fetch) => call(slug, `${BASE}/price-groups/${encodeURIComponent(id)}`, f, { method: 'DELETE' });

// ---- add-ons (A9b) ----------------------------------------------------------------------------------------------------------------------------------
export interface AddOnDraft { nameTh: string; nameEn: string; price: string; active: boolean }
export const addOnDraft = (a?: AddOn): AddOnDraft => ({ nameTh: a?.nameTh ?? '', nameEn: a?.nameEn ?? '', price: satangToBaht(a?.priceSatang), active: a?.active ?? true });
export function addOnBody(was: AddOn | undefined, now: AddOnDraft): GroupBody {
  if (!namesOk(now)) return { ok: false, key: 'A-new.price_err_names' };
  const price = bahtToSatang(now.price);
  if (price === 'bad') return { ok: false, key: 'A-new.price_err_amount' };
  const full: Record<string, unknown> = { nameTh: now.nameTh.trim(), nameEn: now.nameEn.trim(), priceSatang: price, active: now.active };
  if (!was) {
    if (price === null) delete full['priceSatang']; // a price nobody set stays unset: no default is shown or sent
    return { ok: true, body: full };
  }
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) if ((was as unknown as Record<string, unknown>)[k] !== v) body[k] = v;
  return Object.keys(body).length === 0 ? { ok: false, key: 'A-new.price_nothing_changed' } : { ok: true, body };
}
export const addAddOn = (slug: string, body: Record<string, unknown>, f: Fetch) => call<AddOn>(slug, `${BASE}/add-ons`, f, { method: 'POST', body });
export const saveAddOn = (slug: string, id: string, body: Record<string, unknown>, f: Fetch) => call<AddOn>(slug, `${BASE}/add-ons/${encodeURIComponent(id)}`, f, { method: 'PUT', body });
export const deleteAddOn = (slug: string, id: string, f: Fetch) => call(slug, `${BASE}/add-ons/${encodeURIComponent(id)}`, f, { method: 'DELETE' });

// ---- errors -----------------------------------------------------------------------------------------------------------------------------------------
export const PRICE_ERROR_KEY: Record<string, string> = { in_use: 'A-new.price_err_in_use', bad_input: 'A-new.price_err_input', not_found: 'A-new.price_err_not_found', forbidden: 'A-new.price_err_forbidden' };
export function priceErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.price_err_forbidden';
  if (o.kind === 'not_found') return 'A-new.price_err_not_found';
  if (o.kind === 'refused') return PRICE_ERROR_KEY[o.code] ?? 'A-new.price_err_general';
  return 'A-new.price_err_general';
}
/** A save helper's answer: either the typed refusal of its own check or the server's. */
export function resultKey(r: Outcome<unknown> | SaveResult): string | null {
  if ('ok' in r) return r.ok ? null : r.key;
  return r.kind === 'ok' ? null : priceErrorKey(r);
}
