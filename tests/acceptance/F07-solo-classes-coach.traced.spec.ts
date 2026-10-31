// F07 acceptance criteria proven by tests next to the code.
import { traced } from './trace';


// Criteria the lane's tests name by ID (added 31 Oct): the trace checks the ID is still cited in those files.
traced("F07/COACH-01-AC1", "Given a coach on approved leave for that hour, when checkout or the schedule ask", [{ file: "packages/db/src/coach-rules.test.ts", has: "COACH-01-AC1" }]);
traced("F07/COACH-01-AC4", "Given a coach who has taught 6 hours in a row (back to back hours; a free hour i", [{ file: "packages/db/src/coach-rules.test.ts", has: "COACH-01-AC4" }]);
traced("F07/COACH-01-AC7", "Given the hour changes on checkout, when the player picks a different slot, then", [{ file: "packages/db/src/coach-offers.test.ts", has: "COACH-01-AC7" }, { file: "apps/web/src/api/coaches/routes.test.ts", has: "COACH-01-AC7" }]);
traced("F07/COACH-01-AC8", "Given a coach whose availability or leave changes after a booking exists, when t", [{ file: "packages/db/src/coach-admin.test.ts", has: "COACH-01-AC8" }]);
traced("F07/COACH-02-AC1", "Given a coach picked at court checkout, when the order is priced, then the order", [{ file: "packages/db/src/coach-prices.test.ts", has: "COACH-02-AC1" }, { file: "packages/db/src/coach-offers.test.ts", has: "COACH-02-AC1" }, { file: "apps/web/src/api/coaches/routes.test.ts", has: "COACH-02-AC1" }]);
traced("F07/COACH-02-AC3", "Given the owner sets a price override for one coach, when that coach is priced, ", [{ file: "packages/db/src/coach-tables.test.ts", has: "COACH-02-AC3" }, { file: "packages/db/src/coach-admin.test.ts", has: "COACH-02-AC3" }]);
traced("F07/COACH-02-AC4", "Given a tier or coach with no price (the Head Coach price is empty), when the co", [{ file: "apps/web/src/api/coaches/routes.test.ts", has: "COACH-02-AC4" }]);
traced("F07/COACH-03-AC3", "Given Add a coach after booking (from C12), when it is priced, then only the coa", [{ file: "packages/db/src/apply-payment-coach-add.test.ts", has: "COACH-03-AC3" }, { file: "apps/web/src/api/coaches/routes.test.ts", has: "COACH-03-AC3" }, { file: "apps/worker/src/tasks/hold-release.test.ts", has: "COACH-03-AC3" }]);
traced("F07/R1-AC1", "Given C5, when it loads, then each card shows photo, name, rate tier, specialtie", [{ file: "packages/db/src/coach-offers.test.ts", has: "R1-AC1" }]);
traced("F07/R1-AC4", "Given a time with the coach free and a court open, when the player picks it, the", [{ file: "packages/db/src/coach-offers.test.ts", has: "R1-AC4" }]);
traced("F07/R1-AC6", "Given a guest, when they browse C5 and C6, then it loads without sign in; sign i", [{ file: "packages/db/src/coach-offers.test.ts", has: "R1-AC6" }]);
traced("F07/R1-AC7", "Given a coach photo, bio or certification set by the club, when it is shown, the", [{ file: "packages/db/src/coach-tables.test.ts", has: "R1-AC7" }, { file: "packages/db/src/coach-admin.test.ts", has: "R1-AC7" }, { file: "packages/db/src/coach-offers.test.ts", has: "R1-AC7" }]);
traced("F07/R2-AC1", "Given a coach in K3, when they save a weekly rule or a one off time, then it is ", [{ file: "packages/db/src/coach-admin.test.ts", has: "R2-AC1" }]);
traced("F07/R2-AC2", "Given a coach requests leave (dates, full or half day, type, note) in K4, when i", [{ file: "packages/db/src/coach-admin.test.ts", has: "R2-AC2" }]);
traced("F07/R2-AC3", "Given the owner approves or declines, when it is saved, then the coach gets a LI", [{ file: "packages/db/src/coach-admin.test.ts", has: "R2-AC3" }]);
traced("F07/R2-AC4", "Given a coach's rules are changed so that a booked hour is no longer open, when ", [{ file: "packages/db/src/coach-admin.test.ts", has: "R2-AC4" }]);
traced("F07/R2-AC5", "Given availability, leave and decisions, when any is changed, then it is audited", [{ file: "packages/db/src/coach-admin.test.ts", has: "R2-AC5" }]);
traced("F07/R2-AC6", "Given a coach, when they view K3 and K4, then they see only their own rules and ", [{ file: "packages/db/src/coach-admin.test.ts", has: "R2-AC6" }, { file: "packages/db/src/coach-policies.test.ts", has: "R2-AC6" }]);
traced("F07/R3-AC1", "Given run length is the count of back to back hours around the requested hour, w", [{ file: "packages/db/src/coach-rules.test.ts", has: "R3-AC1" }]);
traced("F07/R3-AC2", "Given a free hour between two teaching hours, when the run is counted, then the ", [{ file: "packages/db/src/coach-rules.test.ts", has: "R3-AC2" }]);
traced("F07/R3-AC3", "Given an unpaid held hour, when the run is counted, then it counts (D19).", [{ file: "packages/db/src/coach-rules.test.ts", has: "R3-AC3" }]);
traced("F07/R3-AC6", "Given the cap setting is empty, when F07 reads it, then the default 6 applies; t", [{ file: "packages/db/src/coach-add.test.ts", has: "R3-AC6" }]);
traced("F07/R3-AC7", "Given the run is checked inside the booking transaction, when two bookings race,", [{ file: "packages/db/src/coach-rules.test.ts", has: "R3-AC7" }]);
traced("F07/R4-AC1", "Given a flagged session (approved leave), when the owner opens substitution in A", [{ file: "packages/db/src/coach-substitution.test.ts", has: "R4-AC1" }]);
traced("F07/R4-AC2", "Given the owner picks a substitute, when it is saved, then the session moves to ", [{ file: "packages/db/src/coach-substitution.test.ts", has: "R4-AC2" }]);
traced("F07/R4-AC3", "Given a substitution, when it is saved, then each customer gets Coach changed na", [{ file: "packages/db/src/coach-substitution.test.ts", has: "R4-AC3" }]);
traced("F07/R4-AC4", "Given a solo class customer, when the coach is changed, then they may cancel for", [{ file: "packages/db/src/coach-substitution.test.ts", has: "R4-AC4" }]);
traced("F07/R4-AC5", "Given the session price, when a substitute is assigned, then the customer's pric", [{ file: "packages/db/src/coach-substitution.test.ts", has: "R4-AC5" }]);
traced("F07/R4-AC6", "Given a substitute, when the owner assigns one, then the rest rule applies to th", [{ file: "packages/db/src/coach-substitution.test.ts", has: "R4-AC6" }]);
traced("F07/R5-AC1", "Given a solo class booking, when it is stored, then it has both a coach and a co", [{ file: "packages/db/src/coach-add.test.ts", has: "R5-AC1" }]);
traced("F07/R5-AC2", "Given a two hour solo selection, when it is paid, then it is one order with one ", [{ file: "packages/db/src/coach-add.test.ts", has: "R5-AC2" }]);
traced("F07/R6-AC1", "Given approved leave or a closed time over booked sessions, when it is saved, th", [{ file: "packages/db/src/coach-substitution.test.ts", has: "R6-AC1" }, { file: "packages/db/src/coach-add.test.ts", has: "R6-AC1" }]);
traced("F07/R6-AC2", "Given a flagged session, when no substitute is picked, then the session stays bo", [{ file: "packages/db/src/coach-substitution.test.ts", has: "R6-AC2" }]);
traced("F07/R6-AC3", "Given a coach with future sessions, when the owner tries to deactivate them, the", [{ file: "packages/db/src/coach-admin.test.ts", has: "R6-AC3" }]);

// Criteria traced by hand in the F07/F08 sweep (31 Oct).
traced("F07/COACH-01-AC2", "Given a coach with no availability rule open for that hour (weekly rule or one o", [{ file: "packages/db/src/coach-rules.test.ts", has: "no rule means never offered; a weekly rule covers its weekday and hours only" }, { file: "packages/db/src/coach-rules.test.ts", has: "an open rule on a date works without a weekly one" }]);
traced("F07/COACH-01-AC3", "Given a coach already booked for that hour (a confirmed solo class, a group clas", [{ file: "packages/db/src/coach-rules.test.ts", has: "a confirmed solo class, a held hour and a group class block the same hour" }]);
traced("F07/COACH-01-AC5", "Given the rest cap setting (default 6), when the owner changes it, then the new ", [{ file: "packages/db/src/coach-rules.test.ts", has: "the cap is the setting rest_cap_hours" }]);
traced("F07/COACH-01-AC6", "Given what counts toward the run, then solo classes, group classes and staff boo", [{ file: "packages/db/src/coach-rules.test.ts", has: "unpaid held hours count, an expired hold does not, and a group class counts" }]);
traced("F07/COACH-01-AC9", "Given a leave request that is pending, when coaches are listed, then the coach i", [{ file: "packages/db/src/coach-offers.test.ts", has: "a pending leave still offers the coach (D120)" }]);
traced("F07/COACH-01-AC10", "Given an inactive coach, when coaches are listed, then they are not offered.", [{ file: "packages/db/src/coach-offers.test.ts", has: "drops a busy coach, an inactive coach" }]);
traced("F07/COACH-01-AC11", "Given the rest rule check, when two parallel bookings both try to add the 6th an", [{ file: "packages/db/src/coach-rules.test.ts", has: "two parallel bookings of the 6th and the 7th hour give exactly one success" }]);
traced("F07/COACH-01-AC12", "Given staff move or create a booking in A1 or A2, when the coach would break the", [{ file: "packages/db/src/coach-rules.test.ts", has: "the check takes no override argument" }]);
traced("F07/COACH-02-AC2", "Given each coach has a rate tier (for example Head Coach, Coach) with an Adult p", [{ file: "apps/web/src/api/checkout/routes.test.ts", has: "a solo class: Adult 130000, Student 120000" }, { file: "packages/db/src/coach-admin.test.ts", has: "sets, changes and removes an override" }]);
traced("F07/COACH-02-AC7", "Given the coach price, when it is priced, then it follows the price group from t", [{ file: "apps/web/src/api/checkout/routes.test.ts", has: "a solo class: Adult 130000, Student 120000" }, { file: "packages/domain/src/checkout/pricing.test.ts", has: "under 18 on the Bangkok date gets the Student group" }]);
traced("F07/COACH-02-AC8", "Given adding a coach is optional, when the player skips it, then the booking sta", [{ file: "packages/db/src/solo-class.test.ts", has: "a court only booking is not affected" }]);
traced("F07/COACH-03-AC1", "Given a player with solo credits who adds a coach at court checkout (C10), when ", [{ file: "packages/db/src/credit-functions.test.ts", has: "a coach picked at court checkout never uses solo pack credit" }]);
traced("F07/COACH-03-AC4", "Given a solo pack credit is tied to a tier, when it is used, then it works with ", [{ file: "packages/db/src/credit-functions.test.ts", has: "a solo credit fits any coach of its tier only" }]);
