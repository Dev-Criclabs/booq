// F09 acceptance criteria proven by tests next to the code.
import { traced } from './trace';


// Criteria the lane's tests name by ID (added 31 Oct): the trace checks the ID is still cited in those files.
traced("F09/CANCEL-01-AC1", "Given a booking and the club's cancel window (Hunter 12 hours), when a player op", [{ file: "packages/db/src/return-booking-value.test.ts", has: "CANCEL-01-AC1" }, { file: "packages/db/src/cancel-outcome.test.ts", has: "CANCEL-01-AC1" }]);
traced("F09/CANCEL-01-AC2", "Given a cancel at exactly 12 hours 00 minutes 00 seconds before start or earlier", [{ file: "packages/db/src/cancel-outcome.test.ts", has: "CANCEL-01-AC2" }]);
traced("F09/CANCEL-01-AC3", "Given a booking paid by package credit, when it is cancelled in time, then a `re", [{ file: "packages/db/src/return-booking-value.test.ts", has: "CANCEL-01-AC3" }]);
traced("F09/CANCEL-01-AC8", "Given a promo code used on the order, when only some hours of the order are canc", [{ file: "packages/db/src/cancel-order-effects.test.ts", has: "CANCEL-01-AC8" }]);
traced("F09/CANCEL-01-AC10", "Given a late cancel (under the window) or a no show, when it is confirmed or mar", [{ file: "packages/db/src/return-booking-value.test.ts", has: "CANCEL-01-AC10" }]);
traced("F09/CANCEL-01-AC11", "Given a credit reserved before its package expired, when the booking is cancelle", [{ file: "packages/db/src/credit-functions.test.ts", has: "CANCEL-01-AC11" }, { file: "packages/db/src/booking-cancel.test.ts", has: "CANCEL-01-AC11" }]);
traced("F09/CANCEL-01-AC13", "Given a cancel, when it is saved, then the slot, the coach (for a solo class) an", [{ file: "packages/db/src/cancel-booking.test.ts", has: "CANCEL-01-AC13" }, { file: "packages/db/src/cancel-handlers.test.ts", has: "CANCEL-01-AC13" }]);
traced("F09/CANCEL-01-AC18", "Given a solo class whose coach was changed (F07 R4), when the customer cancels, ", [{ file: "packages/db/src/coach-substitution.test.ts", has: "CANCEL-01-AC18" }]);
traced("F09/CANCEL-03-AC1", "Given front desk or the Owner in A12, when they create a closure (courts, start,", [{ file: "packages/db/src/closure.test.ts", has: "CANCEL-03-AC1" }, { file: "packages/db/src/closure-create.test.ts", has: "CANCEL-03-AC1" }]);
traced("F09/CANCEL-03-AC2", "Given the closure is confirmed, when it is saved, then each affected booking is ", [{ file: "packages/db/src/cancel-outcome.test.ts", has: "CANCEL-03-AC2" }, { file: "packages/db/src/closure-create.test.ts", has: "CANCEL-03-AC2" }]);
traced("F09/CANCEL-03-AC9", "Given a repeat closure (for example every Monday), when it is confirmed, then it", [{ file: "packages/db/src/closure.test.ts", has: "CANCEL-03-AC9" }]);
traced("F09/CANCEL-03-AC12", "Given a closure cancels a booking whose package has already expired (the credit ", [{ file: "packages/db/src/credit-functions.test.ts", has: "CANCEL-03-AC12" }]);
traced("F09/CANCEL-03-AC16", "Given a closure created while a booking is being created in the same range, when", [{ file: "packages/db/src/closure-create.test.ts", has: "CANCEL-03-AC16" }]);
traced("F09/CANCEL-04-AC1", "Given a confirmed booking, when its slot ends (Bangkok time), then its status be", [{ file: "packages/db/src/booking-cancel.test.ts", has: "CANCEL-04-AC1" }]);
traced("F09/CANCEL-04-AC3", "Given a confirmed booking whose player did not come, when staff mark No show in ", [{ file: "packages/db/src/staff-marks.test.ts", has: "CANCEL-04-AC3" }]);
traced("F09/CANCEL-04-AC4", "Given a late cancel that happened outside the app (the player phoned the desk), ", [{ file: "packages/db/src/staff-marks.test.ts", has: "CANCEL-04-AC4" }]);
traced("F09/CANCEL-04-AC5", "Given staff reverse a No show or Late cancel, when they do it with a reason, the", [{ file: "packages/db/src/staff-marks.test.ts", has: "CANCEL-04-AC5" }]);
