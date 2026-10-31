// F10 acceptance sweep gate (QA, same style as F04-gate.new.spec.ts). Every criterion has a real test (a traced pointer or a QA test) or is listed with its reason.
// A listed criterion that gains a test fails as stale, so the list only shrinks. Where a criterion is traced for its database side only, docs/qa/f10-sweep.md says so.
import { defineGate } from './gate';

defineGate('F10', {
  'F10/LINE-02-AC7': 'a Paused club tile opens the paused page: screen (Playwright), the paused banner is proved on C4 in apps/web/e2e/c04-schedule.e2e.mjs',
  'F10/LINE-04-AC4': 'View booking opens that booking inside the club URL: the link target is built in the card (builder.test.ts) and the page /bookings/:id is not built',
  'F10/LINE-04-AC5': 'the same confirmation card for an approved late payment: the late path writes its message, but no test asserts it is booking_confirmed',
  'F10/LINE-05-AC3': 'Cancellation result to a player who cancels: the producer is F09-T11 and is not built',
  'F10/LINE-05-AC4': 'Club closed slot to each affected player: the closure does not write the message yet (the kind exists in the catalogue and the builder)',
}, 63);
