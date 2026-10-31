# QA findings

Filed by QA, not fixed by QA. Each finding has a test written as `it.fails`: it passes while the product is wrong and turns red when the product is fixed, which is the signal to remove `.fails`. Severity: 1 money, privacy or double booking; 2 a rule is broken; 3 wrong or confusing; 4 cosmetic.

| # | Severity | Requirement | What is wrong | Where | Test | Owner | State |
|---|---|---|---|---|---|---|---|
| QA-F01-1 | 2 | ROLE-02-AC7, D123 | A platform admin can issue a second-factor **reset** link for their own account. D123: only another platform admin may reset a second factor | `platform.issue_staff_enrolment`, migration 0055 | `tests/acceptance/F01-platform-foundation.new.spec.ts` | platform lane 2 | open |
| QA-F01-2 | 3 | ROLE-01-AC8, D115 | The accountant reads every club setting. D115: business and tax settings only. Policy `club_setting_read` grants owner, front desk and accountant select on all rows | migration 0002 line 183 | same file | platform lane 1 | fixed in migration 0054 (database scope per setting key; `.fails` removed) |
| QA-F09-1 | 3 | CANCEL-02-AC4, PAY-05-AC5, Gaps A3 | `locales/en.json` X-0120 (P2 step 5, Beam option) says "Refunds go back by PromptPay". Value returns as wallet or package credit only. The key is not used by any code yet, so the text is not shown; the writers' file still holds it | `locales/en.json` | `tests/acceptance/F09-cancellation-closures.new.spec.ts` | Content / writers | open |
| QA-F10-1 | 3 | LINE-05-AC16, D116 | `locales/en.json` and `th.json` L-0021 (the 2 hour reminder title) types the number of hours ("See you in 2 hours"). Reminder numbers must be variables in the text, never typed in a key. Fix: TEXT-03 variable pass on the key (`{hours}` in both languages), the builder passes the hours | `locales/en.json`, `locales/th.json`; `packages/line/src/messages/builder.ts` line 83 | `tests/acceptance/F10-line-messages.new.spec.ts` | Content role, then F10 lane | open |
