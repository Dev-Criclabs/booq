# Player app journeys (Playwright)

`tests/e2e/qa-journeys.e2e.mjs`. Run: `node --test --test-concurrency=1 tests/e2e/*.e2e.mjs`. It uses the lane's harness (`apps/web/e2e/harness.mjs`): `next dev` with the LIFF fake, the club API faked in the browser, no database. Screenshots go to `tests/e2e/screenshots/` (not in git). These tests do not repeat `apps/web/e2e` (C1, C2, C3, C4, C17, deep links, notice).

Run on main d709178 and later, 31 Oct 2026. The lane's own C4 file passes (7 of 7).

| Journey | Result |
|---|---|
| Nothing cut off at 320 x 568 with the longest strings, Thai and English: C1 welcome, C3 guest home, C4 schedule (a 57 character court name, all seven states), C4 paused, My bookings and Profile signed in with a 62 character name. The check looks for text that reaches past a clipping box, ellipsis that hides text, text outside the screen, sideways scroll, and a button label that wraps | pass for a 55 character club name. **Fails for a 101 character club name on C1** (QA-UI-1, severity 4, Q-37: no limit is set) |
| BOOK-01 with colour off (grayscale filter) and in forced colors mode: seven states (open, taken, held, closed, past, mine, selected) | pass: seven different words and seven different icons; every cell has a name |
| Keyboard on C4: only open hours take focus, the focus ring shows, Enter selects | pass |
| Where Continue ends | `GET /c/hunter/checkout?...` answers **404**: the C10 page is not built. Known; marked todo |
| A guest reaches sign-in and comes back | covered by the lane (`c03-home`: person pages; `c01-welcome`: back to the chosen slot). The check through checkout waits for C10 |

Not yet run: the admin shell and customers screens (F11-T12, T15), which are not on main.

## Club admin console (`tests/e2e/qa-admin.e2e.mjs`), main 0718457

The same clipping audit (text cut by a clipping box, ellipsis that hides text, text off screen, sideways scroll, wrapped button labels) with the longest Thai and English names, notes, tags, package names and a 55 character club name, on the admin home, A5 Customers, A6 Customer profile and the staff page, at 320 x 568 and 1280 x 900, in both languages (16 combinations).

| Result | |
|---|---|
| All 16 pass | the page content: names, tags, notes, package names and the tables hold up. The table scrolls inside its box |
| QA-UI-2 (severity 5, to confirm, todo) | at 320 px the top bar ends the club name with an ellipsis |

The lane's own admin suites (shell, customers, profile, staff) pass with the rest of `apps/web/e2e` (41 of 41 before F11-T23). The audit page (`/staff/audit`) is part of the staff suite. Not yet run: F11-T22 and T24 (next batch).

