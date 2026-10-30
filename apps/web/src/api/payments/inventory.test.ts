import { describe, expect, it } from 'vitest';
import type { Db } from '@booq/db';
import { createWebTable } from '../../server/context';

// F05-T03 (PAY-01-AC9, AC10, PAY-05, CANCEL-02; D26; design 5.1, 5.7, 5.8): the route inventory. No route
// simulates or forces a payment, marks one paid, or returns money; a booking is confirmed only by a verified
// callback or lookup (the Beam webhook) or by staff cash (PAY-06), never by a route the player can call.
const table = createWebTable({
  db: {} as Db,
  verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) },
  now: () => new Date('2026-10-30T00:00:00Z'),
  config: { sessionSeconds: 60, maxBodyBytes: 1000, importLimits: null },
}).table;

describe('payment route inventory', () => {
  it('no route simulates, forces or marks a payment, or refunds or withdraws money', () => {
    for (const r of table) {
      expect(`${r.def.method} ${r.def.path}`).not.toMatch(/simulat|force|mark[-_]?paid|refund|withdraw|cash[-_]?out|payout/i);
    }
  });
  it('no player or public route confirms a booking or a payment', () => {
    for (const r of table) {
      if (!(r.def.public === true || r.def.needsPerson === true)) continue;
      expect(`${r.def.method} ${r.def.path}`).not.toMatch(/confirm|\/paid|succeed/i);
    }
  });
});
