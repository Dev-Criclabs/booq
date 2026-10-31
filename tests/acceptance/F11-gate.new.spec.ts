// F11 acceptance sweep gate (QA, same style as F04-gate.new.spec.ts). Every criterion has a real test (a traced pointer or a QA test) or is listed with its reason.
// A listed criterion that gains a test fails as stale, so the list only shrinks. Where a criterion is traced for its database side only, docs/qa/f11-sweep.md says so.
import { defineGate } from './gate';

defineGate('F11', {
  'F11/ADMIN-03': 'A1 calendar drag onto a held slot is refused: the move route is not built (the database refusal is covered by move-booking.test.ts)',
}, 17);
