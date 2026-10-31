# F02 acceptance sweep (F02-T25)

Swept on 31 Oct 2026 against `specs/features/F02-line-login-liff/requirements.md` and `design.md` section 13.

**Result: 62 criteria. 54 covered by lane tests (database, domain and web), 0 new QA tests needed, 0 findings, 8 still open (each with its reason).**

The lanes' tests (`packages/db`, `packages/domain`, `apps/web`) cover the database functions, the price group and profile rules, the sign in client and the C1, C2 and C17 components. Many cite the criterion as `AC12` without the prefix, so `F02-line-login-liff.traced.spec.ts` holds one pointer test per covered criterion, naming the file and the test title; it fails if the test is renamed or removed.

What the sweep did not find: no mismatch between a criterion and its test. What is still untested end to end: everything that needs a running app with the LIFF stub (silent login, return to the slot, the friend ask on the confirmation, the language toggle). Those are Playwright tests (design section 13) and wait for the F03 and F10 screens.

One thing to watch: AUTH-02-AC16 says a date of birth that makes the player older than a limit is refused, but the limit is Q7 and not decided; only the future date is tested.

| Criterion | Text (cut) | Status |
|---|---|---|
| AUTH-01-AC1 | Given a guest (not signed in), when they open the court schedule (C4), solo classes (C5), coach prof | Covered by a lane test (traced) |
| AUTH-01-AC2 | Given a guest on C4, when they pick an open slot and tap Continue, then LINE Login starts and, after | Covered by a lane test (traced) |
| AUTH-01-AC3 | Given a guest, when they tap Continue, then no hold exists yet. The slot is held only when the signe | Covered by a lane test (traced) |
| AUTH-01-AC4 | Given a guest returns to C10 after sign in, when the chosen slot has been taken or held by someone e | Open: Slot taken while the guest was signing in: refused at Pay by reserve_court (BOOK-04, tested in F03); the redirect back to pick again is a Playwright flow. |
| AUTH-01-AC5 | Given a guest who taps to buy a package (C9), when they continue, then LINE Login starts and they re | Open: Package checkout return (C10P): F06 UI. Playwright, later. |
| AUTH-01-AC6 | Given a guest on any page, when they use Keep browsing on C1, then they go back to browsing and noth | Covered by a lane test (traced) |
| AUTH-01-AC7 | Given a guest, when the court grid and the class schedule are shown, then they show held, taken and  | Covered by a lane test (traced) |
| AUTH-01-AC8 | Given a guest who opens the Home screen, when the page loads, then it shows the guest Home (Find a c | Open: Guest Home screen (S-C03-Guest): UI. Playwright, later. |
| AUTH-01-AC9 | Given a guest who opens a page that needs a person (My bookings, Credits and wallet, Refer a friend, | Covered by a lane test (traced) |
| AUTH-01-AC10 | Given the rich menu tile Book a court, when a guest taps it, then C4 opens directly as a guest page  | Covered by a lane test (traced) |
| AUTH-01-AC11 | Given a club that is Paused, when a guest or player opens the app, then browsing and sign in still w | Covered by a lane test (traced) |
| AUTH-01-AC13 | Given the app address, when it is opened, then the club comes from the URL on the one shared BOOQ do | Covered by a lane test (traced) |
| AUTH-01-AC14 | Given a deep link (rich menu tile, shared link, LINE message button), when it is opened, then it con | Covered by a lane test (traced) |
| AUTH-01-AC15 | Given a club in Draft or Testing, when someone opens its URL, then a caller who is not signed in get | Covered by a lane test (traced) |
| AUTH-01-AC16 | Given a guest, when any route answers, then it reads only named public columns or routes; owner cont | Covered by a lane test (traced) |
| AUTH-01-AC12 | Given a guest who cancels or fails LINE Login (they close the LINE consent screen, the network drops | Covered by a lane test (traced) |
| LINE-01-AC1 | Given a player who opens the app inside LINE (LIFF), when sign in starts, then it finishes with no s | Covered by a lane test (traced) |
| LINE-01-AC2 | Given a player in a browser (not inside LINE), when sign in starts, then C1 shows Log in with LINE;  | Covered by a lane test (traced) |
| LINE-01-AC3 | Given a signed in player, when they come back later in the same LINE or browser session, then they a | Covered by a lane test (traced) |
| LINE-01-AC4 | Given each club has its own LINE provider, with its own LIFF app, LINE Login channel and Official Ac | Covered by a lane test (traced) |
| LINE-01-AC5 | Given the LINE user ID the server receives, when the player record is read or created, then the key  | Covered by a lane test (traced) |
| LINE-01-AC6 | Given C1, when the player taps Log in with LINE, then the LIFF add friend option is set to On (norma | Covered by a lane test (traced) |
| LINE-01-AC7 | Given the player declines or ignores the friend choice on LINE's screen, when sign in finishes, then | Covered by a lane test (traced) |
| LINE-01-AC8 | Given a player who is not a friend of the club's Official Account (or has blocked it), when they pay | Open: Checkout not blocked for a non-friend, confirmation shows the ask: needs the F03/F05 confirmation flow. Playwright with the LIFF stub (friendFlag false), later. |
| LINE-01-AC9 | Given a signed in player who is not a friend, when the app shows the confirmation (AC8), then it sho | Open: Same flow as AC8. |
| LINE-01-AC10 | Given a staff, coach or owner, when they sign in with LINE, then the same LIFF login is used and the | Covered by a lane test (traced) |
| LINE-01-AC11 | Given the LINE Login or LIFF is unreachable, when sign in starts, then the player gets the offline e | Covered by a lane test (traced) |
| LINE-01-AC14 | Given a club's LINE provider, when two clubs have the same person, then the person has a different L | Covered by a lane test (traced) |
| LINE-01-AC12 | Given a LINE display name, when the player record is created, then the display name is stored as giv | Covered by a lane test (traced) |
| LINE-01-AC13 | Given an access token or ID token, when the server receives it, then it is not stored longer than ne | Covered by a lane test (traced) |
| AUTH-02-AC1 | Given a LINE user with no player record at this club, when sign in finishes, then C2 shows once, ask | Covered by a lane test (traced) |
| AUTH-02-AC2 | Given C2, when the player continues, then full name and phone must be filled and consent must be tic | Covered by a lane test (traced) |
| AUTH-02-AC28 | Given a phone number that already belongs to another player at the same club, when the player saves  | Covered by a lane test (traced) |
| AUTH-02-AC3 | Given consent is not ticked, when the player tries to continue, then no player record is created and | Covered by a lane test (traced) |
| AUTH-02-AC4 | Given consent is given, when the player continues, then the player record is saved with full name, p | Covered by a lane test (traced) |
| AUTH-02-AC5 | Given a returning player (a record exists), when they sign in, then C2 does not show again. | Covered by a lane test (traced) |
| AUTH-02-AC6 | Given C2 shows after a guest chose a slot or package, when the player completes it, then they contin | Covered by a lane test (traced) |
| AUTH-02-AC7 | Given C2 shows a "Hi, {name}" greeting with the LINE name, when it loads, then the name comes from L | Covered by a lane test (traced) |
| AUTH-02-AC8 | Given the consent text, when it is shown, then it links to the terms and the privacy notice, which n | Covered by a lane test (traced) |
| AUTH-02-AC9 | Given a player who may be under 18, when they give consent at C2, then the consent screen and text a | Open: Consent for players under 18 is parked (D10, Reviewer F02-3). No test treats the text as final; tracked as an open item with the owner (Actions for a person). |
| AUTH-02-AC32 | Given the consent pending legal (D10), when the screen ships for the 7 Dec test, then it is tracked  | Open: Process rule about the parked consent text: nothing to assert in code; see AC9. |
| AUTH-02-AC10 | Given a new player picks an Adult item (any item for the Adult audience, or the court at a price tha | Covered by a lane test (traced) |
| AUTH-02-AC11 | Given a player picks a Student item (a package, class, coach price or other item sold only at a Stud | Covered by a lane test (traced) |
| AUTH-02-AC12 | Given a date of birth that makes the player under 18 today, when it is saved, then the Student price | Covered by a lane test (traced) |
| AUTH-02-AC13 | Given a player who is a Student, when they turn 18, then their price group is Adult from the 18th bi | Covered by a lane test (traced) |
| AUTH-02-AC14 | Given a player with no date of birth on file, when a price depends on age (coach price on C10, a pac | Covered by a lane test (traced) |
| AUTH-02-AC15 | Given a date of birth entered, when it is shown anywhere, then it is shown with the international ye | Covered by a lane test (traced) |
| AUTH-02-AC16 | Given a date of birth entry, when it is a future date or makes the player older than a limit the spe | Covered by a lane test (traced) |
| AUTH-02-AC17 | Given a player who never picks a Student item, when they use the app, then they are never required t | Covered by a lane test (traced) |
| AUTH-02-AC29 | Given an adult in Profile, when they add a date of birth voluntarily, then it is saved like any othe | Covered by a lane test (traced) |
| AUTH-02-AC30 | Given a person signs in whose typed phone matches an imported record, when they finish first sign in | Covered by a lane test (traced) |
| AUTH-02-AC31 | Given every club person (owner, staff, coach), when they have a record, then they also hold the Play | Covered by a lane test (traced) |
| AUTH-02-AC18 | Given a signed in player in Profile, Personal details, when they open it, then the date of birth is  | Covered by a lane test (traced) |
| AUTH-02-AC19 | Given a player edits the date of birth in Profile, when they save it, then the server accepts it at  | Covered by a lane test (traced) |
| AUTH-02-AC20 | Given a corrected date of birth that changes the player's price group (Student to Adult or the rever | Covered by a lane test (traced) |
| AUTH-02-AC21 | Given a date of birth change (including adding or removing one), when it is saved, then an audit ent | Covered by a lane test (traced) |
| AUTH-02-AC22 | Given a player in Profile, when they edit personal details, then the fields the player may change ar | Covered by a lane test (traced) |
| AUTH-02-AC23 | Given a player in Profile, when they set their playing level (New to tennis, Beginner, Intermediate, | Covered by a lane test (traced) |
| AUTH-02-AC24 | Given staff in A6 (customer profile), when they view a player's date of birth and its change history | Covered by a lane test (traced) |
| AUTH-02-AC25 | Given a first sign in inside LINE, when the player record is created, then the starting language is  | Covered by a lane test (traced) |
| AUTH-02-AC26 | Given a player in Profile, when they use the language toggle (TH, EN), then every screen, message an | Open: Profile language toggle changes every screen and message: needs the UI and the F10 messages. Playwright, later. The stored language is constrained (player-profile test) but the effect is not yet tested. |
| AUTH-02-AC27 | Given a guest, when they use the toggle on C1, then the choice applies for browsing and is saved to  | Covered by a lane test (traced) |
