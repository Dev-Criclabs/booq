import { FileReply, route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import { toCsv, type CsvCell } from '@booq/domain';

// Daily close and report routes (F13-T14; design 5; RCPT-03; R2; D33, D35). Owner and accountant only (`daily-close.run`, `report.read`);
// front desk, coaches and players are refused by the route table before anything runs, and again by the database functions. Every report
// is one SQL function of migrations 0706 and 0707 that the screen and the CSV share, so the CSV is the on-screen query (R2-AC9); each CSV
// is written to the club audit log (0712). Amounts are integer satang; no row carries a phone number or date of birth (D35).
//   POST /staff/daily-close {day}            run the close of a finished Bangkok day
//   GET  /staff/daily-close?day=             the closed day, or a preview of an open one ({closed: false})
//   GET  /staff/daily-close/csv?day=         the same, flattened, as a CSV (audited)
//   GET  /staff/reports/:name?from=&to=      the report as JSON (value-owed takes asOf=)
//   GET  /staff/reports/:name/csv?from=&to=  the same rows as a CSV (audited)
// Coach payouts (F13-T10) join here when their tables exist.

export interface ReportRouteDeps {
  db: Db;
}

const UUID_ERRORS: Record<string, number> = { forbidden: 403, invalid_day: 400, day_not_over: 409, already_closed: 409, invalid_range: 400 };
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const bad = () => new RouteError(400, 'bad_input');
const day = (v: unknown): string => {
  const m = typeof v === 'string' ? DAY.exec(v) : null;
  if (!m || new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).toISOString().slice(0, 10) !== v) throw bad();
  return v as string;
};

interface ReportDef {
  /** `range` takes from and to; `as_of` takes asOf. */
  kind: 'range' | 'as_of';
  fn: string;
  columns: readonly string[];
}
const REPORTS: Record<string, ReportDef> = {
  'cash-by-type': { kind: 'range', fn: 'report_cash_by_type', columns: ['method', 'payments', 'amount_satang'] },
  'package-sales': { kind: 'range', fn: 'report_package_sales', columns: ['orders', 'packages', 'money_satang'] },
  'revenue-earned': { kind: 'range', fn: 'report_revenue_earned', columns: ['credits_used', 'credit_value_satang', 'single_sales_satang', 'total_satang'] },
  'value-owed': { kind: 'as_of', fn: 'report_value_owed', columns: ['line', 'packages', 'credits', 'amount_satang'] },
  occupancy: { kind: 'range', fn: 'report_occupancy', columns: ['resource_id', 'weekday', 'hour', 'booked', 'bookable'] },
  'online-vs-staff': { kind: 'range', fn: 'report_online_vs_staff', columns: ['source', 'bookings'] },
  'no-show-rate': { kind: 'range', fn: 'report_no_show_rate', columns: ['played', 'no_shows', 'rate_basis_points'] },
  'new-vs-returning': { kind: 'range', fn: 'report_new_vs_returning', columns: ['new_customers', 'returning_customers'] },
  partner: { kind: 'range', fn: 'report_partner', columns: ['partner_id', 'partner_name', 'redemptions', 'revenue_satang', 'new_customers', 'repeat_30', 'repeat_60'] },
};

/** Big sums come out of the database as text: whole numbers go back to numbers (satang stay exact below 2^53), everything else is kept. */
function plain(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'string' && /^-?\d{1,15}$/.test(v) && !/id$/.test(k) && k !== 'partner_name' ? Number(v) : v;
  return out;
}

export function reportRoutes(deps: ReportRouteDeps): Route<unknown>[] {
  const inClub = async <T>(ctx: RouteContext, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> => {
    try {
      return await deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        (tx) => fn((sql, params) => tx.query(sql, params)),
      );
    } catch (e) {
      const m = /^(?:close|report):(\w+)/.exec((e as { message?: string }).message ?? '');
      if (m && (e as { code?: string }).code === 'P0001' && UUID_ERRORS[m[1]!] !== undefined) throw new RouteError(UUID_ERRORS[m[1]!]!, m[1]!);
      throw e;
    }
  };
  const csv = (name: string, body: string) => new FileReply(new TextEncoder().encode(body), { contentType: 'text/csv; charset=utf-8', filename: name });

  const defOf = (ctx: RouteContext): ReportDef => {
    const name = (ctx.input as { name?: unknown }).name;
    const def = typeof name === 'string' && Object.hasOwn(REPORTS, name) ? REPORTS[name] : undefined;
    if (!def) throw new RouteError(404, 'not_found');
    return def;
  };
  const argsOf = (ctx: RouteContext, def: ReportDef): { from: string; to: string; params: string[] } => {
    const i = ctx.input as Record<string, unknown>;
    if (def.kind === 'as_of') {
      const d = day(i['asOf']);
      return { from: d, to: d, params: [d] };
    }
    const from = day(i['from']);
    const to = day(i['to']);
    return { from, to, params: [from, to] };
  };
  const rowsOf = (ctx: RouteContext, def: ReportDef, a: { params: string[] }) =>
    inClub(ctx, async (q) => ({
      rows: (await q(`select * from app.${def.fn}(${a.params.map((_, n) => `$${n + 1}::date`).join(', ')})`, a.params)).rows.map(plain),
    }));

  /** The daily close as one flat list: a section, an item, an amount, a count, a reference (receipt number) and a name. */
  function closeRows(t: Record<string, any>): CsvCell[][] {
    const rows: CsvCell[][] = [];
    for (const [m, v] of Object.entries(t['methods'] as Record<string, number>)) rows.push(['method', m, Number(v), null, null, null]);
    rows.push(['money_total', '', Number(t['money_total_satang']), null, null, null]);
    for (const p of t['voided_payments'] as Array<Record<string, any>>) rows.push(['voided_payment', p['method'], Number(p['amount_satang']), null, p['number'], null]);
    rows.push(['credit_used', '', Number(t['credit_used'].value_satang), Number(t['credit_used'].count), null, null]);
    rows.push(['wallet_used', '', Number(t['wallet_used_satang']), null, null, null]);
    rows.push(['wallet_returned', '', Number(t['wallet_returned_satang']), null, null, null]);
    for (const w of t['wallet_credited'] as Array<Record<string, any>>) rows.push(['wallet_credited', w['reason'], Number(w['amount_satang']), null, w['receipt_number'], null]);
    for (const v of t['voids_made'] as Array<Record<string, any>>) rows.push(['void_made', v['reason'], Number(v['total_satang']), null, v['number'], null]);
    for (const r of t['receipts'] as Array<Record<string, any>>) rows.push(['receipt', `${r['kind']}:${r['status']}`, Number(r['total_satang']), null, r['number'], r['customer_name']]);
    return rows;
  }
  const CLOSE_COLUMNS = ['section', 'item', 'amount_satang', 'count', 'reference', 'name'] as const;

  async function closeOf(ctx: RouteContext, d: string) {
    return inClub(ctx, async (q) => {
      const stored = (await q('select totals, run_at, is_test from public.daily_close where day = $1::date', [d])).rows[0];
      if (stored) return { closed: true, day: d, runAt: stored.run_at, isTest: stored.is_test as boolean, totals: stored.totals as Record<string, any> };
      return { closed: false, day: d, runAt: null, totals: (await q('select app.preview_daily_close($1::date) as t', [d])).rows[0]!.t as Record<string, any> };
    });
  }
  async function audited<T>(ctx: RouteContext, name: string, from: string, to: string, rows: number, then: () => T): Promise<T> {
    await inClub(ctx, (q) => q('select app.audit_report_export($1, $2::date, $3::date, $4)', [name, from, to, rows]));
    return then();
  }

  return [
    route({ method: 'POST', path: '/staff/daily-close', permission: 'daily-close.run' }, (ctx) => {
      const b = ctx.body as Record<string, unknown> | undefined;
      if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some((k) => k !== 'day')) throw bad();
      const d = day(b['day']);
      return inClub(ctx, async (q) => ({ id: (await q('select app.run_daily_close($1::date) as id', [d])).rows[0]!.id as string, day: d }));
    }),
    route({ method: 'GET', path: '/staff/daily-close', permission: 'daily-close.run' }, (ctx) => closeOf(ctx, day((ctx.input as Record<string, unknown>)['day']))),
    route({ method: 'GET', path: '/staff/daily-close/csv', permission: 'daily-close.run' }, async (ctx) => {
      const d = day((ctx.input as Record<string, unknown>)['day']);
      const c = await closeOf(ctx, d);
      const rows = closeRows(c.totals);
      return audited(ctx, 'daily-close', d, d, rows.length, () => csv(`daily-close-${d}.csv`, toCsv(CLOSE_COLUMNS, rows)));
    }),
    route({ method: 'GET', path: '/staff/reports/:name', permission: 'report.read' }, async (ctx) => {
      const def = defOf(ctx);
      return (await rowsOf(ctx, def, argsOf(ctx, def))).rows;
    }),
    route({ method: 'GET', path: '/staff/reports/:name/csv', permission: 'report.read' }, async (ctx) => {
      const def = defOf(ctx);
      const a = argsOf(ctx, def);
      const { rows } = await rowsOf(ctx, def, a);
      const name = String((ctx.input as { name: string }).name);
      return audited(ctx, name, a.from, a.to, rows.length, () =>
        csv(`${name}-${a.from}${a.from === a.to ? '' : `-${a.to}`}.csv`, toCsv(def.columns, rows.map((r) => def.columns.map((c) => r[c] as CsvCell)))),
      );
    }),
  ];
}
