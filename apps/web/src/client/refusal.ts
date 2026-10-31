import { clubPath } from '@booq/line';
import { refusalTextKey, REFUSAL_TEXT_KEYS, type BookingRefusal } from '@booq/domain/src/booking/refusal';

// Booking refusals in the player app (F03-T25; BOOK-01-AC15, BOOK-04-AC4, BOOK-05-AC8; D61). The server
// answers a typed code with plain values (`{ code, hours }`, `{ code, seconds }`, `{ code, by }`); the
// text is always the code's language key, with its named variables (CC-5). Refusals about the slot send
// the player back to C4, where the grid is read again and they pick again; nothing was charged.

export interface Refusal {
  code: BookingRefusal;
  hours?: number;
  seconds?: number;
  by?: 'resource' | 'coach';
}

/** Codes that mean "pick another hour": checkout returns the player to C4 with a fresh grid. */
const BACK_TO_GRID: ReadonlySet<BookingRefusal> = new Set([
  'slot_unavailable',
  'hour_started',
  'in_the_past',
  'outside_window',
  'outside_hours',
  'not_on_the_hour',
  'not_consecutive',
  'resource_inactive',
] as BookingRefusal[]);

const WHOLE = /^[1-9][0-9]{0,6}$/;
const isCode = (v: unknown): v is BookingRefusal => typeof v === 'string' && Object.hasOwn(REFUSAL_TEXT_KEYS, v);

/** A refusal from a response body, or null when the body is not one (only known codes, plain whole numbers). */
export function refusalFrom(body: unknown): Refusal | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!isCode(b['code'])) return null;
  const r: Refusal = { code: b['code'] };
  const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && WHOLE.test(v) ? Number(v) : undefined);
  const hours = num(b['hours']);
  const seconds = num(b['seconds']);
  if (hours !== undefined) r.hours = hours;
  if (seconds !== undefined) r.seconds = seconds;
  if (b['by'] === 'coach' || b['by'] === 'resource') r.by = b['by'];
  return r;
}

/**
 * The key and variables to show. A value the text needs but the answer did not carry leaves the
 * refusal without a message key (null), so no text ever shows a raw {variable}.
 */
export function refusalMessage(r: Refusal, known: { bookingWindowDays?: number | null } = {}): { key: string; vars: Record<string, number> } | null {
  const key = refusalTextKey(r.code, r.by);
  if (r.code === 'limit_reached') return r.hours ? { key, vars: { hours: r.hours } } : null;
  if (r.code === 'too_many_attempts') return r.seconds ? { key, vars: { seconds: r.seconds } } : null;
  if (r.code === 'outside_window') return known.bookingWindowDays ? { key, vars: { bookingWindowDays: known.bookingWindowDays } } : null;
  return { key, vars: {} };
}

export const backToGrid = (r: Refusal) => BACK_TO_GRID.has(r.code);

/** Where checkout (F04) sends the player for a slot refusal: C4 on the same date, carrying the refusal. */
export function refusalReturnPath(slug: string, date: string, r: Refusal): string {
  const q = new URLSearchParams({ date, refused: r.code });
  if (r.hours) q.set('hours', String(r.hours));
  if (r.seconds) q.set('seconds', String(r.seconds));
  if (r.by) q.set('by', r.by);
  return `${clubPath(slug, { page: 'book' })}?${q.toString()}`;
}

/** The refusal carried in C4's address, read once and then removed from it. */
export function refusalInSearch(search: string): Refusal | null {
  const q = new URLSearchParams(search);
  const code = q.get('refused');
  if (!code) return null;
  return refusalFrom({ code, hours: q.get('hours') ?? undefined, seconds: q.get('seconds') ?? undefined, by: q.get('by') ?? undefined });
}
