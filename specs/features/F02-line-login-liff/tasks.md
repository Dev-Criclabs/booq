# F02 LINE Login, LIFF and first sign in · Tasks

Status: **Approved 30 Oct 2026** (gate 3; `docs/decisions.md`, round 8, approved as recommended). Drafted 30 Oct 2026 from the approved design (`design.md`, approved 30 Oct 2026). Rules for every task (CLAUDE.md): one task per run; write the tests from the acceptance criteria first, then the code; run tests and type checks before ticking; the commit message starts with the requirement IDs, for example `LINE-01 verify ID token against the club's channel`. Each task is under a day. **FA** is `docs/architecture/foundation.md`, **D** is this feature's `design.md`, **F01** is the platform foundation. No task writes user-facing text in code; every new key goes in both locale files and is listed for the writers.

Roles: **BE-P** back end platform and LINE, **FE-P** front end player app, **Arch**, **QA**, **DevOps**, **Content**.

Depends on F01 tasks: T03 to T07 (database, context, tenant suite), T10 and T11 (audit), T12 (people tables), T13 (route wrapper), T28 (testers and invites). F02 can start its own tests earlier against stubs.

## Setup task (not code, before the build)

- [x] **F02-T00** User ID parity and LIFF setup with a real LINE account. Create a test provider with one Login channel, one Messaging API channel linked to it, and one LIFF app with endpoint `https://{domain}/c/{slug}` and **Add friend option = On (normal)** (decision D38). Sign in through LIFF, then confirm the Login `sub` equals the Messaging API `source.userId` from a webhook event for the same user, and that a push to it arrives. Record the result in the design. IDs: LINE-01-AC4, AC5, AC6; design Q33. Role: DevOps with the user · Size: S
  Done when: a short note in `design.md` section 3.3 says the ids match (or the design is reopened, because the player record would change).

## A. Data and session

- [x] **F02-T01** Migration 0101: player columns on `app_user`, unique `(club_id, line_user_id)`, phone index, `duplicate_phone_flags` view. IDs: AUTH-02-AC28, LINE-01-AC14, CC-1. Role: BE-P · Deps F01-T12 · Size: S
  Tests first: the same person at two clubs has two rows; unique on club and LINE id; a shared phone is allowed and flagged on both records.
  - Built (Architect): `0101_player_profile.sql`. Columns on `app_user` (full_name, phone, phone_normalized, date_of_birth, language, level, line_friend, line_friend_checked_at) with CHECKs; level codes `new`, `beginner`, `intermediate`, `advanced` (labels are copy); the unique `(club_id, line_user_id)` was already in 0003; phone index not unique; view `duplicate_phone_flags` (owner and front desk); `app_user_names` now carries `full_name`; a person may update only their profile columns; the friend state is written by `app.set_line_friend(line_user_id, friend)` (definer, club from the context) instead of an update right for the webhook, a small change from the design's `SECURITY INVOKER` handler.
- [x] **F02-T02** Migration 0102: `auth_session` (hash only), pending state with a 30 minute life, housekeeping purge. IDs: LINE-01-AC13, AUTH-02-AC3. Role: BE-P · Deps T01, F01-T34 · Size: S
  Tests first: the table never holds a token; an expired pending row is purged; a revoked session is refused at once.
  - Built (Architect): `0102_auth_session.sql`. Hash only (CHECK: sha-256 hex), no table privilege for any app role; `app.create_session`, `app.touch_session` (refuses revoked, expired, other club or deactivated person), `app.revoke_session` for `booq_app`; deactivating a person revokes their sessions in the same transaction; `app.purge_expired_sessions()` for the worker per club. Expiry is passed by the caller (platform config, no code default). The sessions of a test account are test data (flag follows the person).
- [x] **F02-T03** Log redaction for `idToken`, `access_token`, `Authorization`, with a test that scans captured logs. IDs: LINE-01-AC13. Role: BE-P · Size: S
  Tests first: a request carrying a token produces no log line containing it.

## B. Verifying and signing in

- [x] **F02-T04** LINE verify client with an interface, a real and a fake (valid, wrong audience, expired, bad signature, unreachable). IDs: LINE-01-AC4, AC11, CC-2. Role: BE-P · Deps QA fake LINE · Size: M
  Tests first: a token for club A's channel is refused at club B; an offline response creates nothing and returns the offline code.
- [x] **F02-T05** Club resolver and status gate: slug to club, `clubUrl()` for every deep link, 404 for unknown or not visible, Draft and Testing only for testers. IDs: AUTH-01-AC13 to AC15, BOOK-02-AC3. Role: BE-P · Deps F01-T28 · Size: M
  Tests first: unknown slug 404; Draft and Testing 404 for guests and non-testers; a link for club A never signs in to club B; slug and session club mismatch is 404.
  Review amendment: D102 (review F01-3). The owner role and testers pass in Draft and Testing on every visit; callers who are not signed in get a minimal sign-in config only (name, language, status, LIFF id). Extra tests: an owner who used the invite once returns to a Draft club; a tester returns; anyone else gets not found; the minimal config holds nothing else.
- [x] **F02-T06** Public config route and the guest context: `GET /public/config`, guest role policies on setup-class rows of live and paused clubs only. IDs: AUTH-01-AC1, AC7, AC11. Role: BE-P · Deps T05, F01-T18 · Size: M
  Tests first: a guest reads setup data of a live club and nothing of a Draft club; no player data in any guest response; a paused club still browses.
  Review amendment: D103 (review F01-4). Guests read only named public columns through views or routes; never a whole setup table. Extra tests: a test lists the exact columns a guest can read and fails when one is added; a guest cannot read owner contact, merchant ids or tax details.
- [x] **F02-T07** `POST /auth/session` for an existing player: verify, find by club and LINE id, create the session cookie (`__Host-`, httpOnly, Secure, SameSite Lax), roles read per request, inactive account refused. IDs: LINE-01-AC1 to AC5, AC10. Role: BE-P · Deps T02, T04, T05 · Size: M
  Tests first: a valid token for an active user returns `active`; a deactivated user gets `account_inactive`; roles removed take effect on the next request; the token is not stored.
- [x] **F02-T08** Name and phone validation module (`packages/domain/phone.ts` and name rules from design A-12) with a single place to change. IDs: AUTH-02-AC2, AC28. Role: BE-P · Size: S
  Tests first: Thai mobile formats normalise to E.164; spaces and dashes stripped; invalid values return codes, never text.
- [x] **F02-T09** Pending sign-up and `POST /auth/profile`: create `app_user`, role Player, consent row with notice version and language, audit entries, phone duplicate flag, session upgrade. IDs: AUTH-02-AC1 to AC8, AC28. Role: BE-P · Deps T07, T08, F01-T12 · Size: M
  Tests first: no consent creates nothing; consent creates the record, role, consent row and audit in one transaction; a returning player never reaches this step; only three fields are accepted.
- [x] **F02-T09b** Claim request on a phone match: if the typed normalised phone matches exactly one unclaimed imported record, insert a `claim_request` in the profile transaction; the person continues as a new player. IDs: AUTH-02-AC28, PLAT-06-AC7, decision D105, SR-05. Role: BE-P · Deps T09, F01-T31b · Size: S
  - Database side built (Architect): `0103_claims.sql`. `app_user.claim_state` (`unclaimed` for an import, `merged` after a claim) and `merged_into`, CHECKs (a person has a LINE id unless they are an import; an unclaimed import has none). `claim_request` (open / confirmed / rejected; staff read it, nobody else). `app.request_claim(claimant, typed name, typed phone, normalised phone)`: the claimant must be the signed-in ordinary player; exactly one unclaimed import with that phone makes one open request; none or several make nothing; returns nothing, so C2 learns nothing. The route calls it in the profile transaction after inserting the person and their `player` role.
  - Phone convention: the route passes `phone_normalized` as digits only, Thai numbers as `66…` without the plus (what `normalizePhone` returns with the `+` removed), the same form the import stores; see F02 design 7.1. `claim_state` is a column added by 0103 beside the null LINE id, because a person with no LINE id must also be told apart from a merged record.
  Tests first: a second person typing the same phone sees no balance and no imported field; C2 never mentions a found record; no match or more than one creates nothing.
- [x] **F02-T10** Invite redemption in the sign-in path (owner, staff, coach, tester), including the first profile step. IDs: LINE-01-AC10; F01 ROLE-01-AC1. Role: BE-P · Deps T09, F01-T14, F01-T28 · Size: M
  Tests first: a valid invite adds the roles and (for a tester) `club_tester`; a used or expired invite is refused; a person with no role signs in as a player.
  Review amendment: SR-01 and D122. Redemption is the atomic single-use statement; an owner invite requires the bound LINE ID; a tester invite yields player only; a BOOQ account never receives a token. Extra tests: parallel redemption has one winner; the wrong LINE ID is refused; the bound owner's return visit only opens the club.
- [x] **F02-T11** Route markers `public` / `needs_person` and the `sign_in_required` code, with the return path (slot, package, multi-hour list in the URL). IDs: AUTH-01-AC2, AC3, AC5, AC9, AC10. Role: BE-P · Deps F01-T13 · Size: S
  Tests first: a guest on checkout, My bookings, Credits and wallet, Refer a friend and Profile gets `sign_in_required`; a guest hold request is refused; browse pages need nothing.
- [x] **F02-T12** Logout and session revocation on role change or deactivation. IDs: ROLE-02-AC4 (club side), AUTH-02-AC5. Role: BE-P · Deps T07 · Size: S
  Tests first: logout revokes; deactivating a person ends all their sessions.

## C. Price group and profile

- [x] **F02-T13** `price_group_for(dob, on_date)` and the Student-item eligibility check used by F04 and F06. IDs: AUTH-02-AC10 to AC14, AC17. Role: BE-P · Size: S
  Tests first: no date of birth gives Adult; 17 years 364 days is Student, the 18th birthday in Bangkok switches to Adult; a Student item with no date of birth returns the ask code; 18 or older is refused for a Student item.
- [ ] **F02-T14** `PUT /me/profile`: name, phone, date of birth (not future), level, language; never locked; audited. IDs: AUTH-02-AC15 to AC23, AC29. Role: BE-P · Deps T08, F01-T10 · Size: M
  Tests first: unlimited changes; future date refused; an adult adds a date of birth with no price effect; a bought Student package stays valid (assertion contract with F06); each change has an audit entry with old and new.
- [ ] **F02-T15** Date of birth history route for the owner only, filtering audit entries. IDs: AUTH-02-AC21, AC24, decision D55. Role: BE-P · Deps T14 · Size: S
  Tests first: owner sees the changes; front desk, accountant and the player do not.
- [ ] **F02-T16** Language handling: detect the LINE app language, guest cookie, saved at first sign in, Profile toggle, shared toggle component. IDs: AUTH-02-AC25 to AC27. Role: BE-P with FE-P · Deps T09, T14 · Size: M
  Tests first: LINE language starts the right language; guest choice is saved at first sign in; Profile toggle changes every screen and later messages.

## D. Friend status and webhook

- [ ] **F02-T17** `POST /me/line-friend`, `app_user.line_friend` updates, and the LINE webhook route `POST /api/webhooks/line/{token}` for `follow` and `unfollow` with `x-line-signature` verification on the raw body. IDs: LINE-01-AC6 to AC9, AC14. Role: BE-P · Deps F01-T09, T01 · Size: M
  Tests first: a bad signature changes nothing and returns 401; follow and unfollow update only that club's user; friend status never blocks booking or payment.

## E. Front end (player app)

- [ ] **F02-T18** LIFF client module: `liff.init`, silent in-client login, browser login with return path, `getIDToken` to `/auth/session`, offline handling, re-establishing a lost session silently in LINE. IDs: LINE-01-AC1 to AC3, AUTH-01-AC2, AC12. Role: FE-P · Deps T07 · Size: M
  Tests first (Playwright with a LIFF stub): inside LINE sign-in finishes with no tap; in a browser one tap on Log in with LINE; a reload keeps the session; an offline error shows P-0327 and P-0328.
- [ ] **F02-T19** C1 Welcome screen: note instead of a checkbox (decision D38), Log in with LINE, Keep browsing, Thai and English, buttons never wrap. IDs: AUTH-01-AC6, LINE-01-AC2, AC6. Role: FE-P · Deps T18 · Size: S
  Tests first: no checkbox exists; the Thai longest string does not wrap the button; Keep browsing creates nothing.
- [ ] **F02-T20** C2 Profile setup screen: three fields, consent line with links, continue to payment with the choice kept. IDs: AUTH-02-AC1 to AC8. Role: FE-P · Deps T09 · Size: M
  Tests first: missing consent shows what is missing; the consent line wraps inside its card in Thai; the screen is marked "text pending legal check" in code review notes only (D10), not on screen.
- [ ] **F02-T21** Date of birth step for Student items and the Profile Personal details editor (never locked). IDs: AUTH-02-AC10 to AC12, AC15, AC18 to AC20. Role: FE-P · Deps T13, T14 · Size: M
  Tests first: an Adult item shows no field; a Student item shows it; the date shows with the international year; there is no "ask the front desk" text.
- [ ] **F02-T22** Guest Home (S-C03-Guest), the in-app add-the-account ask on the confirmation, and sign-in starts on person pages. IDs: AUTH-01-AC8, AC9, LINE-01-AC8, AC9. Role: FE-P · Deps T11, T17 · Size: M
  Tests first: guest Home shows Find a court time and Sign in; a non-friend sees the ask once per session; opening My bookings as a guest starts sign-in and returns to it.
- [ ] **F02-T23** Rich menu and share-link behaviour: club path in every link, `liff.state` path handling, C4 opens as a guest page. IDs: AUTH-01-AC10, AC14, BOOK-02-AC1 to AC3, AC5. Role: FE-P · Deps T05 · Size: S
  Tests first: a deep link carries the club and the path; the Book a court link opens C4 without sign-in; a browser opens the same page.

## F. Cross-checks and sweep

- [ ] **F02-T24** Cross-club and abuse tests: a token for club A at club B; the same person at two clubs; rate limit on `POST /auth/session` (value from platform config, none invented); pending-session abuse. IDs: LINE-01-AC4, AC14, CC-1, CC-2. Role: QA · Deps T07, T09 · Size: M
  Tests first: this task is the tests; they must fail on a deliberately wrong audience check.
- [ ] **F02-T25** Acceptance sweep: run the AC-to-test table in `design.md` section 13, close gaps, record results against the requirement IDs. IDs: all F02. Role: QA · Deps all · Size: M
  Done when: every AC has a passing test or a filed bug naming its ID. AUTH-02-AC9 stays marked pending (D10).

## Order and size

T00 and A first, then B, then C and D in parallel, then E, then F. About 26 tasks; the consent text for players under 18 cannot be final until the legal input (D10), and the privacy notice text must be final before 7 Dec 2026.
