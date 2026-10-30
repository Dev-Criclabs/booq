# Restore drill records

One file per drill, named `YYYY-MM-DD-<environment>-<n>.md`. No personal data and no secrets in these files.
The Security launch checklist (items 1.10 and 2.4) points here as the evidence.

Planned: drill 1 on production into a scratch project, 30 Nov to 3 Dec 2026; drill 2 after the 7 Dec test data exists, by 21 Dec 2026. See `docs/ops/plan.md` section 4 and `docs/ops/runbooks.md` 7.

## Template

- Date, who ran it, who watched.
- Source: provider daily backup or nightly dump (and point-in-time if bought). Backup id.
- Target: the scratch project (name, region). Confirmed not the live project.
- Start time, end time, **recovery time** (hours and minutes).
- Smoke checks, each pass or fail with the query output attached or linked:
  - row counts close to expected for core tables;
  - every credit and wallet balance equals the sum of its ledger rows (PKG-01);
  - the court and the coach exclusion constraints reject a duplicate slot;
  - row level security is on for every table;
  - receipt numbers per club are an unbroken sequence (RCPT-01);
  - the audit hash chain verifies, if it exists;
  - deleted players are re-applied from the deletion log.
- Problems found and what changes in the runbook.
- Scratch project deleted on (date).
