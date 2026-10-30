# Review of F01-T22 and T23 (`0033_pause.sql`, `0034_setup_steps.sql`, `0035_owner_invite.sql`, `0036_p6_hardening.sql`, on `main`)

Reviewer: Architect role, 30 Oct 2026. Against SR-01, SR-02, D14, D15, D107, D108, D122, F01 design 4.2, 5.2, 7.1 and 9.3, my reviews of T18 (R3 to R5) and T20 (R2). I read the four migrations; I did not run the lane's branch (they are on `main`, where the suites pass).

## Verdict: approve 0033, 0034 and 0036. 0035 has one blocking problem (B1): as built, no owner can ever redeem the invite. Four smaller changes follow.

### 0033 pause and resume: approved

`pause_club` and `resume_club` are definer functions for `booq_platform`, both go through `apply_status_change(…, via_pause = true)`, so the admin-only rule, the written reason, the lock on the club row, the window clearing and the `club_status_change` row are the T20 ones. The pause row and the status change are one transaction; a resume with no open pause raises after the status was set and so rolls back. Resume handlers run in key order inside the same transaction (F06 registers the package and wallet expiry shift). Nothing touches existing bookings or holds (PLAT-03-AC6, D107). The owner LINE message is a stub until F10; keep it as the one open item.

### 0034 setup steps and launch checks: approved, with the defaults confirmed

- **The five P2 steps** (`basics`, `plan`, `courts_hours`, `line`, `payments`) match Flow J's "P2 steps 1 to 5". Confirmed, on the condition that the step names are only keys: the screens take their labels from the locale files.
- **`payments` for a slip club.** The step needs `payment_connection.tested_at`. PRD Flow J gives slip clubs "a Test for slip checking" as well, so that works if the slip-checking test records `tested_at` on the same row. Make it explicit in the task that builds that test.
- **The ten launch checks and who owes each** (D108): confirmed as a proposal an admin can change. Two changes: (a) **every key needs a producer.** A key nothing can write can never pass, so Go live is impossible. Today `owner_signed_in` and `owner_verified` have one (0035). Add a test that lists the required keys and fails for a key with no producer, and name the producing task for the rest: `line_test` (F01-T24), `beam_key_swap` (F05-T11), `pay_tap_limit_set` (D61, a platform config value), `receipt_prefix_set` (derive from `club.receipt_prefix`, no one writes it by hand), `product_priced` (F04), `template_required_settings` (F01-T08 registry), `test_booking_completed` (F03/F13), `no_open_launch_failure` (derived). (b) **A change to `required_launch_checks` must be logged in P6.** An admin can shorten the list and so skip a check. A write function with a P6 entry, or a trigger on `platform.config`, closes it; the table grant for `update (value)` on `config` should then be dropped for that key.
- Fail closed when the list is missing or empty: correct.
- `app.setup_step_done` runs a function named in a registry that only migrations write; fine.
- Specialist self-assignment on create (`created_club`): fine, and it cannot assign anyone else.

### 0036 P6 hardening: approved

R3 (names allowed by exact match, `key` and `api_key`, `hmac_key`, `secret_key` still refused) and R4 (club must be one the staff member can see; support session must be theirs and the club's; `auth.*` unchanged) are done as asked.

### 0035 owner invite

**B1 (blocking). The invite is bound to a value that LINE never gives us.** `create_owner_invite` binds the invite to `club.owner_line`, the text typed in P2 step 1 (a LINE ID such as `@owner` or a phone). `app.redeem_invite` (migration 0003) compares `bound_line_user_id` with the LINE user id that comes from the verified ID token, which is the internal `U…` id of that person. The two never match, so the owner's redemption returns no row. The tests pass only because they type the same string in both places. LINE's Login and LIFF APIs expose the `U…` id and the display name; they do not expose the searchable LINE ID, so the platform cannot know the `U…` id in advance. This is the "owner's LINE ID discovery" gap the orchestrator mentioned; I wrote a proposal: `docs/architecture/proposal-owner-binding.md` (bind at first redemption, protect the link with the owner's email, the short TTL, the phone match and the second admin). It needs a decision before 0035 is relied on, because D122 says the invite is bound to the ID entered in P2. Until then lane 1 should not build the owner sign-in screens on the current binding.

**C1. Bind in one place.** Whatever is decided, `club_invite_owner_bound` (my CHECK in 0003: an owner invite has `bound_line_user_id`) and `create_owner_invite` change together, in a new migration (0035 is merged).

**C2. `owner_invite_redeemed` writes P6 directly** with the redeemer's phone and name in `detail`. That is allowed here (design 7.1 shows both next to `owner_phone`; owner contact is visible to BOOQ by D2), but write it through `platform.write_audit` so the same filter and the same actor rules apply, or add the two keys to a short documented allow-list. Today it bypasses the filter.

**C3. `platform.owner_contact_change` stores the proposed values in `changes jsonb`.** Those are owner contact values (visible to BOOQ staff, D2), so fine; but the table is outside `audit.register`. The P6 entry holds only the field names, which is right. Add a retention note: delete a decided request's `changes` after a set time (a person decides the time).

**C4. Concurrent redemptions and the older invite.** "A fresh invite ends the older unused one" sets `expires_at` to the earlier of now and the old expiry, with a floor of `created_at + 1µs`. Correct under the CHECK. Add a test that two parallel `create_owner_invite` calls leave exactly one unexpired invite.

## Defaults confirmed

Five P2 steps now and the owner's A0 steps registered by F04/F11 with `register_setup_step`; step meanings as built; who owes each check as proposed (amended above); `invite_ttl_hours` 72 as a proposal an admin can change.
