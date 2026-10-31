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

// Hand mapped in the F09 re-sweep (31 Oct): the lane's tests write these as AC9, AC14 and so on, without the CANCEL-01 prefix.
traced("F09/CANCEL-01-AC4", "Given a booking paid by money (Beam or cash), when it is cancelled in time, then", [{ file: "packages/db/src/cancel-booking.test.ts", has: "the booking is cancelled, its slot is free, the money is in the wallet" }]);
traced("F09/CANCEL-01-AC5", "Given a booking paid partly by wallet, when it is cancelled in time, then the wa", [{ file: "packages/db/src/return-booking-value.test.ts", has: "a mixed line: credit back to the package, wallet use back, money into the wallet as refund" }]);
traced("F09/CANCEL-01-AC6", "Given a mixed payment (credit, wallet and money), when it is cancelled in time, ", [{ file: "packages/db/src/cancel-outcome.test.ts", has: "in time: each part of a mixed line returns to its source; money goes to the wallet" }]);
traced("F09/CANCEL-01-AC9", "Given a two hour order, when the player cancels one hour, then only that hour is", [{ file: "packages/db/src/cancel-booking.test.ts", has: "cancelling one hour of a two hour order frees only that hour" }]);
traced("F09/CANCEL-01-AC23", "Given one hour of an order is cancelled in time, when its money returns, then th", [{ file: "packages/db/src/return-booking-value.test.ts", has: "one hour of a two hour order returns only that hour" }]);
traced("F09/CANCEL-01-AC14", "Given a second tap on Confirm cancel, or two devices, when both arrive, then the", [{ file: "packages/db/src/cancel-booking.test.ts", has: "a second tap and a second device return the same cancel" }]);
traced("F09/CANCEL-01-AC15", "Given a booking that has already started or ended, when a player tries to cancel", [{ file: "packages/db/src/cancel-outcome.test.ts", has: "a booking that has started is refused for everyone" }]);
traced("F09/CANCEL-01-AC16", "Given a booking that is Awaiting payment (a hold), when the player abandons it, ", [{ file: "packages/db/src/cancel-booking.test.ts", has: "a booking awaiting payment is released through release_hold, not cancelled here" }]);
traced("F09/CANCEL-01-AC17", "Given a class seat, when the player cancels in time, then the group credit (or m", [{ file: "packages/db/src/return-booking-value.test.ts", has: "the seat holder gets the money of the seat in the wallet as refund" }]);
traced("F09/CANCEL-01-AC20", "Given staff cancel for a player (A2), when it is saved, then the same window app", [{ file: "packages/db/src/cancel-booking.test.ts", has: "staff cancel for a player with a reason; a club cancel returns in full whatever the time" }]);
traced("F09/CANCEL-01-AC21", "Given a Paused club, when a player cancels an existing booking, then it is allow", [{ file: "packages/db/src/cancel-booking.test.ts", has: "a Paused club still lets a player cancel an existing booking" }]);
traced("F09/CANCEL-01-AC22", "Given any return, when it is saved, then the ledger rows and the booking status ", [{ file: "packages/db/src/cancel-booking.test.ts", has: "a failing cancel handler rolls everything back" }]);
traced("F09/CANCEL-03-AC3", "Given the closure, when it is saved, then the slots are closed in the same trans", [{ file: "packages/db/src/closure-create.test.ts", has: "a booking in the closed range afterwards is refused" }]);
traced("F09/CANCEL-03-AC4", "Given a closed slot, when the schedule or coach availability loads, then the slo", [{ file: "packages/db/src/closure-create.test.ts", has: "a booking in the closed range afterwards is refused" }]);
traced("F09/CANCEL-03-AC5", "Given a slot in the closed range that is in a payment hold, when the closure is ", [{ file: "packages/db/src/closure-create.test.ts", has: "a payment that arrives after the hold was closed cannot reclaim the slot" }]);
traced("F09/CANCEL-03-AC6", "Given a group class session in the closed range, when the closure is confirmed, ", [{ file: "packages/db/src/closure-create.test.ts", has: "a group class session in the range is cancelled and its court freed" }]);
traced("F09/CANCEL-03-AC8", "Given a booking in the closed range that is already played (its slot has ended),", [{ file: "packages/db/src/closure-create.test.ts", has: "a played booking is untouched and a started one keeps its hour" }]);
traced("F09/CANCEL-03-AC13", "Given a closure over a Paused club, when it is created, then it works as for a L", [{ file: "packages/db/src/closure-create.test.ts", has: "works in a Paused club" }]);
traced("F09/CANCEL-03-AC15", "Given a closure over many bookings, when it is confirmed, then it is applied as ", [{ file: "packages/db/src/closure-create.test.ts", has: "exactly one outcome stands" }]);
traced("F09/CANCEL-03-AC17", "Given Front desk and Owner only, when anyone else tries to create a closure, the", [{ file: "packages/db/src/closure-create.test.ts", has: "refuses a player, a missing reason, an unknown court" }]);
traced("F09/CANCEL-04-AC6", "Given staff try to mark a no show before the slot has ended, when they do, then ", [{ file: "packages/db/src/staff-marks.test.ts", has: "before the slot ends it is refused; after, the booking is No show" }]);
traced("F09/CANCEL-04-AC7", "Given a reversal of a no show or late cancel, when it is saved, then coach pay c", [{ file: "packages/db/src/staff-marks.test.ts", has: "a reversed no show is confirmed again (reads Played) and the credit comes back by a new return row" }]);
traced("F09/CANCEL-04-AC10", "Given front desk and owner only, when anyone else tries to mark or reverse, then", [{ file: "packages/db/src/staff-marks.test.ts", has: "a reason is required, front desk or owner only, and only a confirmed booking" }]);

// Added by trace-lane.py: criteria the lane's tests name by ID.
traced("F09/CANCEL-03-AC11", "Given a closure is removed or shortened, when it is saved, then the slots become", [{ file: "packages/db/src/closure-end-roll.test.ts", has: "CANCEL-03-AC11" }]);

// Sweep T21/T19/T22 (31 Oct): by title.
traced("F09/CANCEL-02-AC2", "Given a cancel, closure, failed payment or wrong amount, when value returns, the", [{ file: "packages/db/src/return-booking-value.test.ts", has: "a mixed line: credit back to the package, wallet use back, money into the wallet as refund" }]);
traced("F09/CANCEL-02-AC6", "Given the owner or front desk, when they want to give a player money back, then ", [{ file: "packages/db/src/wallet-functions.test.ts", has: "front desk and owner adjust with a written note; the row names the staff member and is audited" }]);
traced("F09/CANCEL-03-AC10", "Given the owner wants to change opening hours or remove a court under existing b", [{ file: "packages/db/src/live-occupancy.test.ts", has: "shortening hours over a live booking is refused with the closure hint code" }]);
traced("F09/CANCEL-04-AC2", "Given a booking that is Awaiting payment, Cancelled or Released, when its slot e", [{ file: "packages/db/src/booking-cancel.test.ts", has: "a cancelled, late cancelled, no show or released booking keeps its stored status after the slot ends" }]);
