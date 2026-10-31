import { errorKey, type Failure, type SupportSetup } from './club';

// The support view's editing (P3b): opening hours, courts and switches of a Draft or Testing club (or a club inside the owner's
// window). Apart from the screen so it can be tested without a browser. Only what changed is sent. The API is
// PUT /clubs/{id}/support/setup/resources-hours ({hours} and {resources}) and .../features ({features}); there is no API yet to delete
// a court (it is switched off instead), to add a location, or to write club settings.

type Fetch = typeof fetch;
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const SPORTS = ['tennis', 'padel', 'pickleball', 'badminton'] as const;
export const COURT_TYPES = ['outdoor', 'indoor'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type HoursDraft = Record<number, { open: string; close: string }>;
export const trimSeconds = (t: string): string => t.slice(0, 5);
export function hoursDraft(hours: SupportSetup['hours']): HoursDraft {
  const out: HoursDraft = {};
  for (const d of WEEKDAYS) {
    const h = hours.find((x) => x.weekday === d);
    out[d] = { open: h ? trimSeconds(h.open) : '', close: h ? trimSeconds(h.close) : '' };
  }
  return out;
}

export type HoursPatch = { ok: true; hours: Array<{ weekday: number; open: string; close: string }> } | { ok: false; weekday: number; key: 'X-new.support_hours_both' | 'X-new.support_hours_format' | 'X-new.support_hours_order' };
export function hoursPatch(was: HoursDraft, now: HoursDraft): HoursPatch {
  const hours: Array<{ weekday: number; open: string; close: string }> = [];
  for (const d of WEEKDAYS) {
    const a = now[d]!;
    const b = was[d]!;
    if (a.open === b.open && a.close === b.close) continue;
    if (a.open.trim() === '' || a.close.trim() === '') return { ok: false, weekday: d, key: 'X-new.support_hours_both' };
    const open = a.open.trim();
    const close = a.close.trim();
    if (!HHMM.test(open) || !(HHMM.test(close) || close === '24:00')) return { ok: false, weekday: d, key: 'X-new.support_hours_format' };
    if (open >= close) return { ok: false, weekday: d, key: 'X-new.support_hours_order' };
    hours.push({ weekday: d, open, close });
  }
  return { ok: true, hours };
}

export interface CourtDraft { name: string; sport: string; type: string; lights: boolean; max_players: string; active: boolean }
export const courtDraft = (r: SupportSetup['resources'][number]): CourtDraft => ({
  name: r.name, sport: r.sport, type: r.type ?? '', lights: r.lights === true, max_players: r.max_players == null ? '' : String(r.max_players), active: r.active,
});
export type CourtsPatch = { ok: true; resources: Array<Record<string, unknown>> } | { ok: false; id: string; key: 'X-new.support_court_name' | 'X-new.support_court_players_bad' };
export function courtsPatch(was: Record<string, CourtDraft>, now: Record<string, CourtDraft>): CourtsPatch {
  const resources: Array<Record<string, unknown>> = [];
  for (const id of Object.keys(now)) {
    const a = now[id]!;
    const b = was[id];
    if (!b) continue;
    const change: Record<string, unknown> = {};
    if (a.name !== b.name) change['name'] = a.name.trim();
    if (a.sport !== b.sport) change['sport'] = a.sport;
    if (a.type !== b.type) change['type'] = a.type === '' ? null : a.type;
    if (a.lights !== b.lights) change['lights'] = a.lights;
    if (a.active !== b.active) change['active'] = a.active;
    if (a.max_players !== b.max_players) {
      if (a.max_players.trim() === '') change['max_players'] = null;
      else if (!/^[1-9][0-9]{0,2}$/.test(a.max_players.trim())) return { ok: false, id, key: 'X-new.support_court_players_bad' };
      else change['max_players'] = Number(a.max_players.trim());
    }
    if (change['name'] === '') return { ok: false, id, key: 'X-new.support_court_name' };
    if (Object.keys(change).length) resources.push({ id, ...change });
  }
  return { ok: true, resources };
}

/** The switches that apply to this club: those every club has, and those that need the payment option it chose. A switch with no row is off. */
export function applicableSwitches(support: SupportSetup): Array<{ key: string; enabled: boolean }> {
  const option = support.club['payment_option'] ?? null;
  const have = new Map(support.features.map((f) => [f.feature_key, f.enabled]));
  const catalogue = support.featureKeys ?? support.features.map((f) => ({ feature_key: f.feature_key, requires_payment_option: null }));
  return catalogue.filter((k) => k.requires_payment_option === null || k.requires_payment_option === option).map((k) => ({ key: k.feature_key, enabled: have.get(k.feature_key) ?? false }));
}
export const featuresPatch = (was: Record<string, boolean>, now: Record<string, boolean>): Record<string, boolean> =>
  Object.fromEntries(Object.entries(now).filter(([k, v]) => was[k] !== undefined && was[k] !== v));

export function newLocation(name: string): { ok: true; location: { name: string } } | { ok: false; key: 'X-new.support_location_name' } {
  const n = name.trim();
  return n === '' || n.length > 100 ? { ok: false, key: 'X-new.support_location_name' } : { ok: true, location: { name: n } };
}

const down: Failure = { kind: 'error', key: 'X-new.club_unavailable' };
export async function saveSection(f: Fetch, id: string, section: 'resources-hours' | 'features', body: unknown): Promise<{ kind: 'saved' } | Failure> {
  try {
    const res = await f(`/api/clubs/${encodeURIComponent(id)}/support/setup/${section}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 200) return { kind: 'saved' };
    const json = (await res.json().catch(() => ({}))) as { code?: string };
    return { kind: 'error', key: errorKey(res.status, json.code), ...(json.code === 'step_up_required' ? { stepUp: true } : {}), ...(res.status === 401 ? { signIn: true } : {}) };
  } catch {
    return down;
  }
}

/** A new court goes into the club's first location; with no location it cannot be added here yet. */
export function newCourt(locations: SupportSetup['locations'], input: { name: string; sport: string }): { ok: true; resource: Record<string, unknown> } | { ok: false; key: 'X-new.support_court_no_location' | 'X-new.support_court_name' } {
  const loc = locations[0];
  if (!loc) return { ok: false, key: 'X-new.support_court_no_location' };
  if (input.name.trim() === '') return { ok: false, key: 'X-new.support_court_name' };
  return { ok: true, resource: { location_id: loc.id, name: input.name.trim(), sport: input.sport } };
}
