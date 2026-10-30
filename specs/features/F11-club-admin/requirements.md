# F11 Club admin console A0 to A17 · Requirements

Status: **DRAFT ID list for approval (gate 1).** Drafted 30 Oct 2026. Only the requirement IDs, their wording and one acceptance check each are proposed here, so that ADMIN has IDs (QA found "ADMIN" has no `ADMIN-nn` rows, `docs/qa/traceability.md`). The full requirements, canvas notes and design come later, after a person approves this list. Nothing here is approved. The IDs are **proposed**: the hand-off has none, so a person adds them to the PRD, then the hand-off.

Feature: F11 Club admin console. Depends on: F03 to F09 (grows with each feature). Wave 3.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Users, roles and app structure; Coach portal and admin console (admin table, Front desk rules); Payments (backup mode); Platform foundation; What a club needs before it can go live (A0); Pausing a live club; Support access |
| HO | `specs/product/handoff-v1.2.md` | Screen inventory (Club admin row); Roles; PLAT-04, PLAT-06, PAY-06, CANCEL-04 |
| Decisions | `docs/decisions.md` | D1, D13, D27, D28 |
| Gaps | `docs/canvas-gaps.md` | A1, A2, A7, B10, C4, C5 |
| F01 | `specs/features/F01-platform-foundation/requirements.md` | Roles, audit, settings, import |

The spec wins over the canvas. The canvas boards named are the ones in the canvas file list on 30 Oct 2026. Every board has a T- Thai twin.

## Rules that apply to every ADMIN ID

- Club ID scope, server side permissions, audit on every change (PLAT-04), append only audit and ledgers (D28), no BOOQ staff access to this console's data (PLAT-02).
- Text comes from `locales/*` by A keys, Thai and English (TEXT-01 to TEXT-06). Console at 1280 px, sidebar shows only pages the person's roles can use (D1: a set of roles, so a person sees the union).
- Times Asia/Bangkok, money integer satang.
- Removed, never build: A3 Check-in, A11 Gift vouchers, A15 Messages editor, an everyday slip review queue.

## Proposed IDs

Roles are from the PRD admin table. "Owns the rule" means another feature holds the rule and F11 is the screen.

| ID | Page | Roles | Requirement | Acceptance check (Given, When, Then) | Rule owned elsewhere | Canvas (H-, G-, S-) |
|---|---|---|---|---|---|---|
| ADMIN-01 | Shell and navigation | All club staff | The left sidebar shows only the pages the signed in person's roles can use; every page the role cannot use is refused by the server; a Paused club shows a banner on every page with the reason and a Message BOOQ button | Given a front desk user, when they open the sidebar, then Reports, Pricing, Settings and Staff are not listed and a direct request to them is refused | PLAT-03, ROLE-01 | S-A01-Paused |
| ADMIN-02 | A0 Setup checklist | Owner (until live) | The owner sees steps 6 to 8 (Brand, Products and rules, People) until the club is Live, and can tell BOOQ they are done; import of players, packages and balances is here | Given a club in Draft, when the owner finishes steps 6 to 8 and taps Tell BOOQ I'm done, then BOOQ is notified and the page stays until Go live | PLAT-01, PLAT-06, PLAT-05 | H-A0-Setup-checklist |
| ADMIN-03 | A1 Calendar | Front desk, Owner | Day and week views, Court 1 and Court 2 columns 06:00 to 24:00, colour key, click to create, drag to move; a move checks court, coach and rest rule conflicts and messages the customer | Given a booking, when staff drag it to a slot where the court is held, then the move is refused and nothing changes | BOOK-04, COACH-01 | H-A01-Calendar, F3-01-A01-Calendar, S-A01-Paused |
| ADMIN-04 | A2 Booking detail and create | Front desk, Owner | Customer search or walk in quick add, items, add ons, payment including cash with a reason code, history; staff mark no show or late cancel with a reason and can reverse it | Given a booking whose slot ended, when staff mark no show without a reason, then it is refused; with a reason it is saved and audited | PAY-06, CANCEL-04, BOOK-04 | H-A02-Booking-create, G-A02b-Booking-detail, G-A02c-Sell-package |
| ADMIN-05 | A4 Backup slip check | Front desk, Owner (slip clubs only) | The page exists only in backup mode of a club on slip checking; a Beam club never has it | Given Hunter on Beam, when the owner opens the menu, then A4 is not listed and its route answers 404 | PAY-08, F16 | H-A04-Backup-slip-check |
| ADMIN-06 | A5 Customers | Front desk, Owner | Search, filters, tags, CSV export of the club's customers | Given a front desk user, when they press Export CSV, then the file holds only their club's customers and an audit entry is written | PLAT-06 | H-A05-Customers |
| ADMIN-07 | A6 Customer profile | Front desk, Owner | Details, notes, tags, bookings, purchases, credits, wallet, referrals, receipts; adjust credits or wallet with a written reason; show the date of birth and its audited changes to the owner | Given staff adjust a wallet without a reason, when they save, then it is refused; with a reason a ledger row is added | PKG-01, AUTH-02, PDPA-01 | H-A06-Customer-profile |
| ADMIN-08 | A7 Coaches | Owner | Profiles (Thai and English), tier, price override, pay model, availability, leave approvals, substitutions | Given a pending leave request, when the owner approves it, then affected sessions are flagged for a substitute and the coach is told | COACH-01, F12 | H-A07-Coaches, G-A13b-Coach-payouts |
| ADMIN-09 | A8 Group classes | Owner | Templates, sessions, rosters, below minimum alerts, cancel session | Given a session below its minimum, when the owner cancels it, then every player gets full credit back and a LINE message | CLASS-01, CLASS-02 | H-A08-Group-classes |
| ADMIN-10 | A9 Products and pricing | Owner | Court rate, court portion, bundles, solo and group packages (Adult and Student), coach tiers, add ons; TBD values show as empty editable fields | Given an add-on with no price set, when the owner opens A9, then the field is empty and editable and no default is shown | PKG-02, PLAT-05 | H-A09-Pricing |
| ADMIN-11 | A9b Price groups and add-ons | Owner | Price groups (Hunter: Adult, Student), court price rules by weekday or weekend and off peak or peak (Hunter one price), add-on list | Given a new price group, when it is saved, then it is audited and used by the next price decision only | PLAT-05 | H-A09b-Pricing-groups |
| ADMIN-12 | A10 Promotions | Owner | Promo codes, partners, referral and birthday settings; per code stacking rule | Given a code, when it is saved with a stacking choice, then the choice is audited | PROMO-01, PROMO-02 | H-A10-Promotions |
| ADMIN-13 | A12 Closures | Front desk, Owner | Block by range, day or repeat; list affected bookings first, then cancel them with full credit and a LINE message | Given a closure over booked slots, when staff confirm, then each booking is cancelled with full value back and the slots vanish from booking | CANCEL-03 | H-A12-Closures |
| ADMIN-14 | A13 Reports | Owner, Accountant | Dashboard with date range, partner report, coach payouts with Mark paid; every report exports to CSV | Given an accountant, when they open Reports, then they can read and export but not change a booking, price or balance | RCPT-03, COACH pay | H-A13-Reports, G-A13b-Coach-payouts |
| ADMIN-15 | A14 Receipts | Owner, Accountant | List and search, PDF, void with reason (owner only), daily close, exports | Given a receipt, when an accountant tries to void it, then it is refused; an owner voids with a reason and the number is kept | RCPT-01, RCPT-02, RCPT-03 | H-A14-Receipts |
| ADMIN-16 | A16 Settings | Owner | Hours, booking window, cancellation cut off, hold time (10, 15, 20), waitlist and no show timing, max future hours, rest cap, business and tax details, VAT switch, Allow BOOQ to make changes, automatic slip checking (slip clubs) | Given the owner turns on Allow BOOQ to make changes, when 24 hours pass, then it turns off by itself and the change is audited | PLAT-02, BOOK-03, BOOK-05 | H-A16-Settings |
| ADMIN-17 | A17 Staff and audit log | Owner | Invite staff by LINE link, assign a set of roles, deactivate; searchable audit log by staff, record and date; the log is append only | Given the owner assigns Coach and Front desk to one person, when they sign in, then both surfaces open; no one can edit or delete a log entry | ROLE-01, PLAT-04 | H-A17-Staff-audit |

## Open questions

1. **Page count.** The PRD says 15 pages (A11 and A15 removed, A4 backup only) and one change log row says 14 (Gaps B10). The list above has 17 IDs because A0 and A9b are in the hand-off screen inventory but not in the PRD admin table. Confirm the final list.
2. **ID style.** ADMIN-nn per page, as proposed, or per rule? Pages hold rules owned by other features, so each ADMIN ID is the screen and points to the owner ID.
3. **A0 address toggle (Gaps A7, C5).** The PRD says the app never shows the address, but A0 step 6 has a toggle "Show the club address in the app". Not built until decided. Rich menu labels in A0 (three labels, six tiles, Gaps C4) are also open.
4. **Who sees the audit log.** Owner only (PRD), but ADMIN-07 shows the date of birth history to the owner. Do front desk see that history?
5. **A2 reason codes.** The list of cash reason codes is not in the spec (QA Q-22).
6. **Reports.** Each report needs an acceptance check from Product (QA list). Does "value owed to customers" include wallets (Gaps C2)?
7. **Admin for a person with several roles (D1).** The sidebar shows the union; is any page only for one role at a time?
