// F09 acceptance sweep gate (QA, same style as F04-gate.new.spec.ts). Every criterion has a real test (a traced pointer or a QA test) or is listed with its reason.
// A listed criterion that gains a test fails as stale, so the list only shrinks. Where a criterion is traced for its database side only, docs/qa/f09-sweep.md says so.
import { defineGate } from './gate';

defineGate('F09', {
  'F09/CANCEL-01-AC7': 'add-ons return with the booking: no test builds a booking with an add-on line through the cancel (return_booking_value returns every line of the booking, proved for credit, wallet and money lines)',
  'F09/CANCEL-01-AC12': 'a Student credit held by a player who is now an Adult returns on a cancel: credit-functions.test.ts proves the credit stays valid until expiry (PKG-02-AC5, D84), the cancel of it is not named',
  'F09/CANCEL-01-AC19': 'the Cancellation result message to the player: the producer is F09-T11 and is not built (cancel_booking says so in its header)',
  'F09/CANCEL-04-AC8': 'the coach marking Absent in K5 as a hint: the portal is not built (F12); the mark itself is tested in coach-attendance-note.test.ts',
  'F09/CANCEL-04-AC11': 'the referral reward reads played: F14 is not built',
}, 57);
