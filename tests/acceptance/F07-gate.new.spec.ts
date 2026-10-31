// F07-T21 acceptance sweep gate (QA). Every F07 criterion (COACH-01 to COACH-04, R1 to R6) has a real test or is listed with its reason.
import { defineGate } from './gate';

defineGate('F07', {
  'F07/COACH-02-AC5': 'the court portion as a club setting: the solo class price uses the court price rule today (F04 R1); the setting is not built',
  'F07/COACH-02-AC6': 'the coach card at checkout (name, tier, specialties, price, Profile link): the C10 screen is not built',
  'F07/COACH-03-AC2': 'a solo credit used when booking through Classes (C5, C6): the Classes solo flow and the reserve at pay time are not built',
  'F07/COACH-03-AC5': 'a solo credit reserved before expiry stays valid for the session: no test names it for solo credits (credit-functions.test.ts covers the rule for court credits, PKG-03-AC9)',
  'F07/COACH-04-AC1': 'a solo class paid with a solo pack credit (coach line 0, court due): the pay path with a solo credit is not built',
  'F07/COACH-04-AC2': 'the court fee paid by Beam on a solo credit order, court and coach held together: waits for the same pay path',
  'F07/COACH-04-AC3': 'the court fee is the same for a Student on a solo credit: waits for the same pay path',
  'F07/COACH-04-AC4': 'a solo credit returns on a cancel 12 hours ahead: waits for the same pay path (the return itself is proved for credits by return-booking-value.test.ts)',
  'F07/R1-AC2': 'C6 coach page (bio, certifications, times by day): the screen is not built; the data is read through the public coach views (coach-offers.test.ts)',
  'F07/R1-AC3': 'C6 shows a time with no court open as unavailable: the screen is not built; the view hides it (coach-offers.test.ts no_court_open)',
  'F07/R1-AC8': 'Classes shows paused for a Paused club on C5: the screen is not built',
  'F07/R5-AC3': 'a future solo class counts toward the player\'s future court hours limit: no test counts a solo class (take-seat.test.ts covers a seat, D59)',
  'F07/R5-AC5': 'a solo class is played when its slot ends and the coach marks Absent: F09 and F12 (the portal is not built)',
}, 60);
