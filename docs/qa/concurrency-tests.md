# Concurrency test design

Covers **BOOK-04** (no double booking of a court or a coach, including during holds), the solo class all or nothing rule, and the other places where two requests at the same moment could break money, receipts or limits. Written 30 Oct 2026, updated for decisions D18 to D28. No app code exists yet, so scenarios are written against the data model in the hand-off (Booking, Resource, Coach, Credit ledger, Wallet ledger, Order and payment, Receipt) and use placeholders such as `holdSlot()` for the real API call. Names will be bound when F03 `design.md` is approved.

Requirement sources: BOOK-03, BOOK-04, BOOK-05, COACH-01, PAY-02, PAY-03, RCPT-01, PKG-01, CLASS-02, PROMO-01. Handoff, Data model, *Integrity rules*: "Court and coach are reserved in one transaction with a uniqueness rule, including during the payment hold. A solo class reserves both or neither."

## 1. What "exactly one succeeds" means

For a set of N requests that all want the same resource and overlapping time, after all have returned:

1. Exactly **one** request returned success (a hold or a confirmed booking).
2. The other N-1 returned a **typed conflict** (court taken, coach taken, slot held, rest rule). Not a 500, not a timeout, not a deadlock error leaking to the client. Postgres serialization failures and deadlocks are retried inside the server; the client only ever sees success or a business conflict.
3. The database holds exactly one active row for that resource and time (checked directly in SQL, not through the API).
4. The losers left **nothing behind**: no hold, no order in a paid state, no coach row, no credit reserved, no wallet movement, no LINE push, no audit entry that says they succeeded.
5. The winner can pay and be confirmed; the losers can immediately pick another slot.

"Active" means a booking that is held (hold not expired) or confirmed. Cancelled, released and expired rows do not count.

## 2. Harness

All concurrency tests are integration tests in `tests/concurrency/`, on a real Postgres (see `test-strategy.md` section 2), with real separate connections (a connection pool of at least N). A rolled back transaction per test cannot be used.

**`tests/support/parallel.ts`** (skeleton in the repo) provides:

- `raceAll(tasks)`: starts every task, holds them behind a barrier, releases them in the same tick, returns each outcome (`{status: 'ok'|'error', value|error, startedAt, endedAt}`).
- `repeat(n, fn)`: runs a race n times in fresh fixtures (default 50 per scenario locally, 500 in the nightly run) because races fail rarely.
- `jitter(maxMs)`: optional random delay before a task to cover different interleavings.

**Fixtures.** Fresh club A (Hunter fixture) and club B each iteration: 2 courts, 06:00 to 24:00, three coaches (two Coach tier, one Head Coach; the Head Coach price is a fixture value because the PRD marks it TBD), players P1 to P20 (Adult) and S1 (Student). A single target slot, for example `2026-12-08 18:00 to 19:00 Asia/Bangkok`. The fake clock is frozen at `2026-12-07T09:00+07:00`, so a hold of 15 minutes expires at a known instant.

**Oracle.** After every race a helper runs invariant queries straight on the database. Illustrative shape (final names from the approved schema):

```sql
-- I1: no two active court bookings overlap on the same court
-- I2: no two active bookings overlap for the same coach
-- I3: every solo class booking has both a court and a coach (never one of them)
-- I4: for every credit ledger: balance = sum(change) and no row is orphaned
-- I5: for every wallet: balance = sum(change)
-- I6: receipt numbers per club are consecutive with no gap and no duplicate
-- I7: no coach has a run of more than 6 consecutive active teaching hours
-- I8: a club never has rows referencing another club's resource
```

The oracle runs after **every** scenario in the suite, not only the one that is about it. That way an unrelated test that corrupts data is caught by the next one.

**Mutation check (QA does this once per constraint).** For each guarantee, QA runs the suite on a scratch database with that guarantee removed (drop the uniqueness constraint, remove the lock). The test must go red. A race test that stays green without the constraint is not proving anything. Result is recorded in the PR that adds the test.

## 3. Court slot races (BOOK-04)

| ID | Scenario | Setup | Action (all at once) | Expected |
|---|---|---|---|---|
| CONC-01 | Two players, same slot | Court 1, 18:00, empty | P1 and P2 tap Pay (hold) | Exactly 1 hold. Loser gets a typed "slot held or taken" conflict |
| CONC-02 | Many players, same slot | Same | 20 players tap Pay | Exactly 1 hold; 19 conflicts; run 500 times in nightly |
| CONC-03 | Overlapping multi hour | Court 1 empty | P1 books 18:00 to 20:00; P2 books 19:00 to 21:00 | Exactly 1 booking succeeds, as a whole. The loser has **no** partial hours (not 20:00 to 21:00). Also the reverse winner |
| CONC-04 | Adjacent hours are not a conflict | Court 1 empty | P1 books 18:00 to 19:00; P2 books 19:00 to 20:00 | Both succeed. Guards against an off by one in the range check |
| CONC-05 | Different courts | Court 1 and 2 empty | P1 books Court 1, P2 books Court 2, same hour | Both succeed. Guards against a rule that locks the whole hour |
| CONC-06 | Different clubs | Club A and club B both have a Court 1 | A player at each club books 18:00 on their Court 1 | Both succeed. The uniqueness rule must include the club or resource, never time alone |
| CONC-07 | Same player double tap | Court 1 empty | P1 sends the same Pay request twice at once | Exactly 1 hold and 1 charge. Both requests return the **same hold and the same QR** (D47). Never two holds, never a 500, never a second charge |
| CONC-08 | Staff vs player | Court 1 empty | Front desk creates a walk in (A2) while a player taps Pay | Exactly 1 succeeds, same rules |

## 4. Races involving holds (BOOK-03 with BOOK-04)

| ID | Scenario | Setup | Action | Expected |
|---|---|---|---|---|
| CONC-09 | Held slot refuses others | P1 holds Court 1 18:00 | P2 to P6 tap Pay at once, then read the schedule | All 5 conflicts, typed "held" (not "taken"); schedule shows the slot as held, not open, not selectable |
| CONC-10 | Expiry boundary | P1 holds at T, expires at T+15:00 | P2 tries at T+14:59.999 and another P3 at T+15:00.001 (fake clock moved between) | First refused as held; second succeeds. At exactly T+15:00 the answer must match the design (hold valid until or after `expires_at`); the test pins whichever the design says, and a boundary row in design.md is required |
| CONC-11 | Expiry job vs new player | P1's hold is expired but the job has not yet run | P2 taps Pay at the same moment `runDueJobs()` runs | P2 succeeds exactly once. P1's release message sent exactly once. No state where both P1 and P2 are active. This is why the testability request says an expired hold must count as released even before the job runs |
| CONC-12 | Late Beam payment vs new player (PAY-03) | P1's hold expired; slot open; P1 has paid at Beam | The late callback for P1 arrives at the same moment P2 taps Pay on the same slot | Exactly one of: P1 approved (and P2 refused), or P2 holds and P1's value goes to the wallet. Never both on the court. Never P1's money lost: either a confirmed booking or a wallet ledger row of the paid amount. Exactly one LINE outcome message for P1. "Still open" is defined by D25: no other hold, booking or closure |
| CONC-13 | Closure vs hold | P1 holds Court 1 18:00 | Staff create a closure covering 18:00 while P1's callback arrives | The closure wins: the hold is cancelled and P1 is told (D48). A callback that arrives afterwards follows PAY-03: not confirmed, whole value to the wallet (closure, D25). Never a confirmed booking inside a closed slot |

## 5. Solo class: court and coach all or nothing

A solo class holds court and coach in one transaction. These tests prove both land or neither does (BOOK-04, Integrity rules).

| ID | Scenario | Setup | Action | Expected |
|---|---|---|---|---|
| CONC-14 | Coach free, court taken | Court 1 18:00 held by P1; coach C1 free; Court 2 also taken | P2 tries solo with C1 at 18:00 | Refused. Coach C1 is **not** held afterwards: P3 can book C1 at 18:00 on any court that is open (open Court 2 in a variant). No orphan coach row |
| CONC-15 | Court free, coach taken | C1 taken at 18:00 by P1 elsewhere; Court 1 free | P2 tries solo with C1 | Refused. Court 1 is **not** held afterwards: P3 can book Court 1 at 18:00 |
| CONC-16 | Same coach, two courts | C1 free; Courts 1 and 2 free | P1 solo with C1 on Court 1 and P2 solo with C1 on Court 2, same hour | Exactly 1 succeeds (coach unique), the loser's court stays open |
| CONC-17 | **Rest rule (6 in a row), write skew** | C1 already teaches 10:00 to 14:00 (four separate 1 hour bookings) | Three requests at once for the hours 14:00, 15:00 and 16:00 (different players) | Invariant I7 holds in every outcome. "In a row" means back to back hours; a free hour in between resets the count; unpaid held hours and uncancelled group classes count (D19). Doing all three would make 10:00 to 17:00, seven in a row, so the set {14, 15, 16} is a failure. Any other result is fine ({14,15} gives six in a row; {14,16} and {15,16} leave a gap), but at least one must succeed. Each request alone passes the rule, so a per row uniqueness cannot catch this. Repeat with solo, group and staff bookings mixed |
| CONC-18 | Solo vs plain court booking | Court 1 18:00 free; C1 free | P1 books Court 1 18:00 alone while P2 books solo with C1 assigned Court 1 | Exactly 1 wins Court 1. If the solo loses on court it must try Court 2 (system assigns the court) or fail cleanly with the coach not held; if Court 2 is open the solo should succeed on Court 2 (assignment is part of the rule, "the system assigns the court") |
| CONC-19 | Two solo classes, one open court | Court 1 taken; Court 2 open; coaches C1 and C2 free | P1 solo with C1 and P2 solo with C2 at once | Exactly 1 succeeds on Court 2. The loser holds neither court nor coach |
| CONC-20 | Group session vs solo vs court | Group session template at 18:00 uses coach C1 and Court 1 (session generated) | Court booking Court 1 18:00, solo with C1 at 18:00, and staff A2 move at once | Exactly one use of coach C1 and Court 1; the session is never double booked. Reverse case: staff create a session while players hold the court |
| CONC-29 | Atomicity under failure | Test hook or a database fault | Make the second insert (coach side) fail after the first (court side) succeeded: inject a constraint violation by pre inserting a conflicting coach row between the two statements, or kill the connection mid transaction | Whole transaction rolls back: no court row, no coach row, no order, no ledger row. Proven for the opposite order too (coach first then court) |

**Why CONC-17 is listed as a race.** The hand-off says court and coach reservations are protected by a uniqueness rule. That rule stops two bookings for one coach at the same hour. It does **not** stop a seventh hour in a row, nor a player exceeding the future hours limit, because each row passes on its own. The design must name the mechanism (an advisory lock per coach and day, a serializable transaction, or a constraint table) and the test proves it. This is raised as testability request 8 in `test-strategy.md` section 7.

## 6. Other invariants that break under races

Not part of BOOK-04, but each is a way money or a legal number can break, so each has a race test.

| ID | Req | Scenario | Expected |
|---|---|---|---|
| CONC-21 | RCPT-01 | 20 payments confirm in parallel for club A, and 5 for club B, some of the 20 fail halfway | Receipt numbers per club are consecutive from the next number, no gap, no duplicate; a failed confirmation leaves no number consumed; club B counts independently. A gapless sequence needs a serialized counter; an ordinary database sequence leaves gaps on rollback, so this test is expected to find a defect if a native sequence is used |
| CONC-22 | CLASS-02 | Waitlist offer sent to P1 with a 30 minute window; P1 taps Claim twice, and the offer expires at the same moment as a claim | One seat, one claim. Expiry vs claim at the boundary resolves one way only and the loser sees a clear message. After expiry the offer passes to the next player once |
| CONC-23 | PROMO-01 | Code with total cap 1, per customer cap 1 (fixture values) | Two players redeem at once: one succeeds. One player redeems twice at once: one succeeds |
| CONC-24 | PKG-01 | Player has exactly 1 court hour credit | Two bookings at once, both paying with that last credit: one uses it, the other pays from wallet then money (order of use is credit, wallet, money, D22) or fails; ledger never goes negative; balance equals ledger sum |
| CONC-25 | PKG-01 | Wallet has ฿500 | Two checkouts at once each applying the wallet: total spent never exceeds ฿500; ledger never negative |
| CONC-26 | PAY-02 | The same valid Beam callback delivered n times in parallel (identical bytes; Beam sends no event id, so the app dedupes on the charge, Q-31) | One confirmation, one receipt, one LINE card, one ledger entry. Later copies are ignored and answer with success (D24) |
| CONC-27 | PAY-02, BOOK-03 | Valid callback arrives at the same moment the expiry job releases the hold | Either confirmed on time or released and then handled as a late callback (PAY-03). Only a payment after the hold end is late (D126, PAY-02-AC2). The Beam QR expires slightly before the hold end, by a platform margin (D80), so a payment between QR expiry and hold end is on time and must confirm normally; add this interleaving to the race (callback at QR expiry plus a little, job at hold end); never confirmed twice, never released and confirmed, never money lost |
| CONC-28 | BOOK-05 | Fixture limit N. Player has N-1 future hours. Two requests for one more hour each (different slots) | At most one succeeds; total never exceeds N. With the setting empty, both succeed |
| CONC-30 | BOOK-04 | **Chaos pass.** 30 players, 3 coaches, 2 courts, one day; 300 random requests (hold, pay, expire, cancel, solo, group, closure) sent in 10 waves with jitter on the fake clock | Invariants I1 to I8 hold at the end of each wave. Seed is printed; failing seeds are saved as regression fixtures |

## 7. Pass rules

- A scenario passes only if it passes `repeat(500)` in nightly and `repeat(50)` in CI.
- Zero flakiness is the bar. A test that fails once in 500 is a **product defect** (severity 1), not a flaky test, and is filed with the seed and the interleaving log.
- Each test prints the outcome table (who got what) on failure.
- Every scenario above also appears in the traceability file under BOOK-04 or the ID named in its row.

## 8. What is outside this design

- Load and performance testing. The only performance requirement is the 2 second grid and schedule load; it is covered in `test-strategy.md` (E2E-25).
- Multi region or replica lag. The spec names one Thai region; if read replicas are used for the schedule, the design must say that holds are written and checked on the primary.
