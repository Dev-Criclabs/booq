# Proposed rows for `import_transfer`

For the orchestrator or the user to apply. The spec drafter does not edit the PRD or the hand-off. F06 requirements (PKG-01-AC2 and AC3 reason lists) change only after both rows exist (CLAUDE.md, rule 5).

Source: F06 design section 4.8 and assumption A-9.

**PRD change log row (proposed text):**
30 Oct 2026 · Wallet and credit reasons · A new ledger reason `import_transfer` records value carried in from the club's earlier system for a player who has not yet claimed their account. It is a paired movement (the unclaimed holding and the claim), is never cash, and is shown in reports as imported value for unclaimed players. Source: D78 list extended; F06 design 4.8.

**Hand-off row (proposed text):**
Data model, wallet and credit ledgers: add reason `import_transfer` to the reason sets of `wallet_ledger` and `credit_ledger`. Written only by `app.f06_claim_transfer`; two rows per transfer with one shared key; an inert guard `customer_not_claimed` blocks spending before the claim.
