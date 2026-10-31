import { route, RouteError, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import { withoutTransportKeys } from './input';

// PUT /hours (F01 design 5.1; PLAT-02 "Meets"; BOOK-01-AC16, decision D50). The owner changes opening hours; a
// change that would leave a live booking or hold outside the new hours is refused with live_bookings_exist (the
// owner uses a closure instead, F09). The check is F03's app.assert_hours_change_allowed, inside the same
// transaction as the write, so a refusal on any day undoes the whole request.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

interface DayChange {
  weekday: number;
  /** null: the day is closed altogether. */
  open: string | null;
  close: string | null;
}

function parse(input: unknown): DayChange[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new RouteError(400, 'invalid_input');
  const body = input as Record<string, unknown>;
  const list = body['hours'];
  if (Object.keys(body).length !== 1 || !Array.isArray(list) || list.length === 0 || list.length > 7) throw new RouteError(400, 'invalid_input');
  const seen = new Set<number>();
  return list.map((d): DayChange => {
    if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new RouteError(400, 'invalid_input');
    const day = d as Record<string, unknown>;
    const weekday = day['weekday'];
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 7 || seen.has(weekday)) throw new RouteError(400, 'invalid_input');
    seen.add(weekday);
    if (day['closed'] !== undefined) {
      if (day['closed'] !== true || Object.keys(day).length !== 2) throw new RouteError(400, 'invalid_input');
      return { weekday, open: null, close: null };
    }
    const { open, close } = day;
    if (Object.keys(day).length !== 3 || typeof open !== 'string' || typeof close !== 'string' || !TIME.test(open) || !(TIME.test(close) || close === '24:00')) {
      throw new RouteError(400, 'invalid_input');
    }
    if (open >= close) throw new RouteError(400, 'invalid_input');
    return { weekday, open, close };
  });
}

export function hoursRoute(db: Db) {
  return route({ method: 'PUT', path: '/hours', permission: 'hours.write' }, async (ctx: RouteContext) => {
    const days = parse(withoutTransportKeys(ctx.input));
    try {
      return await db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        async (tx) => {
          for (const d of days) {
            await tx.query('select app.assert_hours_change_allowed($1, $2::time, $3::time)', [d.weekday, d.open, d.close]);
            if (d.open === null) {
              await tx.query('delete from public.opening_hours where club_id = $1 and weekday = $2', [ctx.clubId, d.weekday]);
            } else {
              await tx.query(
                `insert into public.opening_hours (club_id, weekday, open, close) values ($1, $2, $3::time, $4::time)
                 on conflict (club_id, weekday) do update set open = excluded.open, close = excluded.close`,
                [ctx.clubId, d.weekday, d.open, d.close],
              );
            }
          }
          const r = await tx.query<{ weekday: number; open: string; close: string }>(
            "select weekday, to_char(open, 'HH24:MI') as open, case when close = time '24:00' then '24:00' else to_char(close, 'HH24:MI') end as close from public.opening_hours where club_id = $1 order by weekday",
            [ctx.clubId],
          );
          return { hours: r.rows };
        },
      );
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'BK001') throw new RouteError(409, err.message ?? 'refused');   // F03's typed refusal, for example live_bookings_exist
      throw e;
    }
  });
}
