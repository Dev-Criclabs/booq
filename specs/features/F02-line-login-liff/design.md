# F02 LINE Login, LIFF and first sign in · Design

Status: **DRAFT for approval (gate 2).** Drafted 30 Oct 2026 by the Architect role. Requirements were approved on 30 Oct 2026 (`docs/decisions.md`, round 4). Nothing here is approved until a person says so. No tasks and no code follow until then. **Two points need a spec decision before this design can be approved: Q32 and Q33 (section 3.3).**

Feature: F02 LINE Login, LIFF and first sign in. Requirement IDs: AUTH-01, AUTH-02, LINE-01. Depends on F01 (club, roles, consent, invites, testers). Wave 1.

Shared decisions are in `docs/architecture/foundation.md` (revision 4), cited as **FA §n**. F01's design (`specs/features/F01-platform-foundation/design.md`) is cited as **F01 §n**.

## 1. Requirement coverage

| Requirement | Where |
|---|---|
| AUTH-01-AC1 to AC15 (browse first, sign in at checkout, club in the URL, Testing gate) | §5.1 routes; §6.1 guests; §6.2 sign-in triggers; §6.3 club from the URL; §6.4 status gate |
| LINE-01-AC1 to AC14 (silent LIFF login, token check, friend prompt) | §4 flow; §5.2; §6.5 friend status; §3 platform facts |
| AUTH-02-AC1 to AC29 (first profile, consent, date of birth, language) | §4.3 first profile; §6.6 date of birth; §6.7 language; §6.8 profile editing |
| Player record (HO Data model: User) | §7 |

## 2. What this design does not build

The booking screens and the slot hold (F03), checkout and pricing by price group (F04), the privacy request screens (F01 routes, F11 screens), rich menu and messages (F10), the staff and owner invite pages (F11, F15). F02 supplies the sign in they all use, the player record, the session, the price-group function and the friend status.

## 3. What LINE's public documentation says, and what it does not

Read on 30 Oct 2026 from `developers.line.biz`. Nothing here is taken from memory.

### 3.1 What it says

| Topic | Documentation |
|---|---|
| Verifying an ID token | `POST https://api.line.me/oauth2/v2.1/verify` with `id_token` and `client_id` (the expected channel ID). It returns the token payload: `iss`, `sub` ("User ID for which the ID token was generated"), `aud` ("Channel ID"), `exp`, `iat`, and `name` and `picture` only if the `profile` scope was requested. A different audience gives "Invalid IdToken Audience". The guide also says to validate the signature (ES256 for LIFF, key at `https://api.line.me/oauth2/v2.1/certs`) |
| Silent login | "You can't use `liff.login()` in a LIFF browser, as it is automatically executed when `liff.init()` is executed." In an external browser, the access token exists only after `liff.login()` has been called, the user has logged in, and `liff.init()` has run. `liff.init()` must run on every page load. The option `withLoginOnExternalBrowser` (default false) controls automatic login in external browsers |
| Scopes | `openid` is required for `liff.getIDToken()`; `profile` for `liff.getProfile()` and `liff.getFriendship()` |
| Token life | The ID token from `liff.getIDToken()` is valid for one hour. A LIFF access token is valid 12 hours and "may be revoked" when the app is closed (the LINE Login page says 30 days for ordinary Login access tokens; the two are not reconciled) |
| Add friend | The Official Account must be linked to the Login channel: same provider, one Official Account per Login channel. In the LIFF console, "Add friend option" is `On (normal)`, `On (aggressive)` or `Off` for the whole LIFF app. `liff.getFriendship()` returns `friendFlag` (true when added and not blocked) |
| Endpoint and deep links | The LIFF Endpoint URL must be https, with no fragment, and may include a path. `liff.init()` works only on URLs equal to or below the endpoint URL. A LIFF URL `https://liff.line.me/{liffId}/extra/path?x=1` opens the endpoint with the extra path and query combined into the final URL and also available in `liff.state`. Up to 30 LIFF apps per channel |

### 3.2 What it does not say

- Whether the user ID in a Login ID token (`sub`) is the same as the user ID the Messaging API uses for push, when both channels are in one provider. The only documented link is the account-linking rule (same provider). **LINE-01-AC5 depends on this.**
- Whether the user ID differs across providers (it is expected to, which D7 relies on).
- Any lifetime of a LIFF ID token beyond the one hour, refresh behaviour for LIFF tokens, domain rules for the endpoint URL beyond https, and the full text of `liff.getFriendship()` (part of that page was summarised, not read verbatim).

### 3.3 Two points that stop for a decision

**Q32. The friend checkbox on C1.** LINE-01-AC6 says the checkbox "Add {club} as a LINE friend" on C1 decides whether LINE asks for the friend at sign in. LINE's LIFF setting for this is per LIFF app (On normal, On aggressive, Off), not per login, so a checkbox on our screen cannot switch it for one login. Options: (a) LIFF "Add friend option" set to `On (normal)`: the choice appears on LINE's own consent screen, where the player can untick it, and C1 shows a plain note with no checkbox (**recommended**, needs a spec change to AC6 and a canvas change); (b) keep the checkbox and, when ticked, open the Official Account's add-friend link after sign in, which is a second step; (c) `Off` and rely on the in-app ask (D9) only. This design builds (a) behind a platform config so (b) or (c) is a small change, but the rule is the spec's and **needs a person to choose**.

**Q33. User ID parity.** If Login's `sub` is not the Messaging API user ID, pushes would not reach the person. The design stores `sub` as `line_user_id` (the key) and treats the webhook `source.userId` as the same id. This must be tested with a real club account (one Login channel, one Official Account, one provider) before the build. If they differ, the push target must be learned from webhook events and linked, which changes the player record.

## 4. Sign-in flow

### 4.1 Pieces

- **Per club:** a LINE provider with a Login channel, a Messaging API channel (Official Account) and one LIFF app (D7, HO LINE integration). The LIFF Endpoint URL is `https://{app domain}/c/{slug}` (the domain is configuration, D6). Scopes: `openid`, `profile`. Deep links use `https://liff.line.me/{liffId}/{path}`; the extra path arrives under the endpoint (§3.1), so a rich menu tile or message button reaches `/c/{slug}/{path}` (AUTH-01-AC14).
- **Stored per club** (F01, class S): `line_connection.login_channel_id`, `liff_id`, `oa_basic_id`, `messaging_channel_id`; secrets in `club_secret` (channel secret, channel access token).
- **Server session:** an opaque random token in an httpOnly, Secure, `SameSite=Lax` cookie named with the `__Host-` prefix; the server stores only its hash (§7.2). The player's roles are read from `app_user_role` on each request (FA §4.2), so changing a role or deactivating a person takes effect at once.

### 4.2 Steps (returning player)

1. The browser or LINE opens `/c/{slug}/...`. The server resolves the club by slug and applies the status gate (§6.4). Unknown or not visible: 404.
2. The page asks `GET /api/c/{slug}/public/config` for the club's `liffId` and language options (public, no secrets).
3. The client runs `liff.init({ liffId })`. **Inside LINE** (`liff.isInClient()`), this logs in silently (LINE-01-AC1). **In a browser**, if `liff.isLoggedIn()` is false the page shows C1 with Log in with LINE; one tap runs `liff.login({ redirectUri })`, where `redirectUri` is under the endpoint URL and keeps where the player was going (LINE-01-AC2, AUTH-01-AC2).
4. If the page needs a person (§6.2) and no valid server session exists, the client reads `liff.getIDToken()` and sends `POST /api/c/{slug}/auth/session { idToken }`.
5. The server verifies the token (§4.4). On success it finds `app_user` by `(club_id, line_user_id)`. A found, active user gets a session and the response says `active`. The token is then discarded (LINE-01-AC13).
6. The client continues to where the player was going.

### 4.3 First sign in (new player)

If step 5 finds no player, no `app_user` row is created. The server creates a **pending sign-up**: a server session in state `pending_profile` that holds only `line_user_id`, the LINE display name and the language, expiring after 30 minutes (platform config, assumption A-1), and answers `needs_profile` (AUTH-02-AC3). C2 shows.

`POST /api/c/{slug}/auth/profile { fullName, phone, consent: true, noticeVersion, language }`:

1. Requires the `pending_profile` session. Server checks name and phone format (§6.9) and `consent = true` (AC2). Without consent nothing is created and the pending session simply expires (AC3).
2. In one transaction: insert `app_user` (role `player`, display name as given by LINE, full name, normalised phone, language, `line_friend` as known), insert `app_user_role`, insert `user_consent` (notice version, language, time), write the audit entries, flag the phone if another player at this club has it (AC28, D11).
3. Upgrade the session to `active`, answer `active`. The player continues to where they were going (AC4, AC6).

A returning player never sees C2 (AC5). A club that is Testing sets `is_test` through the F01 trigger (F01 §7.6). A player at two clubs signs in twice and has two records and two consents (CC-1, LINE-01-AC14).

### 4.4 Verifying the token

The server calls LINE's verify endpoint with `id_token` and `client_id = line_connection.login_channel_id` of the club in the URL, and checks: HTTP 200, `aud` equals that channel id, `iss` is LINE's issuer, `exp` is in the future. A token issued for another club's channel fails (LINE-01-AC4, CC-2). One network call per sign in is acceptable because sign-ins are rare; verifying locally against LINE's published keys is the alternative if latency matters (A-2). The `sub` becomes `line_user_id`. The token, any access token and the raw verify response are never written to the database or to any log: the logger redacts `idToken`, `access_token` and `Authorization` fields (AC13). `picture` is not read or stored (A-3, F02 Q9).

If LINE is unreachable, nothing is created and the response is the offline error code that the client shows with P-0327 (LINE-01-AC11, AUTH-01-AC12).

## 5. API routes (prefix `/api/c/{slug}`)

Conventions as FA §9: typed codes, no text; no club id in bodies; 404 for out-of-reach.

### 5.1 Public (no session)

| Method and path | Purpose |
|---|---|
| `GET /public/config` | `liffId`, supported languages, club display name and logo, `status` flags needed to show paused states. No secrets, no player data |
| `GET /public/courts`, `/public/classes`, `/public/coaches`, `/public/packages` | Read-only data for browsing (C4 to C9). Owned by F03, F07, F08 and F06; F02 supplies the guest context they run in (§6.1) |

### 5.2 Session and profile

| Method and path | Permission | Purpose |
|---|---|---|
| `POST /auth/session` | none (token is the credential) | §4.2 step 5. Rate limited. Returns `active`, `needs_profile`, or an error code (`invalid_token`, `club_not_available`, `not_a_tester`, `offline`) |
| `POST /auth/profile` | pending session | §4.3 |
| `POST /auth/logout` | session | Revokes the session |
| `GET /me` | session | Profile fields, roles, language, `line_friend`, price group today |
| `PUT /me/profile` | player | Name, phone, date of birth, level, language (§6.8) |
| `PUT /me/language` | session or guest cookie | Toggle (§6.7) |
| `POST /me/line-friend { friendFlag }` | session | The client reports `liff.getFriendship()`; used only for the in-app prompt and push choice (§6.5) |
| `GET /me/price-group` | session | `adult` or `student` today, from date of birth (F04 uses the server function, not this route) |

### 5.3 Staff views (F01/F11 own the screens)

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /customers/{id}/dob-history` | owner | The audited changes of date of birth (AC24, D12) |
| `PUT /customers/{id}/dob` | not built | Whether staff may edit is F02 Q6; refused until decided (A-4) |

### 5.4 LINE webhook (platform-wide route, club by token)

`POST /api/webhooks/line/{token}`: verifies `x-line-signature` (HMAC-SHA256 of the raw body with the club's channel secret, base64) before reading the body; handles `follow` and `unfollow` events by updating `app_user.line_friend` for that club and user; ignores other events (F10 extends this route). A bad signature gets a 401 with no processing (FA §5.3).

## 6. Behaviour and rules

### 6.1 Guests (AUTH-01-AC1, AC3, AC7, AC8, AC10, AC11)

A guest request runs with context `{ clubId, userId: null, roles: ['guest'] }`. Row-level policies give the `guest` role `select` on setup-class rows of clubs whose status is `live` or `paused` only, plus the public views F03 and later features define for slot states. Those views expose held, taken, closed and open states with no booking id, no customer and no coach identity (AC7); this is a requirement on F03's view, written here. A guest can never create a hold: `claim_occupancy` requires a user id (AC3). Draft and Testing clubs are invisible to guests (§6.4). A paused club still lets guests browse and sign in (AC11).

### 6.2 When sign in starts (AUTH-01-AC2, AC5, AC9, AC10)

The server marks each route as `public`, `needs_person` or `needs_role`. A guest request to a `needs_person` route returns `sign_in_required`; the client starts §4.2 and returns to the same path with the same query (the chosen slot or package travels in the URL and is kept only as a choice). Routes that are `needs_person`: checkout and payment (C10, C10b, C10P, C11, C11P), My bookings, Credits and wallet, Refer a friend, Profile (AC9, assumption A-5 for Q4). Inside LINE, browse pages are served as guest even though LINE could identify the person silently; sign-in is started only when needed (S-C03-Guest shows a Sign in button, Q4). The rich menu tile Book a court opens C4 as a guest page (AC10).

After sign in the choice is rechecked by F03 when C10 loads; a slot taken meanwhile gives F03's refusal and sends the player back (AC4). Multi-hour choices travel as a list in the URL and are rechecked as a whole (F02 Q17, assumption A-6).

### 6.3 Club from the URL (AUTH-01-AC13, AC14; D6)

Every route is under `/c/{slug}`. The domain is the config value `APP_BASE_URL` and is never in code. The slug selects the club's channel for verification (§4.4) and the status gate. After sign in the **session's club is the truth**: a request whose slug differs from the session's club is refused as 404. Every deep link (rich menu, share link, LINE message button) is built by one server function `clubUrl(club, path)` so it always contains the club; a link for club A never signs a player in to club B. Unknown or non-visible slug: 404.

### 6.4 Status gate (AUTH-01-AC15; F01 §4.3)

| Club status | Guest browsing | Sign in |
|---|---|---|
| Draft, Testing | 404 | Only users in `club_tester` (owner, BOOQ testers), or a valid tester or owner invite being redeemed. Anyone else gets `not_a_tester` shown as not found |
| Live, Paused | Yes | Yes |

A BOOQ tester signs in with LINE as an ordinary player account, never with the BOOQ credential (F01 ROLE-02-AC2).

### 6.5 Friend status (LINE-01-AC6 to AC9, AC14; D9)

`app_user.line_friend` is `true`, `false` or `null` (unknown), with `line_friend_checked_at`.

- **Add-friend prompt at sign in:** per Q32 (§3.3).
- **While using the app:** the client calls `liff.getFriendship()` after sign in (needs the `profile` scope) and posts the result; the webhook `follow` and `unfollow` events keep it current (§5.4).
- **Never blocks anything:** booking, paying and confirmation proceed whatever the value (AC7, AC8).
- **Effect:** FA §5.3 owns the sender rule: a known non-friend gets no push, and the confirmation is shown in the app with the add-account ask (a new P key). How often the ask repeats is F02 Q5 (assumption A-7: on the confirmation screen and on Home until the player is a friend, shown at most once per session).

### 6.6 Date of birth and price group (AUTH-02-AC10 to AC24, AC29; D12, round 1)

- **Function `price_group_for(dob, on_date)`:** no date of birth gives `adult` (D12); under 18 at the Bangkok date gives `student`; otherwise `adult` (switches on the 18th birthday, AC13). Written once in `packages/domain` and called by F04 and F06; never recomputed in a screen.
- **When asked (AC10 to AC12, AC17):** an Adult item never asks. An item sold only at a Student price (package, class, coach price) requires a date of birth if none is on file; a date of birth showing 18 or older refuses the Student item with a code the client maps to a P key. Adults may add a date of birth voluntarily in Profile (AC29), used for the birthday discount (F14).
- **Validation (AC16):** not in the future. The oldest age allowed is F02 Q7, open; the design refuses only future dates until decided (A-8).
- **Editing (AC18 to AC20):** the field is always editable and never shows "ask the front desk" (canvas bug A9). Every change is accepted, with no limit. A bought Student package or credit keeps what it was bought as and its expiry; only new purchases use the new group (AC20). So F04 snapshots the price group on `order_line` and F06 on `customer_package`; F02 never rewrites them.
- **Audit (AC21):** the F01 trigger writes an `audit_entry` for each change with old and new value and the actor; the owner can read it, the player cannot. `GET /customers/{id}/dob-history` filters those entries for the owner (AC24).
- **Display (AC15):** the international year in both languages (FA §7 formatter).

### 6.7 Language (AUTH-02-AC25 to AC27)

The first language is the LINE app language inside LINE (`liff.getLanguage()` or the sign-in request header) and the browser language outside; anything else falls back to the club's `default_language` (assumption A-9 for F02 Q10). A guest's toggle choice is kept in a first-party cookie `lang` (functional, no tracking) and written to `app_user.language` at first sign in (AC27). In Profile the toggle updates `app_user.language` and takes effect on every screen, message and receipt (AC26). The toggle label (`TH | EN` or `ไทย | EN`) is one shared component, labels from locale keys (canvas B7; assumption A-10: `ไทย | EN`, to be confirmed).

### 6.8 Profile editing (AC18 to AC24)

Editable by the player: full name, phone, date of birth, level (optional, set only in Profile, AC23), language. Whether name and phone are editable and whether C2 pre-fills the name from LINE are F02 Q3; assumption A-11: name and phone are editable, and the name field is **not** pre-filled (LINE-01-AC12: the display name is stored as given and is not used as the full name unless the player confirms it). Staff cannot edit a date of birth until F02 Q6 is decided (§5.3).

### 6.9 Validation (AC2, AC28)

Name and phone rules are F02 Q2, open. Assumption A-12 until decided: name is required, 1 to 100 characters after trimming, letters in Thai or English plus spaces, dots, apostrophes and hyphens; phone is stripped of spaces, dashes and brackets, accepted as a Thai mobile (`0` plus nine digits, or `+66` plus nine digits) and normalised to E.164, other international numbers accepted in E.164 form up to 15 digits. The phone is typed and never verified by code (D11). A phone shared with another player at the club is allowed and flagged on both records (AC28). Validation lives in `packages/domain/phone.ts` so only one place changes.

### 6.10 Invites (LINE-01-AC10; assumption A-13 for F02 Q13)

A staff, coach, owner or tester invite is `club_invite` (F01 §3.2). The link is `/c/{slug}/join?invite={token}`. After the LINE token is verified, a valid unused invite is redeemed in the same transaction: the `app_user` (created if new, with the first-profile step for name, phone and consent, as for a player) receives the invite's roles; a tester invite also adds `club_tester`. A person with no role signs in as a player. A deactivated user signing in gets `account_inactive`. The invite pages belong to F11 and F15.

## 7. Data and migrations

F02 migrations continue F01's numbering from 0100. Rules and conventions as FA §2.1.

### 7.1 Player record (migration `0101_player_profile.sql`)

Columns added to F01's `app_user`: `display_name`, `full_name` (null until consent), `phone`, `phone_normalized`, `date_of_birth` (date, null allowed), `language` (`th` or `en`), `level` (null or one of the four levels), `line_friend` (bool, null), `line_friend_checked_at`, `active`. Unique `(club_id, line_user_id)`; index `(club_id, phone_normalized)` (not unique). A view `duplicate_phone_flags` finds shared phones within a club, visible to owner and front desk; no stored flag (FA §2.2). `staff_notes` is not here: it is `user_staff_note` (F01), so the player's own row can never carry it.

Existing audit trigger covers `app_user` including `date_of_birth`.

### 7.2 Sessions (migration `0102_auth_session.sql`)

`auth_session (club_id, id, token_hash, user_id null, line_user_id, state in ('pending_profile','active','revoked'), created_at, last_seen_at, expires_at, revoked_at)`; class D. Server-side sessions let us end a session at once when a role is removed or a person is deactivated (ROLE-02, F01 §6.1). The pending state holds the LINE id and display name for at most the pending lifetime and a housekeeping task purges expired rows (FA §5.4). Tokens are never stored (AC13), only the session cookie's hash.

**Session length (F02 Q8, open).** The design makes lifetimes platform config values with no code default: an absolute lifetime and an idle lifetime. Assumption A-14, to confirm: absolute 12 hours (matching the documented LIFF access token life), with a silent re-sign-in inside LINE and one tap in a browser after that. Payment steps do not re-verify with LINE: Pay starts a Beam QR, which moves no money from our side, and the server session is already tied to a verified token (A-14 for Q8's second question). A closed LIFF app may revoke the LINE token; the next open re-runs §4.2 step 4 silently.

### 7.3 Friend status (migration `0103_friend_status.sql`)

Columns on `app_user` already listed; no table. The webhook handler is `SECURITY INVOKER` under the club context.

## 8. States

**Sign-in session:** none, then `pending_profile` (new person), then `active`, then expired or `revoked`. A returning person goes none to `active` directly. Refused states: `sign_in_required` (guest on a person page), `invalid_token`, `club_not_available`, `not_a_tester`, `account_inactive`, `offline`.

**Player record:** created at consent, `active`, then anonymised on a carried-out deletion (F01 §7.7). Consent is append-only.

## 9. Permission checks

- `public`: no check beyond the status gate (§6.4).
- `needs_person`: a valid active session whose club equals the slug's club.
- Player-only data: RLS `customer_id = app.user_id()` (FA §4.3); a request for another player's record returns 404 (ROLE-AC4).
- `GET /customers/{id}/dob-history`: owner only.
- Accountants (decision D35) see customer names on receipts and reports but never phone or date of birth: they have no `select` on `app_user` and read names only through the F01 view `app_user_names` (F01 §6.2).
- The LINE webhook: valid `x-line-signature` for the club in the token.
- The `route()` wrapper from FA §9 applies to every route above, with a declared permission or `public`.

## 10. How the cross-cutting rules are met

- **Club ID scope (CC-1):** the player record is unique on `(club_id, line_user_id)`; the club is from the URL then fixed in the session; verification uses that club's Login channel id; a token or deep link of club A cannot open club B (§4.4, §6.3). Public reads are scoped by the slug's club and the status gate.
- **Server permissions (CC-2):** the client's claim of identity or club is never trusted; the server verifies the token with LINE and the audience.
- **PDPA (CC-3):** collected: LINE user id and display name (at sign in), full name, phone, consent record, language, optional date of birth and level. Date of birth is asked only for a student price (minimisation). No picture, no email, no tokens kept, no analytics or tracking cookies (assumption A-15 for F02 Q14: only the session cookie and the `lang` cookie exist). Consent is recorded; refusing creates no record. The consent screen is built as in the canvas, but **the text for players under 18 is pending legal input (D10)**, so AUTH-02-AC9 stays open and the text cannot be final before 7 Dec 2026.
- **No double booking (CC-4):** sign in never creates or extends a hold; a guest cannot hold (`claim_occupancy` needs a user); a sign in during a hold does not touch it (the hold follows the user id, F03).
- **TEXT (CC-5):** no text in code; errors are codes. Existing keys: P-0001 to P-0005 (C1), P-0009, P-0010 to P-0016 (C2), P-0250, P-0261, P-0405, P-0413, P-0414, P-0419, P-0422, P-0327, P-0328, A-0531 (reused for the date-of-birth label). Dates in the international year; layouts survive Thai length (consent line wraps inside its card, buttons never wrap, content scrolls). New keys below.
- **Other (CC-6):** Bangkok time for age and consent time; no invented values.

## 11. New text keys needed (none added by this design)

P (both languages): LINE sign in cancelled or failed other than offline; consent required message; full name and phone missing or invalid; date of birth label and helper on the student step; "Student prices are for players under 18"; date of birth in the future; "Sign in to see this page"; the in-app ask to add the Official Account on the confirmation; the repeat of that ask (if kept); not available / not found page text for non-live clubs if no existing key fits. A (both languages): the duplicate phone flag label for staff; the date of birth change line in the audit log with named variables; the unmatched imported player flag (F01). L: none from F02.

## 12. Canvas boards used

H-C01-Welcome and T-, S-C03-Guest and T-, H-C02-Profile-setup and T-, H-C17-Profile-receipts and T-, G-C17-Personal-details and T- (the locked date of birth is the Gaps A9 bug), G-C17-Privacy, G-C03-New-player, S-Error-Offline, H-C04-Book-a-court, H-C09-Packages, H-C10-Checkout, L-Rich-menu, flow copies F1-03 and F1-04 and F2-01. Gaps used: A9, B7, C1.

## 13. Tests (written first at the build step)

Against a real Postgres and a fake LINE (QA's fake LINE Login verify endpoint with valid, wrong audience, expired, bad signature, unreachable) and Playwright for C1/C2/C17.

| Group | Covers | Test |
|---|---|---|
| Browse first | AUTH-01-AC1, AC7, AC8, AC10, AC11 | Guest loads C4 to C9 with no session; no player data in responses; held/taken states carry no identity; paused club still browses |
| Sign in at checkout | AUTH-01-AC2, AC3, AC5, AC6, AC9, AC12 | Continue starts sign in and returns with the slot; guest hold request refused; Keep browsing creates nothing; offline error creates nothing |
| Club from URL | AUTH-01-AC13, AC14, AC15 | Unknown slug 404; Draft/Testing 404 for guests and non-testers; tester signs in; deep link for A never signs in to B; session club vs slug mismatch 404 |
| Token | LINE-01-AC4, AC5, AC13 | Token for club A's channel refused at B; wrong audience, expired, bad signature refused; token never in DB or logs |
| Silent login | LINE-01-AC1 to AC3 | Playwright with LIFF stub: in-client path signs in without a tap; browser path shows C1 and one tap; session survives reload |
| Friend | LINE-01-AC6 to AC9; D9 | Not a friend: booking and payment proceed, confirmation shown in app with the ask; `follow` and `unfollow` events (bad signature refused) update status |
| Two clubs | LINE-01-AC14, CC-1 | Same person at two clubs: two records, two consents, separate credits |
| First profile | AUTH-02-AC1 to AC8, AC28 | Only three fields asked; no consent creates nothing; consent creates record, role, consent row, audit; returning player skips C2; duplicate phone flagged on both records |
| Date of birth | AUTH-02-AC10 to AC17, AC29 | Adult item asks nothing; Student item asks and refuses 18+; no date of birth gives Adult prices; future date refused; Bangkok-date 18th birthday switch; voluntary add by an adult |
| Profile editing | AUTH-02-AC18 to AC24 | Date of birth never locked, unlimited changes; bought Student package stays valid after becoming Adult; every change audited and visible to the owner; level optional |
| Language | AUTH-02-AC25 to AC27 | LINE language start; guest toggle saved at first sign in; Profile toggle changes everything |
| Static | CC-5 | No hard-coded text; Thai year never appears; every route declares public or a permission |

## 14. Assumptions the design makes where the requirements are open

Each needs a yes or no from a person; none changes the tables much.

| Id | Assumption | Question |
|---|---|---|
| A-1 | Pending sign-up lives 30 minutes (platform config) | none |
| A-2 | Server-side verify call to LINE rather than local key verification | none |
| A-3 | The LINE picture is neither read nor stored | Q9 |
| A-4 | Staff cannot edit a date of birth until decided | Q6 |
| A-5 | My bookings, Credits and wallet, Refer a friend and Profile start sign in on open | Q4 |
| A-6 | Multi-hour choices travel in the URL and are rechecked as a whole | Q17 |
| A-7 | The add-account ask shows on the confirmation and Home, once per session, until the player is a friend | Q5 |
| A-8 | Only future dates of birth are refused until an age limit is decided | Q7 |
| A-9 | Language: LINE app language in LINE, browser language outside, fallback the club default | Q10 |
| A-10 | Toggle label uses the Thai word ไทย beside EN | Q10 (canvas B7) |
| A-11 | Name and phone editable; the full-name field is not pre-filled from LINE | Q3 |
| A-12 | The name and phone rules in §6.9 | Q2 |
| A-13 | Invites carried in `club_invite`, redeemed in the sign in, with the first profile step for staff too | Q13 |
| A-14 | Session absolute life 12 hours, no re-verification at Pay | Q8 |
| A-15 | No cookies or analytics beyond the session and language cookies | Q14 |
| A-16 | A deleted player signing in again is a brand new player with a new consent | Q15 |

Open and not assumed: Q1 (consent for players under 18, D10, pending legal input), Q32 (friend checkbox) and Q33 (user ID parity), both in §3.3.
