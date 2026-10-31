# F11 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F11-club-admin/requirements.md` (ADMIN-01 to ADMIN-17) and the design of D168. On main: T01 to T03 (shell and navigation, owner settings), migration 0060 (`oa_basic_id`), 1012 (`record_booking_cancel`). Most A-pages are not built yet; the rules they sit on are.

**Result: 17 criteria. 12 traced to lane tests (several in part), 1 more by a QA test, 5 open (reasons below). No finding.**

Traced: ADMIN-01 (front desk gets no Reports, Pricing edit, Settings or Staff page), ADMIN-04 (a staff cancel needs a reason; a no show only after the slot ends, with the staff note), ADMIN-05 (A4 is never listed; QA's route inventory also shows no slip route, F05 PAY-01-AC2), ADMIN-07 (a wallet adjust needs a note), ADMIN-08 (leave approval, and the solo classes that no longer fit are listed), ADMIN-09 (cancelling a session gives full value back, nothing as cash), ADMIN-13 (a closure cancels with full value inside the window), ADMIN-14 (the accountant reads business settings only and cannot write), ADMIN-15 (only the owner voids a receipt), ADMIN-16 (the support window opens for 24 hours and closes), ADMIN-17 (a person with two staff roles sees the pages of both).

Partial: ADMIN-16 proves the window's end date; QA has no test that it is refused after 24 hours pass. ADMIN-17 is proven for front desk plus accountant; coach plus front desk is the same union rule and has no test of its own. Both can be added without a screen.

Open:

| Criterion | Why it is open |
|---|---|
| ADMIN-02 | A0 checklist and Tell BOOQ I'm done: screen and route not built. |
| ADMIN-03 | Dragging a booking onto a held slot is refused: the A1 calendar move route is not built (the database refusal is covered by F03). |
| ADMIN-10, ADMIN-11, ADMIN-12 | A9 empty add-on price field, new price group audited and used by the next decision only, code stacking choice audited: the A9 routes are not built (same gap as F04 R3-AC8 and PROMO-01-AC12). |

## Other items on main, 31 Oct

- **F08 0919 `cancel_session` with reason `closure`:** covered by the lane (`class-cancel-edit.test.ts`: the worker role cancels with no person and the seats go back as closure; a player cannot; a repeat is a no-op). The closure criteria CANCEL-03-AC3 to AC17 are now traced to `closure-create.test.ts` (see the F09 re-sweep).
- **1012 `record_booking_cancel`:** covered by `record-booking-cancel.test.ts` (next version, who, trimmed reason, no app role). Traced under ADMIN-04.
- **0060 `oa_basic_id`:** a public config column for the add-friend link. Covered by `public-club-config.test.ts`; no acceptance criterion names it.
- **C4 shell and F02-T23 deep links:** the lane tests (`deep-link.test.ts`) prove a link carries the club path and a club with no LIFF app has no link. The C4 page itself is Playwright.
- **Platform support settings editor:** `apps/platform/src/settings/routes.test.ts` and `domain/club/settings.test.ts` cover who may write and that nothing has a default; criteria PLAT-02-AC2 and AC4 were already traced in the F01 sweep.

## ADMIN-06, 31 Oct (main cee820f)

F11-T04 added `GET /staff/customers/csv` with its own `customer.export` permission (front desk and owner), synchronous and audited; the async `/exports` route stays owner only (D168). The lane test proves the CSV holds only this club, writes one audit entry and refuses the accountant; the export route test proves front desk is refused the club export. QA added `F11-customer-csv.new.spec.ts`: a customer whose display name starts with `=` (a player chooses it) is written as `'=...`, and a phone starting with `+` as `'+...`, so a spreadsheet does not run it as a formula. The spec is silent on this; the lane does it and the test only keeps it from regressing.


## Update, 31 Oct (main d709178)

F11-T0x owner setup routes are on main (`setup.routes.test.ts`, `setup-data.routes.test.ts`). ADMIN-02 (the checklist records once and is owner only), ADMIN-10 (an add-on with no price is saved as null), ADMIN-11 (a price group is audited) and ADMIN-12 (the stacking choice is audited) are now traced. Open: ADMIN-03 and ADMIN-06's screen parts.

## F11-T26, 31 Oct (main 43b77b0)

`F11-gate.new.spec.ts`: 17 criteria, 16 with a real test, 1 listed (ADMIN-03, the A1 move). A3, A11, A15 and the slip queue do not exist: `F09-removed-and-record.new.spec.ts` checks the route paths, the page folders, the sidebar list (no A3, A4, A11 or A15) and the schema (no check in or slip column or table); ADMIN-05 is traced to the shell test that A4 is never listed. The F11 canvas boards are not in the repo (G-04), so they were traced by criteria only.
