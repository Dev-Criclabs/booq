import { FileReply, route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import type { Language } from '@booq/receipts';
import type { PrintData, ReceiptPdf } from './pdf';

// Receipt routes (F13-T12, T13; design 5; RCPT-01-AC9, AC11; RCPT-02-AC8; D35). Thin: who may call is declared on each route, the
// access rule and the snapshot are app.receipt_for_print in the database (migration 0711), the void is app.void_receipt (0704), and the
// words and layout of the PDF are in packages/receipts. A receipt of another club, or one the caller may not print, is 404.
//   GET  /me/receipts, GET /me/receipts/:id/pdf      the signed-in person's own (the PDF is the original the first time, then a copy)
//   GET  /staff/receipts?q&from&to&limit&offset      owner, accountant: list and search by number, name and Bangkok date
//   GET  /staff/receipts/:id/pdf?lang=th|en          owner, accountant, front desk: always a copy, in either language, audited
//   POST /staff/receipts/:id/void { reason }         owner only
// Path parameter `input.id`; the void body is read as sent (`ctx.body`).

export interface ReceiptRouteDeps {
  db: Db;
  /** Null when the language files are not configured: the PDF routes answer 503 not_configured. */
  pdf: ReceiptPdf | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const bad = () => new RouteError(400, 'bad_input');
const STATUS: Record<string, number> = { forbidden: 403, not_found: 404, reason_required: 400, already_void: 409 };

const idOf = (ctx: RouteContext): string => {
  const id = (ctx.input as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !UUID.test(id)) throw bad();
  return id;
};
const day = (v: unknown): string | null => {
  if (v === undefined || v === '') return null;
  const m = typeof v === 'string' ? DAY.exec(v) : null;
  if (!m || new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).toISOString().slice(0, 10) !== v) throw bad();
  return v as string;
};
const whole = (v: unknown, def: number, min: number, max: number): number => {
  if (v === undefined || v === '') return def;
  const n = typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw bad();
  return n;
};

export function receiptRoutes(deps: ReceiptRouteDeps): Route<unknown>[] {
  const inClub = async <T>(ctx: RouteContext, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> => {
    try {
      return await deps.db.withClubTx(
        { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
        (tx) => fn((sql, params) => tx.query(sql, params)),
      );
    } catch (e) {
      const m = /^receipt:(\w+)/.exec((e as { message?: string }).message ?? '');
      if (m && (e as { code?: string }).code === 'P0001' && STATUS[m[1]!] !== undefined) throw new RouteError(STATUS[m[1]!]!, m[1]!);
      throw e;
    }
  };

  async function pdfOf(ctx: RouteContext, id: string, staff: boolean, lang: Language | null): Promise<FileReply> {
    if (!deps.pdf) throw new RouteError(503, 'not_configured');
    const render = deps.pdf;
    const data = await inClub(ctx, async (q) => {
      if (!staff && (await q('select 1 from public.receipt where id = $1 and customer_id = app.user_id()', [id])).rows.length === 0) throw new RouteError(404, 'not_found');
      return (await q('select app.receipt_for_print($1) as r', [id])).rows[0]!.r as PrintData;
    });
    const bytes = await render(data, lang ?? data.language, staff || !data.original);
    return new FileReply(bytes, { contentType: 'application/pdf', filename: `receipt-${data.number}.pdf` });
  }

  return [
    route({ method: 'GET', path: '/me/receipts', needsPerson: true }, (ctx) =>
      inClub(ctx, async (q) =>
        (await q(`select id, number, kind, status, issued_at, total_satang from public.receipt where customer_id = app.user_id() order by issued_at desc, id desc`)).rows.map((r) => ({ ...r, total_satang: Number(r.total_satang) })),
      ),
    ),
    route({ method: 'GET', path: '/me/receipts/:id/pdf', needsPerson: true }, (ctx) => pdfOf(ctx, idOf(ctx), false, null)),

    route({ method: 'GET', path: '/staff/receipts', permission: 'receipt.list' }, (ctx) => {
      const i = ctx.input as Record<string, unknown>;
      const q = i['q'] === undefined ? '' : typeof i['q'] === 'string' && i['q'].length <= 100 ? i['q'].trim() : (() => { throw bad(); })();
      const from = day(i['from']);
      const to = day(i['to']);
      const limit = whole(i['limit'], 50, 1, 200);
      const offset = whole(i['offset'], 0, 0, 100000);
      return inClub(ctx, async (query) =>
        (await query(
          `select id, number, kind, status, issued_at, customer_name_snapshot as customer_name, total_satang, is_test
             from public.receipt
            where ($1 = '' or strpos(lower(number), lower($1)) = 1 or strpos(lower(coalesce(customer_name_snapshot, '')), lower($1)) > 0)
              and ($2::date is null or (issued_at at time zone 'Asia/Bangkok')::date >= $2::date)
              and ($3::date is null or (issued_at at time zone 'Asia/Bangkok')::date <= $3::date)
            order by issued_at desc, id desc limit $4 offset $5`,
          [q, from, to, limit, offset],
        )).rows.map((r) => ({ ...r, total_satang: Number(r.total_satang) })),
      );
    }),
    route({ method: 'GET', path: '/staff/receipts/:id/pdf', permission: 'receipt.print' }, (ctx) => {
      const l = (ctx.input as { lang?: unknown }).lang;
      if (l !== undefined && l !== 'th' && l !== 'en') throw bad();
      return pdfOf(ctx, idOf(ctx), true, (l as Language | undefined) ?? null);
    }),
    route({ method: 'POST', path: '/staff/receipts/:id/void', permission: 'receipt.void' }, (ctx) => {
      const id = idOf(ctx);
      const b = ctx.body as Record<string, unknown> | undefined;
      if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some((k) => k !== 'reason') || typeof b['reason'] !== 'string') throw bad();
      const reason = b['reason'];
      return inClub(ctx, async (q) => {
        await q('select app.void_receipt($1, $2)', [id, reason]);
        return { ok: true };
      });
    }),
  ];
}
