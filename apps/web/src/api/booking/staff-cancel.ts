import { route } from '@booq/auth';
import {
  closureExpiredPackages, closureUnmessaged, createClosure, endClosure, listClosures, markBooking, previewClosure, previewStaffCancel,
  reverseBookingMark, staffCancel,
} from '@booq/domain';
import { contextFor, idempotent, inCancelTx, inputOf } from './cancel';
import type { BookingRoute, BookingRouteDeps } from './routes';

// F09-T13 staff routes (F09 design 5 and 7; prefix /api/c/{slug}), thin handlers over packages/domain/src/booking/staff-cancel.ts
// and closures.ts. Front desk and owner: booking.cancel.staff and booking.mark (f09.ts), closure.write (f11.ts). Every change
// needs a written reason (refused as reason_required) and takes an optional Idempotency-Key. Each route refuses input fields
// it does not name. A Paused club works as Live (D107, CANCEL-03-AC13). No route sends money back (CANCEL-02).

export function staffCancelRoutes(deps: BookingRouteDeps): BookingRoute<unknown>[] {
  return [
    route({ method: 'GET', path: '/staff/bookings/:id/cancel-preview', permission: 'booking.cancel.staff' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'admin', ['id']);
      return inCancelTx(deps.db, c, (tx) => previewStaffCancel(tx, c, inputOf(ctx)['id']));
    }),
    route({ method: 'POST', path: '/staff/bookings/:id/cancel', permission: 'booking.cancel.staff' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'admin', ['id', 'clubCancel', 'reason']);
      const i = inputOf(ctx);
      return inCancelTx(deps.db, c, (tx) => idempotent(tx, ctx, 'POST /staff/bookings/:id/cancel', () => staffCancel(tx, c, i['id'], i)));
    }),
    route({ method: 'POST', path: '/staff/bookings/:id/mark', permission: 'booking.mark' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'admin', ['id', 'kind', 'reason']);
      const i = inputOf(ctx);
      return inCancelTx(deps.db, c, (tx) => idempotent(tx, ctx, 'POST /staff/bookings/:id/mark', () => markBooking(tx, c, i['id'], i)));
    }),
    route({ method: 'POST', path: '/staff/bookings/:id/mark/reverse', permission: 'booking.mark' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'admin', ['id', 'reason']);
      const i = inputOf(ctx);
      return inCancelTx(deps.db, c, (tx) => idempotent(tx, ctx, 'POST /staff/bookings/:id/mark/reverse', () => reverseBookingMark(tx, c, i['id'], i)));
    }),
  ];
}

export function closureRoutes(deps: BookingRouteDeps): BookingRoute<unknown>[] {
  const CLOSURE = ['courtIds', 'start', 'end', 'repeat'];
  return [
    route({ method: 'POST', path: '/staff/closures/preview', permission: 'closure.write' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'admin', CLOSURE);
      return inCancelTx(deps.db, c, (tx) => previewClosure(tx, inputOf(ctx)));
    }),
    route({ method: 'POST', path: '/staff/closures', permission: 'closure.write' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'admin', [...CLOSURE, 'reason']);
      return inCancelTx(deps.db, c, (tx) => idempotent(tx, ctx, 'POST /staff/closures', () => createClosure(tx, inputOf(ctx))));
    }),
    route({ method: 'GET', path: '/staff/closures', permission: 'closure.write' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'admin', []);
      return inCancelTx(deps.db, c, (tx) => listClosures(tx));
    }),
    route({ method: 'POST', path: '/staff/closures/:id/end', permission: 'closure.write' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'admin', ['id', 'newEnd', 'reason']);
      const i = inputOf(ctx);
      return inCancelTx(deps.db, c, (tx) => idempotent(tx, ctx, 'POST /staff/closures/:id/end', () => endClosure(tx, i['id'], i)));
    }),
    route({ method: 'GET', path: '/staff/closures/:id/expired-packages', permission: 'closure.write' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'admin', ['id']);
      return inCancelTx(deps.db, c, (tx) => closureExpiredPackages(tx, inputOf(ctx)['id']));
    }),
    route({ method: 'GET', path: '/staff/closures/:id/unmessaged', permission: 'closure.write' }, async (ctx) => {
      const c = await contextFor(deps, ctx, 'admin', ['id']);
      return inCancelTx(deps.db, c, (tx) => closureUnmessaged(tx, inputOf(ctx)['id']));
    }),
  ];
}
