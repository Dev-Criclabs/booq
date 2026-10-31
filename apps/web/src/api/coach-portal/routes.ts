import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';

// F12 coach portal routes (design 6; CPORT-01 to CPORT-06; F12-T07, T08). Thin handlers over the portal functions of migrations 1202 to
// 1205: the coach is the signed-in person and is never read from the input (CC-2), every route needs the Coach role (`coach.portal`) and
// the function checks it again, answers carry `Cache-Control: no-store` (personal data), and a refusal is a typed code with no text.
//   GET  /coach/today?date=                              K1: the day's sessions, with the count and the hours
//   GET  /coach/schedule?from=&to=                       K2: up to 14 days of sessions, leave and blocked times, with the counts
//   GET  /coach/rest-cap                                 K3: the longest run of hours in a row the club allows a coach
//   GET  /coach/sessions/{solo|group}/:id                K5: the session, its roster, marks and notes
//   PUT  /coach/sessions/{solo|group}/:id/attendance     {mark} for a solo class, {bookingId, mark} for a group seat
//   PUT  /coach/sessions/{solo|group}/:id/note           {customerId|null, body}: a blank body deletes the note
//   GET  /coach/earnings?month=YYYY-MM                   K6: the month's figures and its adjustments
//   GET  /coach/earnings/history                         K6: past payouts
//   GET  /staff/bookings/:id/attendance                  A2: the coach's mark as a hint (owner, front desk)
// The kind is a literal in the path so these never clash with F08's GET /coach/sessions/:id/roster.

export interface CoachPortalDeps {
  db: Db;
}

const STATUS: Record<string, number> = {
  forbidden: 403, not_found: 404, invalid_kind: 400, invalid_mark: 400, invalid_month: 400, invalid_range: 400, invalid_customer: 400, body_too_long: 400,
  not_ended: 409, month_paid: 409, not_started: 409,
};
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = () => new RouteError(400, 'bad_input');
const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;

const day = (v: unknown): string => {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m || new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).toISOString().slice(0, 10) !== v) throw bad();
  return v as string;
};
/** `YYYY-MM` (or the first day of that month) to the first day of the month. */
const monthOf = (v: unknown): string => {
  const m = typeof v === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(v) : null;
  if (!m) throw bad();
  return `${m[1]}-${m[2]}-01`;
};
const idOf = (ctx: RouteContext): string => {
  const id = inputOf(ctx)['id'];
  if (typeof id !== 'string' || !UUID.test(id)) throw new RouteError(404, 'not_found');
  return id;
};
/** The body must be an object with exactly the named keys (extra or missing keys are a bad request). */
const bodyOf = (ctx: RouteContext, keys: readonly string[]): Record<string, unknown> => {
  const b = ctx.body as Record<string, unknown> | undefined;
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== keys.length || keys.some((k) => !(k in b))) throw bad();
  return b;
};

export function coachPortalRoutes(deps: CoachPortalDeps): Route<unknown>[] {
  const inClub = async <T>(ctx: RouteContext, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> => {
    try {
      return await deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'coach_portal', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        (tx) => fn((sql, params) => tx.query(sql, params)),
      );
    } catch (e) {
      const m = /^portal:(\w+)/.exec((e as { message?: string }).message ?? '');
      if (m && (e as { code?: string }).code === 'P0001' && STATUS[m[1]!] !== undefined) throw new RouteError(STATUS[m[1]!]!, m[1]!);
      throw e;
    }
  };
  const get = <T>(path: string, fn: (ctx: RouteContext) => Promise<T>): Route<T> & { headers: typeof NO_STORE } => ({ ...route({ method: 'GET', path, permission: 'coach.portal' }, fn), headers: NO_STORE });
  const put = <T>(path: string, fn: (ctx: RouteContext) => Promise<T>): Route<T> & { headers: typeof NO_STORE } => ({ ...route({ method: 'PUT', path, permission: 'coach.portal' }, fn), headers: NO_STORE });

  const sessionRoutes = (kind: 'solo' | 'group'): Route<unknown>[] => [
    get(`/coach/sessions/${kind}/:id`, (ctx) => {
      const id = idOf(ctx);
      return inClub(ctx, async (q) => (await q('select app.coach_session($1, $2) as s', [kind, id])).rows[0]!.s);
    }),
    put(`/coach/sessions/${kind}/:id/attendance`, (ctx) => {
      const id = idOf(ctx);
      const b = bodyOf(ctx, kind === 'solo' ? ['mark'] : ['bookingId', 'mark']);
      if (typeof b['mark'] !== 'string') throw bad();
      const seat = kind === 'solo' ? id : b['bookingId'];
      if (typeof seat !== 'string' || !UUID.test(seat)) throw bad();
      return inClub(ctx, async (q) => {
        // A seat of another session is not this session's: it is not found, whoever owns it. The roster comes from the coach's own session
        // (app.coach_session answers not_found for a session that is not theirs), because a coach reads no seat row directly.
        if (kind === 'group') {
          const roster = (await q('select app.coach_session($1, $2) as s', [kind, id])).rows[0]!.s.roster as Array<{ booking_id: string }>;
          if (!roster.some((p) => p.booking_id === seat)) throw new RouteError(404, 'not_found');
        }
        return (await q('select app.mark_attendance($1, $2) as r', [seat, b['mark']])).rows[0]!.r;
      });
    }),
    put(`/coach/sessions/${kind}/:id/note`, (ctx) => {
      const id = idOf(ctx);
      const b = bodyOf(ctx, ['customerId', 'body']);
      const customer = b['customerId'];
      if (customer !== null && (typeof customer !== 'string' || !UUID.test(customer))) throw bad();
      if (b['body'] !== null && typeof b['body'] !== 'string') throw bad();
      return inClub(ctx, async (q) => (await q('select app.save_session_note($1, $2, $3, $4) as r', [kind, id, customer, b['body']])).rows[0]!.r);
    }),
  ];

  return [
    get('/coach/today', async (ctx) => {
      const raw = inputOf(ctx)['date'];
      const date = raw === undefined ? null : day(raw);
      const rows = await inClub(ctx, async (q) => (await q('select * from app.coach_day($1::date)', [date])).rows);
      return { date: date ?? null, count: rows.length, hours: rows.length, sessions: rows };
    }),
    get('/coach/schedule', async (ctx) => {
      const from = day(inputOf(ctx)['from']);
      const to = day(inputOf(ctx)['to']);
      const items = await inClub(ctx, async (q) => (await q('select * from app.coach_schedule($1::date, $2::date)', [from, to])).rows);
      const n = (item: string, kind?: string) => items.filter((r) => r.item === item && (kind === undefined || r.kind === kind)).length;
      return { from, to, counts: { solo: n('session', 'solo'), group: n('session', 'group'), leave: n('leave') }, items };
    }),
    ...sessionRoutes('solo'),
    ...sessionRoutes('group'),
    get('/coach/rest-cap', (ctx) => inClub(ctx, async (q) => ({ restCapHours: (await q('select app.coach_rest_cap() as n')).rows[0]!.n as number }))),
    get('/coach/earnings', async (ctx) => {
      const month = monthOf(inputOf(ctx)['month']);
      return inClub(ctx, async (q) => ({
        earnings: (await q('select app.my_earnings($1::date) as e', [month])).rows[0]!.e,
        adjustments: (await q('select * from app.my_payout_adjustments($1::date)', [month])).rows,
      }));
    }),
    get('/coach/earnings/history', (ctx) =>
      inClub(ctx, async (q) => (await q(`select to_char(month, 'YYYY-MM') as month, total_satang::bigint as total_satang, paid_at from app.my_payout_history()`)).rows.map((r) => ({ ...r, total_satang: Number(r.total_satang) }))),
    ),
    { ...route({ method: 'GET', path: '/staff/bookings/:id/attendance', permission: 'attendance.read' }, (ctx) => {
        const id = idOf(ctx);
        return inClub(ctx, async (q) => {
          const r = (await q(
            `select a.mark, a.marked_at, a.changed_at, coalesce(u.full_name, u.display_name) as coach_name
               from public.coach_attendance a join public.app_user u on u.club_id = a.club_id and u.id = a.coach_id
              where a.booking_id = $1`, [id])).rows[0];
          return r ?? { mark: null, marked_at: null, changed_at: null, coach_name: null };
        });
      }), headers: NO_STORE },
  ];
}
