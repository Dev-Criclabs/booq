import { call, type Outcome } from './api';
import { satangToBaht, bahtToSatang } from './pricing';
import { hundredths, toHundredths } from './rules';

// A10 Promotions (F11-T19; ADMIN-12; board H-A10-Promotions): promo codes and partners apart from the screen. Reads and writes the F04 setup routes
// (`/staff/setup/promo-codes`, `/staff/setup/partners`). A percent is held by the server as basis points (10% = 1000) and a fixed amount as satang;
// the owner types percent and baht. Nothing here supplies a value: a cap, a date or a minimum spend left empty stays unset. One code per order is a rule
// of the checkout, not of this page.

type Fetch = typeof fetch;

export const APPLIES = ['court_hour', 'coach', 'add_on', 'package', 'solo_class', 'group_class'] as const;
export type Applies = (typeof APPLIES)[number];
/** The words of each thing a code can apply to: A keys of the board where it has the text. */
export const APPLIES_KEY: Record<Applies, string> = {
  court_hour: 'A-0263', coach: 'A-new.promo_applies_coach', add_on: 'A-new.promo_applies_add_on', package: 'A-0268', solo_class: 'A-0016', group_class: 'A-0017',
};
export const AUDIENCES = ['any', 'adult', 'student'] as const;
export const AUDIENCE_KEY: Record<(typeof AUDIENCES)[number], string> = { any: 'A-0068', adult: 'A-0069', student: 'A-0070' };

export interface Partner { id: string; name: string; type: string | null; contact: string | null }
export interface Promo {
  id: string; code: string; kind: 'percent' | 'fixed'; value: number; appliesTo: Applies[]; includesAddOns: boolean; audience: (typeof AUDIENCES)[number];
  startsOn: string | null; endsOn: string | null; firstTimeOnly: boolean; totalCap: number | null; perCustomerCap: number | null; minSpendSatang: number | null;
  stackableWithBirthday: boolean; partnerId: string | null; active: boolean;
}

export async function loadPromos(slug: string, f: Fetch): Promise<Outcome<{ promos: Promo[]; partners: Partner[] }>> {
  const [p, q] = await Promise.all([call<Promo[]>(slug, '/staff/setup/promo-codes', f), call<Partner[]>(slug, '/staff/setup/partners', f)]);
  if (p.kind !== 'ok') return p as Outcome<never>;
  if (q.kind !== 'ok') return q as Outcome<never>;
  return { kind: 'ok', body: { promos: p.body, partners: q.body } };
}

// ---- promo codes ------------------------------------------------------------------------------------------------------------------------------------
export interface PromoDraft {
  code: string; kind: 'percent' | 'fixed'; amount: string; appliesTo: Applies[]; includesAddOns: boolean; audience: (typeof AUDIENCES)[number]; startsOn: string; endsOn: string;
  firstTimeOnly: boolean; totalCap: string; perCustomerCap: string; minSpend: string; stackableWithBirthday: boolean; partnerId: string; active: boolean;
}
export const promoDraft = (p?: Promo): PromoDraft => ({
  code: p?.code ?? '', kind: p?.kind ?? 'percent', amount: p ? (p.kind === 'percent' ? hundredths(p.value) : satangToBaht(p.value)) : '', appliesTo: p ? [...p.appliesTo] : [],
  includesAddOns: p?.includesAddOns ?? false, audience: p?.audience ?? 'any', startsOn: p?.startsOn ?? '', endsOn: p?.endsOn ?? '', firstTimeOnly: p?.firstTimeOnly ?? false,
  totalCap: p?.totalCap == null ? '' : String(p.totalCap), perCustomerCap: p?.perCustomerCap == null ? '' : String(p.perCustomerCap), minSpend: satangToBaht(p?.minSpendSatang),
  stackableWithBirthday: p?.stackableWithBirthday ?? false, partnerId: p?.partnerId ?? '', active: p?.active ?? true,
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CAP = (s: string): number | null | 'bad' => (s.trim() === '' ? null : /^[1-9]\d{0,8}$/.test(s.trim()) ? Number(s.trim()) : 'bad');
export type PromoBody = { ok: true; body: Record<string, unknown> } | { ok: false; key: string };

/** A new code sends what was filled in; a change sends only what changed (an emptied cap, date, minimum spend or partner is sent as null). */
export function promoBody(was: Promo | undefined, now: PromoDraft): PromoBody {
  const code = now.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code) || code.length > 200) return { ok: false, key: 'A-new.promo_err_code' };
  let value: number | null;
  if (now.kind === 'percent') {
    value = toHundredths(now.amount);
    if (value === null || value < 1 || value > 10000) return { ok: false, key: 'A-new.promo_err_percent' };
  } else {
    const s = bahtToSatang(now.amount);
    if (s === 'bad' || s === null || s < 1) return { ok: false, key: 'A-new.promo_err_fixed' };
    value = s;
  }
  if (now.appliesTo.length === 0) return { ok: false, key: 'A-new.promo_err_applies' };
  for (const d of [now.startsOn, now.endsOn]) if (d !== '' && !DAY.test(d)) return { ok: false, key: 'A-new.promo_err_date' };
  if (now.startsOn !== '' && now.endsOn !== '' && now.endsOn < now.startsOn) return { ok: false, key: 'A-new.promo_err_dates_order' };
  const total = CAP(now.totalCap);
  const per = CAP(now.perCustomerCap);
  if (total === 'bad' || per === 'bad') return { ok: false, key: 'A-new.promo_err_cap' };
  const spend = bahtToSatang(now.minSpend);
  if (spend === 'bad') return { ok: false, key: 'A-new.promo_err_spend' };
  const full: Record<string, unknown> = {
    code, kind: now.kind, value, appliesTo: APPLIES.filter((a) => now.appliesTo.includes(a)), includesAddOns: now.includesAddOns, audience: now.audience,
    startsOn: now.startsOn === '' ? null : now.startsOn, endsOn: now.endsOn === '' ? null : now.endsOn, firstTimeOnly: now.firstTimeOnly, totalCap: total, perCustomerCap: per,
    minSpendSatang: spend, stackableWithBirthday: now.stackableWithBirthday, partnerId: now.partnerId === '' ? null : now.partnerId, active: now.active,
  };
  if (!was) {
    // Left empty = not set: the optional fields are not sent at all, so the table's own "no limit" stands.
    for (const k of ['startsOn', 'endsOn', 'totalCap', 'perCustomerCap', 'minSpendSatang', 'partnerId']) if (full[k] === null) delete full[k];
    return { ok: true, body: full };
  }
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) {
    const old = (was as unknown as Record<string, unknown>)[k];
    if (k === 'appliesTo' ? JSON.stringify([...was.appliesTo].sort()) !== JSON.stringify([...(v as string[])].sort()) : (old ?? null) !== v) body[k] = v;
  }
  return Object.keys(body).length === 0 ? { ok: false, key: 'A-new.promo_nothing_changed' } : { ok: true, body };
}
export const addPromo = (slug: string, body: Record<string, unknown>, f: Fetch) => call<Promo>(slug, '/staff/setup/promo-codes', f, { method: 'POST', body });
export const savePromo = (slug: string, id: string, body: Record<string, unknown>, f: Fetch) => call<Promo>(slug, `/staff/setup/promo-codes/${encodeURIComponent(id)}`, f, { method: 'PUT', body });
export const deletePromo = (slug: string, id: string, f: Fetch) => call(slug, `/staff/setup/promo-codes/${encodeURIComponent(id)}`, f, { method: 'DELETE' });

/** The discount as read in a list: "10%" or "฿50" (the amount is the owner's, formatted, never a default). */
export const discountText = (p: Pick<Promo, 'kind' | 'value'>): { percent: string } | { satang: number } => (p.kind === 'percent' ? { percent: hundredths(p.value) } : { satang: p.value });

// ---- partners ---------------------------------------------------------------------------------------------------------------------------------------
export interface PartnerDraft { name: string; type: string; contact: string }
export const partnerDraft = (p?: Partner): PartnerDraft => ({ name: p?.name ?? '', type: p?.type ?? '', contact: p?.contact ?? '' });
export function partnerBody(was: Partner | undefined, now: PartnerDraft): PromoBody {
  const name = now.name.trim();
  if (name === '' || name.length > 200) return { ok: false, key: 'A-new.promo_err_partner_name' };
  const type = now.type.trim();
  const contact = now.contact.trim();
  if (type.length > 200 || contact.length > 200) return { ok: false, key: 'A-new.promo_err_partner_long' };
  const full: Record<string, unknown> = { name, type: type === '' ? null : type, contact: contact === '' ? null : contact };
  if (!was) {
    if (full['type'] === null) delete full['type'];
    if (full['contact'] === null) delete full['contact'];
    return { ok: true, body: full };
  }
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) if (((was as unknown as Record<string, unknown>)[k] ?? null) !== v) body[k] = v;
  return Object.keys(body).length === 0 ? { ok: false, key: 'A-new.promo_nothing_changed' } : { ok: true, body };
}
export const addPartner = (slug: string, body: Record<string, unknown>, f: Fetch) => call<Partner>(slug, '/staff/setup/partners', f, { method: 'POST', body });
export const savePartner = (slug: string, id: string, body: Record<string, unknown>, f: Fetch) => call<Partner>(slug, `/staff/setup/partners/${encodeURIComponent(id)}`, f, { method: 'PUT', body });
export const deletePartner = (slug: string, id: string, f: Fetch) => call(slug, `/staff/setup/partners/${encodeURIComponent(id)}`, f, { method: 'DELETE' });

// ---- errors -----------------------------------------------------------------------------------------------------------------------------------------
export const PROMO_ERROR_KEY: Record<string, string> = {
  duplicate: 'A-new.promo_err_duplicate', in_use: 'A-new.promo_err_in_use', bad_input: 'A-new.promo_err_input', not_found: 'A-new.promo_err_not_found', forbidden: 'A-new.promo_err_forbidden',
};
export function promoErrorKey(o: Outcome<unknown>): string | null {
  if (o.kind === 'ok') return null;
  if (o.kind === 'forbidden') return 'A-new.promo_err_forbidden';
  if (o.kind === 'not_found') return 'A-new.promo_err_not_found';
  if (o.kind === 'refused') return PROMO_ERROR_KEY[o.code] ?? 'A-new.promo_err_general';
  return 'A-new.promo_err_general';
}
