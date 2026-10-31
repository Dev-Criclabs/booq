# F11 Club admin console A0 to A17 · Design

Status: **DRAFT for review (gate 2).** Drafted 31 Oct 2026 by the Architect from the approved F11 requirements (`requirements.md`, approved 30 Oct 2026, revision 3) and the code on `architect/foundation`. Nothing here is built. A change to anything below goes through the PRD, then the hand-off, then this file. Tasks are in `tasks.md`.

Feature: F11 Club admin console. Requirement IDs: ADMIN-01 to ADMIN-17 (ADMIN-05 is not built for Hunter, D53). Depends on F01 to F10 and F13. Wave 3 and later; each page is built when the feature behind it exists.

Shared decisions are in `docs/architecture/foundation.md` (**FA §n**); feature designs are cited as **F01 §n** and so on.

## 1. What F11 is

F11 is the screens and the routes behind them. The rules, the ledgers and almost every server function already exist in F01 to F13 (or are in their approved designs). The design is therefore:

1. one **shell** (§4) that tells the page which pages the signed in person may open and which banners to show;
2. one **route table per page** (§5) that names the existing function each action calls;
3. a short list of **missing reads and tables** (§6) that no feature owns: the staff calendar read, the customer list and tags, the customer profile read, the audit read for staff, the owner's A0 checklist read.

F11 adds no business rule. If a page needs a rule that is not in the PRD it stops and asks (CLAUDE.md).

Not built, ever: A3 Check-in, A11 Gift vouchers, the A15 Messages editor, an everyday slip review queue. A4 Backup slip check is built with F16, not for Hunter (D53); its route answers 404 for a Beam club. There is no `message`, `template` editor route: the six rich menu tile labels (A16, F10) are the only text an owner edits, and the route is `/staff/rich-menu/labels`.

## 2. Requirement coverage

| ID | Page | Where |
|---|---|---|
| ADMIN-01 | Shell | §4 |
| ADMIN-02 | A0 Setup checklist | §5.1, §6.5 |
| ADMIN-03 | A1 Calendar | §5.2, §6.1 |
| ADMIN-04 | A2 Booking detail and create | §5.3 |
| ADMIN-05 | A4 Backup slip check | §5.4 (not built) |
| ADMIN-06 | A5 Customers | §5.5, §6.2 |
| ADMIN-07 | A6 Customer profile | §5.6, §6.3 |
| ADMIN-08 | A7 Coaches | §5.7 |
| ADMIN-09 | A8 Group classes | §5.8 |
| ADMIN-10, 11 | A9 and A9b Pricing | §5.9 |
| ADMIN-12 | A10 Promotions | §5.10 |
| ADMIN-13 | A12 Closures | §5.11 |
| ADMIN-14 | A13 Reports | §5.12 |
| ADMIN-15 | A14 Receipts | §5.13 |
| ADMIN-16 | A16 Settings | §5.14 |
| ADMIN-17 | A17 Staff and audit log | §5.15, §6.4 |

## 3. Conventions

Routes are under `/api/c/{slug}` and declared with `route()` (FA 4.3): `permission`, never an inline role test. Typed codes, no text (CC-5). The club comes from the session and the path slug; another club's slug is 404. Money is integer satang, times are Asia/Bangkok, the international year in both languages. Every write is audited by the table's trigger or the service function (PLAT-04); the audit log is append only (D28). BOOQ platform staff reach none of these routes (PLAT-02): the platform app has its own routes and the blind suite (F01-T18) covers this console.

Text: A keys from `locales/copy-index.csv` by screen, new keys in `locales/pending/F11.json` (D81). Layouts at 1280 px; Thai strings are longer, so tables scroll and buttons never wrap. A page loads its data with the routes below and renders states from the codes (§7).

## 4. The shell (ADMIN-01)

`GET /staff/shell` (permission `staff.shell`: every staff role, so `front_desk`, `accountant`, `owner`; a coach uses the coach portal) returns one object:

- `pages`: the list of page ids the caller's roles allow, computed from the permission matrix on the server (the same `can()` that guards the routes, so the sidebar and the guard cannot disagree). A person with several roles gets the union (D58). Page to permission: A0 `setup.read`, A1 `calendar.read`, A2 `booking.create.staff`, A5 and A6 `customer.contact.read`, A7 `coach.manage` (front desk reads the list only: `coach.read`), A8 `class.session.read`, A9 and A9b `price.write` (read: front desk, accountant), A10 `price.write`, A12 `closure.write`, A13 `report.read`, A14 `receipt.list`, A16 `settings.read` (accountant: `settings.business.read`), A17 `staff.manage`. A4 is listed only when the club is on slip checking and the feature is on (`club_feature`).
- `banners`: `paused` with the reason from `club_pause` and a Message BOOQ action (F01 PLAT-03; the owner sees the button, others the banner); `line_cap` at 70 percent of the LINE plan (F10 LINE-07-AC1, owner only); `line_token` on a LINE token failure (F10 LINE-06-AC4, owner only). Banners read `public.public_club_config`, `club_pause` and F10's `GET /staff/line/status`; F11 stores nothing.
- `club`: name, status, language default. No club id.

A page the roles cannot use is refused by its own routes (403); the sidebar is a convenience. Hidden pages are never 404 for a signed in person of the same club.

## 5. Pages: routes and the function behind each

"Exists" means built on `architect/foundation` or approved in the named design. **New** means §6.

### 5.1 A0 Setup checklist (ADMIN-02, owner until Live)

| Route | Function | Notes |
|---|---|---|
| `GET /staff/setup` | New read `app.owner_setup_view()` (§6.5) | steps 6 to 8 (Brand, Products and rules, People) with their done state, derived from the tables each step fills; read only. Shown until the club is Live |
| `POST /staff/setup/done` | New `app.owner_tell_done()` (§6.5) | writes an `owner_flag`/`owner_notice` row the platform P3 sees (F01 `owner_flag`); idempotent; the page stays until Go live (PLAT-01) |
| `POST /imports`, `POST /imports/:id/confirm`, `GET /imports/:id`, `DELETE /imports/:id` | Exists (F01-T24 to T27) | players, packages, balances; permission `import.run` |
| `GET /staff/rich-menu`, `PUT /staff/rich-menu/labels` | Exists in F10 design (§5.3) | the six tile labels, Thai and English; links fixed (D54); no address toggle exists |

### 5.2 A1 Calendar (ADMIN-03, front desk, owner)

| Route | Function | Notes |
|---|---|---|
| `GET /staff/calendar?from=&to=` | New read `public.staff_calendar` (§6.1) | one column per active court; bookings, class sessions, closures, held hours, with state colour key; max 7 days a call |
| `POST /staff/bookings` | Exists (F03 design 5.3, with F04 `POST /staff/orders/quote` and `pay`) | click to create opens A2 |
| `PUT /staff/bookings/:id/move` | Exists (F03-T22, `app.move_booking`) | drag to move; refusals `slot_unavailable`, `coach_unavailable`, `rest_rule` (with `hours`), `hour_started`; the customer is messaged by F10 on success |
| `GET /courts` | Exists | columns |

In a Paused club the calendar opens and owner and front desk may still move, add a coach, cancel and mark no show (D107); create and checkout answer `club_paused`.

### 5.3 A2 Booking detail and create (ADMIN-04)

| Action | Route | Function |
|---|---|---|
| Detail | `GET /bookings/:id` (staff reads the club's, F03-T21) plus `GET /orders/:id` | exists |
| Customer search or walk in quick add | `GET /staff/customers?q=` (§5.5), `POST /staff/customers` (quick add, New `app.staff_add_customer`, §14 item 1) | search new read; quick add creates an unclaimed customer the first sign in claims (D105) |
| Quote and pay | `POST /staff/orders/quote`, `POST /staff/orders/pay` | exists (F04 §5.2). Cash only with a reason code `no_banking_app`, `qr_failed_at_counter` or `other` plus a note (D56), front desk and owner (`booking.create.staff`); cash is allowed for packages |
| Sell a package | `POST /staff/orders/:id/package-sale` | F06 design 6 |
| Add a coach | `POST /bookings/:id/coach` | exists (F07-T11); staff also allowed |
| Cancel | `GET /staff/bookings/:id/cancel-preview`, `POST /staff/bookings/:id/cancel` | F09 design 6 |
| Mark no show, late cancel, reverse | `POST /staff/bookings/:id/mark`, `POST /staff/bookings/:id/mark/reverse` | F09; reason required when the slot ended (`reason_required`); each saved and audited (CANCEL-04) |
| Override the future hours limit | the `override_reason` field of `POST /staff/bookings` and of quote | F03 (D49, D110): front desk and owner; the reason is logged |
| History | `GET /staff/bookings/:id/history` | New read over `audit_entry` and `booking_cancel` for that booking (§6.4) |

Staff may book an hour that has already started for walk ins (D39); the player routes still refuse it.

**Selling to a walk in (D168).** `POST /staff/customers` makes a record with no consent and no LINE id. F04's pricing stays strict (migration 0320 needs a claimed customer, because age pricing needs the claimed profile), so staff sell to a person who has not signed in through the walk in order (`customer_id` null) until the person signs in and claims.

### 5.4 A4 Backup slip check (ADMIN-05)

Not built for Hunter. Placeholder: the shell omits it and `/staff/slips*` is not mounted; a request answers 404. Built with F16.

### 5.5 A5 Customers (ADMIN-06, front desk, owner)

| Route | Function | Notes |
|---|---|---|
| `GET /staff/customers?q=&tag=&status=&cursor=` | New `public.customer_list` view (§6.2) | name, phone (front desk and owner only), tags, last booking, counts; paged |
| `POST /staff/customers/export` | Exists (`POST /exports` kind `customers`, F01-T25) | CSV of this club only; writes an audit entry; permission `export.run` is owner only in F01, front desk is added in §8 for kind `customers` only |
| `POST /staff/customers/:id/tags`, `DELETE /staff/customers/:id/tags/:tag` | New `app.customer_tag_set` (§6.2) | free text tags typed by the club; no default tag list |

### 5.6 A6 Customer profile (ADMIN-07)

| Panel | Route | Function |
|---|---|---|
| Details, date of birth | `GET /staff/customers/:id` | New `public.customer_profile` read (§6.3). Date of birth shown to front desk and owner; accountant never |
| Date of birth history | `GET /customers/:id/dob-history` | exists, owner only (D55) |
| Notes | `GET/POST /staff/customers/:id/notes` | `public.user_staff_note` exists (F01); staff and coach only, never shown to the player (PDPA) |
| Bookings, purchases | `GET /staff/customers/:id/bookings`, `.../orders` | New reads (§6.3) over `booking` and `orders` |
| Credits and wallet | `GET /staff/customers/:id/credits` | F06 design 6 |
| Adjust credits | `POST /staff/customers/:id/credit-adjust` | F06: `app.credit_adjust`; a written reason is required (`reason_required`), a ledger row is added |
| Adjust wallet | `POST /staff/customers/:id/wallet-adjust` | F06: `app.wallet_adjust`, same rule |
| Extend a package | `POST /staff/packages/:id/extend` | F06 (owner with a written reason, D118) |
| Receipts | `GET /staff/receipts?customer=` | F13 |
| Referrals | `GET /staff/customers/:id/referrals` | Waits for F14 (the referral table does not exist yet); returns an empty list until then |
| Imported player claim | `GET /claims`, `POST /claims/:id/confirm`, `POST /claims/:id/reject` | exists (F02, D105) |
| Data requests | `GET /data-requests`, `POST /data-requests/:id/handle` | exists (F01) |

### 5.7 A7 Coaches (ADMIN-08, owner; front desk reads the list)

All routes exist (F07-T11, T12): `GET /staff/coaches`, `GET/PUT /staff/coaches/:id` (profile, tier, consent, publish, active, overrides), `GET/PUT .../pay`, `GET/PUT /coach/availability?coachId=` (owner for any coach), `GET/POST /coach/leave?coachId=`, `GET /staff/leave`, `POST /staff/leave/:id/decision`, `GET /staff/flagged-sessions`, `GET /staff/bookings/:id/substitutes`, `POST /staff/bookings/:id/substitute`. Missing: **`GET /staff/leave-calendar?from=&to=`** (permission `coach.read`, front desk and owner): dates and status only, no type or note, over the existing view `coach_leave_calendar` (F07-T12 note). Coach payouts (G-A13b) are on A13 (§5.12). The pay route returns nulls for unset values and the page shows "not set".

### 5.8 A8 Group classes (ADMIN-09, owner; front desk reads)

Exists (F08-T13): `GET/POST /staff/class-templates`, `PUT /staff/class-templates/:id`, `GET /staff/class-sessions`, `PUT /staff/class-sessions/:id`, `POST /staff/class-sessions/:id/cancel`, `POST /staff/class-sessions/:id/resolve`, `GET /staff/class-sessions/:id/roster`, `GET /staff/waitlist`. Below minimum alerts are the F08 job and the `due_below_minimum` read; A8 lists sessions in state `below_minimum`. Cancelling a session gives every seat full value back and a LINE message (F08-T14).

### 5.9 A9 and A9b Products, pricing, groups, add-ons (ADMIN-10, 11, owner)

F04 §5.3 fixes the routes: `GET/POST/PUT /staff/setup/price-groups`, `/court-prices`, `/coach-tier-prices`, `/add-ons`, and for packages `/package-products` (F06). Permission `price.write` (owner); reads for front desk and accountant through `price.read` (new in §8). Rules: TBD values (add-on price, tier price, package price) are empty editable fields and no default is shown (ADMIN-10-AC); a save is audited and applies to new orders only; a price used by a held or paid order is never deleted. Court price rules by weekday or weekend and off peak or peak exist as `court_price_rule` (Hunter has one price). Coach tiers are `coach_tier` (F07).

### 5.10 A10 Promotions (ADMIN-12, owner)

`GET/POST/PUT /staff/setup/promo-codes`, `/staff/setup/partners` (F04 §5.3, PROMO-01, PROMO-02); referral and birthday settings are settings keys through `PUT /config/:key` (§5.14). Each code carries its own stacking rule; the choice is audited. Referral settings take effect with F14.

### 5.11 A12 Closures (ADMIN-13, front desk, owner)

Exists in F09 design: `POST /staff/closures/preview` (lists affected bookings first), `POST /staff/closures` (cancels them with full value and a LINE message in one transaction through `app.run_cancel_handlers`), `GET /staff/closures`, `POST /staff/closures/:id/end`. The screen also lists packages that expired before a closure return: `GET /staff/closures/:id/expired-packages` (F09 design 6, New if absent) and `POST /staff/packages/:id/extend` with a written reason (owner, D118).

### 5.12 A13 Reports (ADMIN-14, owner, accountant)

Exists (F13): `GET /staff/reports/:name?from=&to=` and `/csv`, `GET /staff/payouts?month=`, `POST /staff/payouts/:coach/paid` (owner only, D115), `POST .../adjustments`, `GET /staff/reports/owed` (value owed: unused package credit and wallet shown separately, D57). Test flagged rows are excluded (D33). The accountant gets names without phone or date of birth (D35, `app_user_names`). Report formulas are F13's; open question 1 of the requirements stays with F13.

### 5.13 A14 Receipts (ADMIN-15, owner, accountant)

Exists (F13-T05, T10): `GET /staff/receipts?q=&from=&to=`, `GET /staff/receipts/:id/pdf?lang=`, `POST /staff/receipts/:id/void` (owner, reason, number kept), `POST /staff/daily-close`, `GET /staff/daily-close`, `/csv`. A wallet credit from a late payment has its own receipt (D37).

### 5.14 A16 Settings (ADMIN-16, owner; accountant reads the business details)

Exists (F01): `GET /config`, `PUT /config/:key` (the registry validates; old and new values audited), `PUT /club/business`, `PUT /hours`, `POST/PUT /resources`, `PUT /support-window`. The keys shown: opening hours, booking window, cancellation cut off, hold time (10, 15, 20), waitlist and no show timing, max future hours, rest cap, VAT switch, automatic slip checking (slip clubs), business and tax details. "Allow BOOQ to make changes" is the support window: on for 24 hours then off by itself and audited (PLAT-02). The six tile labels are §5.1. Values with no PRD default stay empty.

### 5.15 A17 Staff and audit log (ADMIN-17, owner)

Exists: `GET /staff`, `POST /staff/invites`, `GET /staff/invites`, `PUT /staff/:userId/roles`, `POST /staff/:userId/deactivate` (F01-T30, T31; every club person also holds Player, D115; roles are a set). Missing: **`GET /staff/audit?staff=&record=&from=&to=&cursor=`** over `public.audit_entry` (§6.4), owner only (`audit.read`); no write or delete route exists and the table grants nothing but select and insert.

## 6. Missing reads and tables

Migration block: none was planned for F11 (`docs/proposals/migration-blocks.md`); these take the next free block **1101 to 1199**, one file per task, in task order.

### 6.1 `1101_staff_calendar.sql`
`public.staff_calendar(from date, to date)` (security definer function, owner and front desk only, `app.has_any_role`): per hour of each active court, the occupancy kind (court booking, solo class, group class, closure, held), state (confirmed, held with `hold_expires_at`), booking id, customer display name, coach display name, class name, and `is_walk_in`. Names only; no phone, no date of birth. The range is capped at 7 days. It reads `occupancy` and `booking`; it writes nothing.

### 6.2 `1102_customer_list_tags.sql`
Table `customer_tag (club_id, user_id, tag, created_by, created_at)` (class D, composite keys, audit registered; tag is typed by the club, 1 to 40 characters, no default list). `public.customer_list` function (owner and front desk): search by name, phone fragment or tag; columns id, display name, phone, tags, claimed state, last booking, booking count; keyset paged; test rows excluded for reports only, not here. `app.customer_tag_set(user, tag, on)`.

### 6.3 `1103_customer_profile_reads.sql`
`public.customer_profile(user)`: details, date of birth (not for the accountant), language, tags, created at, claim state. `public.customer_bookings(user)` and `public.customer_orders(user)`: booking rows with type, court, coach, status and cancel outcome; orders with lines, money, credit and wallet parts and receipt number. Owner and front desk. Nothing from another club.

### 6.4 `1104_audit_read.sql`
`public.staff_audit(staff, record_type, record_id, from, to, cursor)` function over `audit_entry` for the owner: actor name, action, table, record id, changed fields with old and new values (personal data columns shown as `[changed]`, not the value, as FA 8.2 holds them apart). Also used for booking history in A2 (`record_id = booking id`). Read only.

### 6.6 `1106_shell_banners.sql` (built with T02)
`app.shell_state()`: the open pause reason, the LINE cap state and the failed LINE token reason of the caller's club; the cap and token columns are null for anyone but the owner.

### 6.5 `1105_owner_setup.sql`
`app.owner_setup_view()` returns steps 6 to 8 as {key, done} computed from rows (Brand: rich menu labels, name; Products and rules: price groups, court prices, at least the settings that have no default are set; People: staff invited, import run). It invents no new required step: the list is F01 §9.3's. `app.owner_tell_done()` records the click once (`owner_notice` for P3) and audits it.

## 7. States

Every page: loading, empty, error (a typed code from the route), paused (banner; writes that need an open club answer `club_paused`), not allowed (403 shows a no access state), and a long Thai text state. A1: empty day, closure cells, held cells with a countdown from `hold_expires_at`. A2: refused payment, expired hold, started hour. A6: unclaimed customer, anonymised customer (name shown as removed). A13 and A14: empty range, test rows excluded. Idempotency keys are required on every POST that moves money or value (F05, F06 conventions).

## 8. Permissions

Existing names are reused (`booking.create.staff`, `booking.move`, `customer.contact.read`, `customer.names.read`, `price.write`, `settings.*`, `staff.manage`, `roles.assign`, `audit.read`, `import.run`, `export.run`, `receipt.*`, `report.read`, `coach.*`, `class.*`). New names, in `packages/auth/src/permissions/f11.ts`: `staff.shell` (front desk, accountant, owner), `calendar.read` (front desk, owner), `setup.read` and `setup.done` (owner), `customer.write` (front desk, owner: tags, notes, quick add), `price.read` (front desk, accountant, owner), `closure.write` (front desk, owner). `export.run` for kind `customers` is also allowed to front desk (ADMIN-06-AC) through `customer.export` (front desk, owner) so the owner-only data export stays owner only. The API role matrix test (tests/api/role-matrix.spec.ts) is run after each page.

The Accountant never gets a phone number, a date of birth, a booking write, a price write or a balance change (D35, D115). A coach has no console page.

## 9. Concurrency and failure

Moves and creates are F03's (the exclusion constraints decide); the calendar is a read and can show a cell that was just taken, so the write answers `slot_unavailable` and the page reloads the day. Two staff adjusting the same wallet serialise on the wallet lock (FA 3.4). Closure confirm is one transaction (F09). A second "Tell BOOQ I'm done" is a no op.

## 10. Cross-cutting rules

Club ID scope in every function (`app.club_id()`), permissions on the server, audit on every write, PDPA (notes and date of birth by role; BOOQ staff blind), TEXT (A keys), Bangkok times, satang. The console never computes a price, a refund or a report figure; it shows what the F04, F06, F09 and F13 functions return.

## 11. Tests (written first at the build step)

Per page: permission matrix (every role, allowed and refused), club scope (another club's id is 404), the acceptance check of the ADMIN ID, and a state test. Specific: the sidebar equals the union of two roles and a refused direct request (ADMIN-01); drag onto a held court is refused and nothing changes (ADMIN-03); no show without a reason is refused (ADMIN-04); the customer CSV holds only this club and writes an audit entry (ADMIN-06); a wallet adjust without a reason is refused (ADMIN-07); an empty price field has no default (ADMIN-10); the accountant sees no phone or date of birth and cannot void or mark paid (ADMIN-14, 15); Allow BOOQ to make changes expires after 24 hours (ADMIN-16); the audit route has no write path (ADMIN-17).

## 12. Canvas boards used

H-A0-Setup-checklist, H-A01-Calendar, F3-01-A01-Calendar, S-A01-Paused, H-A02-Booking-create, F3-02-A02-Booking-create, G-A02b-Booking-detail, F3-03-A02b-Booking-detail, G-A02c-Sell-package, H-A05-Customers, H-A06-Customer-profile, H-A07-Coaches, G-A13b-Coach-payouts, H-A08-Group-classes, H-A09-Pricing, H-A09b-Pricing-groups, H-A10-Promotions, H-A12-Closures, H-A13-Reports, H-A14-Receipts, H-A16-Settings, H-A17-Staff-audit, and the T- Thai twins. Not built: the A3, A11, A15 boards and H-A04-Backup-slip-check (F16).

## 13. Assumptions to confirm (recommended defaults, D147)

| # | Assumption | Basis |
|---|---|---|
| A-1 | F11 takes migration block 1101 to 1199 | migration-blocks.md row F11, F12 |
| A-2 | The sidebar comes from one server call (`GET /staff/shell`) using the same permission check as the routes | ADMIN-01, FA 4.3 |
| A-3 | Customer tags are free text typed by the club; there is no default list | CLAUDE.md: never invent settings |
| A-4 | Front desk may export the customer CSV through its own permission; the full data export stays owner only | ADMIN-06 names front desk |
| A-5 | A6 Referrals is empty until F14 exists | no referral table yet |
| A-6 | A2 history is the audit trail of the booking plus its cancel rows | ADMIN-04 "history" |
| A-7 | Page level reads that no feature owns (calendar, customers, profile, audit) are definer functions with the role check inside, like F07 | F07 §5 pattern |

## 14. Open items

1. **Walk-in quick add.** ADMIN-04 asks for "walk in quick add". F02 holds the unclaimed customer and the claim at first sign in (D105), but no function named for creating one from the console was found. Default: `app.staff_add_customer(name, phone)` in `1102`, creating an unclaimed customer with no LINE id; confirm with F02.
2. **A0 step list.** §6.5 uses F01 §9.3 as the list of steps 6 to 8; confirm the exact done tests with the Reviewer.
3. **Report acceptance checks** (requirements open question 1) stay with F13.
