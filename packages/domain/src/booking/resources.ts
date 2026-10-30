import type { Tx } from '../../../db/src/tx';
import type { OpeningHours } from './time';

// F03-T04: reads the opening hours of a Bangkok date and the resource's active flag
// (BOOK-01-AC3, AC9). Every query runs inside withClubTx, so the club scope comes from the
// request context and another club's rows are invisible (CC-1).

/** ISO weekday of a Bangkok calendar date (YYYY-MM-DD): 1 Monday to 7 Sunday. */
export function isoWeekday(bangkokDate: string): number {
  const d = new Date(`${bangkokDate}T00:00:00Z`).getUTCDay(); // calendar date only, zone free
  return d === 0 ? 7 : d;
}

const hhmm = (t: string): string => t.slice(0, 5);

/** The club's opening hours for that Bangkok date, or null when the weekday has no row (closed). */
export async function openingHoursFor(tx: Tx, bangkokDate: string): Promise<OpeningHours | null> {
  const r = await tx.query<{ open: string; close: string }>(
    'select open::text as open, close::text as close from public.opening_hours where club_id = app.club_id() and weekday = $1',
    [isoWeekday(bangkokDate)],
  );
  const row = r.rows[0];
  return row ? { open: hhmm(row.open), close: hhmm(row.close) } : null;
}

export interface BookableResource {
  id: string;
  name: string;
  sport: string;
}

/** Active resources of the club, for the schedule. An inactive court is never offered. */
export async function listActiveResources(tx: Tx): Promise<BookableResource[]> {
  const r = await tx.query<BookableResource>(
    'select id, name, sport from public.resource where club_id = app.club_id() and active order by name, id',
  );
  return r.rows;
}

/** A court that is missing, belongs to another club or is inactive is refused the same way. */
export async function resourceBookable(
  tx: Tx,
  resourceId: string,
): Promise<{ ok: true } | { ok: false; code: 'resource_inactive' }> {
  const r = await tx.query('select 1 from public.resource where club_id = app.club_id() and id = $1 and active', [resourceId]);
  return r.rowCount === 1 ? { ok: true } : { ok: false, code: 'resource_inactive' };
}
