# Review of 0037, 0038 and 0039 (lane 1: F01-T23 follow-up, T25, T24 as built on `be-p/f01-lifecycle`)

Reviewer: Architect role, 30 Oct 2026. Against D122, PLAT-05-AC1 to AC16, F01 design 9.1 and A-1, and my reviews of T22 and T23. I read the three migrations (0039 from `origin/be-p/f01-lifecycle` at 505793e); I did not run the branch.

## Verdict

- **0037 owner LINE format: approve only as an interim, B1 stands.**
- **0038 feature switches: approve, with one required change (who may flip a switch).**
- **0039 templates: cannot merge as written.** `main` already has F01-T24 (my `0018_templates.sql`, merged), so the two collide. The lane's version has more in it and most of it is right, so the fix is to rebase 0039 as a delta on 0018 (below). Nothing is lost.

## 0037 owner LINE format

The CHECK `^U[0-9a-f]{32}$` makes P2 step 1 accept only an internal LINE user id, which is what `redeem_invite` compares against, so it removes the silent mismatch I found in B1. It also means **no one can complete P2 step 1**: the platform cannot know that id before the owner has signed in (my proposal in `proposal-owner-binding.md`), and `setup_basics` needs `owner_line` set before Draft to Testing. So the constraint is correct only if D122 is kept AND a way to learn the id is added. If the orchestrator accepts the proposal (bind at first redemption), `owner_line` becomes an optional contact detail again and this CHECK goes. Treat 0037 as a placeholder, and do not build the P2 screens on it before the decision.

## 0038 feature switches: approved, one change

Good: the list is data (`app.feature_keys`), `club_feature.feature_key` is a foreign key to it so no other switch can exist (AC6); `slip_checking` and `backup_mode` exist only for a slip club (AC4); `app.has_feature` is SECURITY INVOKER, takes no club, reads through the caller's policies, and is off with no context (AC1, AC2); changes are audited by the existing trigger (AC3).

**Who flips a switch (the lane's question).** The design does not give the owner this right: `club_feature` is class S, "set by BOOQ in the support view" (F01 design 3.2, 6.3), and PLAT-05 says a switch is a setting BOOQ configures per club. Your default is right: BOOQ staff write, the owner reads. As built the owner can still write it: my migration 0002 has the policy `club_feature_owner` and an insert/update/delete grant to `booq_app`. **Required change** (a small new migration, lane 1 owns it): drop `club_feature_owner` and revoke `insert, update, delete` on `club_feature` from `booq_app`; keep the read policy. BOOQ staff keep the 0008 write path (assigned, Draft or Testing, or the owner's window). Add a test: the owner reads the switches and cannot write one; a specialist can in Testing and cannot on a Live club without the window.

## 0039 templates

**What collides with `main`.** 0018 (merged, so it cannot be edited) already: creates `app.template_handlers`; seeds the four templates (the second insert breaks on `template_key_unique`); seeds Tennis items; and adds `platform.apply_template`. 0039 would fail on the first duplicate.

**Rebase as a delta on 0018** (lane 1 owns the file; I will adjust my tests when it lands):
1. Remove from 0039: the `app.template_handlers` table, the four template rows, the two `club_setting`/`opening_hours` insert policies (0018 has equivalent ones; keep yours only if the names differ and you want both, they are harmless).
2. Keep your additions as `insert … on conflict do nothing` into `platform.template_item`: `booking_window_days 30`, `cancel_window_hours 12`, `vat_enabled false`, the TBD items with JSON null, `label resource`, `price court_hour`, and the products. **I checked the values against the PRD:** court ฿500, bundles ฿4,500 for 3 months and ฿8,000 for 5 months, solo 8 packs ฿5,600 (Adult) and ฿4,800 (Student), the 30 day window and the 12 hour cancel (hand-off BOOK-01, CANCEL-01), and "Non VAT by default" (hand-off RCPT-02) all appear in the spec; the single class prices and the group pack prices I could not check line by line and the Reviewer should (PRD pricing table, lines 241 to 255). This also answers my open question about `cancel_window_hours` and `booking_window_days`: they are in, and the Go live check can stay.
3. Delete my seed item `sport/tennis` (`delete from platform.template_item where kind = 'sport'`); your `label` item replaces it (AC10).
4. One entry point: keep **`app.apply_template`** (owner in A0 and BOOQ staff) and drop `platform.apply_template` in the same migration (`drop function platform.apply_template(uuid)`); keep my P6 entry for the staff path by calling `platform.write_audit` in yours (PLAT-04-AC5: a platform action must reach P6; yours writes only the club's audit note).
5. Registering handlers: keep your `app.register_template_handler`; 0018 has the table without a created_at column dependency, so nothing else changes.

**Design points to change in the function.**
- **Pending kinds are never applied later.** For `price` and `product` your function reports the kind as "pending" and sets `template_applied_at`, and `already_applied` then blocks a second run, so a club created before F04/F06 are deployed never gets its prices. Either fail closed (my 0018 stopped with `no_handler`) or keep the pending kinds on the club (`template_pending text[]`) and have each handler-registering migration run `app.apply_pending_template_kind(kind)` for every club that has it pending, in the same migration. I recommend the second: it lets you start a club before F04 is deployed and still ends with the right data.
- **The label becomes a `club_setting` row `resource_label`.** The settings registry (T08) validates keys; `resource_label` must be in it, or the label belongs in a column. Decide before T08.
- **Draft or Testing** is wider than mine (Draft only). A copy in Testing writes rows that are test data only if the setting trigger says so; settings are not test rows, so it is fine, but a second template change after Testing started would be a surprise. Keep "once".
- The F04 items the Tennis template still lacks (price groups Adult and Student, the coach tiers and their prices, the add-on "Balls (Set of 3 balls)") are F04-T06's: it will add the items and register handlers for the kinds `price`, `price_group`, `coach_tier`, `coach_tier_price`, `add_on`. Lane 1 should name the kind `price` for the court rule exactly as seeded so the handler matches.

## Tests I expect in the rebased 0039

Tennis settings equal the PRD values (including the three now added); the TBD keys have no row; Blank copies nothing; a later template edit leaves existing clubs unchanged; the owner can apply in A0 and a specialist who cannot see the club gets "not found"; a kind with no handler is kept pending and applied by `app.apply_pending_template_kind`; P6 and the club log both have the entry.
