# Canvas versus spec: gaps register

The hand-off says: where the spec and the canvas disagree, the spec wins and the gap is a bug in the canvas.
This list was found by reading the whole canvas (screens, flow maps, notes) against PRD v1.2 and Hand-off v1.2 on 30 Oct 2026.
Build from the spec. Do not "fix" a gap by guessing; if the right answer is not in the spec, it is a question for the user.

## A. Canvas is wrong, spec is clear (fix the canvas, build the spec)

| # | Gap | Spec says | Where in canvas |
|---|---|---|---|
| A1 | Check-in leftovers | No check-in, no late flag, no check-in QR. Booking counts as played when the slot ends; staff mark no-show or late cancel in A2 with a reason and can reverse it (CANCEL-04). A3 removed | A01 notes about Late after 15 min and No-show at end of slot; C12 / My bookings / Home notes about a check-in QR |
| A2 | Slip screens shown as Hunter's path | Hunter pays by Beam: QR per booking, confirmed by Beam's verified callback, no slip (PAY-01, PAY-02). Slip checking, A4 and the slip popup are F16, other clubs only | Flow 0 and Flow B in the flow maps; C11 slip variant; C13 "Checking slip" chip; A02b "PromptPay slip, auto checked"; A04 in Hunter's menu; P4 fake-slip tests for Hunter; S-C11 delayed, rejected |
| A3 | Refund wording | Value never returns as cash; wallet or credit only (CANCEL-02, PAY-05) | P2 step 5 Beam option says "Refunds go back by PromptPay"; the PRD cost section repeats it |
| A4 | Partner code on a solo class | Partner codes on solo classes are parked for later | PARTNER100 applied on C10b solo checkout; flow B text |
| A5 | Fixed numbers in player copy | Hold time (10/15/20, default 15), cancellation window (12 h), waitlist claim time (30 min), no offers within 2 h are club settings (BOOK-03, CANCEL-01, CLASS-02) | "No slip within 15 minutes", "12 hours or more", "30 minutes" hard-coded in C9c, C10P, C11, C16, G- boards. Must become named variables in the locale files |
| A6 | Rich menu tile names | Thai terms are คลาสเดี่ยว, คลาสกลุ่ม, รายชื่อรอ, วอลเล็ต, เครดิต | L-Rich-menu uses เรียนเดี่ยว and เรียนกลุ่ม |
| A7 | Club address toggle | The app never shows the club's address, location, area or district (design rules) | A0 step 6 has a "Show the club address in the app" toggle; PRD step 6 also lists "whether the address shows in the app (off for Hunter)". The PRD contradicts itself; treat the toggle as not built until the user decides |
| A9 | Date of birth shown as locked | Never locked; the player can correct it in Profile | G-C17 Personal details ("To change it, ask the front desk") |
| A8 | Design-system tokens file | Palette D "Sage garden", DM Sans, Noto Sans Thai, Cormorant Garamond for the HUNTER wordmark only | `project/ds/booq/tokens.json` in the canvas uses Jost, Kanit, EB Garamond, cream cards and small radii. Ignore that file; use the PRD palette table |

## B. Sample-data errors in the canvas (do not copy into code or tests)

| # | Gap |
|---|---|
| B1 | Thu 14 Jan 20:00 Adult intermediate drill is "Full 6 of 6" with a waitlist offer on C07, C16 and the LINE message, but "3 booked, needs 4" below minimum in A08 |
| B2 | C07 lists sessions that match none of the three A08 templates (Beginner clinic Thu 18:00, Adult match play, Advanced filter) |
| B3 | K1 shows four 60-minute sessions but says "4.5 teaching hours". Bookings are always 60 minutes |
| B4 | K6 shows a base-salary coach with 24 sessions while A07 says the 24-session coach is freelance; A07 says 4 coaches and lists 3; A13b says "0 of 3" |
| B5 | Receipt numbers are out of date order (HTC-2027-000001 is both a 9 Jan booking and a 2 Jan court hour). A 10-hour bundle bought 5 Jan shows expiry 9 Apr; validity from purchase date gives 5 Apr (PKG-02) |
| B6 | Court type shows Outdoor/Indoor in P2 but "Hard" in P3b; players "Up to 4" vs "2 to 4" |
| B7 | Language toggle label "TH | EN" on most screens, "ไทย | EN" on C01 and C17 |
| B8 | Palette default is A in the V- files and D in the T- and F- files. Palette D is final |
| B9 | Receipt note says address and branch are placeholders, but the receipt shows the real ones (they are now settled: HTC, head office, 1128/1 ... 12130) |
| B10 | Admin page count is stated as 14 in one PRD change-log row and 15 in the body. The IDs to build are in the hand-off screen inventory |

## C. Spec gaps

Settled on 30 Oct 2026 (also recorded in the PRD change log and hand-off)
- **PAY-03.** A Beam payment that arrives after the hold ended is approved if the slot is still open, otherwise the value goes to the wallet.
- **Receipt address.** The PDF receipt keeps the registered address; the app never shows it.
- **Stack.** Next.js with the LIFF SDK, Postgres (Supabase) with row-level security by club ID, server jobs.
- **Date of birth.** Never locked. A player can correct it in Profile. The canvas G-C17 Personal details board shows it locked ("ask the front desk"), which is now a canvas bug (add to section A). Student pricing follows the date of birth on file.

Still open
| # | Question | Notes |
|---|---|---|
| ~~What happens to an already-bought Student package when the holder becomes an Adult?~~ | Settled 30 Oct 2026: it stays valid and usable until its expiry. Only new purchases follow the current price group. (Adult becoming Student via a DOB correction is not covered; treat the same way unless told otherwise) |
| C2 | Does "value still owed to customers" in reports include wallet balances? | Canvas note says the earlier spec counted package credit only |
| C3 | Behaviour at a club's LINE monthly message cap | Undecided. LINE-06 covers display and token alerts only. Not blocking early features |
| C4 | Rich menu: A0 offers three editable labels, the image has six tiles | LINE-02 says six tiles, each a deep link |
| C5 | A0 "Show the club address in the app" toggle | PRD contradicts itself (see A7) |
| C6 | Which slip-check provider for F16 (Thunder, EasySlip, SlipOK) | Not needed for Hunter launch |
| C7 | Platform: self sign-up, BOOQ billing through the platform, branches per club, web address per club | Not needed for Hunter launch |

## D. Locale files

- `locales/en.json` has 1,476 keys, `locales/th.json` has 1,180. The 296 missing Thai keys are all `X-` platform-console keys, which are English only (TEXT-05). All other prefixes (P 458, A 549, K 112, L 61) match one to one.
- No string contains a named variable yet. Sample values (names, dates, prices, counts) are still baked into the text, so the TEXT-03 pass is still to do before the screens are built.
- `locales/copy-index.csv` is named in `CLAUDE.md` but was not supplied. It must be produced (key, screens, canvas boards) or received from the writers.
