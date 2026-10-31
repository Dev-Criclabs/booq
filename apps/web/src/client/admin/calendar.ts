import { call, type Outcome } from './api';
import { bangkokParts } from './time';

// A1 Calendar (F11-T13; ADMIN-03; boards H-A01-Calendar, F3-01-A01-Calendar), apart from the screen. One column per active court, one row per hour of the
// club's opening hours, a day or a week (at most 7 days a call). Reads GET /courts (courts, opening hours, today by the server's clock) and GET
// /staff/calendar?from=&to=; the one write is PUT /staff/bookings/:id/move {courtId, start}. All times are Asia/Bangkok. The calendar is a read and can
// show a cell that was just taken, so a refused move reloads the day. Names only: no phone and no date of birth ever reach this page.

type Fetch = typeof fetch;

export interface Cell {
  resourceId: string;
  resourceName: string;
  startAt: string;
  endAt: string;
  kind: 'court_booking' | 'solo_class' | 'group_class' | 'closure' | string;
  state: 'confirmed' | 'held';
  holdExpiresAt: string | null;
  bookingId: string | null;
  bookingStatus: string | null;
  bookingSource: 'online' | 'staff' | string | null;
  customerId: string | null;
  customerName: string | null;
  coachId: string | null;
  coachName: string | null;
  classSessionId: string | null;
  classNameTh: string | null;
  classNameEn: string | null;
  closureId: string | null;
}
export interface CourtInfo { id: string; name: string; sport: string }
export interface Courts { status: string; today: string; courts: CourtInfo[]; openingHours: Array<{ weekday: number; open: string; close: string }> }

export const loadCourts = (slug: string, f: Fetch) => call<Courts>(slug, '/courts', f);
export const loadCells = (slug: string, from: string, to: string, f: Fetch) => call<Cell[] | null>(slug, `/staff/calendar?from=${from}&to=${to}`, f);
export const moveBooking = (slug: string, bookingId: string, courtId: string, start: string, f: Fetch) =>
  call<unknown>(slug, `/staff/bookings/${encodeURIComponent(bookingId)}/move`, f, { method: 'PUT', body: { courtId, start } });

// ---- days ---------------------------------------------------------------------------------------------------------------------------------------
const MS = 86_400_000;
const utc = (day: string): number => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number): string => new Date(utc(day) + n * MS).toISOString().slice(0, 10);
/** 1 = Monday to 7 = Sunday, as the opening hours number their days. */
export const isoWeekday = (day: string): number => ((new Date(utc(day)).getUTCDay() + 6) % 7) + 1;
export const weekStart = (day: string): string => addDays(day, 1 - isoWeekday(day));
export const rangeOf = (view: 'day' | 'week', day: string): { from: string; to: string; days: string[] } => {
  const from = view === 'day' ? day : weekStart(day);
  const n = view === 'day' ? 1 : 7;
  return { from, to: addDays(from, n - 1), days: Array.from({ length: n }, (_, i) => addDays(from, i)) };
};
/** The next or previous day, or week. */
export const shift = (view: 'day' | 'week', day: string, dir: 1 | -1): string => addDays(day, dir * (view === 'day' ? 1 : 7));

// ---- hours --------------------------------------------------------------------------------------------------------------------------------------
const hourOfTime = (hhmm: string): number => Number(hhmm.slice(0, 2));
/** The hours a day is open as [first start hour, last start hour] (a 24:00 close ends at 23:00); null when closed. */
export function openHours(c: Pick<Courts, 'openingHours'>, day: string): { first: number; last: number } | null {
  const h = c.openingHours.find((x) => x.weekday === isoWeekday(day));
  if (!h) return null;
  const first = hourOfTime(h.open);
  const last = (h.close === '24:00' ? 24 : hourOfTime(h.close)) - 1;
  return last >= first ? { first, last } : null;
}
/** The rows of the grid: every hour any shown day is open. Empty when the club is closed on all of them. */
export function rowHours(c: Pick<Courts, 'openingHours'>, days: readonly string[]): number[] {
  const hs = days.map((d) => openHours(c, d)).filter((x): x is { first: number; last: number } => !!x);
  if (hs.length === 0) return [];
  const first = Math.min(...hs.map((x) => x.first));
  const last = Math.max(...hs.map((x) => x.last));
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
export const isOpenAt = (c: Pick<Courts, 'openingHours'>, day: string, hour: number): boolean => {
  const h = openHours(c, day);
  return !!h && hour >= h.first && hour <= h.last;
};
export const hourLabel = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;
/** The instant an hour of a day begins, as the move route takes it. */
export const startOf = (day: string, hour: number): string => `${day}T${String(hour).padStart(2, '0')}:00:00+07:00`;

/** The Bangkok day and hour a cell starts in. */
export function whenOf(cell: Pick<Cell, 'startAt'>): { day: string; hour: number } | null {
  const p = bangkokParts(cell.startAt);
  return p ? { day: p.day, hour: Number(p.time.slice(0, 2)) } : null;
}
export function cellAt(cells: readonly Cell[], courtId: string, day: string, hour: number): Cell | undefined {
  return cells.find((c) => {
    if (c.resourceId !== courtId) return false;
    const w = whenOf(c);
    return !!w && w.day === day && w.hour === hour;
  });
}

// ---- what a cell shows -------------------------------------------------------------------------------------------------------------------------
export type CellLook = { tone: 'online' | 'staff' | 'awaiting' | 'solo' | 'group' | 'closed'; key: string; vars: Record<string, string> };
/** The words and colour of a cell, from the key of the board: Closed, Awaiting payment, coach with player, class and coach, or the player's name. */
export function lookOf(c: Cell, lang: 'th' | 'en'): CellLook {
  const player = c.customerName ?? '';
  const coach = c.coachName ?? '';
  if (c.kind === 'closure') return { tone: 'closed', key: 'A-0018', vars: {} };
  if (c.kind === 'solo_class') return { tone: 'solo', key: 'A-0029', vars: { coachName: coach, playerName: player } };
  if (c.kind === 'group_class') return { tone: 'group', key: 'A-new.cal_class', vars: { className: (lang === 'th' ? c.classNameTh : c.classNameEn) ?? '', coachName: coach } };
  if (c.state === 'held') return { tone: 'awaiting', key: 'A-new.cal_awaiting', vars: { playerName: player } };
  return { tone: c.bookingSource === 'staff' ? 'staff' : 'online', key: 'A-new.cal_player', vars: { playerName: player } };
}
/** A booking the staff can move: a confirmed court booking (a class, a closure or an unpaid hold is not moved here). */
export const movable = (c: Cell): boolean => c.kind === 'court_booking' && c.state === 'confirmed' && !!c.bookingId;

/** The numbers of the summary line of the day: distinct bookings and closed hours. */
export function dayCounts(cells: readonly Cell[], day: string): { count: number; closed: number } {
  const ids = new Set<string>();
  let closed = 0;
  for (const c of cells) {
    if (whenOf(c)?.day !== day) continue;
    if (c.kind === 'closure') closed += 1;
    else if (c.bookingId) ids.add(c.bookingId);
  }
  return { count: ids.size, closed };
}

// ---- refusals -----------------------------------------------------------------------------------------------------------------------------------
export const MOVE_ERROR_KEY: Record<string, string> = {
  slot_unavailable: 'A-new.cal_err_taken', coach_unavailable: 'A-new.cal_err_coach', rest_rule: 'A-new.cal_err_rest', limit_reached: 'A-new.cal_err_rest', hour_started: 'A-new.cal_err_started',
  in_the_past: 'A-new.cal_err_started', outside_window: 'A-new.cal_err_window', club_paused: 'A-new.cal_err_paused', forbidden: 'A-new.cal_err_forbidden', not_found: 'A-new.cal_err_gone',
  bad_input: 'A-new.cal_err_general',
};
export function moveErrorKey(o: Outcome<unknown>): { key: string; vars: Record<string, string | number> } {
  if (o.kind === 'forbidden') return { key: 'A-new.cal_err_forbidden', vars: {} };
  if (o.kind === 'not_found') return { key: 'A-new.cal_err_gone', vars: {} };
  if (o.kind === 'refused') {
    const hours = o.params?.['hours'];
    return { key: MOVE_ERROR_KEY[o.code] ?? 'A-new.cal_err_general', vars: typeof hours === 'number' ? { hours } : {} };
  }
  return { key: 'A-new.cal_err_general', vars: {} };
}
/** A refusal that means the grid is out of date: the day is read again. */
export const staleAfter = (o: Outcome<unknown>): boolean => o.kind === 'refused' && ['slot_unavailable', 'coach_unavailable', 'hour_started', 'not_found'].includes(o.code);

/** The page a click on an empty hour opens (A2 Booking create, F11-T14). */
export const createPath = (slug: string, courtId: string, day: string, hour: number): string => `/c/${slug}/admin/bookings/new?court=${encodeURIComponent(courtId)}&start=${encodeURIComponent(startOf(day, hour))}`;
export const bookingPath = (slug: string, bookingId: string): string => `/c/${slug}/admin/bookings/${encodeURIComponent(bookingId)}`;
