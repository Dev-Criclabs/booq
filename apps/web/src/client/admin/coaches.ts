import { call, type Outcome } from './api';
import { bahtToSatang, satangToBaht } from './pricing';
import { hundredths, toHundredths } from './rules';

// A7 Coaches (F11-T16; ADMIN-08; board H-A07-Coaches), apart from the screen. Reads: GET /staff/coaches (list), /staff/coaches/:id (profile, tier, consent, overrides),
// /staff/coaches/:id/pay, /staff/leave?status= and /staff/flagged-sessions (owner), /staff/leave-calendar (front desk, owner), /staff/setup/coach-tiers and
// price-groups for the names. Writes (owner): PUT /staff/coaches/:id, PUT /staff/coaches/:id/pay, POST /staff/leave/:id/decision, POST /staff/bookings/:id/substitute.
// A value left empty is "not set" and never replaced by a default; a percent is held as basis points (10% = 1000) and money as satang.

type Fetch = typeof fetch;

export interface CoachRow { coachId: string; displayName: string | null; tierId: string | null; active: boolean; published: boolean }
export interface CoachProfile {
  bioTh: string | null; bioEn: string | null; certificationsTh: string | null; certificationsEn: string | null; specialtiesTh: string[]; specialtiesEn: string[];
  agesLevelsTh: string | null; agesLevelsEn: string | null; languages: string[]; photoPath: string | null;
}
export interface CoachFull extends CoachRow { profile: CoachProfile; consentAt: string | null; overrides: Array<{ priceGroupId: string; priceSatang: number }> }
export interface CoachPay { monthlyBaseSatang: number | null; soloPayKind: 'fixed' | 'percent' | null; soloPayValue: number | null; groupPayKind: 'fixed' | 'percent' | null; groupPayValue: number | null }
export interface Leave { leaveId: string; coachId: string; startDate: string; endDate: string; fromHour: number | null; toHour: number | null; status: 'pending' | 'approved' | 'declined'; type: string | null; note: string | null }
export interface Away { leaveId: string; coachId: string; coachName: string | null; startDate: string; endDate: string; fromHour: number | null; toHour: number | null; status: 'pending' | 'approved' | 'declined' }
export interface Flagged { bookingId: string; coachId: string; resourceId: string; startAt: string; endAt: string; reason: string }
export interface Tier { id: string; nameTh: string; nameEn: string }
export interface Group { id: string; nameTh: string; nameEn: string }

const list = async <T>(slug: string, path: string, f: Fetch): Promise<Outcome<T[]>> => {
  const r = await call<T[] | null>(slug, path, f);
  return r.kind === 'ok' ? { kind: 'ok', body: r.body ?? [] } : r;
};
export const loadCoaches = (slug: string, f: Fetch) => list<CoachRow>(slug, '/staff/coaches', f);
export const loadCoach = (slug: string, id: string, f: Fetch) => call<CoachFull>(slug, `/staff/coaches/${encodeURIComponent(id)}`, f);
export const loadPay = (slug: string, id: string, f: Fetch) => call<CoachPay>(slug, `/staff/coaches/${encodeURIComponent(id)}/pay`, f);
export const loadLeave = (slug: string, f: Fetch) => list<Leave>(slug, '/staff/leave?status=pending', f);
export const loadFlagged = (slug: string, f: Fetch) => list<Flagged>(slug, '/staff/flagged-sessions', f);
export const loadAway = (slug: string, from: string, to: string, f: Fetch) => list<Away>(slug, `/staff/leave-calendar?from=${from}&to=${to}`, f);
export const loadSubstitutes = (slug: string, bookingId: string, f: Fetch) => list<CoachRow>(slug, `/staff/bookings/${encodeURIComponent(bookingId)}/substitutes`, f);
/** The names for tiers and price groups; a role that may not read them gets none and the page shows the ids' absence plainly. */
export const loadTiers = async (slug: string, f: Fetch): Promise<Tier[]> => { const r = await call<Tier[]>(slug, '/staff/setup/coach-tiers', f); return r.kind === 'ok' ? r.body : []; };
export const loadGroups = async (slug: string, f: Fetch): Promise<Group[]> => { const r = await call<Group[]>(slug, '/staff/setup/price-groups', f); return r.kind === 'ok' ? r.body : []; };

export const decideLeave = (slug: string, id: string, approve: boolean, f: Fetch) => call<{ ok: true }>(slug, `/staff/leave/${encodeURIComponent(id)}/decision`, f, { method: 'POST', body: { approve } });
export const REASONS = ['leave', 'closed_time', 'inactive', 'other'] as const;
/** The reason sent with a substitution: the flag's own reason when it is one the route takes, else "other". */
export const reasonFor = (flag: Pick<Flagged, 'reason'>): (typeof REASONS)[number] => ((REASONS as readonly string[]).includes(flag.reason) ? (flag.reason as (typeof REASONS)[number]) : 'other');
export const assign = (slug: string, bookingId: string, coachId: string, reason: (typeof REASONS)[number], f: Fetch) =>
  call<{ substitutionId: string }>(slug, `/staff/bookings/${encodeURIComponent(bookingId)}/substitute`, f, { method: 'POST', body: { coachId, reason } });

// ---- profile ----------------------------------------------------------------------------------------------------------------------------------------
export interface ProfileDraft {
  tierId: string; bioTh: string; bioEn: string; certificationsTh: string; certificationsEn: string; specialtiesTh: string; specialtiesEn: string; agesLevelsTh: string; agesLevelsEn: string; languages: string;
  consent: boolean; published: boolean; active: boolean; overrides: Record<string, string>;
}
const joined = (xs: readonly string[]) => xs.join(', ');
export const profileDraft = (c: CoachFull, groups: readonly Group[]): ProfileDraft => ({
  tierId: c.tierId ?? '', bioTh: c.profile.bioTh ?? '', bioEn: c.profile.bioEn ?? '', certificationsTh: c.profile.certificationsTh ?? '', certificationsEn: c.profile.certificationsEn ?? '',
  specialtiesTh: joined(c.profile.specialtiesTh), specialtiesEn: joined(c.profile.specialtiesEn), agesLevelsTh: c.profile.agesLevelsTh ?? '', agesLevelsEn: c.profile.agesLevelsEn ?? '', languages: joined(c.profile.languages),
  consent: c.consentAt !== null, published: c.published, active: c.active,
  overrides: Object.fromEntries(groups.map((g) => [g.id, satangToBaht(c.overrides.find((o) => o.priceGroupId === g.id)?.priceSatang)])),
});
const items = (s: string): string[] => s.split(',').map((x) => x.trim()).filter((x) => x !== '');
export type SaveBody = { ok: true; body: Record<string, unknown> } | { ok: false; key: string };
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Only what changed is sent. A profile text emptied is sent as null (not set). Consent comes first on the server, so a profile can be published in the same save. */
export function coachBody(was: CoachFull, wasDraft: ProfileDraft, now: ProfileDraft): SaveBody {
  const profile: Record<string, unknown> = {};
  const text = (key: string, a: string, b: string) => { if (a.trim() !== b.trim()) profile[key] = b.trim() === '' ? null : b.trim(); };
  text('bio_th', wasDraft.bioTh, now.bioTh); text('bio_en', wasDraft.bioEn, now.bioEn);
  text('certifications_th', wasDraft.certificationsTh, now.certificationsTh); text('certifications_en', wasDraft.certificationsEn, now.certificationsEn);
  text('ages_levels_th', wasDraft.agesLevelsTh, now.agesLevelsTh); text('ages_levels_en', wasDraft.agesLevelsEn, now.agesLevelsEn);
  const list = (key: string, a: string, b: string) => { if (!same(items(a), items(b))) profile[key] = items(b).length === 0 ? null : items(b); };
  list('specialties_th', wasDraft.specialtiesTh, now.specialtiesTh); list('specialties_en', wasDraft.specialtiesEn, now.specialtiesEn); list('languages', wasDraft.languages, now.languages);
  const body: Record<string, unknown> = {};
  if (Object.keys(profile).length > 0) body['profile'] = profile;
  if (now.tierId !== wasDraft.tierId) body['tierId'] = now.tierId === '' ? null : now.tierId;
  if (now.consent !== wasDraft.consent) body['consent'] = now.consent;
  if (now.published !== wasDraft.published) body['published'] = now.published;
  if (now.active !== wasDraft.active) body['active'] = now.active;
  const overrides: Array<{ priceGroupId: string; priceSatang: number | null }> = [];
  for (const [g, v] of Object.entries(now.overrides)) {
    if (v.trim() === (wasDraft.overrides[g] ?? '').trim()) continue;
    const s = bahtToSatang(v);
    if (s === 'bad') return { ok: false, key: 'A-new.coach_err_amount' };
    overrides.push({ priceGroupId: g, priceSatang: s });
  }
  if (overrides.length > 0) body['overrides'] = overrides;
  if (body['published'] === true && !now.consent && was.consentAt === null) return { ok: false, key: 'A-new.coach_err_consent' };
  return Object.keys(body).length === 0 ? { ok: false, key: 'A-new.coach_nothing_changed' } : { ok: true, body };
}
export const saveCoach = (slug: string, id: string, body: Record<string, unknown>, f: Fetch) => call<CoachFull>(slug, `/staff/coaches/${encodeURIComponent(id)}`, f, { method: 'PUT', body });

// ---- pay --------------------------------------------------------------------------------------------------------------------------------------------
export interface PayDraft { monthlyBase: string; soloKind: '' | 'fixed' | 'percent'; soloValue: string; groupKind: '' | 'fixed' | 'percent'; groupValue: string }
const valueText = (kind: 'fixed' | 'percent' | null, v: number | null): string => (v === null ? '' : kind === 'percent' ? hundredths(v) : satangToBaht(v));
export const payDraft = (p: CoachPay): PayDraft => ({
  monthlyBase: satangToBaht(p.monthlyBaseSatang), soloKind: p.soloPayKind ?? '', soloValue: valueText(p.soloPayKind, p.soloPayValue), groupKind: p.groupPayKind ?? '', groupValue: valueText(p.groupPayKind, p.groupPayValue),
});
function payValue(kind: '' | 'fixed' | 'percent', text: string): { kind: 'fixed' | 'percent' | null; value: number | null } | 'bad' {
  if (kind === '' && text.trim() === '') return { kind: null, value: null };
  if (kind === '' || text.trim() === '') return 'bad'; // the kind and the value are set together or not at all
  if (kind === 'percent') {
    const v = toHundredths(text);
    return v === null || v > 10000 ? 'bad' : { kind, value: v };
  }
  const s = bahtToSatang(text);
  return s === 'bad' || s === null ? 'bad' : { kind, value: s };
}
/** The whole set is sent (the route replaces it): a field left empty is not set. */
export function payBody(d: PayDraft): { ok: true; body: Record<string, unknown> } | { ok: false; key: string } {
  const base = bahtToSatang(d.monthlyBase);
  if (base === 'bad') return { ok: false, key: 'A-new.coach_err_amount' };
  const solo = payValue(d.soloKind, d.soloValue);
  const group = payValue(d.groupKind, d.groupValue);
  if (solo === 'bad' || group === 'bad') return { ok: false, key: 'A-new.coach_err_pay' };
  return { ok: true, body: { monthlyBaseSatang: base, soloPayKind: solo.kind, soloPayValue: solo.value, groupPayKind: group.kind, groupPayValue: group.value } };
}
export const savePay = (slug: string, id: string, body: Record<string, unknown>, f: Fetch) => call<CoachPay>(slug, `/staff/coaches/${encodeURIComponent(id)}/pay`, f, { method: 'PUT', body });

// ---- words ------------------------------------------------------------------------------------------------------------------------------------------
/** True when the Thai or the English half of the public profile has no text (the board's "Thai missing"). */
export const missing = (c: CoachFull): { th: boolean; en: boolean } => ({
  th: !c.profile.bioTh?.trim() && !c.profile.certificationsTh?.trim() && c.profile.specialtiesTh.length === 0,
  en: !c.profile.bioEn?.trim() && !c.profile.certificationsEn?.trim() && c.profile.specialtiesEn.length === 0,
});
export const COACH_ERROR_KEY: Record<string, string> = {
  forbidden: 'A-new.coach_err_forbidden', not_found: 'A-new.coach_err_gone', bad_input: 'A-new.coach_err_input', coach_unavailable: 'A-new.coach_err_unavailable', slot_unavailable: 'A-new.coach_err_unavailable',
  rest_rule: 'A-new.coach_err_rest', limit_reached: 'A-new.coach_err_rest', club_paused: 'A-new.coach_err_paused',
};
export function coachErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.coach_err_forbidden';
  if (o.kind === 'not_found') return 'A-new.coach_err_gone';
  if (o.kind === 'refused') return COACH_ERROR_KEY[o.code] ?? 'A-new.coach_err_general';
  return 'A-new.coach_err_general';
}
