# F14 Referrals and birthday discount · Requirements

Status: **Approved 30 Oct 2026** (gate 1). Recorded in `docs/decisions.md`, round 11: D146 approves the F14 and F15 requirements and D129 to D145 answer their questions. Revision 2 applies D129 to D136. Changes after approval go PRD, then hand-off, then this file. No design or code follows until the design gate.

Feature: F14 Referrals and birthday discount. Depends on: F06. Requirement IDs: PROMO-01 (the code and stacking rules, owned by F04, used here), PROMO-02 (referral reward and the self referral block), and the birthday discount rules the hand-off has no ID for (labelled R1 to R4, local to this file). Wave 5.

## Sources

| Short name | File | Sections used |
|---|---|---|
| PRD | `specs/product/prd-v1.2.md` | Promotions and referrals; Customer app pages C3 (birthday banner), C10, C15 Refer a friend; Admin A10; LINE notifications (Birthday discount, Referral reward earned); Club facts (date of birth); Key flows E |
| HO | `specs/product/handoff-v1.2.md` | Business rules as requirements (PROMO-01, PROMO-02, AUTH-02, CANCEL-01, LINE-05); Data model (Promo code, partner, referral; Wallet ledger); Open items (referral reward, friend discount, birthday discount are empty settings) |
| Decisions | `docs/decisions.md` | D11, D12, D21, D23, D65, D66, D67, D70, D78, D94, D95, D105, D118, D129 to D136 |
| Gaps | `docs/canvas-gaps.md` | A4 (partner codes on solo classes parked), B-section sample warnings |
| QA | `docs/qa/traceability.md`, `open-questions.md` (branch `qa/test-strategy`) | PROMO-02 row; Q-13, Q-17, Q-18 |
| Other features | F02, F04, F06, F09, F10, F11 | Date of birth and phone, code engine, wallet, cancel and played, messages, A10 |

The spec wins over the canvas. Boards named are the ones in the canvas file list on 30 Oct 2026; every board has a T- Thai twin.

## Scope

In scope: the personal referral link and code, attributing a friend, the friend's first purchase discount, the referrer's wallet reward after the friend's first paid booking is played, the self referral block, the C15 screen and its statuses, the birthday month discount (entitlement, banner, checkout line, message), and the A10 settings for the two.

Out of scope: the promo code engine, one code per order and stacking arithmetic (F04, PROMO-01), the wallet ledger (F06), the played status (F09), the LINE messages themselves (F10), the A10 screen as a page (F11), partner codes and the partner report (F04, F13).

## Canvas legend

H- hi-fi, G- gap states, S- states, T- Thai twin. Boards: H-C15-Refer-gift (T-), G-C10-Referral-discount (T-), G-C03-Birthday (T-), H-C03-Home, H-A10-Promotions (T-), H-C10-Checkout, L-Msg-* (no boards for the Birthday discount and Referral reward earned messages; F10 D91). The canvas shows a sample link and code (hunter.club/r/PLOY24, PLOY24); they are samples, not rules (the domain is D6, still to be supplied).

## Cross-cutting rules (apply to every requirement below)

**CC-1 Club ID scope.** Referral links, codes, referral rows, entitlements and settings carry the club ID. A referral link of club A works only at club A. A player at two clubs has two accounts and two referral codes (PRD What changes in the club app). A request for another club's record answers 404 (D27).

**CC-2 Server side.** The server decides who is a friend, whether a reward is due and whether a discount applies. The client sends the link or the code; it never sends an amount.

**CC-3 PDPA.** The referrer sees a friend's status only, as "Friend 1", "Friend 2" with a chip, never the friend's name, phone or bookings (C15 canvas). The referrer is not named to the friend: the welcome text carries no name, and the canvas wording "Your friend Ploy's code" is a canvas fix (D129). The date of birth is used for the birthday month only and is never shown to the referrer or the Accountant (D35). BOOQ staff never see referral or birthday data (PLAT-02). Test records are flagged and excluded (D33).

**CC-4 No double booking.** Not relevant. Referral and birthday discounts change the price and the wallet, never a slot or a coach. A reward paid or a discount applied never creates, moves or releases a booking.

**CC-5 Language files (TEXT-01 to TEXT-06).** All text from `locales/*` by key, Thai and English. Sample values are named variables with the same names in both files (variable names are those in `locales/README.md`, for example `{friendDiscount}`, `{referrerReward}`, `{friendName}`, `{referralLink}`, `{amount}`, `{code}`); the discount and reward amounts are never typed in a key. Existing wording is not edited; new text gets new keys in both files, proposed by the drafter, owned by the writers (D51). Dates use the international year. Layouts survive the longest string; the link row, chips and buttons never wrap.

**CC-6 Other platform rules.** All times Asia/Bangkok, including the birth month, the first day of the month and "once a year". Money is integer satang. Never invent an amount: the friend discount, the referrer reward and the birthday discount are empty club settings (hand-off open items); an empty value means that part is not offered or paid.

---

## PROMO-02 Referral reward and the self referral block

**Source.** HO PROMO-02. PRD Promotions and referrals (Refer a friend), C15, A10, Key flows E; D11, D66, D78, D94, D118; QA Q-18.

**Requirement.** The referral reward lands in the referrer's wallet after the friend's first paid booking is played. Self referral is blocked by LINE ID and phone.

**Acceptance criteria.**

- PROMO-02-AC1. Given a signed in player, when they open Refer a friend (C15), then they see their personal referral link with Copy and Share in LINE, the friend discount and the reward from the club's settings (as `{friendDiscount}` and `{referrerReward}`), and their friends with a status chip each (PRD C15).
- PROMO-02-AC2. Given a friend opens the referral link, when they sign in and complete first sign in (F02), then the link's referrer is recorded against the friend as their referrer; the club comes from the link (D6).
- PROMO-02-AC3. Given a friend who is a new player at this club (no earlier paid purchase, D136), when they reach checkout after the link, then the referral code is applied as their one code of the order and gives the friend's first purchase discount (PROMO-01-AC11); the checkout shows the Friend's code chip. A player with an earlier paid purchase who opens a link is not a friend and gets no discount and no reward.
- PROMO-02-AC4. Given the friend's first paid booking, when its slot ends and it becomes Played (CANCEL-04), then a wallet row with the reason `referral_reward` for the amount of the referrer's reward setting is written to the referrer's wallet and the friend's status becomes Reward added (D78, PRD, C15).
- PROMO-02-AC5. Given the reward is due, when the referrer's wallet row is written, then the Referral reward earned LINE message is sent if their Promotions in LINE switch is on; the reward is paid either way (D94, LINE-05-AC9).
- PROMO-02-AC6. Given a friend who has joined but has no played paid booking, when C15 loads, then their chip shows Joined, not played yet.
- PROMO-02-AC7. Given a referrer who is the same person as the friend, by LINE ID or by phone number, when the link is used, then the referral is refused: no friend discount and no reward (PROMO-02 hand-off check). A phone number already used by another player at the club is flagged for staff on both records (D11).
- PROMO-02-AC8. Given a reward paid and the friend's booking later reversed to No show by staff, when it is reversed, then the paid reward stays paid (D118).
- PROMO-02-AC9. Given one friend, when they have several paid bookings, then exactly one reward is paid for that friend (one reward per referred friend; the first played paid booking counts). A second played booking does not pay again.
- PROMO-02-AC10. Given the reward amount, when the friend's qualifying booking is played, then the reward is the amount in force at that moment (D130); if it is empty then, no reward is paid and none is paid later when the owner sets it.
- PROMO-02-AC11. Given a referral reward, when it is saved, then the wallet row and the referral status change are one transaction, and two parallel Played events for one friend give exactly one reward (no double payment).
- PROMO-02-AC12. Given a referrer who has been deleted or anonymised (PDPA), when the friend's booking is played, then no reward is paid and the friend keeps their discount.
- PROMO-02-AC13. Given the referral and reward, when they are created or paid, then the changes are audited (PLAT-04) and the ledger row is append only (D28).
- PROMO-02-AC14. Given what counts, then the friend's booking counts only if money was paid for it (a booking paid wholly by package credit or wallet does not count); a cancelled booking never counts and the reward waits for the friend's next qualifying booking (D131).
- PROMO-02-AC15. Given the referral link, when it is shared in LINE, then it opens the club's app with the referrer recorded in the URL; sharing uses LINE's own share, and the link never contains the referrer's name or phone.

**Meets.**

- PDPA: CC-3; the friend's chip hides their identity; the referrer's first name shows only as the welcome text allows.
- No double booking: not relevant (CC-4).
- Club scope: link, code, rows and settings per club (CC-1).
- TEXT: C15 and the checkout chip use P keys with the variables above; the welcome text uses `{friendName}` for the referrer's name (the key name is the writers'); the Referral reward earned card uses L keys.

**Canvas.** H-C15-Refer-gift (T-), G-C10-Referral-discount (T-), H-A10-Promotions (T-), L-Msg-* (D91).

---

## R1 Referral link, code and attribution

**Source.** PRD Promotions and referrals ("Refer a friend uses a personal link shared through LINE"), C15; D6, D11, D105.

**Acceptance criteria.**

- R1-AC1. Given a player, when they first open C15, then a personal referral code is created for them at this club and stays the same; the link carries the club and the code.
- R1-AC2. Given the referral code, when a friend enters it by hand in the code field instead of the link, then it works the same as the link (the code field accepts a friend's code, F04 PROMO-01-AC11).
- R1-AC3. Given a friend opens the link, when they complete first sign in through it, then the referrer is recorded against them at that first sign in with no time limit; the link need not be used again at purchase (D132).
- R1-AC4. Given a friend already recorded against one referrer, when they open another referrer's link, then the first referrer stays; a friend has one referrer.
- R1-AC5. Given the friend discount is empty, when a friend uses a link, then the referrer is recorded but no discount shows.
- R1-AC6. Given a Paused club, when a friend opens a link, then they browse and sign in as usual; the discount applies only when buying is on (F01 PLAT-03).
- R1-AC7. Given a link for a club in Draft or Testing, when someone opens it, then it follows the sign in rules for that status (F02 AUTH-01-AC15).
- R1-AC8. Given the owner sets or changes the friend discount or reward amount, when it is saved, then it applies to new referrals and rewards from then and is audited (PLAT-04); a reward uses the amount in force when the friend's booking is played (D130).

**Meets.** PDPA: the link carries a code, not personal data. No double booking: not relevant. Club scope: per club. TEXT: P keys.

**Canvas.** H-C15-Refer-gift (T-).

---

## R2 Birthday month discount

**Source.** PRD Promotions and referrals ("Birthday month discount (TBD) applies automatically to one package and one solo class, once each per year, announced by LINE on the first day of the month"), C3; D12, D21, D65, D94, D118.

**Requirement.** In the player's birth month a discount applies automatically at checkout to one package and one solo class, once each per year. The value is an empty club setting.

**Acceptance criteria.**

- R2-AC1. Given a player with a date of birth on file, in their birth month (Bangkok calendar month), with the birthday discount value set, when they price a package or a solo class, then the discount applies automatically and shows as a line (F04 R5-AC1).
- R2-AC2. Given the player has not used the package entitlement this year, when they buy a package, then the discount applies once; after it is used, a second package in the year gets no birthday discount. The solo class entitlement is separate and also once a year.
- R2-AC3. Given the discount value is empty, when checkout loads, then no birthday discount shows and no banner shows.
- R2-AC4. Given a player with no date of birth on file, when checkout loads, then no birthday discount applies (D12); adults may add a date of birth voluntarily in Profile, which makes them eligible from their next birth month.
- R2-AC5. Given the birth month, when the player opens Home (C3), then a birthday banner shows with the amount and two chips Package unused or used and Solo class unused or used (G-C03-Birthday), and it says it applies at checkout automatically any time in the month.
- R2-AC6. Given a code that is stackable with the birthday discount, when both apply, then both apply; given a code that is not stackable, then the larger discount wins and the other is not used up (F04 PROMO-01-AC2, D65).
- R2-AC7. Given a booking or order that used the entitlement is cancelled 12 hours or more ahead, when F09 returns value, then the entitlement is restored by the same rule as a code: only when every hour of the order is cancelled (D118, D67).
- R2-AC8. Given a player changes their date of birth, when it moves their birth month, then eligibility follows the date on file at the time of pricing; entitlements already used this year stay used. A change is audited and visible to the owner (D12, F02 AUTH-02-AC21).
- R2-AC9. Given a birthday discount percentage or amount, when it is calculated, then it follows the F04 rounding (half up to the satang, D23) and applies to the whole solo class price (coach and court lines together, D133) or to the package price; add-ons are excluded unless the setting says so.
- R2-AC10. Given the first day of the player's birth month, when the Bangkok day starts, then the player gets the Birthday discount LINE message if their Promotions in LINE switch is on, the value is set and they have a date of birth on file (LINE-05-AC8, D94). A booking made on the first day is not delayed.
- R2-AC11. Given the entitlement counts once a year, when "a year" is counted, then it resets each Bangkok calendar year (D134).
- R2-AC12. Given a player whose birth date is 29 February, when the birth month is worked out, then the month is February (leap day players keep the month; the discount applies in February of every year).
- R2-AC13. Given a booking that is a court hour, group class or any item other than a package or a solo class, when it is priced, then no birthday discount applies.

**Meets.**

- PDPA: the date of birth is used for the month check only and never shown to other roles (CC-3).
- No double booking: not relevant.
- Club scope: per club and player; the setting is per club.
- TEXT: banner and checkout line from P keys with `{amount}` and the month name; the message from L keys.

**Canvas.** G-C03-Birthday (T-), H-C10-Checkout, H-A10-Promotions (T-), L-Msg-* (D91).

---

## R3 A10 settings for referrals and birthday

**Source.** PRD A10 ("Promo codes, partners, referral and birthday settings"); HO open items.

**Acceptance criteria.**

- R3-AC1. Given the owner in A10, when they open Refer a friend and Birthday month, then they see the friend's first purchase discount, the referrer wallet reward and the birthday discount as empty editable fields (dashed as TBD) until set; no default value is shown.
- R3-AC2. Given the owner saves a value, when it is saved, then it is audited and applies to new uses from then (R1-AC8).
- R3-AC3. Given the owner is Front desk or Accountant, when they open A10, then the server refuses (Owner only, HO Roles).
- R3-AC4. Given the settings are empty and the club goes Live, then Go live is not blocked by them (they are TBD settings, F01 Q7), and the player app shows no friend discount, reward or birthday banner.
- R3-AC5. Given the friend discount is a fixed THB amount, when it applies to a smaller order, then the discount is capped at the price in scope (F04 PROMO-01-AC4).

**Meets.** PDPA: not relevant. No double booking: not relevant. Club scope: per club. TEXT: A keys.

**Canvas.** H-A10-Promotions (T-).

---

## R4 Abuse checks

**Source.** PRD ("Self referrals are blocked by LINE ID and phone"); D11.

**Acceptance criteria.**

- R4-AC1. Given a friend whose phone number equals the referrer's, when the link is used, then it is refused as a self referral (PROMO-02-AC7).
- R4-AC2. Given a phone number shared by several players at one club, when it is typed, then it is allowed and flagged for staff, since the phone is typed and not verified (D11); the referral is not paid automatically if the friend's phone matches the referrer's phone.
- R4-AC3. Given a friend with a different phone but the same LINE ID as the referrer, when the link is used, then it is refused (one person has one LINE ID per club).
- R4-AC4. Given staff see a flagged duplicate, when they review it in A6, then they can add a note; they cannot change a paid reward (only a wallet `adjust` with a reason, F06 PKG-01-AC4).
- R4-AC5. Given a referrer with many friends, when rewards are paid, then each is a separate wallet row; there is no reward cap in v1 (D135).

**Meets.** PDPA: flags are staff only. No double booking: not relevant. Club scope: per club. TEXT: A6 flag label from an A key.

**Canvas.** H-A06-Customer-profile (T-).

---

## Data covered by F14 (HO Data model, for the design step)

Referral (club, referrer, referred user, reward status: joined, reward added), referral code per player, promo code of kind referral (F04), birthday entitlement (player, year, package used, solo class used), wallet ledger rows with reason `referral_reward` (F06), settings (friend discount, referrer reward, birthday discount; all empty by default).

## Proposed new text keys (D51)

Proposed by the drafter; writers own the wording; numbers from the i18n role after `copy-index.csv` exists (D31). Existing keys first (P-0240, P-0241, P-0245, P-0247, P-0402, P-0433 to P-0435).

- P: referral code already used, link not valid for existing players, your own code cannot be used, birthday banner chips used and unused, birthday discount line at checkout.
- A: duplicate phone flag on a player, referral status labels.
- L: Birthday discount and Referral reward earned (wording by the writers on the Booking confirmed card style, D91).

No key is added by this draft.

## Open questions

All 8 earlier questions are answered by D129 to D136 and removed. None remain.
