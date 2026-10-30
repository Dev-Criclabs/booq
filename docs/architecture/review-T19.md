# Review of F01-T19 (`0031_support_window.sql`, on `main`)

Reviewer: Architect role, 30 Oct 2026. Against SR-02, PLAT-02-AC4 and AC5, F01 design 6.3 and 7.2. I read the migration and the test titles; I did not run it separately (it is part of the merged `main`, where the suites pass).

## Verdict: approve. Two small changes for lane 1's next pass; nothing blocks.

`app.set_support_window(p_on)` is the only writer of `allow_booq_changes_until` and `allow_booq_changes_set_at` (the `booq_platform` column grants exclude both, migration 0008, and `booq_app` has none). It is a definer function with a fixed search path, takes the club from `app.club_id()`, is executable by `booq_app` only, requires the owner role, uses `app.now()` so the test clock works, and sets `until = now + 24 hours` with `set_at = now`, which is exactly what the CHECK `club_booq_window_max` allows. Turning it off clears both columns. The BOOQ side reads the window through the club policy (`club_editable`), which compares `until` with `app.now()` at every statement, so the window closes by itself with no job. Go live, pause and resume clear it in T20. That matches SR-02.

## Changes (small)

**C1. Do not default `app.source`.** The function sets `app.source` to `admin` when it is empty. `withClubTx` has set `source` since F01-T11, and the audit writer is meant to refuse a club user's change with no source, so a caller that forgets it should fail rather than be labelled `admin`. Remove the `set_config` line and its comment. If a test relied on it, pass `source: 'admin'` in the test context.

**C2. Refuse a null argument.** `set_support_window(null)` falls through the `case` as "off" and writes `support_window.off`. Add `if p_on is null then raise exception ... end if;` so only an explicit true or false changes the window.

## Notes, none blocking

- **Re-extending.** Calling it with true while a window is open restarts the 24 hours from now. That is the owner's choice and still bounded by the CHECK; keep it, and have the owner screen show the new end time.
- **Two audit records.** The update of `club` produces an entry through the trigger and `audit.note` adds a readable `support_window.on` / `.off` event. Both are wanted (PLAT-02-AC5 asks for the visible event); no change.
- **Policy duplication.** `club_owner_role_window` (here) and `club_owner_role_status` (0032) are the same shape on `club` for `booq_owner`. Harmless, since permissive policies are ORed; fold them into one if a later migration touches either.
- **BOOQ notice.** A platform write inside an open window to the connection or secret tables of a Live or Paused club should create an owner notice (design 6.3). That sits with the secrets grants I am writing next, not here.
