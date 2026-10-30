# Review of F01-T20 (`0032_club_status.sql`, branch `be-p/f01-lifecycle`, head 5433414)

Reviewer: Architect role, 30 Oct 2026. Against SR-02, F01 design 3.3, 4.1 and 7.6, PLAT-01-AC1 to AC10. I read the migration and the file list; I did not run the branch.

## Verdict: approve the shape. One change is required before merge (R1); R2 is required before Go live is used for real.

`club.status` is writable only through a definer function (no `UPDATE` grant for anyone), the actor and the club come from the transaction and never from an argument, an unassigned specialist and a missing club look the same (404), the transition table is closed (draft to testing to live, live to paused and back; no backward move, no delete, no `closed`: D14), the club row is locked `for update` so two transitions cannot interleave, the open owner window is cleared on every move (SR-02), and every move writes `club_status_change` with the staff member. `search_path` is fixed and every object is schema-qualified. The pause and resume path is closed to `set_club_status` (`use_pause`) and open only to the internal function, which T22 will call. All of that is what the design asks.

## Required before merge

**R1. Testing to Live does not run the purge.** PLAT-01-AC6 and F01 design 7.6: Go live deletes the club's test data in the same transaction, and a failed purge keeps the club in Testing. `apply_status_change` never calls `app.go_live_purge()` (F01-T27, on `main` since 3f7eec0). Add, after the blockers check and before the `update public.club`:

```sql
if v_from = 'testing' and p_to = 'live' then
  perform app.go_live_purge();
end if;
```

The purge reads the club in the same context, requires the status to still be `testing` (it is, because the update comes after), writes its own audit entry and P6 row, and `booq_owner` (the owner of this function) is the one role that may execute it. If the purge raises, the whole function rolls back and the status stays Testing. Tests to add: a Testing club with test rows and a tester account goes Live and the test rows and tester account are gone while the owner account, its roles and a setting's audit entry stay; a purge that fails (a fixture table whose delete trigger raises) leaves the status Testing and writes no `club_status_change`; the purge never runs for Draft to Testing or for resume.

## Required before Go live is used for real (not blocking this merge)

**R2. "At least one launch check, all pass" can be satisfied by one row.** A club with a single passing check can go Live. The list of required checks must be data (`platform.config`, key for example `required_launch_checks`, and the Blank-template rule of design 9.3), and `status_blockers` must require every key in that list to be present and `pass`. The `owner_verified` check of design 7.1 (the redeemer's phone matches `owner_phone`, confirmed by a second admin otherwise) must be in that list. T23 replaces `status_blockers`, so put this in T23's tests: remove one required row and Go live is refused; an unknown key does not count.

## Notes, none blocking

- **The default reason** (`draft_to_testing`) is fine for history. The pause and resume paths already require a written reason.
- **Draft to Testing** is open until T23 replaces the blockers function, as the lane says; nothing here makes that worse.
- **Policies for `booq_owner`** on `club` (update, own club) and on `club_status_change` (insert) sit beside my wide `club_definer_read` select policy; together that is what a definer function owned by `booq_owner` needs. Keep the names as they are.
- **After Go live** `club_tester` rows of purged tester accounts are gone with them (T27 registers them); nothing for this task.
