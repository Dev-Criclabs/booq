# BOOQ product spec

Status: draft v0.1, derived from the design canvas (Hunter Tennis Club, Palette D hi-fi, English and Thai).
Where the canvas contradicts itself or leaves a value blank, this spec says so in section 12 and marks the
affected rule **[OPEN]**. Nothing marked [OPEN] is built until the question is closed.

Rule IDs (`R-xxx`) are stable. Tests, PRs and issues cite them.
Screen IDs (C, A, K, P, L, R, S, G) match the design canvas file names.

---

## 1. Product

BOOQ is a multi-club booking platform for racquet-sport clubs in Thailand. Players book inside LINE; club staff
run the day on a web console; coaches use a portal inside LINE; the BOOQ team onboards and supports clubs on a
platform console. First club: Hunter Tennis Club (two indoor courts, Lam Lukka, Pathum Thani).

Principles
- P1. Money goes straight to the club. BOOQ never holds player payments.
- P2. Value never returns as cash. Cancellations return wallet balance or package credit.
- P3. Every state carries a word as well as a colour.
- P4. Every staff change to money, bookings or settings is written to an audit log.
- P5. Browsing never needs sign in. Sign in happens at the moment of booking or buying.
- P6. Thai and English everywhere. Language follows LINE; the player can switch.

## 2. Users and surfaces

| Surface | Who | Platform | Entry |
|---|---|---|---|
| Customer app (C) | Players (Adult, Student) | LIFF in LINE, mobile 375 wide, also opens in a browser | LINE rich menu, links in LINE messages |
| Club admin (A) | Owner, Front desk, Accountant | Web, desktop and reception tablet | Staff invite by LINE link |
| Coach portal (K) | Coaches | LIFF in LINE, mobile | Invite by LINE link |
| Platform console (P) | BOOQ platform admin, onboarding specialist | Web | Invited by platform admin |
| LINE messaging (L) | Players, coaches, owners | LINE OA push, Flex messages, rich menu | System |
| Receipts (R) | Players, staff | PDF, TH and EN | Profile, booking, admin |

Roles and what they can do
- R-001. **Front desk**: Calendar, Customers, Closures, new bookings, selling packages at the counter, cancel with reason, backup slip check when it is shown.
- R-002. **Owner**: everything front desk can, plus Coaches, Group classes, Products and pricing, Promotions, Settings, Staff and audit log, Reports, Receipts, void a receipt, extend a package, approve leave.
- R-003. **Accountant**: Reports and Receipts (read and export).
- R-004. **Coach**: coach portal only. Never sees payments or other coaches.
- R-005. **Platform admin**: all of P, may pause a club. **Onboarding specialist**: only clubs assigned to them; cannot pause.
- R-006. BOOQ staff never see players, bookings, payments, slips, receipts, wallets or reports of a club.

## 3. Core domain rules

Booking
- R-010. All bookings are exactly 60 minutes, on the hour, for every club and every sport.
- R-011. Opening hours are club-set (Hunter 06:00 to 24:00, every day). Players book up to a club-set number of days ahead (Hunter 30).
- R-012. A slot or seat is **held** while payment is pending. Hold length is club-set to 10, 15 or 20 minutes, default 15. In backup slip mode the hold is up to 60 minutes. [OPEN Q-3: player copy hard-codes 15.]
- R-013. When the hold ends without payment, the slot is released, nothing is charged, and a LINE message tells the player.
- R-014. Consecutive hours on one court can be selected in one booking.
- R-015. Slot states shown to players: Open, Selected, Held (being paid), Taken (with Waitlist link), Closed, Yours. Each has a word and a dot.
- R-016. Max future court hours per player: **[OPEN Q-2]** `[X]`.
- R-017. Reminders by LINE 24 hours and 2 hours before every booking (player can switch "Booking reminders in LINE" off in Profile).

Cancellation
- R-020. Free cancellation until a club-set number of hours before start (Hunter 12). [OPEN Q-3: hard-coded in copy, blank in template.]
- R-021. Cancel 12 h or more ahead: value returns as wallet balance (court hour, drop-in) or package credit (bundle hour, class credit).
- R-022. Cancel inside the window: the value is forfeited. The sheet says this before the player confirms; "Keep booking" is the primary button.
- R-023. Club closure or coach change: full value back, or free cancel at any time for a coach change.
- R-024. The cancel sheet always states the outcome before the confirm button.

Wallet and credits
- R-030. Wallet balance is spent first at checkout. It is not withdrawable as cash.
- R-031. Court bundle hours work on either court at any open hour, and can also pay the court part of a solo class.
- R-032. Solo class pack credits cover coaching only. The court part is paid at each booking. Credits work with any coach of the same tier.
- R-033. Group pack credits: one credit per class, any class for the player's audience. Credit returns when cancelled 12 h or more ahead.
- R-034. Validity starts on the day of purchase. Unused credit expires on the expiry date and is lost. No cash refunds.
- R-035. LINE reminders 14 days and 3 days before expiry.
- R-036. Wallet balance expiry: **[OPEN Q-4]**.
- R-037. Every staff adjustment of wallet or credit needs a reason and writes an audit event.
- R-038. Order of use at checkout: package credit, then wallet, then payment for the remainder. How a solo-class court part chooses between bundle hour, wallet and PromptPay: **[OPEN Q-10]**.

Coaches and classes
- R-040. A coach never gets more than 6 teaching hours in a row (club-set). Booking, substitute choice, class templates and add-a-coach all enforce it; the 7th hour is never offered. "In a row" means consecutive hours, not a daily total.
- R-041. A solo class = coaching price (by coach tier and player type) + court part. Each time shown already has an open court assigned.
- R-042. A coach hour is bookable only when the coach is working, not on leave, under the 6-hour limit, and a court is open.
- R-043. Group classes are 60 minutes, 4 to 6 players, audience Adult or Student. A player sees only their audience.
- R-044. Class below minimum: the owner is alerted a club-set number of hours before start **[OPEN Q-3 `[X]`]** and chooses Keep running or Cancel session. Cancel returns full credit and messages players.
- R-045. Waitlist: join a taken slot or full class; first in line gets a LINE offer; claim window club-set (Hunter 30 min); decline or timeout passes to the next; no offers within 2 hours of start.
- R-046. Leave: coach requests; owner approves; affected sessions are flagged; owner assigns a substitute from eligible coaches; customers are told the new coach with free cancel; the player price is unchanged and the substitute is paid.
- R-047. A class template cannot be saved if it would break a coach's 6-hour rule. Saving creates the sessions for the booking window.

Pricing (Hunter tennis template; every price is a club setting and changes affect only new purchases)

| Item | Adult | Student (under 18) |
|---|---|---|
| Court hour | 500 | 500 |
| 10 hour bundle, valid 3 months | 4,500 | 4,500 |
| 20 hour bundle, valid 5 months | 8,000 | 8,000 |
| Solo class, coaching only (Coach) | 800 | 700 |
| Solo class all-in with court | 1,300 | 1,200 |
| Solo 8 pack, valid 3 months | 5,600 | 4,800 |
| Group drop-in | 600 | 500 |
| Group 8 pack, valid 3 months | 4,000 | 3,200 |
| Head Coach price | **[OPEN]** | **[OPEN]** |
| Add-ons (racket, balls, towel/water) | **[OPEN]** | **[OPEN]** |

- R-050. Price groups: Adult (18 and over, default) and Student (under 18, from date of birth). Other clubs may add groups.
- R-051. Court price may vary by Off-peak/Peak and Weekday/Weekend. Hunter is flat 500.
- R-052. Final offer v1.2: 10h and 20h court bundles only. No 5-hour bundle, no monthly unlimited, no gift vouchers.
- R-053. Players see only prices for their own audience.

Promotions
- R-060. One promo code per order. Each code has its own audience, scope, caps, minimum spend, dates and stacking rule.
- R-061. Referral: friend gets a first-purchase discount; referrer gets wallet credit after the friend's first booking is **played**. Self-referral blocked by LINE ID and phone. Amounts **[OPEN Q-11]**.
- R-062. Birthday: once a year, one package and one solo class, applied automatically in the birth month; LINE message on the 1st. Amount **[OPEN Q-11]**.
- R-063. Promo scope must be enforced as configured (PARTNER100 is court-only yet appears on a solo class checkout in the design; see section 12).

Payments
- R-070. Each club picks one way to take PromptPay: (A) **Beam** gateway, a QR per booking that confirms by itself; or (B) **PromptPay with slip checking**, the player uploads a slip that is verified automatically. **[OPEN Q-1: which applies to Hunter.]**
- R-071. Beam: package and booking QR valid for the hold time; unpaid means order cancelled, nothing charged.
- R-072. Slip: only a verified slip confirms. Wrong slip shows "This slip didn't match" with the slot still held, Upload a new slip, and Chat with us on LINE. Slip checking down or turned off enables backup mode (R-073).
- R-073. Backup slip check (A04) appears in the menu only while the checker is down or off. Approve unlocks only after four ticks: amount, paid-to account, paid after the booking was made, money arrived in the club's own bank app. Doesn't match sends the player the rejection popup. Decisions are saved with staff name.
- R-074. Staff can take PromptPay QR on the counter screen or cash. Cash needs a reason code (No banking app, QR failed at the counter, Other) plus optional note.
- R-075. Refund path: wallet or credit only. Beam's "refunds go back by PromptPay" text conflicts and must be removed or the rule changed. **[OPEN Q-12]**
- R-076. Money amounts are stored as integer satang. Display in baht.

Receipts and tax
- R-080. A receipt is issued automatically on every paid order. Numbers `HTC-YYYY-NNNNNN` (club prefix, year, six digits), gapless, never reused.
- R-081. Receipts are non-VAT by default: "This is not a tax invoice. The business is not VAT registered." VAT tax invoices are a club setting, off until registered. **[OPEN Q-5]**
- R-082. Void: Owner only, reason required, shows "Voided - reason". Reprint is marked Copy. Player downloads in Thai or English.
- R-083. Daily close summary (A14): PromptPay or Beam total, cash total with reasons, wallet used, package credit used. Wallet and credit are not new money.

Pause and closures
- R-090. Closure: courts, date, from/to or whole day, optional weekly repeat, reason. Blocked slots vanish from booking and coach availability. Preview shows affected bookings and refund outcome per type. Confirm cancels, returns full value, messages players and coaches.
- R-091. Club pause (platform admin only, reason required): new booking and buying off; players see the paused message; existing bookings stay valid; reminders keep going; package and wallet expiry move forward by the pause length; admin stays open with a banner.

## 4. Customer app requirements (C)

Navigation: bottom bar Home, Courts, Classes, Bookings, Profile. The rich menu tile "Book a court" opens C04 directly, not Home.

| ID | Screen | Must do |
|---|---|---|
| C01 | Welcome and LINE sign-in | Silent sign-in inside LINE; sheet only in a browser. "Add club as LINE friend" option. "Keep browsing". Terms and privacy links |
| C02 | Profile setup (first booking only) | Full name, phone, PDPA consent. DOB asked only when a Student price applies. Level optional later |
| C03 | Home | Next booking card, four quick actions (Book a court, Solo classes, Group classes, Packages), balance strip (court hours, wallet), promo card. Variants: Guest, New player (with referral banner), Birthday month, Paused |
| C04 | Book a court | Date strip, two court columns by hour, slot legend, multi-hour select, summary bar with Continue. States: Loading skeleton, Day full banner with next open day, Offline error, Waitlist joined sheet |
| C05 | Solo classes | Filters (All, Beginners, Juniors, Competitive), coach cards with tier, focus, languages, all-in price, next open time |
| C06 | Coach profile | About and Pick a time. Times carry their court. "No court open" is shown disabled. 7th-hour times never offered |
| C07 | Group classes | Audience fixed by player type, week range, level chips, rows with spots left or Full and action Book or Waitlist |
| C08, C08b | Class detail, pack choice | Credit first, drop-in fallback. With no credits: Drop in or 8 pack (preselected) using 1 now |
| C09 | Packages | Tabs Court bundles, Solo classes, Group classes, with price per hour/class, savings, validity, tags |
| C10 | Checkout | Court or class lines, optional Add a coach (only eligible coaches), add-ons, promo code, credit and wallet lines, amount due, Pay. Variants: bundle prompt, bundle plus booking, pack plus class, stand-alone package, credit-covered (confirm, no payment), referral discount, solo with credit |
| C11 | Pay | Beam waiting screen, or PromptPay QR with Save QR, bank-app list, Upload slip, countdown. States: Checking slip, Checking delayed (backup), Rejected, Time ran out |
| C12 | Confirmed | Booking summary, receipt number, Add to calendar, Share to LINE, Add a coach. C12P variants for hours added and seat plus pack |
| C13 | My bookings | Tabs Upcoming, Past, Waitlist. Cancel sheet (C13b) with outcome first. Late cancel and coach-changed variants. Empty state |
| C14 | Credits and wallet | Wallet balance, packages with remaining and expiry, signed ledger |
| C15 | Refer a friend | Personal link, copy, share in LINE, friend statuses |
| C16 | Waitlist offer | Countdown, Claim, Decline |
| C17 | Profile and receipts | Personal details (DOB locked for players, **[OPEN Q-13]**), language, notification toggles, receipts list with PDF, Privacy and my data (copy of data, delete account) |

- R-100. Check-in QR is available full screen from C12, My bookings and Home (note-only in the design; see section 12).
- R-101. PDPA: "Get a copy of my data" and "Delete my account" are requests handled by the front desk, confirmed in LINE, recorded in the audit log. Deletion loses unused credit; receipts stay on record for the club's accounts.
- R-102. Thai: Noto Sans Thai with DM Sans for numbers; Gregorian year; content scrolls, buttons never wrap.

## 5. Club admin requirements (A)

| ID | Screen | Must do |
|---|---|---|
| A0 | Setup checklist | Until live. Steps 1 to 5 BOOQ, 6 Brand (logo, colour preset, rich menu labels, show address toggle), 7 Products and rules (template, edit, CSV import of players and balances), 8 People (invite by LINE link), 9 Test and launch (BOOQ). "Tell BOOQ I'm done" unlocks after 6 to 8 |
| A01 | Calendar | Day and Week, two court columns, legend (Online, Staff, Awaiting payment, Solo class, Group class, Closed), click empty slot to create, drag to move with conflict check and LINE message. Paused banner when paused |
| A02 | New booking | Find or quick-add customer, items, add a coach, add-ons, credit and wallet, PromptPay QR or Cash with reason, auto receipt |
| A02b | Booking detail | Items, payment, receipt and slip image, history log, move, change coach, add add-on, cancel with return-to-wallet or forfeit, reason required |
| A02c | Sell package | Counter sale for a customer's own audience, wallet use, QR or cash, credits added immediately |
| A03 | Check-in | **Missing from the canvas.** Not checked in 15 min after start is Late; at end of slot No-show; staff can reverse with reason |
| A04 | Backup slip check | Per R-073 |
| A05 | Customers | Search, filters (All, Adult, Student, Active package, Expiring soon, No visit in 30 days, Tag), export CSV |
| A06 | Customer profile | Tabs Overview, Bookings, Purchases, Credits and wallet, Referrals, Receipts; tags; staff notes; Adjust balance with reason; Extend package (Owner) |
| A07 | Coaches | Leave requests, substitute assignment, table with tier, price override, pay model, monthly sessions, profile completeness TH/EN |
| A08 | Group classes | Templates and this week's sessions; below-minimum alert; template fields name TH/EN, audience, level, coach, court, weekly time, 60 min, min to max |
| A09, A09b | Products and pricing | Tabs Courts, Solo, Group, Coach tiers, Price groups and add-ons; court bundles; solo price preview |
| A10 | Promotions | Codes table, refer-a-friend amounts, birthday amount |
| A12 | Closures | Per R-090 |
| A13, A13b | Reports, Coach payouts | KPIs, occupancy heatmap, promotions summary; payouts per coach per month with adjustments and Mark paid |
| A14 | Receipts | List, PDF, void, daily close |
| A16 | Settings | Booking, payment and waitlist, coaches and classes, packages and wallet, business and tax, BOOQ support toggle (24 h) |
| A17 | Staff and audit log | Invite by LINE link with role; read-only audit log with filters |

- R-110. A coach payout counts sessions attended or marked no-show. Sessions cancelled within policy do not count. Pay goes to whoever delivered the session. Adjustments need a reason. Pay rates **[OPEN Q-14]**.
- R-111. Reports "Owed to customers" = unused package credit value + wallet balances (proposed; confirm). **[OPEN Q-15]**
- R-112. A11 and A15 appear in the numbering but have no design; they are not built until specified.

## 6. Coach portal requirements (K)

- K1 Today: counts and session list; footer shows teaching hours (copy shows 4.5 for 4 sessions, a design bug, see section 12).
- K2 Schedule: week agenda including leave and blocked times.
- K3 Availability: weekly hours and one-off changes; feeds solo-class booking immediately, combined with court availability.
- K4 Leave: request with range, full day or part, type, note; warns how many booked classes are affected.
- K5 Session detail: roster, Present/Absent per player, private note per player, session note (coaches and admins only). Marking feeds check-in and pay.
- K6 Earnings: month so far, base, solo and group counts, adjustments, past payouts.

## 7. Platform console requirements (P)

- P1 Clubs: list with status (Draft, Testing, Live, Paused), setup progress n of 9, bookings in last 30 days, LINE messages this month against quota, alerts first. Specialists see only assigned clubs.
- P2 New club wizard, steps 1 to 5, autosaved draft: basics (names TH/EN, legal name, 13-digit tax ID, branch, registered address, owner contact, default language), plan (single BOOQ plan 1,900 per month plus VAT, read only; trial end and billing start dates), courts and hours (sport, location, courts, opening hours), LINE (OA ID, Login channel, LIFF, Messaging token last 4, each with Test; same provider; rich menu upload), payments (Beam or slip checking per R-070, cash toggle).
- P3 Club detail: checklist with owner of each step, owner invite (link, resend), live checks with times and Test all again, status selector, alert banner and what to tell the owner, Open support view, Export club data (draft).
- R-120. A club cannot reach Testing until all LINE tests pass and steps 1 to 8 are done.
- P3b Support view: Draft and Testing clubs open in edit mode. Live clubs are look-only unless the owner turns on Allow BOOQ to make changes, which auto-expires in 24 hours. Every visit and change is logged with BOOQ staff name. No player, booking or payment data is ever shown.
- P3c Pause club per R-091. Owner gets a LINE message with the reason.
- P4 Launch: test mode (mock bookings, fake slips; players cannot see the club) with checks: mock bundle booking, fake slip accepted, fake slip mismatch popup, LINE confirmation arrives, reminder sent, receipt PDF has legal details, booking on calendar. Go-live checklist; test data deleted at go live; logged.
- P5 Templates: Tennis (Hunter's setup, used for new clubs), Padel and Pickleball (to build), Blank. Editing a template never changes an existing club. P4 blocks go-live on Blank until at least one priced product and every rule is set.
- P6 Team and audit log: BOOQ staff accounts and an immutable log of platform actions.

## 8. LINE messages (L)

Rich menu: six tiles, Thai first, English beneath: Book a court, Solo classes, Group classes, Packages, My bookings, Refer a friend. Each opens its page directly.
Rich menu labels in A0 are three editable; the image has six fixed tiles. **[OPEN Q-16]**

| Message | Trigger | Content |
|---|---|---|
| Confirmed | Payment confirmed or credit used | Booking details, View booking, Add to calendar. Wording fixed in code |
| Reminder | 24 h and 2 h before | 2 h version: details, Cancel (notes free cancellation has passed), My bookings |
| Waitlist offer | Spot opens | Details, Claim spot, Decline |
| Time ran out | Hold expires | Slot released, nothing charged |
| Cancellation result | Player cancels | Outcome (credit back or forfeited) |
| Club closed this slot | Closure | Full value back |
| Coach changed | Substitute assigned | New coach, Keep or Cancel for free |
| Session cancelled, new session | Coach side | Coach and substitute notices |
| Expiry reminders | 14 d and 3 d before expiry | Remaining balance and date |
| Birthday | 1st of birth month | Discount note |
| Referral reward | Friend's first booking played | Wallet credited |
| Slip result | Async check | Confirmed or rejected |
| Owner reconnect | LINE token fails | Steps to issue a new token |

- R-130. LINE message volume is capped per club per month (Hunter 15,000; trial clubs 300). Behaviour at the cap is **[OPEN Q-17]**.

## 9. Non-functional requirements

- NF-1. Multi-tenant: every row carries `club_id`; a user of one club can never read another's data.
- NF-2. Time stored in UTC, shown as Asia/Bangkok; slot arithmetic is by club-local hour.
- NF-3. Slot holds are atomic: two players cannot hold or pay for the same slot; payment webhooks are idempotent.
- NF-4. Availability for a day loads in under 1 s on a mid-range phone on 4G; calendar drag reflects a conflict within 300 ms of server response.
- NF-5. Accessibility: tap targets 44 px or more, text contrast 4.5:1, status never by colour alone, real buttons and labels.
- NF-6. PDPA: consent record, copy-of-data and delete flows, audit trail, retention rules for receipts.
- NF-7. Audit log is append-only and covers all staff and platform actions listed in R-037, R-074, R-082, R-091, support view and settings changes.
- NF-8. Offline and slow network states are designed (C04 Offline, Loading); errors say nothing was booked or charged.

## 10. Journeys (acceptance anchors)

Each flow has Given/When/Then scenarios in `/specs/acceptance/` (QA owns). Flow letters match the design flow maps.

0. Book one hour and pay. A. Book with bundle credit, then add a coach. B. Book a solo class by PromptPay, including slip mismatch. C. Join a full class from the waitlist. D. Cancel a booking. E. Buy a package then refer a friend. F. Front desk morning. G. Coach takes leave. H. Buy a court bundle. I. Buy a group class pack. J. Onboard a new club. K. Support a live club, pause a club.

## 11. Build order

Slice 0 foundation; 1 Flow 0 plus admin calendar; 2 club onboarding (P1 to P4, A0, templates); 3 front desk and receipts; 4 cancellation and LINE messages; 5 packages, wallet, referral; 6 coaches, classes, waitlist, coach portal; 7 reports, payouts, promotions, audit, support view, pause; 8 hardening. Detail in `DEVELOPMENT-PLAN.md`.

## 12. Open questions and design defects

Decisions needed (owner: product spec role, with the user)

| ID | Question | Why it matters |
|---|---|---|
| Q-1 | Beam or slip checking for Hunter? Settings and flow F1 say Beam ("no slips, no backup mode"); Flow 0, C11, C13, A02b, A04, P4 describe slip upload | Changes payment integration, half the checkout screens, and whether A04 exists for Hunter |
| Q-2 | Max future court hours per player | Booking limit |
| Q-3 | Are hold time (10/15/20), cancellation window (12 h) and claim window (30 min) fixed or club settings? Player copy hard-codes them; the Blank template leaves them empty. Also below-minimum alert hours | Copy must be generated from settings if they vary |
| Q-4 | Wallet balance expiry | Liability and reminders |
| Q-5 | VAT, legal name, tax ID, branch and address are placeholders | Receipts are legal documents |
| Q-6 | Support view: look-only vs can act (24 h opt-in is drawn) | Access model |
| Q-7 | Self sign-up, BOOQ pricing and billing, branches, web address | Platform scope |
| Q-8 | Visual direction: Palette D "Sage garden" with DM Sans on screens vs the design-system tokens (Jost/Kanit/EB Garamond, cream cards, 2 to 8 px radii) | Design system package |
| Q-9 | Stack and hosting | Slice 0 |
| Q-10 | Solo-with-credit: court part paid by bundle hour, wallet or PromptPay, and in what order | Checkout logic |
| Q-11 | Referral discount and reward amounts, birthday amount, per-code stacking | Promotions |
| Q-12 | Refunds: "never cash" vs Beam text "refunds go back by PromptPay" | Money policy |
| Q-13 | DOB locked for players after entry (designer suggestion) | Student pricing integrity |
| Q-14 | Coach pay models and rates (base plus rate, freelance percent, freelance flat) | Payouts |
| Q-15 | "Owed to customers" includes wallets (suggestion) | Reporting |
| Q-16 | Rich menu: 3 editable labels or 6 fixed tiles? Thai names differ (เรียนเดี่ยว vs คลาสเดี่ยว) | LINE setup |
| Q-17 | Behaviour at LINE monthly message cap | Messaging reliability |

Design defects to fix before build (found while reading the canvas)
- D-1. Thu 14 Jan 20:00 Adult intermediate drill is "Full 6 of 6" on C07, C16 and the LINE waitlist message, but "3 booked, needs 4" on A08.
- D-2. C07 lists sessions that match no A08 template (Beginner clinic Thu 18:00, Adult match play, Advanced filter).
- D-3. K1 shows four 60-minute sessions but says 4.5 teaching hours.
- D-4. K6 base-salary coach has 24 sessions; A07 says the 24-session coach is freelance. A07 says 4 coaches but lists 3; A13b says "0 of 3".
- D-5. PARTNER100 is court-only (A10) but applied to a solo class (C10b).
- D-6. Receipt numbers are not in date order across screens (000001 is both a 9 Jan booking and a 2 Jan court hour). Bundle bought 5 Jan expires 9 Apr; should be 5 Apr.
- D-7. Court type Outdoor/Indoor (P2) vs "Hard" (P3b); players "up to 4" vs "2 to 4".
- D-8. Missing screens: A03 check-in, A11, A15, class template edit, coach edit, add-coach modal, change-status modal other than Pause, check-in QR image.
- D-9. Language toggle label "TH | EN" vs "ไทย | EN".
- D-10. Palette default differs between V- files (A) and T-/F- files (D).
