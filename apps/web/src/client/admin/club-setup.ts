import { call, type Outcome } from './api';

// A16 Settings (F11-T22; ADMIN-16; board H-A16-Settings): the club's own setup, apart from the screen. Reads GET /club/setup (business and tax details,
// VAT, hours, courts, the support window) and the settings list GET /settings; writes PUT /club/business, PUT /hours, POST /resources, PUT
// /resources/:id, PUT /settings/:key and PUT /support-window. Every change is audited by the server with the owner as actor. Nothing here supplies a
// value: an empty field stays empty and a detail cannot be cleared.

type Fetch = typeof fetch;

export interface Business {
  legal_name: string | null;
  tax_id: string | null;
  tax_branch: string | null;
  registered_address: string | null;
  receipt_prefix: string | null;
  vat_enabled: boolean | null;
}
export interface HoursRow { weekday: number; open: string; close: string }
export interface Location { id: string; name: string }
export interface Court { id: string; location_id: string; name: string; sport: string; type: string | null; lights: boolean; max_players: number | null; active: boolean }
export interface ClubSetup {
  business: Business;
  hours?: HoursRow[];
  locations?: Location[];
  resources?: Court[];
  supportWindowUntil?: string | null;
}

export const loadClubSetup = (slug: string, f: Fetch) => call<ClubSetup>(slug, '/club/setup', f);

// ---- business and tax -----------------------------------------------------------------------------------------------------------------------------
export const BUSINESS_FIELDS = ['legal_name', 'tax_id', 'tax_branch', 'registered_address'] as const;
export type BusinessField = (typeof BUSINESS_FIELDS)[number];
export type BusinessDraft = Record<BusinessField, string> & { vat: 'on' | 'off' | '' };
export const businessDraft = (b: Business): BusinessDraft => ({
  legal_name: b.legal_name ?? '', tax_id: b.tax_id ?? '', tax_branch: b.tax_branch ?? '', registered_address: b.registered_address ?? '',
  vat: b.vat_enabled === true ? 'on' : b.vat_enabled === false ? 'off' : '',
});
export type BusinessPatch = { ok: true; body: Record<string, unknown> } | { ok: false; field: BusinessField | 'vat'; key: string };
/** Only what changed is sent. A detail cannot be cleared (a receipt needs it) and the tax ID is 13 digits, as the route requires. */
export function businessPatch(was: BusinessDraft, now: BusinessDraft): BusinessPatch {
  const body: Record<string, unknown> = {};
  for (const f of BUSINESS_FIELDS) {
    const v = now[f].trim();
    if (v === was[f].trim()) continue;
    if (v === '') return { ok: false, field: f, key: 'A-new.set_err_empty' };
    if (f === 'tax_id' && !/^\d{13}$/.test(v)) return { ok: false, field: f, key: 'A-new.set_err_tax_id' };
    body[f] = v;
  }
  if (now.vat !== was.vat) {
    if (now.vat === '') return { ok: false, field: 'vat', key: 'A-new.set_err_empty' };
    body['vat_enabled'] = now.vat === 'on';
  }
  return Object.keys(body).length === 0 ? { ok: false, field: 'legal_name', key: 'A-new.set_nothing_changed' } : { ok: true, body };
}
export const saveBusiness = (slug: string, body: Record<string, unknown>, f: Fetch) => call<Business>(slug, '/club/business', f, { method: 'PUT', body });

// ---- opening hours --------------------------------------------------------------------------------------------------------------------------------
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export interface DayDraft { open: string; close: string; closed: boolean }
export type HoursDraft = Record<number, DayDraft>;
export const hoursDraft = (rows: readonly HoursRow[]): HoursDraft =>
  Object.fromEntries(WEEKDAYS.map((d) => {
    const r = rows.find((x) => x.weekday === d);
    return [d, r ? { open: r.open, close: r.close, closed: false } : { open: '', close: '', closed: true }];
  }));
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export type HoursPatch = { ok: true; hours: Array<Record<string, unknown>> } | { ok: false; weekday: number; key: string };
/** Days that changed, in the form PUT /hours takes: a closed day, or open and close (close may be 24:00, and must be later than open). */
export function hoursPatch(was: HoursDraft, now: HoursDraft): HoursPatch {
  const hours: Array<Record<string, unknown>> = [];
  for (const d of WEEKDAYS) {
    const a = was[d]!;
    const b = now[d]!;
    if (a.closed === b.closed && (b.closed || (a.open === b.open.trim() && a.close === b.close.trim()))) continue;
    if (b.closed) { hours.push({ weekday: d, closed: true }); continue; }
    const open = b.open.trim();
    const close = b.close.trim();
    if (open === '' || close === '') return { ok: false, weekday: d, key: 'A-new.set_hours_both' };
    if (!TIME.test(open) || !(TIME.test(close) || close === '24:00')) return { ok: false, weekday: d, key: 'A-new.set_hours_format' };
    if (open >= close) return { ok: false, weekday: d, key: 'A-new.set_hours_order' };
    hours.push({ weekday: d, open, close });
  }
  return hours.length === 0 ? { ok: false, weekday: 1, key: 'A-new.set_nothing_changed' } : { ok: true, hours };
}
export const saveHours = (slug: string, hours: Array<Record<string, unknown>>, f: Fetch) => call<{ hours: HoursRow[] }>(slug, '/hours', f, { method: 'PUT', body: { hours } });

// ---- courts ---------------------------------------------------------------------------------------------------------------------------------------
export const SPORTS = ['tennis', 'padel', 'pickleball', 'badminton'] as const;
export const COURT_TYPES = ['outdoor', 'indoor'] as const;
export interface CourtDraft { name: string; sport: string; type: string; lights: boolean; max_players: string; active: boolean }
export const courtDraft = (c: Court): CourtDraft => ({ name: c.name, sport: c.sport, type: c.type ?? '', lights: c.lights, max_players: c.max_players === null ? '' : String(c.max_players), active: c.active });
/** The court name holds only the label: players see "Court {label}" (A-0019). A name that already starts with the word would show it twice. */
export const COURT_WORD = /^\s*(court|คอร์ต)\b/i;
export const courtLabelDoubles = (name: string): boolean => COURT_WORD.test(name);
export type CourtProblem = 'A-new.set_court_name' | 'A-new.set_court_doubles' | 'A-new.set_court_players';
export function checkCourt(d: CourtDraft): CourtProblem | null {
  if (d.name.trim() === '') return 'A-new.set_court_name';
  if (courtLabelDoubles(d.name)) return 'A-new.set_court_doubles';
  if (d.max_players.trim() !== '' && !/^[1-9]\d{0,2}$/.test(d.max_players.trim())) return 'A-new.set_court_players';
  return null;
}
/** The fields of a court that changed, as PUT /resources/:id takes them (the id goes in the body). */
export function courtChanges(was: CourtDraft, now: CourtDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (now.name.trim() !== was.name) out['name'] = now.name.trim();
  if (now.sport !== was.sport) out['sport'] = now.sport;
  if (now.type !== was.type && now.type !== '') out['type'] = now.type;
  if (now.lights !== was.lights) out['lights'] = now.lights;
  if (now.max_players.trim() !== was.max_players && now.max_players.trim() !== '') out['max_players'] = Number(now.max_players.trim());
  if (now.active !== was.active) out['active'] = now.active;
  return out;
}
export const saveCourt = (slug: string, id: string, changes: Record<string, unknown>, f: Fetch) => call<{ id: string }>(slug, `/resources/${encodeURIComponent(id)}`, f, { method: 'PUT', body: { id, ...changes } });
export const addCourt = (slug: string, d: CourtDraft & { location_id: string }, f: Fetch) =>
  call<{ id: string }>(slug, '/resources', f, {
    method: 'POST',
    body: { location_id: d.location_id, name: d.name.trim(), sport: d.sport, ...(d.type ? { type: d.type } : {}), lights: d.lights, ...(d.max_players.trim() ? { max_players: Number(d.max_players.trim()) } : {}) },
  });

// ---- support window -------------------------------------------------------------------------------------------------------------------------------
export const setSupportWindow = (slug: string, on: boolean, f: Fetch) => call<{ on: boolean; until: string | null }>(slug, '/support-window', f, { method: 'PUT', body: { on } });
export const windowOpen = (until: string | null | undefined, now: Date): boolean => !!until && Date.parse(until) > now.getTime();

/** The words of a refusal of these routes. */
export const SET_ERROR_KEY: Record<string, string> = {
  live_bookings_exist: 'A-new.set_err_live_bookings', invalid_input: 'A-new.set_err_input', forbidden: 'A-new.set_err_forbidden', not_found: 'A-new.set_err_not_found',
};
export function setErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.set_err_forbidden';
  if (o.kind === 'not_found') return 'A-new.set_err_not_found';
  if (o.kind === 'refused') return SET_ERROR_KEY[o.code] ?? 'A-new.set_err_general';
  return 'A-new.set_err_general';
}
