import type { PlatformDb } from '@booq/db';

// Aggregate counts for P1 and P3 (F01-T35; PLAT-02-AC10, AC11, PLAT-07-AC7; D2, D33). BOOQ staff
// see numbers only: bookings confirmed and LINE messages sent in the last 30 days, from
// platform.club_usage_daily, which holds a count per club per day per metric and nothing finer.
// There is no list of rows behind a number and no way to drill down. Test activity never reaches
// the table (app.bump_usage counts only Live and Paused clubs). The row policies decide which
// clubs a staff member sees; a club they cannot see is the same `not_found` as one that does not exist.
// Only the two metrics on P1 and P3 exist (Q-D); a new count is a new decision.

export interface UsageCounts {
  bookingsConfirmed30d: number;
  lineMessagesSent30d: number;
}
export type ClubCountsResult = { ok: true; counts: UsageCounts } | { ok: false; code: 'not_found' };
export interface PortfolioRow {
  clubId: string;
  nameTh: string;
  nameEn: string;
  status: string;
  bookingsConfirmed30d: number;
  /** Setup steps done of all steps (P1 Setup column). */
  setup: { done: number; total: number };
  /** LINE messages sent this month and the limit (null: not known), P1 LINE messages column. */
  line: { used: number; limit: number | null };
  /** Checks failed right now (P1 Alerts column). */
  alerts: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The last 30 days include today: today and the 29 days before it. */
const WINDOW_DAYS_BEFORE_TODAY = 29;

export function createUsageService(deps: { db: PlatformDb; /** Today's Asia/Bangkok date from the clock. */ today(): string }) {
  const { db } = deps;

  async function activeStaff(staffId: string): Promise<boolean> {
    if (!UUID.test(staffId)) return false;
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<{ active: boolean }>('select active from platform.staff_by_id($1)', [staffId])).rows[0]);
    return Boolean(row?.active);
  }

  return {
    async clubCounts(staffId: string, clubId: string): Promise<ClubCountsResult> {
      if (!UUID.test(clubId) || !(await activeStaff(staffId))) return { ok: false, code: 'not_found' };
      return db.withPlatformTx({ staffId, staffLabel: 'usage' }, async (tx) => {
        const visible = await tx.query('select 1 from public.club where id = $1', [clubId]);
        if (visible.rows.length === 0) return { ok: false as const, code: 'not_found' as const };
        const { rows } = await tx.query<{ metric: string; total: string }>(
          `select metric, sum(value)::text as total from platform.club_usage_daily
            where club_id = $1 and day >= $2::date - $3::int and day <= $2::date group by metric`,
          [clubId, deps.today(), WINDOW_DAYS_BEFORE_TODAY],
        );
        const n = (metric: string) => Number(rows.find((r) => r.metric === metric)?.total ?? 0);
        return { ok: true as const, counts: { bookingsConfirmed30d: n('bookings_confirmed'), lineMessagesSent30d: n('line_messages_sent') } };
      });
    },

    /** P1: each visible club with one number. */
    async portfolio(staffId: string): Promise<PortfolioRow[]> {
      if (!(await activeStaff(staffId))) return [];
      return db.withPlatformTx({ staffId, staffLabel: 'usage' }, async (tx) => {
        const { rows } = await tx.query<{ id: string; name_th: string; name_en: string; status: string; total: string; setup_done: string; setup_total: string; line_used: string | null; line_limit: number | null; alerts: string }>(
          `select c.id, c.name_th, c.name_en, c.status,
                  coalesce(sum(u.value) filter (where u.metric = 'bookings_confirmed' and u.day >= $1::date - $2::int and u.day <= $1::date), 0)::text as total,
                  (select count(*) from jsonb_array_elements(coalesce(platform.club_progress(c.id) -> 'setup', '[]'::jsonb)) e where (e ->> 'done')::boolean)::text as setup_done,
                  (select count(*) from jsonb_array_elements(coalesce(platform.club_progress(c.id) -> 'setup', '[]'::jsonb)) e)::text as setup_total,
                  (select l.used::text from platform.club_line_usage l where l.club_id = c.id and l.month = date_trunc('month', $1::date)::date) as line_used,
                  (select l.message_limit from platform.club_line_usage l where l.club_id = c.id and l.month = date_trunc('month', $1::date)::date) as line_limit,
                  (select count(*) from platform.club_health h where h.club_id = c.id and h.status = 'failed')::text as alerts
             from public.club c left join platform.club_usage_daily u on u.club_id = c.id
            group by c.id, c.name_th, c.name_en, c.status order by c.name_en, c.id`,
          [deps.today(), WINDOW_DAYS_BEFORE_TODAY],
        );
        return rows.map((r) => ({
          clubId: r.id, nameTh: r.name_th, nameEn: r.name_en, status: r.status, bookingsConfirmed30d: Number(r.total),
          setup: { done: Number(r.setup_done), total: Number(r.setup_total) },
          line: { used: Number(r.line_used ?? 0), limit: r.line_limit },
          alerts: Number(r.alerts),
        }));
      });
    },
  };
}
