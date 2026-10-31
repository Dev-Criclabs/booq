# F11 Club admin console · Tasks

Status: **DRAFT for review (gate 3).** Drafted 31 Oct 2026 from the F11 design (`design.md`, draft) and the approved requirements. Rules for every task (CLAUDE.md): one task per run; write the tests from the acceptance criteria first, then the code; run tests and type checks before ticking; the commit message starts with the requirement IDs, for example `ADMIN-06 customer list route`. A merged migration is never edited. New text goes in `locales/pending/F11.json` (D81).

Roles: **BE-A** back end foundation and admin reads, **BE-B** booking, **BE-C** commerce, **FE-A** front end admin, **QA**, **Content**. Sizes are under a day.

Depends on: F01 (route wrapper, permissions, settings, audit, import, staff), F03 (staff booking routes), F04 (staff quote and pay, setup routes), F05 (cash), F06 (credit and wallet adjust), F07 (coach routes), F08 (class routes), F09 (cancel, mark, closure routes), F10 (rich menu, LINE status), F13 (receipts, reports). Migrations 1101 to 1105, one per task, rising in task order. No page is built before the routes it calls exist; each FE task names its route tasks.

## A. Server: missing reads, permissions, shell

- [x] **F11-T01** Permissions fragment `f11.ts` (`staff.shell`, `calendar.read`, `setup.read`, `setup.done`, `customer.write`, `customer.export`, `price.read`, `closure.write`) and the page to permission map. IDs: ADMIN-01. Role: BE-A · Deps F01-T13 · Size: S
  Tests first: the map has no page without a permission; the union of two roles; the role matrix passes.
  Built (Architect): `packages/auth/src/permissions/f11.ts`, `packages/auth/src/admin-pages.ts` (`ADMIN_PAGES`, `pagesFor(roles)`). `closure.write` is declared here; F09's closure routes use the name and must not declare it again. A4 is not in the map (F16).
- [ ] **F11-T02** `GET /staff/shell` (pages, banners, club). IDs: ADMIN-01. Role: BE-A · Deps T01, F10 `staff/line/status` · Size: M
  Tests first: front desk does not get Reports, Pricing, Settings, Staff; front desk plus accountant get both sets; a Paused club shows the banner with the reason; the LINE banners only for the owner; A4 absent for a Beam club.
- [ ] **F11-T03** `1101_staff_calendar.sql` and `GET /staff/calendar`. IDs: ADMIN-03. Role: BE-A · Deps F03, F07, F08 · Size: M
  Tests first: held, confirmed, closure, solo and class cells; names only, no phone; range over 7 days refused; another club empty; accountant refused.
- [ ] **F11-T04** `1102_customer_list_tags.sql`, `GET /staff/customers`, tags routes, customer CSV via `POST /staff/customers/export`. IDs: ADMIN-06. Role: BE-A · Deps F01-T25 · Size: M
  Tests first: search by name, phone fragment, tag; CSV holds only this club and writes an audit entry; front desk can export customers but not the full data export.
- [ ] **F11-T05** `app.staff_add_customer` (walk in quick add) and `POST /staff/customers` (if Open item 1 is confirmed). IDs: ADMIN-04. Role: BE-A · Deps T04, F02 · Size: S
  Tests first: creates an unclaimed customer; a duplicate phone is refused; the first LINE sign in claims it (D105).
- [ ] **F11-T06** `1103_customer_profile_reads.sql`, `GET /staff/customers/:id`, `.../bookings`, `.../orders`, notes routes over `user_staff_note`. IDs: ADMIN-07. Role: BE-A · Deps T04 · Size: M
  Tests first: date of birth shown to front desk and owner, never the accountant; its change history owner only (D55); notes are never readable by the player.
- [ ] **F11-T07** Credit and wallet panels: `GET /staff/customers/:id/credits`, `POST .../credit-adjust`, `POST .../wallet-adjust`, `POST /staff/packages/:id/extend` wired to F06 functions. IDs: ADMIN-07. Role: BE-C · Deps T06, F06 · Size: M
  Tests first: a wallet adjust without a reason is refused; with a reason a ledger row is added; the extension needs the owner and a reason.
- [ ] **F11-T08** `1104_audit_read.sql`, `GET /staff/audit` and booking history `GET /staff/bookings/:id/history`. IDs: ADMIN-17, ADMIN-04. Role: BE-A · Deps F01 audit · Size: M
  Tests first: search by staff, record and date; owner only; personal fields shown as changed, not the value; no write route exists.
- [ ] **F11-T09** `1105_owner_setup.sql`, `GET /staff/setup`, `POST /staff/setup/done`. IDs: ADMIN-02. Role: BE-A · Deps F01 launch checks · Size: M
  Tests first: steps 6 to 8 with done state; the tell-done click notifies P3 once; the page stays until Live; there is no address toggle (D54).
- [ ] **F11-T10** `GET /staff/leave-calendar` (dates and status only) over `coach_leave_calendar`. IDs: ADMIN-08. Role: BE-B · Deps F07-T12 · Size: S
  Tests first: front desk sees no type or note; a coach is refused; another club empty.

## B. Mounts for routes owned by other features

- [ ] **F11-T11** Check that every route in design §5 exists and is mounted, and list the gaps (closure expired packages, setup/* CRUD, package products). IDs: ADMIN-09 to ADMIN-15. Role: QA · Deps F04, F06, F09, F13 routes · Size: S
  Tests first: a table of route to feature to test; the role matrix covers each.

## C. Pages

Each FE task builds the page from the hi-fi board, with all states of design §7, Thai and English, a 1280 px layout, and the longest string in either language.

- [ ] **F11-T12** Shell, sidebar and banners (S-A01-Paused). IDs: ADMIN-01. Role: FE-A · Deps T02 · Size: M
- [ ] **F11-T13** A1 Calendar (H-A01-Calendar, F3-01-A01-Calendar): day and week, colour key, click to create, drag to move. IDs: ADMIN-03. Role: FE-A · Deps T03, F03-T22 · Size: M
- [ ] **F11-T14** A2 Booking create and detail (H-A02-Booking-create, G-A02b-Booking-detail, G-A02c-Sell-package). IDs: ADMIN-04. Role: FE-A · Deps T05, T08, F04, F05, F09 · Size: M
- [ ] **F11-T15** A5 Customers and A6 Customer profile (H-A05, H-A06). IDs: ADMIN-06, ADMIN-07. Role: FE-A · Deps T04, T06, T07 · Size: M
- [ ] **F11-T16** A7 Coaches (H-A07-Coaches, G-A13b payouts link). IDs: ADMIN-08. Role: FE-A · Deps F07-T12, T10 · Size: M
- [ ] **F11-T17** A8 Group classes (H-A08). IDs: ADMIN-09. Role: FE-A · Deps F08-T13 · Size: M
- [ ] **F11-T18** A9 Pricing and A9b Price groups and add-ons (H-A09, H-A09b). IDs: ADMIN-10, ADMIN-11. Role: FE-A · Deps F04 setup routes · Size: M
- [ ] **F11-T19** A10 Promotions (H-A10). IDs: ADMIN-12. Role: FE-A · Deps F04 setup routes · Size: M
- [ ] **F11-T20** A12 Closures (H-A12). IDs: ADMIN-13. Role: FE-A · Deps F09 closure routes · Size: M
- [ ] **F11-T21** A13 Reports and A14 Receipts (H-A13, H-A14). IDs: ADMIN-14, ADMIN-15. Role: FE-A · Deps F13 routes · Size: M
- [ ] **F11-T22** A16 Settings (H-A16). IDs: ADMIN-16. Role: FE-A · Deps F01 settings routes, F10 rich menu · Size: M
- [ ] **F11-T23** A17 Staff and audit log (H-A17). IDs: ADMIN-17. Role: FE-A · Deps T08, F01-T30 · Size: M
- [ ] **F11-T24** A0 Setup checklist (H-A0). IDs: ADMIN-02. Role: FE-A · Deps T09, F01 import · Size: M

## D. Content and sweep

- [ ] **F11-T25** Content: `locales/pending/F11.json`, existing A keys first by screen from `copy-index.csv`. IDs: TEXT-01 to TEXT-06. Role: Content · Deps none · Size: S
  Tests first: key sets and variables match in both languages; no existing key edited.
- [ ] **F11-T26** Acceptance sweep: every ADMIN acceptance check has a named test; walk the boards; confirm A3, A11, A15 and the slip queue do not exist. IDs: ADMIN-01 to ADMIN-17. Role: QA · Deps all · Size: M

Order: T01, T02, then the reads T03 to T10 in any order, T11, T25 early, then the pages in the order a club needs them (T12, T13, T14, T15, T24, T22, T18, T19, T17, T16, T20, T21, T23), then T26. About 26 tasks.
