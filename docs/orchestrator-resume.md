# Orchestrator resume checklist (paused 31 Oct 2026, resume Wed)

The user paused all lanes to save credits. Main is at the last gated push; every lane pushed its branch.

## First batch on resume (run all gates and the full e2e before pushing main)
- architect/foundation: 1b to 1d done (coach picker, price group, customer on booking read, receipts payment method?); 1a walk-in sale (1208) is WIP with no tests yet.
- be-b/f03-routes (8acf39ce, gates green): 1015 cancel messages (coach duplicate removed), F09-T12 player cancel, T13 staff cancel, mark, closures (1016).
- be-c/f04-f05 (ea83322): T15 coach add (0418), POST /staff/orders/:id/cash (D181). test:zones not confirmed.
- be-l/f10 (32b225c0): T15 rich menu (0615), 0616 f10_released skips closed, session_change change titles. test:zones not confirmed.
- be-p/platform-transport (cdb9941): A7, A8, A13, A14, A16 LINE labels.
- be-p/f01-lifecycle: F12 T11 to T13 done; T14 K5 WIP.
- be-w/f06-f13 (0bcbc57f, gates green): C9 packages (0521), F06-T18 C14 credits and wallet. Terms (approved: GET /packages/terms, price-group aware, nulls when unset; answer may not have reached them), F13-T15 and T19 not started.
- fe/player (7892fe14 WIP): QA-UI-1 fix, Add on LINE; test-only fix for 2 e2e failures not re-run. Run the full e2e (--test-concurrency=1).
- qa/f01 (7fdf593): qa-pay-journey.e2e.mjs WIP, not run yet.
- Check for duplicate migration numbers after merging (1208 architect vs BE-P1 1208 f12_export!).

## Lane queues on resume
- BE-C (all gates green on ea83322, cash route included): TOP: wire F07 coach prices into production quoteSources (coach lines answer coach_price_not_set outside tests). Then override_reason pass-through, bundle accept (0520 on main), class-seat waitlist offer, take_cash for coach-add orders. Tell lane 2 the cash route.
- Architect: finish 1a walk-in sale tests (zero money, receipts, apply_payment with null customer); receipts payment method; then bundle accept and {hours} on C10, FE refusal helpers.
- Lane 2 (FE-A): C13b cancel sheet (F09-T14), A12 closures, A2b cancel and mark, A2 desk cash, calendar 1111 fields, promo usedCount.
- BE-P1: F12 T14 to T16.
- BE-W: GET /packages/terms (re-confirm approval), F13-T15, F06-T19; Profile rows linking C14 and receipts (FE lane to agree).
- FE: class screens C5 to C8, waitlist screens.
- F10: confirm zones, http-transport test timeout, T16 platform rich menu.
- QA: run the pay journey, C13b via API, F12-T18 later.
- DevOps: closure_cancel_limit (platform.config, BE-B 1016) is missing from the console /config list and docs/ops/platform.md; route to lane 2 (console) and DevOps.

## User items (remind briefly)
Beam account, Supabase decision (also unblocks the club data export storage), branch protection, booq_support_line_url, platform config values before 7 Dec.
