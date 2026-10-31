import { route, RouteError, type Route } from '@booq/auth';
import type { Db } from '@booq/db';
import { orderConfirmation, PaymentNotFound, paymentStatus, type PaymentStatus } from '@booq/domain';

// GET /payments/:id (F05 design 6; C11): the state of one payment, polled by the payment screen until final. A player reads their own payment
// and staff the club's (row policies); another person's or another club's is 404. Never cached.
export interface PaymentStatusDeps {
  db: Db;
}

export function paymentStatusRoutes(deps: PaymentStatusDeps): Route<PaymentStatus>[] {
  return [
    {
      ...route({ method: 'GET', path: '/payments/:id', permission: 'orders.read.own' }, async (ctx) => {
        try {
          return await deps.db.withClubTx({ clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) }, (tx) =>
            paymentStatus(tx, (ctx.input as { id?: unknown } | null)?.id));
        } catch (e) {
          if (e instanceof PaymentNotFound) throw new RouteError(404, 'not_found');
          throw e;
        }
      }),
      headers: { 'Cache-Control': 'no-store' },
    },
    {
      ...route({ method: 'GET', path: '/orders/:id/confirmation', permission: 'orders.read.own' }, async (ctx) => {
        try {
          return await deps.db.withClubTx({ clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'player_app', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) }, (tx) =>
            orderConfirmation(tx, (ctx.input as { id?: unknown } | null)?.id));
        } catch (e) {
          if (e instanceof PaymentNotFound) throw new RouteError(404, 'not_found');
          throw e;
        }
      }),
      headers: { 'Cache-Control': 'no-store' },
    },
  ];
}
