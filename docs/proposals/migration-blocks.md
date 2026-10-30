# Proposal: migration number blocks for every feature

From the spec drafter, 30 Oct 2026, for the Architect to put in `docs/architecture/build-plan.md` section 4 (the spec drafter does not edit that file). Answers reviewer finding G3B-11.

One block per feature, one migration file per task, numbers rising in the order tasks merge (`migrate.ts` refuses a duplicate number and a number below one already applied). A merged migration is never edited.

| Feature | Block | Notes |
|---|---|---|
| F01 | 0001 to 0099 | on `main` |
| F02 | 0101 to 0199 | 0103 holds the claims registry |
| F03 | 0201 to 0299 | |
| F04 | 0301 to 0399 | |
| F05 | 0401 to 0499 | |
| F06 | 0501 to 0599 | 0501 to 0513 used (F06 design section 3) |
| F10 | 0601 to 0699 | 0601 to 0607 used (F10 design section 4) |
| F13 | 0701 to 0799 | 0701 to 0709 used (F13 design section 3) |
| F07 | 0801 to 0899 | proposed |
| F08 | 0901 to 0999 | proposed |
| F09 | 1001 to 1099 | proposed; four digit numbers sort after 0999 only if the loader compares numbers, not strings (Architect to confirm) |
| F11, F12 | none expected | screens and routes over existing tables; if a table is needed it takes the next free block, 1101 |
| F14 | 1401 to 1499 | proposed |
| F15 | 1501 to 1599 | proposed |
| F16 | 1601 to 1699 | not for the Hunter launch |

Why F07 is not 0601: the F10 design already holds 0601 to 0699. Open for the Architect: whether the numbering could follow the build waves instead; no feature depends on the order of the blocks, only on the order inside each block and on the features it calls.

## Rule D159 audit of the F06 to F10 and F13 tasks (30 Oct 2026)

A redefinition is numbered above the last definition of the object, wherever the migration lives (the orchestrator's rule; D159 is not yet in `docs/decisions.md` on the branch this was written on). Checked for every migration that redefines something that already exists; new objects, `ALTER TABLE ... ADD`, registry inserts and function bodies that are only called need no change.

| Task | Object redefined | Last earlier definition | Number |
|---|---|---|---|
| F03-T30 | `release_hold`, release reason CHECK | F05 0403 (and 0409 is the highest F05 file today) | 0411 |
| F03-T31 | `move_booking` | 0225 (D107 Paused change) | 0227 |
| F06-T03b | `order_line` kind CHECK, the lines-add-up check | F04 0303 | 0504 |
| F04-T22a | `order_line` kind CHECK | F06-T03b 0504 | 0516, builds after F06-T03b |
| F06-T08 | ledger reason CHECKs (`import_transfer`) | F06-T02 0502 | 0510 |
| F06-T14 | `package_reminder_hook` | F06-T07 0508 | 0514 |
| F07-T03 | `lock_coach`, `coach_rules_check` registration | F03 0213 | 0803 |
All other F06 to F10 and F13 migrations create new objects, add columns or foreign keys, or insert into registries, so the rule does not move them. F04-T22b and F04-T22c are route code, not migrations (Pay is route code), so the earlier numbers 0315 and 0316 are removed.

