# F04 acceptance sweep

Swept on 31 Oct 2026 against `specs/features/F04-checkout-pricing/requirements.md`. F04 is built in the domain (pricing, discounts, pay) and the database (orders, lines, codes, redemptions, quote and order functions); the checkout routes exist. The A9b and codes admin screens and the C11 screens are not built.

**Result: 76 criteria. 57 were already cited by other QA files or lane tests, 10 newly traced here, 9 still open (each with its reason). No new finding.**

Newly traced (lane tests next to the code): PAY-07-AC3 and AC6 (a 100 percent code confirms in the same request with a receipt), PROMO-01-AC6 (first time only), AC8 (partner code on a solo class), AC10 (split by hour price, restored only on the last live hour), AC11 (referral code is the one code; the own code block waits on F14), AC14 (a restored use is not counted by the partner report), R5-AC4 (no birthday discount without a date of birth), R7-AC4 (test rows flagged), R7-AC5 (lines, payments and ledgers append only).

Still open:

| Criterion | Why it is open |
|---|---|
| R2-AC9 | Add a coach after booking, priced for the coaching portion only: F07 owns the flow. |
| R3-AC8, PROMO-01-AC12 | Audit of add-on and code edits, applying to new orders only: the A9b and codes admin routes are not built. Price changes are audited (`price-tables.test.ts`), which is the same trigger family, but the add-on and code tables need their own check. |
| R4-AC7 | Credit and wallet ledger rows written in the same transaction as the order: the pay test covers the default (nothing reserved); a test with credit and wallet through the pay path waits for F06's reserve call to be wired. |
| R4-AC11 | Whole baht without decimals, two decimals otherwise: only the LINE builder has a money formatter (`฿1,200.50`). The player app formatter is not built. |
| R6-AC4 | No prompt for a player with court hours: screen (Playwright). |
| R8-AC2, R8-AC3, R8-AC5 | Offline error, longest string at 375 px, live coach list: screens (Playwright), F07 for the coach rule. |
