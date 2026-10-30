import type { Tx } from '../../../db/src/tx';
import { bangkokDate } from '../../../time/src/index';
import { BookingError } from './errors';
import { listActiveResources, openingHoursFor, type BookableResource } from './resources';
import { daysBetween, minutesOfDay } from './time';

// F03-T20: the reads behind the public schedule routes (BOOK-01-AC6, AC7, AC14, BOOK-02-AC1, AC2, AC5;
// design 4.6 and 5.1). Every query runs inside withClubTx with the caller's context, a guest included.
// Other people's bookings are read only through public.public_slot_state and public.public_day_state
// (0220), which carry no ids, names or counts of who; the window through public.public_booking_config
// (0224). A club that is not visible to the caller (Draft, or Testing for a non-tester) is not found.
// "My booking" comes from the caller's own rows (policy booking_own_read), matched by customer only.

export interface Viewer {
  userId: string | null;
  roles: readonly string[];
}

/** The six states the server sends; the client adds Selected (design 4.6). */
export type SlotState = 'open' | 'held' | 'taken' | 'closed' | 'past' | 'mine';

export interface ScheduleHour {
  /** ISO 8601 in Bangkok, for example 2026-12-02T18:00:00+07:00. */
  start: string;
  state: SlotState;
  /** Join waitlist is offered (WAIT-01, F08): a Held or Taken hour that is not the caller's own. */
  waitlist: boolean;
}

export interface ScheduleDay {
  date: string;
  courts: Array<{ id: string; name: string; sport: string; hours: ScheduleHour[] }>;
  /** No court has an Open hour (S-C04-Day-full). */
  dayFull: boolean;
  /** Day full and at least one hour is filled by a booking or hold, so the waitlist applies. */
  waitlist: boolean;
}

export interface CourtsInfo {
  status: string;
  today: string;
  /** Null when the club has not set it (no default). */
  bookingWindowDays: number | null;
  courts: BookableResource[];
  openingHours: Array<{ weekday: number; open: string; close: string }>;
}

export interface DaysInfo {
  days: Array<{ date: string; courts: Array<{ id: string; openHours: number }>; dayFull: boolean; waitlist: boolean }>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAFF = new Set(['owner', 'front_desk']);

const isStaff = (v: Viewer) => v.roles.some((r) => STAFF.has(r));
const pad = (n: number) => String(n).padStart(2, '0');
const hourStart = (date: string, minuteOfDay: number) => `${date}T${pad(minuteOfDay / 60)}:00:00+07:00`;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function parseDate(raw: unknown): string {
  if (typeof raw !== 'string' || !DATE.test(raw)) throw new BookingError('bad_input');
  if (new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) throw new BookingError('bad_input');   // 30 Feb and the like
  return raw;
}

interface Context {
  status: string;
  window: number | null;
  now: Date;
  today: string;
}

async function context(tx: Tx): Promise<Context> {
  const r = await tx.query<{ status: string; booking_window_days: number | null; now: Date }>(
    'select status, booking_window_days, app.now() as now from public.public_booking_config',
  );
  const row = r.rows[0];
  if (!row) throw new BookingError('not_found');
  return { status: row.status, window: row.booking_window_days, now: row.now, today: bangkokDate(row.now) };
}

/** Today through today plus the window, day N inclusive (D42). An unset window offers no date. */
function checkInWindow(ctx: Context, date: string): void {
  const ahead = daysBetween(ctx.today, date);
  if (ahead < 0) throw new BookingError('in_the_past');
  if (ctx.window === null || ahead > ctx.window) throw new BookingError('outside_window');
}

export async function courtsFor(tx: Tx): Promise<CourtsInfo> {
  const ctx = await context(tx);
  const courts = await listActiveResources(tx);
  const hours = await tx.query<{ weekday: number; open: string; close: string }>(
    `select weekday, to_char(open, 'HH24:MI') as open,
            case when close = time '24:00' then '24:00' else to_char(close, 'HH24:MI') end as close
       from public.opening_hours where club_id = app.club_id() order by weekday`,
  );
  return { status: ctx.status, today: ctx.today, bookingWindowDays: ctx.window, courts, openingHours: hours.rows };
}

async function dayOf(tx: Tx, viewer: Viewer, ctx: Context, date: string): Promise<ScheduleDay> {
  const courts = await listActiveResources(tx);
  const opening = await openingHoursFor(tx, date);
  if (!opening) {
    return { date, courts: courts.map((c) => ({ ...c, hours: [] })), dayFull: true, waitlist: false };
  }
  const from = new Date(`${date}T00:00:00+07:00`);
  const to = new Date(from.getTime() + 86_400_000);

  const slots = await tx.query<{ resource_id: string; start_at: Date; state: 'held' | 'taken' | 'closed' }>(
    'select resource_id, start_at, state from public.public_slot_state where start_at >= $1 and start_at < $2',
    [from, to],
  );
  const slotState = new Map<string, 'held' | 'taken' | 'closed'>();
  for (const s of slots.rows) {
    const key = `${s.resource_id}|${s.start_at.getTime()}`;
    if (slotState.get(key) !== 'closed') slotState.set(key, s.state);   // a closure wins over anything under it
  }

  const mine = new Set<string>();
  if (viewer.userId !== null) {
    const own = await tx.query<{ resource_id: string; start_at: Date }>(
      `select resource_id, start_at from public.booking
        where club_id = app.club_id() and customer_id = $1 and start_at >= $2 and start_at < $3
          and (status = 'confirmed' or (status = 'awaiting_payment' and hold_expires_at > app.now()))`,
      [viewer.userId, from, to],
    );
    for (const b of own.rows) mine.add(`${b.resource_id}|${b.start_at.getTime()}`);
  }

  // A player cannot book the hour that has started; staff can until it ends (D39).
  const cutoff = ctx.now.getTime() - (isStaff(viewer) ? 3_600_000 : 0);
  const open = minutesOfDay(opening.open);
  const close = Math.min(minutesOfDay(opening.close), 1440);
  let anyOpen = false;
  let anyFilled = false;
  const out = courts.map((c) => {
    const hours: ScheduleHour[] = [];
    for (let m = open; m + 60 <= close; m += 60) {
      const start = hourStart(date, m);
      const t = Date.parse(start);
      const key = `${c.id}|${t}`;
      const slot = slotState.get(key);
      let state: SlotState;
      if (mine.has(key)) state = 'mine';
      else if (t <= cutoff) state = 'past';
      else state = slot ?? 'open';
      const waitlist = state === 'held' || state === 'taken';
      if (state === 'open') anyOpen = true;
      if (waitlist) anyFilled = true;
      hours.push({ start, state, waitlist });
    }
    return { ...c, hours };
  });
  return { date, courts: out, dayFull: !anyOpen, waitlist: !anyOpen && anyFilled };
}

export async function scheduleFor(tx: Tx, viewer: Viewer, rawDate: unknown): Promise<ScheduleDay> {
  const date = parseDate(rawDate);
  const ctx = await context(tx);
  checkInWindow(ctx, date);
  return dayOf(tx, viewer, ctx, date);
}

export async function scheduleDays(tx: Tx, viewer: Viewer, rawFrom?: unknown, rawTo?: unknown): Promise<DaysInfo> {
  const ctx = await context(tx);
  const from = rawFrom === undefined ? ctx.today : parseDate(rawFrom);
  if (rawTo === undefined && ctx.window === null) throw new BookingError('outside_window');
  const to = rawTo === undefined ? addDays(ctx.today, ctx.window ?? 0) : parseDate(rawTo);
  if (to < from) throw new BookingError('bad_input');
  checkInWindow(ctx, from);
  checkInWindow(ctx, to);

  const courts = await listActiveResources(tx);
  const counts = await tx.query<{ resource_id: string; day: string; open_hours: number }>(
    `select resource_id, to_char(day, 'YYYY-MM-DD') as day, open_hours from public.public_day_state
      where day between $1::date and $2::date`,
    [from, to],
  );
  const open = new Map(counts.rows.map((r) => [`${r.resource_id}|${r.day}`, r.open_hours]));
  const filled = await tx.query<{ day: string }>(
    `select distinct to_char((start_at at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD') as day from public.public_slot_state
      where state in ('held', 'taken') and start_at >= $1 and start_at < $2`,
    [new Date(`${from}T00:00:00+07:00`), new Date(`${addDays(to, 1)}T00:00:00+07:00`)],
  );
  const filledDays = new Set(filled.rows.map((r) => r.day));

  const days: DaysInfo['days'] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d === ctx.today) {
      // Today leaves out the hours already started, which the view does not (0220).
      const today = await dayOf(tx, viewer, ctx, d);
      days.push({
        date: d,
        courts: today.courts.map((c) => ({ id: c.id, openHours: c.hours.filter((h) => h.state === 'open').length })),
        dayFull: today.dayFull,
        waitlist: today.waitlist,
      });
      continue;
    }
    const perCourt = courts.map((c) => ({ id: c.id, openHours: open.get(`${c.id}|${d}`) ?? 0 }));
    const dayFull = perCourt.every((c) => c.openHours === 0);
    days.push({ date: d, courts: perCourt, dayFull, waitlist: dayFull && filledDays.has(d) });
  }
  return { days };
}
