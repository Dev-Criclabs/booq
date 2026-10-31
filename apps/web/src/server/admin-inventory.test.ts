import { describe, expect, it } from 'vitest';
import type { Db } from '@booq/db';
import { createWebTable } from './context';

// F11-T11 (ADMIN-01 to ADMIN-17): the route inventory of the club admin console, page by page (F11 design 5). Every route an admin page
// calls is either mounted with the permission the design names, or listed as a known gap that another feature owns. When a gap is built
// this test fails on purpose: move the line from GAPS to BUILT. A route that is not in either list but looks like a console route is
// also a failure, so a new console route cannot appear without an entry here. The removed pages (A3, A11, A15, the slip queue) have none.

const touch = new Proxy({}, { get: () => { throw new Error('not reachable in this test'); } });
const web = createWebTable({
  db: touch as unknown as Db,
  verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) },
  now: () => new Date('2026-12-07T03:00:00Z'),
  config: { sessionSeconds: 60, maxBodyBytes: 10_000, importLimits: null },
}).table;
const mounted = new Map(web.map((r) => [`${r.def.method} ${r.def.path}`, r.def.permission ?? (r.def.public ? 'public' : r.def.needsPerson ? 'person' : '')]));

// route -> permission, by page.
const BUILT: Record<string, string[]> = {
  shell: ['GET /staff/shell staff.shell'],
  A0: ['GET /staff/setup setup.read', 'POST /staff/setup/done setup.done', 'POST /imports import.run', 'POST /imports/:id/confirm import.run', 'GET /imports/:id import.run', 'DELETE /imports/:id import.run'],
  A1: ['GET /staff/calendar calendar.read', 'PUT /staff/bookings/:id/move booking.move', 'GET /courts public'],
  A2: [
    'POST /staff/orders/quote booking.create.staff', 'POST /staff/orders/pay booking.create.staff', 'POST /staff/bookings/:id/release booking.create.staff',
    'GET /staff/bookings/:id/history booking.create.staff', 'GET /bookings/:id booking.read.own', 'POST /bookings/:id/coach person', 'POST /staff/customers customer.write',
    'GET /staff/bookings/:id/cancel-preview booking.cancel.staff', 'POST /staff/bookings/:id/cancel booking.cancel.staff', 'POST /staff/bookings/:id/mark booking.mark',
    'POST /staff/bookings/:id/mark/reverse booking.mark',
  ],
  A5: ['GET /staff/customers customer.contact.read', 'GET /staff/customers/csv customer.export', 'POST /staff/customers/:id/tags customer.write', 'DELETE /staff/customers/:id/tags/:tag customer.write'],
  A6: [
    'GET /staff/customers/:id customer.contact.read', 'GET /staff/customers/:id/bookings customer.contact.read', 'GET /staff/customers/:id/orders customer.contact.read',
    'GET /staff/customers/:id/notes customer.contact.read', 'GET /staff/customers/:id/receipts customer.contact.read', 'POST /staff/customers/:id/notes customer.write', 'GET /staff/customers/:id/credits customer.contact.read',
    'POST /staff/customers/:id/credit-adjust customer.adjust', 'POST /staff/customers/:id/wallet-adjust customer.adjust', 'POST /staff/packages/:id/extend package.extend',
    'GET /customers/:id/dob-history customer.dob-history.read', 'GET /claims claim.handle', 'POST /claims/:id/confirm claim.handle', 'POST /claims/:id/reject claim.handle',
    'GET /data-requests datarequest.handle', 'POST /data-requests/:id/handle datarequest.handle',
  ],
  A7: [
    'GET /staff/coaches coach.read', 'GET /staff/coaches/:id coach.manage', 'PUT /staff/coaches/:id coach.manage', 'GET /staff/coaches/:id/pay coach.pay', 'PUT /staff/coaches/:id/pay coach.pay',
    'GET /staff/leave coach.leave.decide', 'POST /staff/leave/:id/decision coach.leave.decide', 'GET /staff/leave-calendar coach.read', 'GET /staff/flagged-sessions coach.substitute',
    'GET /staff/bookings/:id/substitutes coach.substitute', 'POST /staff/bookings/:id/substitute coach.substitute', 'GET /coach/availability coach.self', 'PUT /coach/availability coach.self',
    'GET /coach/leave coach.self', 'POST /coach/leave coach.self',
  ],
  A8: [
    'GET /staff/class-templates class.session.read', 'POST /staff/class-templates class.template', 'PUT /staff/class-templates/:id class.template', 'GET /staff/class-sessions class.session.read',
    'PUT /staff/class-sessions/:id class.session.edit', 'POST /staff/class-sessions/:id/cancel class.session.cancel', 'POST /staff/class-sessions/:id/resolve class.session.edit',
    'GET /staff/class-sessions/:id/roster class.roster.read', 'GET /staff/waitlist class.session.read',
  ],
  A9: [
    'GET /staff/setup/price-groups price.read', 'POST /staff/setup/price-groups price.write', 'PUT /staff/setup/price-groups/:id price.write', 'DELETE /staff/setup/price-groups/:id price.write',
    'GET /staff/setup/court-prices price.read', 'POST /staff/setup/court-prices price.write', 'PUT /staff/setup/court-prices/:id price.write', 'DELETE /staff/setup/court-prices/:id price.write',
    'GET /staff/setup/coach-tiers price.read', 'POST /staff/setup/coach-tiers price.write', 'PUT /staff/setup/coach-tiers/:id price.write', 'DELETE /staff/setup/coach-tiers/:id price.write',
    'GET /staff/setup/coach-tier-prices price.read', 'PUT /staff/setup/coach-tier-prices price.write',
    'GET /staff/setup/package-products price.read', 'POST /staff/setup/package-products price.write', 'PUT /staff/setup/package-products/:id price.write',
    'GET /staff/setup/add-ons price.read', 'POST /staff/setup/add-ons price.write', 'PUT /staff/setup/add-ons/:id price.write', 'DELETE /staff/setup/add-ons/:id price.write',
  ],
  A10: [
    'GET /staff/setup/partners price.read', 'POST /staff/setup/partners price.write', 'PUT /staff/setup/partners/:id price.write', 'DELETE /staff/setup/partners/:id price.write',
    'GET /staff/setup/promo-codes price.read', 'POST /staff/setup/promo-codes price.write', 'PUT /staff/setup/promo-codes/:id price.write', 'DELETE /staff/setup/promo-codes/:id price.write',
  ],
  A13: [
    'GET /staff/coach-pay payout.read', 'GET /staff/coach-pay/csv payout.read', 'POST /staff/coach-pay/:id/adjustments payout.adjust', 'POST /staff/coach-pay/:id/paid payout.pay',
    'GET /staff/reports/:name report.read', 'GET /staff/reports/:name/csv report.read', 'GET /staff/daily-close daily-close.run', 'GET /staff/daily-close/csv daily-close.run', 'POST /staff/daily-close daily-close.run'],
  A14: ['GET /staff/receipts receipt.list', 'GET /staff/receipts/:id/pdf receipt.print', 'POST /staff/receipts/:id/void receipt.void'],
  A16: [
    'PUT /club/business club.business.write', 'GET /club/setup settings.business.read',
    'GET /settings settings.business.read', 'PUT /settings/:key settings.write', 'PUT /hours hours.write', 'POST /resources resource.write', 'PUT /resources/:id resource.write',
    'PUT /support-window support-window.write',
    'POST /exports export.run', 'GET /exports/:id export.run',
  ],
  A12: [
    'POST /staff/closures/preview closure.write', 'POST /staff/closures closure.write', 'GET /staff/closures closure.write', 'POST /staff/closures/:id/end closure.write',
    'GET /staff/closures/:id/expired-packages closure.write', 'GET /staff/closures/:id/undelivered closure.write',
  ],
  A17: ['GET /staff staff.manage', 'POST /staff/invites staff.manage', 'GET /staff/invites staff.manage', 'PUT /staff/:userId/roles roles.assign', 'POST /staff/:userId/deactivate staff.manage', 'GET /staff/audit audit.read', 'GET /staff/audit/record-types audit.read', 'POST /staff/invites/:id/cancel staff.manage'],
};

// Routes the design needs that another feature owns and that are not mounted yet (F11 design 5; the owner of each is named).
const GAPS: Record<string, string[]> = {
  A2: ['POST /staff/bookings (F03)', 'POST /staff/orders/:id/package-sale (F06)'],
  A13: ['GET /staff/reports/owed (F06)'],
  A16: ['GET /staff/rich-menu (F10)', 'PUT /staff/rich-menu/labels (F10)'],
};

describe('F11 route inventory (design 5)', () => {
  for (const [page, routes] of Object.entries(BUILT)) {
    it(`${page}: every route is mounted with the permission the design names`, () => {
      for (const r of routes) {
        const [method, path, permission] = r.split(' ') as [string, string, string];
        expect(mounted.get(`${method} ${path}`), r).toBe(permission);
      }
    });
  }
  it('known gaps are still gaps (when one is built, move it to BUILT)', () => {
    for (const routes of Object.values(GAPS)) {
      for (const g of routes) {
        const [method, path] = g.split(' ') as [string, string];
        if (mounted.get(`${method} ${path}`) === undefined) continue;
        throw new Error(`${g} is mounted now: move it to BUILT with its permission`);
      }
    }
  });
  it('no removed page has a route (A3 check-in, A11 vouchers, A15 message editor, the slip queue)', () => {
    const paths = [...mounted.keys()].filter((r) => /check-?in|voucher|gift|slip|message-editor/i.test(r) && !/webhook/i.test(r));
    expect(paths).toEqual([]);
  });
  it('every /staff route is a known built route, a known gap, or belongs to another page of the design', () => {
    const known = new Set(Object.values(BUILT).flat().map((r) => r.split(' ').slice(0, 2).join(' ')));
    const other = /^(GET|POST|PUT|DELETE) \/staff\/(class-|coach-pay|orders|bookings|invites|reports|receipts|daily|leave|coaches|customers|packages|waitlist|audit|setup|calendar|shell|flagged|:)/;
    const loose = [...mounted.keys()].filter((r) => r.includes('/staff') && !known.has(r) && !other.test(r));
    expect(loose).toEqual([]);
  });
});
