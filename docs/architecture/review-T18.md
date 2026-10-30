# Review of F01-T18 (`0008_platform_grants.sql`, `platform-tx.ts`, branch `be-p/f01-platform`, 3830d09)

Reviewer: Architect role, 30 Oct 2026. Against SR-02, SR-06, D27, PDPA-01-AC1, F01 design 6.3, FA 4.4 and 8.2. I read the migration, `platform-tx.ts` and the test titles of `platform-grants.test.ts`. I did not run the branch.

## Verdict: approve the grants and policies. Two changes are required before merge (R1, R2); R3 to R5 can follow in the next platform task.

The security shape is right: no privilege at all on any D table (the suite walks the registry, so a new table is covered), S tables by column grant plus per-staff policy, row security on all ten platform tables as a second layer, `club.status` and both window columns outside the grants (SR-02), a new club can only start as Draft, a window of at most 24 hours is a CHECK and the policy reads the clock so it closes by itself, and Paused is look only (D27). The P6 writer refusing player data at any depth is good.

## Required before merge

**R1. One `withPlatformTx`, and it must name the staff member (PLAT-04-AC4).** `main` already has a `withPlatformTx` from F01-T11 (`packages/db/src/tx.ts`, types `PlatformContext` and `PlatformDb` exported from `index.ts`). Two exports with those names will not compile together. Keep **yours** in `platform-tx.ts` and I remove mine after this merges (I have already taken mine out of my branch; see below). Please add to yours:
1. `staffLabel: string`, required whenever `staffId` is not null, set as `app.actor_label`. Without it `audit.write` records the label `BOOQ staff`, so the club's own log does not name the person, and PLAT-04-AC4 ("the entry names the BOOQ staff member") fails. Add the test: a platform edit of `club_setting` gives an `audit_entry` whose `actor_label` is the given name.
2. `clubId?: string`, set as `app.club_id` when given. `audit.note()` (support session opened or closed, PLAT-02-AC6) reads the club from the context and fails without it.
3. One setting name. You set both `app.platform_staff_id` and `app.actor_platform_staff_id`. Make `platform.staff_id()` read `app.actor_platform_staff_id` and drop the other, so the audit writer and the policies can never disagree about who is acting.

**R2. A specialist can write `launch_check` rows directly.** `launch_check_insert` and `_update` let any staff member who can see the club set `result = 'pass'`, and Go live (T22) is gated on every check passing. That lets the person who benefits from going live mark their own checks. Required: no insert or update grant on `launch_check` for `booq_platform`; results are written only by a definer function (`platform.record_launch_check`) that runs or reads the actual check, or, until those exist, by an admin only. The select policy stays. Fix it in this migration, because T22 depends on it.

## Next platform task (not blocking this merge)

**R3. The P6 filter over-refuses.** `assert_setup_detail` blocks any key that has the token `key` in it, so `feature_key`, `check_key` and `setting_key` (all setup facts, and `launch_check` itself has `check_key`) would be refused, and `T22`/`T23` will hit it on day one. Allow those three names by exact match, as you already do for `secret_last4`. Keep `key` blocked alone and `api_key`, `hmac_key`.

**R4. `write_audit` does not check the club or the session.** A specialist can write a P6 row for a club they cannot see, or with another staff member's support session id. It is only a log, but P6 is evidence. Add: when `p_club` is given and the action is not `auth.*`, require `platform.can_see_club(p_club)`; when `p_support_session` is given, require that session belongs to the current staff member.

**R5. Owner contact changes.** Design 7.1: after an owner invite exists, a change to `club.owner_*` needs a second platform admin. The `club` column grant still allows a specialist to update those columns in Draft or Testing. Enforce it in T23 (a definer function plus removing the column from the update grant at that point); until then note it as open.

## Notes

- **Trust model.** The policies trust the transaction-local staff id, as the club side trusts `app.club_id`. That is safe only while the platform app builds all SQL (no string concatenation, the lint stays on) and nothing lets a request choose the setting. Keep `createPlatformDb` as the only way to reach the pool.
- **`staff_by_id` / `staff_by_auth_user`** return name, role and active flag for any id asked for. Fine for sign in and the session check; do not call them from a screen with an id that comes from the client.
- **`platform.club_editable`** is invoker on purpose and reads the club row through the caller's policy; I traced it and it does not recurse.
- **Migration 0008 and the T12 file.** Nothing in 0008 depends on the people tables, so merge order against my 0003 and 0010 does not matter.
- **My side of R1.** I removed `withPlatformTx` from `tx.ts`, kept the audit checks in `audit.test.ts` (an entry names the staff member when `app.actor_platform_staff_id`, `app.actor_label` and `app.support_session_id` are set), and will add the label test above to the platform suite after your change lands.
