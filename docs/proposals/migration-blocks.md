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
