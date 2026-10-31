import { call, type Outcome } from './api';
import { bahtToSatang, satangToBaht } from './pricing';
import { addDays } from './calendar';

// A8 Group classes (F11-T17; ADMIN-09; board H-A08-Group-classes), apart from the screen. Reads: GET /staff/class-templates, GET /staff/class-sessions?from=&to=&status=
// (up to 62 days, with seats taken and the waiting count), GET /staff/class-sessions/:id/roster, GET /staff/waitlist?sessionId=. Writes: templates (owner) POST and PUT
// /staff/class-templates, PUT {end:true} to end one; sessions PUT /staff/class-sessions/:id (owner), POST .../cancel (front desk, owner; every seat gets its full value back
// and a LINE message) and POST .../resolve (owner). A class is 60 minutes on the hour. A price left empty is "not set".

type Fetch = typeof fetch;

export interface Template {
  id: string; nameTh: string; nameEn: string; audience: 'adult' | 'student' | string; level: string | null; coachId: string; resourceId: string; weekday: number; startTime: string;
  durationMinutes: number; minPlayers: number; maxPlayers: number; dropInPriceSatang: number | null; active: boolean; endedOn: string | null;
}
export interface Session {
  id: string; templateId: string; startAt: string; endAt: string; nameTh: string; nameEn: string; audience: string; level: string | null; coachId: string; resourceId: string; minPlayers: number;
  maxPlayers: number; dropInPriceSatang: number | null; status: 'scheduled' | 'needs_attention' | 'cancelled' | string; attentionReason: string | null; cancelReason: string | null; edited: boolean; taken: number; waiting: number;
}
export interface RosterRow { bookingId: string; customerId: string; displayName: string | null; status: string; holdExpiresAt: string | null }
export interface WaitRow { entryId: string; customerId: string; displayName: string | null; position: number; status: string; offerExpiresAt: string | null }

const list = async <T>(slug: string, path: string, f: Fetch): Promise<Outcome<T[]>> => {
  const r = await call<T[] | null>(slug, path, f);
  return r.kind === 'ok' ? { kind: 'ok', body: r.body ?? [] } : r;
};
export const loadTemplates = (slug: string, f: Fetch) => list<Template>(slug, '/staff/class-templates', f);
export const loadSessions = (slug: string, from: string, to: string, f: Fetch) => list<Session>(slug, `/staff/class-sessions?from=${from}&to=${to}`, f);
export const loadRoster = (slug: string, id: string, f: Fetch) => list<RosterRow>(slug, `/staff/class-sessions/${encodeURIComponent(id)}/roster`, f);
export const loadWaitlist = (slug: string, id: string, f: Fetch) => list<WaitRow>(slug, `/staff/waitlist?sessionId=${encodeURIComponent(id)}`, f);
export const cancelSession = (slug: string, id: string, reason: 'below_minimum' | 'owner', f: Fetch) => call<{ seats: number; entries: number }>(slug, `/staff/class-sessions/${encodeURIComponent(id)}/cancel`, f, { method: 'POST', body: { reason } });
export const resolveSession = (slug: string, id: string, f: Fetch) => call<{ resolved: boolean; reason: string | null }>(slug, `/staff/class-sessions/${encodeURIComponent(id)}/resolve`, f, { method: 'POST', body: {} });

/** A session with fewer seats taken than its minimum, still to come and not cancelled (the board's BELOW MINIMUM). */
export const belowMinimum = (s: Session, now: string): boolean => s.status !== 'cancelled' && s.startAt > now && s.taken < s.minPlayers;
export const weekOf = (today: string, offset: number): { from: string; to: string } => {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday
  const monday = addDays(today, 1 - (dow === 0 ? 7 : dow));
  const from = addDays(monday, offset * 7);
  return { from, to: addDays(from, 6) };
};

// ---- templates --------------------------------------------------------------------------------------------------------------------------------------
export interface TemplateDraft {
  nameTh: string; nameEn: string; audience: 'adult' | 'student'; level: string; coachId: string; resourceId: string; weekday: string; startHour: string; minPlayers: string; maxPlayers: string; dropIn: string;
}
export const blankTemplate = (): TemplateDraft => ({ nameTh: '', nameEn: '', audience: 'adult', level: '', coachId: '', resourceId: '', weekday: '', startHour: '', minPlayers: '', maxPlayers: '', dropIn: '' });
export const templateDraft = (t: Template): TemplateDraft => ({
  nameTh: t.nameTh, nameEn: t.nameEn, audience: t.audience === 'student' ? 'student' : 'adult', level: t.level ?? '', coachId: t.coachId, resourceId: t.resourceId, weekday: String(t.weekday),
  startHour: String(Number(t.startTime.slice(0, 2))), minPlayers: String(t.minPlayers), maxPlayers: String(t.maxPlayers), dropIn: satangToBaht(t.dropInPriceSatang),
});
const WHOLE = (s: string, min: number, max: number): number | null => (/^\d{1,3}$/.test(s.trim()) && Number(s.trim()) >= min && Number(s.trim()) <= max ? Number(s.trim()) : null);
export type TemplateBody = { ok: true; body: Record<string, unknown> } | { ok: false; key: string };
/** A new template sends every field; a change only what changed. The class is 60 minutes on the hour; min is at most max. A drop-in price left empty is not set. */
export function templateBody(was: Template | undefined, now: TemplateDraft): TemplateBody {
  if (now.nameTh.trim() === '' || now.nameEn.trim() === '') return { ok: false, key: 'A-new.cls_err_names' };
  if (now.coachId === '') return { ok: false, key: 'A-new.cls_err_coach' };
  if (now.resourceId === '') return { ok: false, key: 'A-new.cls_err_court' };
  const weekday = WHOLE(now.weekday, 0, 6);
  if (weekday === null || now.weekday.trim() === '') return { ok: false, key: 'A-new.cls_err_weekday' };
  const hour = WHOLE(now.startHour, 0, 23);
  if (hour === null || now.startHour.trim() === '') return { ok: false, key: 'A-new.cls_err_hour' };
  const min = WHOLE(now.minPlayers, 1, 200);
  const max = WHOLE(now.maxPlayers, 1, 200);
  if (min === null || max === null) return { ok: false, key: 'A-new.cls_err_players' };
  if (min > max) return { ok: false, key: 'A-new.cls_err_minmax' };
  const price = bahtToSatang(now.dropIn);
  if (price === 'bad') return { ok: false, key: 'A-new.cls_err_price' };
  const full: Record<string, unknown> = {
    nameTh: now.nameTh.trim(), nameEn: now.nameEn.trim(), audience: now.audience, level: now.level.trim() === '' ? null : now.level.trim(), coachId: now.coachId, resourceId: now.resourceId, weekday,
    startTime: `${String(hour).padStart(2, '0')}:00`, durationMinutes: 60, minPlayers: min, maxPlayers: max, dropInPriceSatang: price,
  };
  if (!was) return { ok: true, body: full };
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) if (k !== 'durationMinutes' && (was as unknown as Record<string, unknown>)[k] !== v) body[k] = v;
  return Object.keys(body).length === 0 ? { ok: false, key: 'A-new.cls_nothing_changed' } : { ok: true, body };
}
export const createTemplate = (slug: string, body: Record<string, unknown>, f: Fetch) => call<{ id: string; made: number; needsAttention: number }>(slug, '/staff/class-templates', f, { method: 'POST', body });
export const updateTemplate = (slug: string, id: string, body: Record<string, unknown>, f: Fetch) => call<{ rewritten: number; cancelled: number; generated: number }>(slug, `/staff/class-templates/${encodeURIComponent(id)}`, f, { method: 'PUT', body });
export const endTemplate = (slug: string, id: string, f: Fetch) => call<{ ended: boolean; cancelled: number; failed: number }>(slug, `/staff/class-templates/${encodeURIComponent(id)}`, f, { method: 'PUT', body: { end: true } });

// ---- a session's own edit (owner) ------------------------------------------------------------------------------------------------------------------
export interface SessionDraft { coachId: string; resourceId: string; minPlayers: string; maxPlayers: string; dropIn: string }
export const sessionDraft = (s: Session): SessionDraft => ({ coachId: s.coachId, resourceId: s.resourceId, minPlayers: String(s.minPlayers), maxPlayers: String(s.maxPlayers), dropIn: satangToBaht(s.dropInPriceSatang) });
export function sessionBody(was: Session, now: SessionDraft): TemplateBody {
  const min = WHOLE(now.minPlayers, 1, 200);
  const max = WHOLE(now.maxPlayers, 1, 200);
  if (min === null || max === null) return { ok: false, key: 'A-new.cls_err_players' };
  if (min > max) return { ok: false, key: 'A-new.cls_err_minmax' };
  const price = bahtToSatang(now.dropIn);
  if (price === 'bad') return { ok: false, key: 'A-new.cls_err_price' };
  const body: Record<string, unknown> = {};
  if (now.coachId !== was.coachId) body['coachId'] = now.coachId;
  if (now.resourceId !== was.resourceId) body['resourceId'] = now.resourceId;
  if (min !== was.minPlayers) body['minPlayers'] = min;
  if (max !== was.maxPlayers) body['maxPlayers'] = max;
  if (price !== was.dropInPriceSatang) body['dropInPriceSatang'] = price;
  return Object.keys(body).length === 0 ? { ok: false, key: 'A-new.cls_nothing_changed' } : { ok: true, body };
}
export const editSession = (slug: string, id: string, body: Record<string, unknown>, f: Fetch) => call<{ edited: boolean }>(slug, `/staff/class-sessions/${encodeURIComponent(id)}`, f, { method: 'PUT', body });

export const STATUS_KEY: Record<string, string> = { scheduled: 'A-new.cls_status_scheduled', needs_attention: 'A-new.cls_status_attention', cancelled: 'A-new.cls_status_cancelled' };
export const CLASS_ERROR_KEY: Record<string, string> = {
  forbidden: 'A-new.cls_err_forbidden', not_found: 'A-new.cls_err_gone', bad_input: 'A-new.cls_err_input', template_clash: 'A-new.cls_err_clash', court_clash: 'A-new.cls_err_court_clash', coach_clash: 'A-new.cls_err_coach_clash',
  coach_leave: 'A-new.cls_err_leave', coach_rest: 'A-new.cls_err_rest', below_taken: 'A-new.cls_err_taken', booking_window_unset: 'A-new.cls_err_window',
};
export function classErrorKey(o: Outcome<unknown>): { key: string; dates?: string } {
  if (o.kind === 'forbidden') return { key: 'A-new.cls_err_forbidden' };
  if (o.kind === 'not_found') return { key: 'A-new.cls_err_gone' };
  if (o.kind === 'refused') {
    const dates = typeof o.params?.['dates'] === 'string' ? (o.params['dates'] as string) : undefined;
    return { key: CLASS_ERROR_KEY[o.code] ?? 'A-new.cls_err_general', ...(dates ? { dates } : {}) };
  }
  return { key: 'A-new.cls_err_general' };
}
