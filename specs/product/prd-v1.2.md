# Hunter Tennis Club Booking Platform · Product Requirements v1.2

Oct 29, 2026 · @Criclabs

## Change log

Version 1.2 folds every design decision made so far into the spec. This doc is the live version and is updated whenever a design change touches the product rules.

| Version | Area              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|---------|-------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1.2     | LINE | LINE message cap rule added (LINE-07): alert at 70% of the plan limit, reminders stop at 80%, bookings and payments never blocked |
| 1.2     | Decisions 30 Oct (3) | New hand-off IDs ROLE-01, ROLE-02 and PLAT-07 added. Phone is typed and unverified, duplicates flagged; no date of birth means Adult prices, adults may add one, changes audited. CSV import is owner only, all or nothing, no bookings, ledger reason import; the owner downloads the club export; no delete-club in v1. The 7 Dec test runs on production with Hunter in Testing status |
| 1.2     | Decisions 30 Oct (2) | Foundation decisions: a person can hold several roles in one club; BOOQ staff sign in by email with a second factor, separate from LINE; BOOQ staff may see aggregate booking counts per club and the owner's contact details, never individual bookings or players; Testing-mode data is flagged, uses its own non-legal receipt numbers and is purged at Go live; one LINE provider per club; no code, no database and no earlier Booq core exists, Hunter is the first real build; the Notion Booq Product Reference is no longer the source of truth, this PRD and the hand-off are |
| 1.2     | Decisions 30 Oct | Late Beam payment (after the hold ends) is approved if the slot is still open, otherwise the value goes to the wallet (PAY-03 confirmed). The registered address stays on both PDF receipts while the app never shows it. The stack in this doc is adopted. Date of birth is not locked: a player can correct it in Profile. A Student package already bought stays valid when the holder becomes an Adult. Club LINE message cap behaviour is still undecided |
| 1.2     | Thai and business | Thai versions of every remaining screen: 53 player app screens and states, 20 club admin screens and 6 coach portal screens (Steps 4.3 to 4.5). Terms aligned to คลาสเดี่ยว, คลาสกลุ่ม and รายชื่อรอ. Legal name now บริษัท ทีที รีครีเอชั่น จำกัด on receipts and Settings, Thai only. Clickable flows checked end to end                                                                                                                                                         |
| 1.2     | Checkout          | Solo pack credits don't cover a coach added at court checkout. The player pays the full price there. Credits apply only through Classes, then Solo classes                                                                                                                                                                                                                                                                                                          |
| 1.2     | Booking           | A3 Check-in removed from the spec, wireframes, hi-fi, sitemap, flows and the F3 prototype. No check in nav item, no late flag setting, no Checked in status. Bookings count as played when the slot ends, and staff mark no shows from booking detail. Referral rewards land after the friend's first booking is played. The coach picked at checkout is held with the court during the payment hold                                                                |
| 1.2     | Platform          | Hunter launches on Beam. F1 and F2 prototypes now pay by Beam with no slip, with a new C11P Beam package screen. The slip journey moves to F1b for clubs on slip checking. Settings shows How players pay as Beam and adds the registered address, also on both receipts. Support view is setup only, BOOQ never sees player, booking or payment data. Players per club, one plan for now, 60 minutes fixed and Hunter's fixed ฿500 court price confirmed           |
| 1.2     | Platform          | Platform foundation decisions. Hunter built as the first club on the Booq core. Clubs with locations, courts as general resources, players per club, one LINE setup per club, 60 minute bookings for all. Price groups, peak and weekend court prices, club add-ons and sport labels are club settings. Clubs pay their own running costs. CSV import, guided LINE setup, data export, LINE usage per club. New A9b Pricing groups screen and sport templates in P5 |
| 1.2     | Payments          | Both payment options offered. Each club picks Beam or slip checking in P2 step 5. New C11 Beam screen with no slip upload. Hunter branch is head office. BOOQ plan is ฿1,900 a month plus VAT. Partner codes on solo classes parked for later                                                                                                                                                                                                                       |
| 1.2     | LINE              | Booking confirmation rich card in the LINE chat made explicit: sent as soon as a booking is confirmed, shown after C12 in the F1 prototype                                                                                                                                                                                                                                                                                                                          |
| 1.2     | Checkout          | Court checkout shows coaches available for that hour, each with their price for the player and a Profile link. Picking one makes it a solo class. Add-ons collapse into one row. New hi-fi state C10 Checkout · coach picked, and an optional branch in the F1 prototype                                                                                                                                                                                            |
| 1.2     | Navigation        | The LINE rich menu Book a court tile opens C4 Book a court, the court schedule, directly instead of Home. Every rich menu tile deep links to its own page                                                                                                                                                                                                                                                                                                           |
| 1.2     | Wording           | "Free" is no longer used for availability, so it never reads as no charge. Court slots say Open, coaches say available, and the guest Home button says Find a court time. "Free" stays only where nothing is charged, such as free cancellation                                                                                                                                                                                                                     |
| 1.2     | Business          | Hunter legal name ทีที รีครีเอชั่น จำกัด and tax ID 0135569018041 on receipts and Settings. BOOQ plan ฿1,900 a month. New section comparing payment checking options and LINE message costs                                                                                                                                                                                                                                                                                |
| 1.2     | Booking           | Check in QR removed. Once booked it's done, no QR to show at reception. Removed from confirmations, My bookings, Home, LINE messages and the QR screen. A3 Check-in is now an optional arrivals list by name, with no scanner                                                                                                                                                                                                                                       |
| 1.2     | Add ons           | Balls add on is one set of 3 balls. Shown as "Balls (Set of 3 balls)" in English and "ลูกเทนนิส (ชุด 3 ลูก)" in Thai on every screen and receipt                                                                                                                                                                                                                                                                                                                        |
| 1.2     | Design            | Guest Home added for browse first. Payment hold choices set at 10, 15 or 20 minutes. Step 6 clickable flows built for booking and paying, buying a package, front desk morning, onboarding a club, and supporting and pausing a club                                                                                                                                                                                                                                |
| 1.2     | Platform          | Pause rules set (bookings kept, expiry extended, new booking and buying off). Support view edits Draft and Testing clubs, live clubs look only unless the owner allows changes for 24 hours                                                                                                                                                                                                                                                                         |
| 1.2     | Payments          | Owner picks the payment hold time per club in Settings, 10, 15 or 20 minutes (15 default). Backup mode still holds for 60. Platform console hi-fi built                                                                                                                                                                                                                                                                                                             |
| 1.2     | Platform          | One BOOQ plan for every club. Blank template defined: no products, owner sets every rule before Go live                                                                                                                                                                                                                                                                                                                                                             |
| 1.2     | Platform          | Flows J and K approved. Wireframes for P1 to P6, the five P2 wizard steps, P3 support view and pause, and the owner's A0 Setup checklist. Hunter defaults template carries the final offer and rules                                                                                                                                                                                                                                                                |
| 1.2     | Payments          | Backup mode. When slip checking is down or turned off, holds extend to 60 minutes and staff verify slips by hand in A4 Backup slip check, a page shown only in backup mode. Admin console back to 15 pages                                                                                                                                                                                                                                                          |
| 1.2     | Payments          | Slip didn't match is now a popup on C11 with Upload a new slip and Chat with us on LINE, for players sure their slip was right                                                                                                                                                                                                                                                                                                                                      |
| 1.2     | Sign in           | Browse first, sign in at checkout. LINE Login runs when the player books or buys. The first sign in asks only for name, phone and consent. Date of birth only for student prices, level later in Profile                                                                                                                                                                                                                                                            |
| 1.2     | Payments          | Front desk slip review (A4) removed. Only a verified slip confirms a booking. Checking is a small overlay on C11, and a slip that doesn't match shows a banner to upload again. Bank app tiles added to C11. Admin console is now 14 pages                                                                                                                                                                                                                          |
| 1.2     | Scope             | Admin Messages page (A15) removed. LINE messages are still sent, with fixed wording and layout in code. Reminders fixed at 24 h and 2 h before start                                                                                                                                                                                                                                                                                                                |
| 1.2     | Scope             | Gift vouchers removed. No voucher tab in Packages, no admin Gift vouchers page (A11), no voucher message or record. Refer and gift is now Refer a friend (C15 and the rich menu tile)                                                                                                                                                                                                                                                                               |
| 1.2     | Purchase flows    | Flows H (court bundle) and I (group pack) added, with package checkout, package payment and purchase confirmed screens                                                                                                                                                                                                                                                                                                                                              |
| 1.2     | Pricing           | Final package offer. 10 hour bundle ฿4,500 and 20 hour bundle ฿8,000 (now 5 months). Each class type has a single price and an 8 pack, Adult and Student. All other packages dropped                                                                                                                                                                                                                                                                                |
| 1.2     | Design rules      | The app never shows the club's location (area, district or address)                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1.2     | Design rules      | Palette D "Sage garden" replaces the original colour table                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1.2     | Design rules      | UI type is DM Sans in sentence case, Noto Sans Thai for Thai. Cormorant Garamond is kept for the HUNTER wordmark only                                                                                                                                                                                                                                                                                                                                               |
| 1.2     | Pricing           | A solo class is priced as coach ฿800 plus court ฿500, so ฿1,300 an hour (confirmed)                                                                                                                                                                                                                                                                                                                                                                                 |
| 1.2     | Solo classes      | A coach booking always includes a court in one flow. The coach profile shows the court that comes with each time, and times with no open court as unavailable                                                                                                                                                                                                                                                                                                       |
| 1.2     | App structure     | "Book a coach" and "Individual lessons" are renamed Solo classes. Solo classes and Group classes sit together under the Classes tab                                                                                                                                                                                                                                                                                                                                 |
| 1.2     | App structure     | Bottom tabs are Home, Courts, Classes, Bookings, Profile                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1.1     | Coach rules       | Rest rule added. A coach teaches at most 6 hours in a row (sections 5.2 and 5.10)                                                                                                                                                                                                                                                                                                                                                                                   |
| 1.0     | All               | First version, 28 Oct 2026                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Overview

Hunter Tennis Club needs its own booking platform, live for public booking on 29 Dec 2026. Players open it from the LINE Official Account and sign in with LINE when they book or buy. It runs court bookings for the club's two courts, solo and group classes, packages, promotions, payments and club operations in one place.

### Goals

- Booking a court, a solo class or a group class from LINE takes under a minute, with no separate sign up.

- Packages, credits and cancellations follow written rules, so front desk staff never settle disputes from memory.

- Coaches run their own schedule, availability, attendance and earnings from their phones.

- The owners see revenue, occupancy, package liability and partner performance without exporting spreadsheets.

### Key dates

| Milestone                             | Date        |
|---------------------------------------|-------------|
| End to end testing with mock bookings | 7 Dec 2026  |
| Online booking open to the public     | 29 Dec 2026 |
| Soft launch                           | 9 Jan 2027  |
| Grand opening                         | 12 Mar 2027 |

### Club facts

- Two indoor courts, Court 1 and Court 2, singles or doubles (up to 4 players each).

- Open 06:00 to 24:00 every day. Bookings start on the hour, 60 minute minimum, in 60 minute steps.

- Flat court rate of ฿500 per hour.

- Adult is 18 or older. Student is under 18, worked out from the date of birth, and switches to adult pricing on the 18th birthday. The player can correct their date of birth in Profile at any time (30 Oct 2026).

- Every rule is an admin setting, not hard coded. Anything marked TBD is a setting the club fills in later, so designs show it as an editable value.

- The club's address is never shown in the app (v1.2).

### Platform and LINE

- One responsive web app run inside LINE as a LIFF app, so the same code works in LINE and in a browser.

- Three surfaces share it. The customer app (mobile, 375 px), the coach portal (mobile, Coach role) and the admin console (desktop, 1280 px). There is no check in page.

- Browse first, sign in at checkout (v1.2). Players can look at courts, classes, coaches and packages without signing in. LINE Login runs when they tap to book or buy. Inside LINE this is silent. In a browser the customer taps "Log in with LINE" once. Sign in prompts customers to add the OA as a friend.

- The Messaging API sends booking messages and reminders.

- Rich menu has six tiles opening deep links. Each tile opens its own page directly, not Home. Book a court opens C4 Book a court, the court schedule. Book a court, Solo classes, Group classes, Packages, My bookings, Refer a friend.

- First sign in asks once for full name, phone and PDPA consent. Date of birth is asked only when the player picks a student price. Language follows the LINE app and can be changed in Profile. Playing level is optional and set later in Profile. The LINE user ID is the permanent key.

- Suggested stack (not a requirement) is Next.js with the LIFF SDK, Postgres such as Supabase with row level permissions, server jobs for reminders and expiries, and a Thai slip verification API.

## Users, roles and app structure

Five roles share one platform. Everyone signs in with LINE, and the role decides which surfaces and data they see. Every change to a booking, balance, price or setting goes to the audit log.

| Role                        | Uses                              | Can do                                                                                                    | Cannot do                                                       |
|-----------------------------|-----------------------------------|-----------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| Customer (adult or student) | Customer app in LINE or a browser | Book courts, solo and group classes; buy packages; pay; cancel; see credits, receipts and referrals       | See other customers                                             |
| Coach                       | Coach portal (mobile)             | See own schedule; set availability; request leave; mark attendance; write session notes; see own earnings | See other coaches' schedules, customer payments or club revenue |
| Front desk                  | Admin console                     | Create and change bookings; walk ins and cash; look up customers                                          | See revenue or coach pay; change prices, policies or staff      |
| Accountant                  | Admin console, finance pages      | Read reports and receipts; export                                                                         | Change bookings, prices or balances                             |
| Owner / Admin               | Admin console, everything         | All of the above plus prices, packages, promotions, policies, staff, coach rates and payouts              | Nothing restricted                                              |

### Customer app pages (v1.2)

Bottom tabs are Home, Courts, Classes, Bookings, Profile. The Classes tab holds a Solo classes and Group classes switch.

| \#   | Page                     | Must show                                                                                                                                                                                                     |
|------|--------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| C1   | Welcome and LINE sign in | HUNTER wordmark; browse without signing in; sign in runs at checkout, silent inside LINE; "Log in with LINE" in a browser; add OA prompt. No location line                                                    |
| C2   | Profile setup            | Shown at the first checkout. Full name, phone, consent. Date of birth only for student prices                                                                                                                 |
| C3   | Home                     | Next booking card; quick actions Book a court, Solo classes, Group classes, Packages; credit and wallet summary; birthday banner; current promotion                                                           |
| C4   | Book a court             | Opened directly by the rich menu Book a court tile, not via Home. 30 day date strip; Court 1 and Court 2 hourly grid; open, held, taken, closed, past and my booking states; multi hour select; Join waitlist |
| C5   | Solo classes             | Coach cards with photo, name, tier, specialties, languages, price including court, next open time                                                                                                             |
| C6   | Coach profile            | Bio, certifications, languages; times by date, each showing its assigned court; times with no open court shown as unavailable; summary bar coach ฿800 + court ฿500                                            |
| C7   | Group classes            | Week view; level filter; class cards with coach, court, time, spots left; Full plus Waitlist; customer's audience only                                                                                        |
| C8   | Class detail             | Level, audience, date and time, duration, coach, court, players booked versus maximum, minimum to run, credit or drop in price                                                                                |
| C9   | Packages                 | Tabs Court bundles, Solo classes, Group classes; cards with credits, validity, price, per hour saving                                                                                                         |
| C10  | Checkout                 | Item, add ons, birthday discount, promo or referral code, credits applied, wallet applied, amount due, cancellation policy line                                                                               |
| C10b | Checkout, solo class     | Coach line and court line priced separately; coach and court held together for 15 minutes                                                                                                                     |
| C11  | Pay by PromptPay         | QR with amount, 15 minute countdown, save QR, bank app tiles, upload slip. Checking is a small overlay on this screen. A slip that doesn't match shows a popup to upload again or chat with the club on LINE  |
| C12  | Booking confirmed        | Summary, add to calendar, Add a coach (court bookings), share to LINE                                                                                                                                         |
| C13  | My bookings              | Tabs Upcoming, Past, Waitlist; status chip; Cancel, Receipt                                                                                                                                                   |
| C13b | Cancel sheet             | Outcome stated before confirming; value returns as wallet or credit, never cash                                                                                                                               |
| C14  | Credits and wallet       | Wallet balance; each package with credits left and expiry; history of movements                                                                                                                               |
| C15  | Refer a friend           | Referral link with Copy and Share in LINE; friends and reward status                                                                                                                                          |
| C16  | Waitlist offer           | The spot, a countdown to claim, credit used, Claim spot or Decline                                                                                                                                            |
| C17  | Profile and receipts     | Details, credits shortcut, refer shortcut, language toggle, LINE notification switches, receipt list with PDF, privacy and my data                                                                            |

Added in v1.2 for Flows H and I. C10P package checkout (credits, price per hour or session, validity and expiry date, promo code, wallet, amount due, no cash refunds line, plus the booking when one rides along). C12P purchase confirmed (credits added, expiry, receipt, Book now, plus the booking when one rides along). A bundle prompt on C10 when a player with no court hours pays full price. A pack choice on C8 when a player has no group credits.

Also added in v1.2. C11P and C11bP pay and check a package bought on its own. Nothing is held, the QR is valid 15 minutes, then the order is cancelled and nothing is charged. A package bought with a booking uses the normal C11 and C11b with the slot held. C9 Packages has full tabs for Court bundles, Solo classes (with the court fee note), and Group classes.

## Court booking

Customers book one or more consecutive hours on one court, up to 30 days ahead, and pay with bundle hours, wallet or PromptPay.

- Pick a date (today to 30 days ahead) and see both courts side by side in hourly slots from 06:00 to 24:00.

- Taken, closed and past slots show but can't be selected. A slot someone else is paying for shows as held.

- Bundle hours cover any hour of the day at the flat rate.

- Add a coach at checkout (v1.2). Court checkout (C10) shows the coaches available for that exact hour, updated live for the slot picked. A coach is shown only if they work that hour, aren't on leave, aren't already booked, and are under their 6 hour in a row limit. Each card shows name, tier, specialties, the price for this player (Adult or Student, by tier) and a Profile link that opens the coach profile. Picking one turns the court hour into a solo class: court ฿500 plus that coach's coaching price, for example ฿800 for an adult with a Coach tier. Adding a coach is optional; skipping keeps a court only booking. If a coach becomes unavailable before payment, the card disappears and the player is asked to pick again. Once the player taps Pay, the coach is held with the court for the payment hold, so nobody else can book them (confirmed 30 Oct 2026). Solo pack credits don't apply to a coach added here. The player pays the full coaching price, and solo pack credits are used only when booking through Classes, then Solo classes (confirmed 30 Oct 2026).

- After booking, Add a coach (from C12) still works the same way and shows coaches available at that same time on that court. Picking one turns it into a solo class and charges only the coaching portion (฿800 under the v1.2 price model).

- A customer can hold at most a set number of future court hours at once (setting, TBD).

- An unpaid booking holds its slot for 15 minutes, then is released.

- A taken slot offers Join waitlist (see Group classes and waitlist).

## Solo classes and coach rules

A solo class is one coach, one customer, 60 minutes, and always comes with a court booked in the same flow (v1.2). It is never possible to book a coach without a court.

### Booking a solo class

- Solo classes list shows photo, name, rate tier, specialties, ages and levels taught, languages, the next open time, and the price for the customer's type including the court.

- Coach profile shows bio, background, certifications such as ITF level, and times by date.

- Only times when the coach is available AND a court is open are bookable. The system assigns the court and shows it beside each time. A time when the coach is available but no court is shows as "No court open".

- Checkout lists the coaching line and the court line separately, and holds coach and court together for 15 minutes.

- Payment by a solo class package credit of the right tier and customer type, wallet or PromptPay. With a pack credit, the ฿500 court fee is paid by a bundle hour, wallet or PromptPay (v1.2).

### Rest rule

A coach teaches at most 6 hours in a row (setting, default 6). Booking never offers an hour that would be the 7th in a row. Solo classes, group classes and staff bookings all count, with no override.

### Coach rates and pay

- Each coach has a rate tier (for example Head Coach, Coach) with an adult and a student price per 60 minutes. The owner can override the price for one coach.

- Solo class packages are sold per tier, and a credit works with any coach in that tier.

- Price model in the designs is coach ฿800 plus court ฿500, so ฿1,300 for an adult solo class. The court portion (default ฿500, a setting) is separated, and coach pay is calculated on the coaching portion only.

- Pay model per coach is an optional monthly base, plus a per session amount for solo classes (fixed or a percentage of the coaching portion) and for group classes. Freelancers have no base.

- A session counts for pay when the customer attended or was a no show. Sessions cancelled within policy don't count.

- Monthly payout report shows sessions delivered, amount owed and adjustments with reasons. The owner marks it paid.

### Substitutions

- From a flagged session the owner picks a substitute. Only coaches available at that time are listed.

- Customers get a LINE message naming the new coach. Solo class customers may cancel for full credit regardless of the 12 hour rule.

- The price stays the same. Pay goes to the coach who delivers the session.

## Group classes and waitlist

Group classes run from owner made templates with 4 to 6 players by default, and full classes or taken court slots offer a waitlist.

- Templates hold name (Thai and English), audience (Adult or Student), level, coach, court, weekday and time, duration (always 60 minutes, so classes fit the hourly court grid, v1.2), and minimum and maximum players (default 4 and 6). Sessions are generated from them.

- The schedule shows the week, filterable by level, with spots left per session. Students only see Student classes, adults only Adult classes.

- Class detail shows players booked against the maximum and the minimum needed to run.

- Payment by a group credit for the right audience, a drop in price or wallet.

- If a session is below its minimum a set time before start (setting, TBD), staff get an alert. If they cancel it, everyone gets full credit back and a LINE message.

- Waitlist works for classes and court slots. When a spot opens, the first in line gets a LINE offer and has a set time (default 30 minutes) to claim and pay before it passes on. No offers within 2 hours of the start (setting).

## Pricing and packages

This is the final package offer (v1.2, from the club's five price sheets). Courts are ฿500 an hour, and each class type has a single price and an 8 pack, in Adult and Student versions. Validity starts on the purchase date.

### Court hours and bundles

| Product                       | Credit         | Validity   | Price (THB) | Per hour | Saving |
|-------------------------------|----------------|------------|-------------|----------|--------|
| Court hour, walk in or online | 1 court hour   | Single use | 500         | 500      | None   |
| 10 hour bundle (Popular)      | 10 court hours | 3 months   | 4,500       | 450      | 500    |
| 20 hour bundle (Best value)   | 20 court hours | 5 months   | 8,000       | 400      | 2,000  |

Bundle hours work at any available booking time, either court, subject to availability. The price sheet labels these "Soft opening special".

### Solo and group classes

| Package                           | Audience | Sessions              | Validity   | Price (THB) | Per session | Saving |
|-----------------------------------|----------|-----------------------|------------|-------------|-------------|--------|
| Solo class, single                | Adult    | 1 × 60 min            | Single use | 800         | 800         | None   |
| Solo 8 class pack (Best value)    | Adult    | 8 × 60 min            | 3 months   | 5,600       | 700         | 800    |
| Solo class, single                | Student  | 1 × 60 min            | Single use | 700         | 700         | None   |
| Solo 8 class pack (Best value)    | Student  | 8 × 60 min            | 3 months   | 4,800       | 600         | 800    |
| Group class, drop in              | Adult    | 1 session per person  | Single use | 600         | 600         | None   |
| Group 8 session pack (Best value) | Adult    | 8 sessions per person | 3 months   | 4,000       | 500         | 800    |
| Group class, drop in              | Student  | 1 session per person  | Single use | 500         | 500         | None   |
| Group 8 session pack (Best value) | Student  | 8 sessions per person | 3 months   | 3,200       | 400         | 800    |

Solo class prices are the coaching portion only. The court is added at ฿500 an hour, so an adult solo class is ฿1,300 and a student solo class ฿1,200 (confirmed). Class packs are valid 3 months (confirmed). Court bundles keep the "Soft opening special" label. Dropped from v1.1 are the 5 hour bundle, monthly unlimited, 4 and 12 packs for solo and group classes, grand opening special and grand opening family.

## Payments, cancellation, credits and wallet

Value never comes back as cash. It returns as wallet balance or package credit, and every movement is kept in a ledger.

### Booking and cancellation policy

- Courts, solo classes and group classes can be booked up to 30 days ahead.

- Cancelling 12 hours or more before start returns full value. Package credit goes back to the package, cash payments go to the wallet.

- Cancelling under 12 hours before, or not showing up, forfeits the credit or payment.

- The cancel sheet states the outcome before the customer confirms.

- When the club closes a slot, affected customers get full credit back automatically and a LINE message.

### Credits and wallet

- Credit types are court hours, solo classes (per tier and customer type) and group sessions (per customer type).

- A credit is reserved at booking, returned on a cancellation 12 hours or more ahead, used once the session starts, and forfeited on a late cancellation or no show.

- Expired credits are lost. LINE reminders go 14 and 3 days before expiry. The owner can extend a package only with a written reason.

- The wallet is a THB balance funded by cancellations and referral rewards. It is spent first at checkout and can't be withdrawn.

- Customers see the full history of every credit and wallet movement.

- Staff adjust credits or wallet only with a reason, recorded in the audit log.

- Student packages can only be bought by customers under 18. A Student package or credit already bought stays valid and usable after the customer turns 18 or corrects their date of birth to an adult age; it keeps its expiry date (confirmed 30 Oct 2026).

### Checkout and payment

- Checkout lists the item, add ons (racket, balls sold as a set of 3, towel, water; prices TBD), automatic birthday discount, a promo or referral code field, credits applied, wallet applied and amount due.

- Nothing left to pay confirms at once. Otherwise a PromptPay QR shows the exact amount with a 15 minute countdown while the slot is held.

- No check in QR (v1.2). Once a booking is confirmed the player is all set and just comes to play. Confirmations, My bookings and LINE messages show the booking details only. The PromptPay payment QR is unchanged.

- The customer uploads the transfer slip. Automatic checking confirms amount, receiving account, transfer time after booking creation, and that the slip is unused.

- Only a verified slip confirms a booking (v1.2). While the slip is checked, a small Checking overlay sits on C11. Slip passes, the booking is confirmed with receipt and LINE message. Slip doesn't match, nothing is booked: a popup on C11 gives the reason. The player uploads the right slip while the hold lasts. If they are sure the slip was right, they tap Chat with us on LINE, the club admin checks it in the LINE OA chat, and the front desk books it (A2) or adds the value to the wallet (A6). There is no everyday slip review queue. A4 Backup slip check is used only while automatic checking is down or turned off.

- Clubs on Beam (v1.2). The PromptPay QR is made by Beam for each booking. There is no slip to upload: C11 shows Waiting for your payment and the booking confirms when Beam reports the payment. The hold time and release work the same. The slip popup and A4 Backup slip check apply only to clubs on slip checking.

- No slip within 15 minutes releases the hold and tells the customer. A slip that arrives after the hold ends is approved if the slot is still open (v1.2).

- Front desk can take cash with a reason code, since the policy is QR first.

### Tax and receipts

- Receipts default to non VAT (likely below the 1.8M THB threshold), with a setting to switch to VAT tax invoices.

- Every payment gets a receipt in an unbroken sequence such as HTC‑2027‑000001, showing business name, address, tax ID and branch, customer, items, discounts, method and total.

- Customers download receipts as PDF from Profile. Voiding needs the owner and a reason, numbers are never reused, and reprints are marked as copies.

- A daily close summary totals each payment method for matching against the bank.

## Promotions and referrals

One promo code per order, partner codes tracked per partner, and referral and birthday rewards paid into the wallet or applied at checkout.

- Promo codes carry code text, percentage or fixed THB discount, what they apply to, audience and dates. Optional limits are first time only, total cap, per customer cap and minimum spend. The owner decides per code whether it stacks with the birthday discount.

- Launch example is ฿100 off a first court booking, handed out through partner gyms and cafes (shown in the designs as PARTNER100).

- Each partner business gets its own codes. The partner report shows redemptions, revenue, new customers and repeat bookings within 30 and 60 days.

- Refer a friend uses a personal link shared through LINE. The friend gets a first purchase discount (TBD). The referrer gets wallet credit (TBD) once the friend's first paid booking is played. Self referrals are blocked by LINE ID and phone.

- Birthday month discount (TBD) applies automatically to one package and one solo class, once each per year, announced by LINE on the first day of the month.

## Coach portal and admin console

The coach portal has 6 mobile pages inside LINE. The admin console has 15 desktop pages (A11 and A15 removed in v1.2, A4 shown only in backup mode) at 1280 px with a left sidebar showing only pages the role can use.

### Coach portal

| \#  | Page           | Must show                                                                  |
|-----|----------------|----------------------------------------------------------------------------|
| K1  | Today          | Sessions in time order with time, court, solo or group, students and level |
| K2  | Schedule       | Week view of solo and group classes, leave and blocked times               |
| K3  | Availability   | Weekly rules by day; one off open or closed times; 6 hour rest cap applied |
| K4  | Leave          | Request form (dates, full or half day, type, note); list with status       |
| K5  | Session detail | Roster with photo, level, past notes; Present or Absent; private note      |
| K6  | Earnings       | This month's delivered sessions and amount owed; past payouts              |

### Admin console

| \#  | Page                      | Roles             | Must show                                                                                                                                                                                             |
|-----|---------------------------|-------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A1  | Calendar                  | Front desk, Owner | Day and week views; Court 1 and Court 2 columns 06:00 to 24:00; colour key; drag to move; click to create                                                                                             |
| A2  | Booking detail and create | Front desk, Owner | Customer search or walk in quick add; items; add ons; payment incl. cash reason code; history                                                                                                         |
| A4  | Backup slip check         | Front desk, Owner | Only while automatic checking is down or off. Waiting slips oldest first with minutes left of the 60 minute hold; slip image; four ticks before Approve; Doesn't match sends the player the C11 popup |
| A5  | Customers                 | Front desk, Owner | Search, filters, tags, CSV export                                                                                                                                                                     |
| A6  | Customer profile          | Front desk, Owner | Details, notes, tags, bookings, purchases, credits, wallet, referrals, receipts; adjust with reason                                                                                                   |
| A7  | Coaches                   | Owner             | Profiles (Thai and English), tier, price override, pay model, availability, leave approvals, substitutions                                                                                            |
| A8  | Group classes             | Owner             | Templates, sessions, rosters, below minimum alerts, cancel session                                                                                                                                    |
| A9  | Products and pricing      | Owner             | Court rate, court portion, bundles, solo and group packages (Adult and Student), coach tiers, add ons                                                                                                 |
| A10 | Promotions                | Owner             | Promo codes, partners, referral and birthday settings                                                                                                                                                 |
| A12 | Closures                  | Front desk, Owner | Block by range, day or repeat; affected bookings preview                                                                                                                                              |
| A13 | Reports                   | Owner, Accountant | Dashboard with date range; partner report; coach payouts with Mark paid                                                                                                                               |
| A14 | Receipts                  | Owner, Accountant | List and search; PDF; void with reason; daily close; exports                                                                                                                                          |
| A16 | Settings                  | Owner             | Hours, booking window, cancellation cut off, hold time, waitlist and no show timing, max future hours, rest cap, business and tax details, VAT                                                        |
| A17 | Staff and audit log       | Owner             | Invite, assign roles, deactivate; searchable audit log                                                                                                                                                |

### Front desk rules

- Admin calendar colours paid online, staff created, awaiting payment, solo class, group class, and closed or blocked. Add on icons sit on the booking.

- Moving a booking checks conflicts (court, coach and rest rule) and messages the customer.

- There is no check in (v1.2). A confirmed booking counts as played once its slot ends. Staff can mark a no show or late cancel from booking detail (A2) with a reason, and reverse it the same way.

- Closures list existing bookings first, then cancel them with full credit and a LINE message. Blocked slots disappear from booking and coach availability.

- Reports cover cash received by type, revenue earned versus package sales, value still owed to customers, occupancy heatmap per court, online versus staff bookings and no show rate, new versus returning, promotion and partner performance, and coach payouts. Every report exports to CSV.

## Design and content rules

The BOOQ Booking Platform Design System is the source of truth. The feel is premium but approachable, calm, sporty and welcoming, never luxurious or exclusive.

### Colour, palette D "Sage garden" (v1.2)

| Role          | Hex      | Use                                                                             |
|---------------|----------|---------------------------------------------------------------------------------|
| Ground        | \#F1F3EC | App background                                                                  |
| Card          | \#FFFFFF | Cards and sheets                                                                |
| Heading       | \#24392B | Titles, primary buttons, selected tabs                                          |
| Dark surface  | \#4E6B54 | Header bars, summary bars, dark cards                                           |
| Selected      | \#3F5E46 | Selected slots and states, success text                                         |
| Open          | \#6E9A6E | Open slots                                                                      |
| Tint          | \#DDEADB | Confirmed chips, applied codes, info notes                                      |
| Butter accent | \#F3D98E | Only on dark surfaces, such as Continue in the summary bar and the success tick |
| Highlight     | \#F5ECCB | Pending chips such as Checking slip and Expires soon                            |
| Body text     | \#1D241F | Body text                                                                       |
| Muted text    | \#58635B | Secondary text                                                                  |
| Cancel        | \#9A4E3E | Cancel booking and destructive actions                                          |

### Type (v1.2)

- UI text is DM Sans in sentence case, a rounded digital style. Thai falls back to Noto Sans Thai so both languages sit on the same baseline.

- Cormorant Garamond Medium is used for the HUNTER wordmark only.

### Content

- The app never shows the club's location, area, district or address (v1.2).

- Prices always in THB, with the per hour or per session saving on packages. Solo class prices show the coach and court split.

- Dates use the international year in both languages (29 ธันวาคม 2026, never 2569).

### Layout and states

- Customer app and coach portal are mobile first at 375 px, with thumb reachable pill buttons. Admin console is desktop at 1280 px with the two court calendar as the main canvas.

- Court grid states must be distinct without colour alone. Open, selected, held, taken, closed, past, my booking.

- Booking states are labelled chips. Awaiting payment, Checking slip, Confirmed, Cancelled, No show.

- Every screen in Thai and English, with the Thai version designed too. Thai lines run taller and longer, so content areas scroll and buttons never wrap (found in the Step 4.2 Thai pass).

- Accessibility meets WCAG AA contrast, 44 px tap targets, states never by colour alone.

## LINE notifications and language

Messages go through the LINE Official Account in the customer's language, with fixed Thai and English wording and a fixed card layout set in code (v1.2). Wording changes go through the developer. There is no message editing page in the admin.

LINE message cap (LINE-07, decided 30 Oct 2026). The app reads each club's monthly usage from LINE and compares it with the club's plan limit. At 70% the platform console (P1) shows an alert and the club admin shows a banner asking the owner to upgrade the LINE plan. At 80% reminders (24 hours and 2 hours before start) stop being sent; booking confirmed, booking released, cancellation result, waitlist offer, club closed this slot, coach changed, package expiring, birthday discount and referral reward keep going. Skipped reminders are not sent later. At 100% on a paid plan everything keeps sending and the owner is told that LINE bills the club for extra messages. At 100% on the free plan LINE blocks sending: the app shows the confirmation in My bookings and on the confirmation screen, and a waitlist offer that cannot be sent passes to the next person. Bookings and payments are never blocked by the cap. The 70% and 80% thresholds are the same for every club and are not club settings.

| Message                                                                                                                                                                                                                               | Sent to    | When                                                |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------|-----------------------------------------------------|
| Booking confirmed. A rich card (LINE Flex Message) in the club's LINE chat, sent the moment the booking is confirmed: court or class, date, time, coach if any, amount paid, receipt number, View booking and Add to calendar buttons | Customer   | Payment confirmed or credit used                    |
| Slip needs re upload                                                                                                                                                                                                                  | Customer   | The automatic check says the slip doesn't match     |
| Booking released                                                                                                                                                                                                                      | Customer   | No slip within 15 minutes                           |
| Reminder                                                                                                                                                                                                                              | Customer   | 24 hours and 2 hours before start                   |
| Cancellation result                                                                                                                                                                                                                   | Customer   | Customer cancels; says whether value came back      |
| Club closed this slot                                                                                                                                                                                                                 | Customer   | Staff close a booked slot                           |
| Coach changed                                                                                                                                                                                                                         | Customer   | A substitute coach is assigned                      |
| Waitlist spot open                                                                                                                                                                                                                    | Customer   | A spot opens up and it is their turn                |
| Package expiring                                                                                                                                                                                                                      | Customer   | 14 days and 3 days before expiry                    |
| Birthday discount                                                                                                                                                                                                                     | Customer   | First day of birth month                            |
| Referral reward earned                                                                                                                                                                                                                | Customer   | Friend's first booking played                       |
| New or changed session                                                                                                                                                                                                                | Coach      | A solo or group class is booked, moved or cancelled |
| Leave approved or declined                                                                                                                                                                                                            | Coach      | Owner decides on a leave request                    |
| Class below minimum                                                                                                                                                                                                                   | Front desk | Set time before a class with too few players        |

Thai and English run throughout the customer app, coach portal, admin console, LINE messages and receipts. The starting language follows the LINE app, with a toggle on Profile. Everything the club types in has a Thai and an English field.

## Key flows

- **Flow 0, simplest booking.** The rich menu Book a court tile opens C4 directly (Home is skipped), pick one open hour, checkout with no package, pay by PromptPay, confirmed.

- **Flow A, court with bundle credit.** C4, pick two hours on Court 2, checkout applies 2 bundle hours, amount due 0, confirmed. Optionally Add a coach and pay only the coaching portion.

- **Flow B, solo class by PromptPay.** Classes, Solo classes (C5), pick a coach and a time with its court (C6), solo checkout (C10b) with a partner code, pay (C11), slip checked (C11b), confirmed. If the check fails, C11 asks for the right slip and nothing is booked.

- **Flow C, waitlist.** A Thursday adult class shows Full on C7, join waitlist, someone cancels, LINE message opens C16 with a 30 minute countdown, Claim uses a group credit.

- **Flow D, cancel.** C13, Cancel, the sheet (C13b) states the outcome first, confirm, LINE message confirms.

- **Flow E, buy and refer.** C9, buy the 10 hour bundle, share the referral link from C15, the friend's first played booking credits the referrer's wallet.

- **Flow F, front desk morning.** A1 today, quick add a walk in at 19:00 on Court 1, daily close in A14.

- **Flow G, coach leave.** Leave on K4, owner approves in A7, sessions flagged, substitute assigned, customers messaged with a free cancel option.

<!-- -->

- **Flow H, buy a court bundle (v1.2).** Main path is C9 Court bundles, package checkout (C10P) with hours, per hour price, validity and expiry, PromptPay, then Hours added (C12P) with a Book a court button. Shortcut while booking is C4, then a full price court checkout (C10) that offers the 10 hour bundle and 1 hour used now, one bill (C10P), PromptPay, then confirmation with hours left.

- **Flow I, buy a group class pack (v1.2).** Main path is C7, then class detail (C8) with no credits offering drop in ฿600 or the 8 pack ฿4,000 with 1 session used now, one bill (C10P), PromptPay, then confirmation with 7 sessions left. Next time the class is booked with 1 credit at ฿0. The pack can also be bought alone from C9.

Solo class packs follow the Flow I pattern from the coach profile, with the ฿500 court fee still paid at each booking.

## Data model

Twenty one core records cover version 1. Credits and wallet are stored as a ledger of movements, never a single editable number.

| Record            | Key fields                                                                                                                             | Links to                          |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------|
| User              | LINE user ID, display name, full name, phone, date of birth, language, level, role, tags, staff notes                                  | Bookings, Packages, Wallet ledger |
| Court             | Name, active                                                                                                                           | Bookings, Closures                |
| Coach             | User, bio (TH/EN), certifications, specialties, tier, price override, pay model                                                        | Availability, Leave, Sessions     |
| Coach tier        | Name, adult price, student price                                                                                                       | Coaches, Package products         |
| Availability rule | Coach, weekday, start, end, or a one off date open or closed                                                                           | Coach                             |
| Leave request     | Coach, dates, full or half day, type, status, approver                                                                                 | Coach                             |
| Booking           | Type (court, solo class, class seat), court, start, end, customer, coach, status, source. A solo class always has both coach and court | Payment, Credit ledger, Receipt   |
| Class template    | Name (TH/EN), audience, level, coach, court, weekday, time, duration, min and max players                                              | Class sessions                    |
| Class session     | Template, date, coach, status                                                                                                          | Bookings, Waitlist                |
| Waitlist entry    | Customer, session or court slot, position, offer sent, offer expires                                                                   | Booking                           |
| Package product   | Name (TH/EN), credit type, credits, validity, audience, tier, price, active                                                            | Customer packages                 |
| Customer package  | Customer, product, credits total, purchased at, expires at, extended reason                                                            | Credit ledger                     |
| Credit ledger     | Package, change, reason (reserve, return, use, forfeit, expire, adjust, import), booking, staff                                                | Package, Booking                  |
| Wallet ledger     | Customer, change in THB, reason, booking or referral, staff                                                                            | User                              |
| Order and payment | Items, add ons, discounts, amount due, method, slip, check result, status                                                              | Bookings, Receipt                 |
| Promo code        | Code, discount, applies to, audience, dates, caps, first time only, stackable, partner                                                 | Orders                            |
| Partner           | Name, type, contact                                                                                                                    | Promo codes                       |
| Referral          | Referrer, referred user, reward status                                                                                                 | Wallet ledger                     |
| Closure           | Courts, start, end, repeat, reason, staff                                                                                              | Courts                            |
| Receipt           | Sequential number, order, issued at, VAT flag, void reason                                                                             | Order                             |
| Audit entry       | Staff, time, record type and ID, old value, new value, reason                                                                          | Any record                        |

## Quality and scope

Version 1 must never double book a court or a coach, must keep data under Thailand's PDPA, and leaves 15 ideas for later.

- No double bookings. Court and coach slots are reserved in one transaction with a uniqueness rule, including during the 15 minute hold. A solo class reserves both or neither.

- The court grid and class schedule load in under 2 seconds on 4G inside LINE.

- All times in Asia/Bangkok. Permissions enforced on the server.

- PDPA privacy notice and consent at sign up, data copy or deletion on request, slips and staff notes staff only, daily backups.

- Backup mode (v1.2). If slip checking goes down, or the owner turns it off in Settings, slot holds stretch to 60 minutes and C11 tells the player the club is checking by hand. The A4 Backup slip check page appears in the admin menu only while this lasts. Staff tick amount, receiving account, transfer time and that the money arrived in the club's bank app before Approve unlocks. Every decision is logged in A17. When checking is back on, the page leaves the menu and holds return to the club's normal hold time. Each owner picks the normal hold time in Settings (A16): 10, 15 or 20 minutes, 15 by default. Settings also has the Automatic slip checking switch.

- A test mode with mock bookings and fake slips for the 7 Dec test.

Not in version 1. Family or guardian accounts, student ID upload, waivers, shared family packages, membership tiers, recurring weekly bookings, trial class and assessment, bill splitting, progress tracking and certification alerts, free influencer bookings, shift cash counts, school programs and camps, quotations and invoices, events and tournaments, card payments and court lighting control.

### Design deliverables

1.  All pages C1 to C17, K1 to K6 and A1 to A17, each with empty, loading and error states where relevant.

2.  Flows 0 and A to G as clickable sequences.

3.  The LINE rich menu and message cards for confirmation, reminder and waitlist offer.

4.  A PDF receipt layout in Thai and English.

## BOOQ platform and club onboarding (v1.2, proposed)

BOOQ becomes a platform sold to many clubs. Hunter Tennis Club is the first club, and BOOQ's own team gets a platform console to set up, launch and support new clubs. Each club keeps its own LINE account, its own PromptPay, its own prices and its own players. Money always goes straight to the club, never through BOOQ.

### Who uses it

| Role                         | Belongs to | Can do                                                                                                                                                                                                                                                                        |
|------------------------------|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Platform admin               | BOOQ team  | Create and set up clubs, change status (draft, testing, live, paused), see every club's setup and health, open a setup only support view of a club with no player, booking or payment data (edit while Draft or Testing, look only once Live unless the owner allows changes) |
| Onboarding specialist        | BOOQ team  | Same as platform admin for clubs assigned to them, no pause or delete                                                                                                                                                                                                         |
| Club owner                   | The club   | Everything in today's admin console, for their club only. Finishes setup after the invite                                                                                                                                                                                     |
| Club staff, coaches, players | The club   | Unchanged, they only ever see their own club                                                                                                                                                                                                                                  |

### What a club needs before it can go live

| Step                 | Who fills it            | What it holds                                                                                                                                                 |
|----------------------|-------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 Club basics        | Platform                | Club name (TH and EN), legal company name, tax ID, branch, registered address for receipts, owner name, phone, LINE and email, default language               |
| 2 Plan               | Platform                | One BOOQ plan at ฿1,900 a month plus VAT for every club, not editable per club (more plans may come later). Only trial end and billing start are set per club |
| 3 Courts and hours   | Platform or owner       | Number of courts, names, indoor or outdoor, opening hours per day. Bookings stay 60 minutes on the hour                                                       |
| 4 LINE               | Platform with the owner | LINE Official Account, LINE Login channel and LIFF app under the same provider, Messaging API token, rich menu uploaded. A Test connection check for each     |
| 5 Payments           | Platform with the owner | PromptPay ID and account name, slip checking account, whether cash is allowed                                                                                 |
| 6 Brand              | Owner                   | Logo, colour preset from the design system, rich menu labels, whether the address shows in the app (off for Hunter)                                           |
| 7 Products and rules | Owner                   | Start from a template (Hunter defaults or blank), then prices, packages, cancellation hours, hold time, waitlist timing, rest rule                            |
| 8 People             | Owner                   | Invite staff and coaches by LINE link, coach tiers and pay models                                                                                             |
| 9 Test and launch    | Platform                | Test mode with mock bookings and fake slips, a go live checklist, then Go live                                                                                |

### Platform console pages (desktop)

| \#  | Page                        | Must show                                                                                                                                                                                                                                                     |
|-----|-----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| P1  | Clubs                       | Every club with status, setup progress, bookings in the last 30 days, alerts                                                                                                                                                                                  |
| P2  | New club                    | The setup wizard, steps 1 to 5 above, saved as a draft at any point                                                                                                                                                                                           |
| P3  | Club detail                 | Setup checklist with what is missing and who owes it, LINE and slip checks, status changes, owner invite, setup only support view                                                                                                                             |
| P4  | Launch                      | Test mode results and the go live checklist                                                                                                                                                                                                                   |
| P5  | Templates                   | Default products, prices and rules a new club can start from. Hunter defaults or Blank. Blank has no products and empty club rules; the owner adds everything in Pricing, and Go live stays blocked until there is at least one product and every rule is set |
| P6  | Platform team and audit log | BOOQ staff accounts and every platform action                                                                                                                                                                                                                 |

### Platform flows (approved, wireframes in Step 1.8, hi-fi in Step 3.9)

- **Flow J, onboard a new club.** BOOQ team: P1 New club, P2 steps 1 to 5 with a Test for LINE and for slip checking, P3 saves a Draft and invites the owner by LINE link. Owner: signs in with LINE, works through A0 Setup checklist (brand, products from a P5 template in A9, staff and coaches in A7). BOOQ team: P3 Testing, P4 test mode and go live checklist, Go live. A failed test keeps the club in Draft or Testing, and P3 shows what is missing and who owes it.

- **Flow K, support a live club.** P1 alert, P3 club detail, setup only support view with no player data, owner reconnects and tests again. Only a platform admin can pause a club, with a reason, logged in P6.

- **A0 Setup checklist** is a new club admin page shown to the owner until the club is live.

**Pausing a live club.** Only a platform admin can pause, with a reason, and the owner gets a LINE message. While paused, new booking and buying turn off and players see "Online booking is paused for now. Message the club on LINE for help." Existing bookings stay valid and LINE reminders still work, package and wallet expiry dates move forward by the length of the pause, and the club admin stays open with a pause banner on every page, showing the reason and a Message BOOQ button. In the player app, Book a court, Classes and Packages show as paused, while upcoming bookings still show.

**Support access.** Draft and Testing clubs open in edit mode for BOOQ staff. Live clubs are look only. The owner can turn on Allow BOOQ to make changes in Settings (A16), which turns off by itself after 24 hours. Every visit and change is logged in P6 and in the club's own staff audit log.

### What changes in the club app

- Every record belongs to one club. A player, booking, package or receipt is never shared between clubs.

- Club name, logo, colours, LINE account and PromptPay come from the club's setup, not from code. HUNTER becomes the first club's brand.

- The club owner gets a Setup checklist page until the club is live.

- A player who uses two clubs signs in to each club's LINE account separately and has separate credits.

### Platform foundation (v1.2 decisions)

Hunter is built as the first club on the existing Booq core (Notion Booq Product Reference), set up with tennis settings. Everything Hunter needs is a club setting, not code written only for Hunter, so the next club costs less to add.

| Area           | Decision                                                                                                                                      | Where it shows              |
|----------------|-----------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------|
| Club structure | A club has one or more locations. Hunter has one, Main location · Head office                                                                 | P2 step 3, Add location     |
| Courts         | Courts are general resources with sport, type, lights and players                                                                             | P2 step 3 resources table   |
| Players        | Players belong to one club. A player at two clubs has two accounts (confirmed)                                                                | Player app, A6 Players      |
| LINE           | One LINE OA, LIFF app and rich menu per club                                                                                                  | P2 step 4 guided setup      |
| Booking length | Always 60 minutes on the hour, for every club                                                                                                 | P2 step 3, C4               |
| Price groups   | Platform setting. Hunter uses Adult and Student                                                                                               | A9b Pricing groups          |
| Court prices   | Prices by weekday or weekend and off peak or peak. Hunter uses one fixed price, ฿500 every day and hour                                       | A9b Pricing groups          |
| Packages       | Generic hour bundles and class packs, set by each club                                                                                        | A9 Price groups and add-ons |
| Staff          | Staff types and pay models per club (coach tiers, per hour pay)                                                                               | A12 Staff                   |
| Add-ons        | Each club keeps its own add-on list                                                                                                           | A9b add-ons card            |
| Sport labels   | Labels follow the sport (court, table, lane), not tennis only                                                                                 | P5 templates                |
| LINE templates | Message templates fill in the club's name, logo and rules                                                                                     | LINE messages               |
| Booking rules  | Hold time, cancellation window and waitlist are club settings                                                                                 | A16 Settings                |
| Running costs  | The club pays its own LINE OA plan and its payment or slip checking fees directly. BOOQ pays none of these                                    | P2 step 2 note              |
| Payments       | Two options per club, Beam or slip checking. Most clubs will pick slip checking because Beam's fees eat their margin. Hunter launches on Beam | P2 step 5                   |
| Templates      | Tennis (Hunter's setup), Padel, Pickleball and Blank                                                                                          | P5 Templates                |

**Onboarding friction fixes.** CSV import for players, packages and balances in A0 step 7. A step by step LINE setup guide in P2 step 4. Owner self serve sign up comes later, BOOQ sets up clubs for now. Export club data in P3 gives a clean exit.

**Running many clubs.** One codebase for every club, with feature switches per club. Health monitoring for LINE, payments and slip checking in P1. Usage numbers per club, including LINE messages this month. Under PDPA the club is the data controller and BOOQ is the data processor.

**Conflicts with the Notion Booq core to settle.**

- Plans. Notion lists Personal, Professional and Business. This design has one plan at ฿1,900 a month before VAT. Settled 30 Oct 2026, keep one plan now and add plans later.

- Platform admin access. Settled 30 Oct 2026, BOOQ staff never see customer data. The P3 support view now shows setup only (courts, products and pricing, LINE, payment connections, settings). Players, bookings, payments, slips, receipts, wallets and reports stay hidden.

- Booking length. Notion allows 60 or 90 minute variants. Settled 30 Oct 2026, fixed at 60 minutes for every club.

- Names. Notion says Store and Branch. This design says Club and Location.

### Open questions for the platform

- [ ] Is onboarding always done with BOOQ's team, or can a club sign up by itself later?

- [ ] BOOQ plan set at ฿1,900 a month before VAT. Still open: whether BOOQ bills clubs through the platform.

- [ ] Can one club have more than one location or branch?

- [ ] Does each club need its own web address, or a shared BOOQ address with the club's name in it?

- [x] Settled: BOOQ staff can edit Draft and Testing clubs. Live clubs are look only unless the owner turns on Allow BOOQ to make changes in Settings, which lasts 24 hours and logs every change with the BOOQ staff name.

## Payment checking and LINE message costs (v1.2, both payment options offered)

Prices below were checked online on 29 Oct 2026, mostly from the providers' own pages, and exclude VAT. Confirm them with each provider before signing.

**Decision (29 Oct 2026).** BOOQ offers both options and each club picks one in P2 step 5 (How players pay). Option A clubs pay with C11 Beam: the QR is made for that booking, there is no slip, and the booking confirms when the payment arrives. Option B clubs use C11 with slip upload, the slip popup and A4 Backup slip check. Hunter launches on Option A, Beam (30 Oct 2026). Which slip checking provider BOOQ contracts for Option B is still to choose.

### Option A, payment gateway (Beam)

The player pays a PromptPay QR made by the gateway for that exact booking. The gateway tells BOOQ when the money arrives, so there's no slip, no checking and no backup slip page. Refunds go back by PromptPay. Each club is its own merchant on Beam, so money still goes straight to the club.

- Beam lists QR PromptPay as "starts from free" per transaction, with next business day payout. Cards are 1.80% to 3.50%. Monthly or setup fees aren't listed, so ask Beam sales.

- A separate BOOQ product spec in Notion (Booq Product Reference, approved 19 Oct 2026) already confirms Beam as its gateway with PromptPay refunds.

- Each club needs its own Beam merchant account, which adds a step to club onboarding (P2 step 5).

### Option B, slip checking API

The player pays the club's PromptPay, uploads the slip, and an API reads the slip's QR to confirm the amount, receiving account, time and that it hasn't been used before. This is how the current design works.

| Provider | Package                        | Price a month          | Slips included            | About per slip       |
|----------|--------------------------------|------------------------|---------------------------|----------------------|
| Thunder  | Free / Start / Basic / Starter | ฿0 / ฿99 / ฿199 / ฿349 | 150 / 400 / 1,000 / 2,500 | ฿0.14 to ฿0.25       |
| EasySlip | Start / Basic / Starter        | ฿99 / ฿350 / ฿700      | 250 / 1,000 / 2,500       | ฿0.28 to ฿0.40       |
| SlipOK   | OK Start / OK SME              | ฿210 / ฿360            | about 500 / 1,000         | about ฿0.36 to ฿0.42 |

Thunder's prices come from Thunder's own comparison article. EasySlip's come from its pricing page. SlipOK's come from Thunder's article, so confirm them with SlipOK. EasySlip says it checks the receiving account, amount and duplicates, and covers 18+ Thai banks.

Hunter at full capacity is about 960 court hours a month, two courts at 16 hours over 30 days. Allowing for packages and re-uploads, expect about 500 to 1,000 checks a month. That's ฿199 to ฿360 a month on Option B.

### LINE Official Account messages

Each club sends from its own LINE OA. LINE counts messages the account sends on its own (push messages), including booking confirmations, reminders, waitlist offers and payment results. Replies to a player's chat and rich menu taps are free.

| Plan (Thailand) | Price a month | Push messages included | Extra messages |
|-----------------|---------------|------------------------|----------------|
| Free            | ฿0            | 300                    | Not available  |
| Basic           | ฿1,280        | 15,000                 | ฿0.10 each     |
| Pro             | ฿1,780        | 35,000                 | ฿0.06 each     |

Each booking sends about 3 to 4 push messages: confirmation, reminders 24 h and 2 h before, plus a payment result. 500 bookings a month is about 2,000 messages, so Hunter needs the Basic plan, ฿1,280 a month. On the free plan, messages stop once 300 are used. Unused messages don't carry over to the next month.

Sources: [Thunder price comparison](https://thunder.in.th/blog/cheapest-slip-verification-api/), [EasySlip packages](https://easyslip.com/api-products/), [EasySlip checks](https://easyslip.com/how-to-choose-slip-verification-api-thailand-2026/), [Beam pricing](https://www.beamcheckout.com/pricing), [LINE OA pricing guide](https://linebot.pro/blog/line-official-account-pricing-guide).

## Open questions

The first two come from the v1.2 pricing. Settled items are ticked at the end.

- [x] If a late payment (slip or Beam) arrives and the slot is already taken, the value goes to the wallet (confirmed 30 Oct 2026)

- [x] Solo pack credits cover coaching only. The player pays the ฿500 court fee at every booking, adult and student (confirmed).

- [x] The app hides the club's address, but receipts legally show the business address. Settled 30 Oct 2026: keep it on the PDF receipt only

- [ ] Add on prices (racket, balls as a set of 3, towel, water) are still TBD.

- [ ] Coach pay numbers per coach. Base salary, per solo class amount or percentage, per group class amount.

- [ ] Settled: clubs choose Beam or slip checking. Still open: which slip checking API BOOQ uses for the slip option (Thunder, EasySlip or SlipOK). See Payment checking and LINE message costs.

- [x] With no review queue, what happens when a player really paid but the check fails? Settled: the popup offers Chat with us on LINE. The club admin checks the slip, then the front desk books it or adds the value to the wallet in A6 with a reason.

- [x] If the slip checker is down, should PromptPay pause or the hold be extended? Settled: holds extend to 60 minutes and staff check slips by hand in A4 Backup slip check.

- [ ] Bank app tiles on C11 only open the bank app. The player then scans the saved QR from their photos. A prefilled amount needs a payment gateway with mobile banking (for example Opn). A gateway would also confirm payments automatically and remove slips. Consider for v2.

- [ ] Bank app links from inside LINE rely on each bank's unofficial app link. Test on iOS and Android before launch, and use official logos from each bank's brand kit.

- [ ] Choose the club's LINE OA plan. The free plan's 300 messages a month won't cover Hunter's confirmations and reminders. See Payment checking and LINE message costs.

- [x] Legal name and tax ID set: บริษัท ทีที รีครีเอชั่น จำกัด, tax ID 0135569018041. Branch is head office (สำนักงานใหญ่). Registered address 1128/1 ถนนเลียบคลองรังสิต ตำบลประชาธิปัตย์ อำเภอธัญบุรี จังหวัดปทุมธานี 12130, shown on receipts and in Settings. Settled 30 Oct 2026: the name uses the บริษัท prefix and stays in Thai on both receipts, with no English name.

- [ ] Settings values. Maximum future court hours, class minimum cut off, referral and birthday reward amounts.

- [x] Solo class price is coach ฿800 plus court ฿500, so ฿1,300.

- [x] Class packs are valid 3 months.

- [x] Court bundles keep the "Soft opening special" label.

- [x] Bundle prices settled by the final offer (฿4,500 and ฿8,000). Monthly unlimited, grand opening special and family package dropped.
