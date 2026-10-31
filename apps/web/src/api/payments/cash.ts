import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import { CashError, parseCashRequest, requestHash, takeCash, withIdempotency, type CashErrorCode } from '@booq/domain';

// POST /staff/orders/:id/cash (F05 §5.6; PAY-06; D174, D181): front desk and owner take cash for an open order of the
// club, a court booking order inside its hold or a package order. Permission payment.cash. The Idempotency-Key is
// required: a repeat returns the first answer and takes nothing twice. The club is the session's; no club id is read
// from the input. Path parameter: `input.id`.

export interface CashRouteDeps {
  db: Db;
}

const STATUS: Record<CashErrorCode, number> = {
  bad_input: 400,
  cash_reason_required: 400,
  cash_note_required: 400,
  club_paused: 409,
  order_not_found: 404,
  nothing_to_pay: 409,
  hold_ended: 409,
  credit_unavailable: 409,
  coach_add_not_supported: 409,
};
const KEY = /^[\x21-\x7e]{1,200}$/;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function cashRoutes(deps: CashRouteDeps): Route<unknown>[] {
  return [
    {
      ...route({ method: 'POST', path: '/staff/orders/:id/cash', permission: 'payment.cash' }, async (ctx: RouteContext) => {
        const input = (ctx.input ?? {}) as Record<string, unknown>;
        const key = input['idempotencyKey'];
        if (typeof key !== 'string' || !KEY.test(key)) throw new RouteError(400, 'idempotency_key_required');
        let req;
        try {
          req = parseCashRequest(ctx.body);
        } catch (e) {
          if (e instanceof CashError) throw new RouteError(STATUS[e.code], e.code);
          throw e;
        }
        const c = { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin' as const, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) };
        try {
          return await deps.db.withClubTx(c, (tx) =>
            withIdempotency(tx, key, requestHash(`POST /staff/orders/${String(input['id'])}/cash`, ctx.body ?? null), () => takeCash(tx, input['id'], req)),
          );
        } catch (e) {
          if (e instanceof CashError) throw new RouteError(STATUS[e.code], e.code);
          throw e;
        }
      }),
      headers: NO_STORE,
    },
  ];
}
