// The coach portal's calls (F12 design 6; CPORT-01 to CPORT-06). Every call goes to /api/c/{slug}/coach/... and answers a body or a typed
// code; the screen decides the words from the code (CC-5). The coach is never sent: the server knows who is signed in.

export type CoachResult<T> = { ok: true; body: T } | { ok: false; status: number; code: string };

const base = (slug: string) => `/api/c/${encodeURIComponent(slug)}`;

export async function coachCall<T>(f: typeof fetch, slug: string, method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<CoachResult<T>> {
  try {
    const res = await f(`${base(slug)}${path}`, {
      method,
      credentials: 'same-origin',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: string };
    return res.ok ? { ok: true, body: json as T } : { ok: false, status: res.status, code: json.code ?? 'error' };
  } catch {
    return { ok: false, status: 0, code: 'offline' };
  }
}

/** One row of K1 and K2 (migration 1202). `kind` is `solo` or `group`; the others are the functions' own columns. */
export interface SessionRow {
  kind: 'solo' | 'group';
  ref_id: string;
  start_at: string;
  end_at: string;
  court: string;
  held: boolean;
  student_name: string | null;
  class_name_th: string | null;
  class_name_en: string | null;
  level: string | null;
  players: number | null;
  capacity: number | null;
  needs_attention: boolean;
  status: string;
}
export interface TodayBody {
  date: string | null;
  count: number;
  hours: number;
  sessions: SessionRow[];
}
export interface ScheduleItem extends Omit<SessionRow, 'kind'> {
  item: 'session' | 'leave' | 'blocked';
  kind: 'solo' | 'group' | null;
  note: string | null;
}
export interface ScheduleBody {
  from: string;
  to: string;
  counts: { solo: number; group: number; leave: number };
  items: ScheduleItem[];
}
export interface RosterPlayer {
  booking_id: string;
  customer_id: string;
  name: string;
  level: string | null;
  mark: 'present' | 'absent' | null;
  note: string | null;
  last_note: { body: string; at: string } | null;
}
export interface SessionDetail {
  kind: 'solo' | 'group';
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  held?: boolean;
  court: string;
  level?: string | null;
  class_name_th?: string;
  class_name_en?: string;
  players: number;
  capacity: number | null;
  roster: RosterPlayer[];
  session_note: string | null;
  marked: number;
  listed: number;
  can_mark: 'ok' | 'not_ended' | 'month_paid';
}

export const getToday = (f: typeof fetch, slug: string, date?: string) => coachCall<TodayBody>(f, slug, 'GET', `/coach/today${date ? `?date=${date}` : ''}`);
export const getSchedule = (f: typeof fetch, slug: string, from: string, to: string) => coachCall<ScheduleBody>(f, slug, 'GET', `/coach/schedule?from=${from}&to=${to}`);
export const getSession = (f: typeof fetch, slug: string, kind: 'solo' | 'group', id: string) => coachCall<SessionDetail>(f, slug, 'GET', `/coach/sessions/${kind}/${encodeURIComponent(id)}`);
export const putAttendance = (f: typeof fetch, slug: string, kind: 'solo' | 'group', id: string, bookingId: string, mark: 'present' | 'absent') =>
  coachCall<{ mark: string; changed: boolean }>(f, slug, 'PUT', `/coach/sessions/${kind}/${encodeURIComponent(id)}/attendance`, kind === 'solo' ? { mark } : { bookingId, mark });
export const putNote = (f: typeof fetch, slug: string, kind: 'solo' | 'group', id: string, customerId: string | null, body: string | null) =>
  coachCall<{ saved?: boolean; deleted?: boolean }>(f, slug, 'PUT', `/coach/sessions/${kind}/${encodeURIComponent(id)}/note`, { customerId, body });
