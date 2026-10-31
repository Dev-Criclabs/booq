# API role matrix (RLS test plan RLS-R07)

`role-matrix.spec.ts` calls **every mounted route of apps/web** as seven club role sets and as a guest, through the real transport
(`serveRoutes`), with a database that throws if it is touched before the gate lets the call through. A route that declares a permission must
refuse exactly the role sets the permission matrix refuses (403, or 401 for a guest) and a refused call must not reach the database. Routes
for any signed-in person refuse a guest with 401. Public routes let a guest through; none may look like staff, money or personal data.
A second block checks the permission matrix itself against the hand-off roles table (front desk, accountant, coach, player, owner).

`platform-matrix.spec.ts` does the same for the platform console (`servePlatform`): a guest and a club session cookie get 401 on every staff
and admin route, an onboarding specialist gets 403 on every admin route (pause, resume, team), and neither touches the database.

A new route needs no change here; a route that declares the wrong access, or a permission that is not in the matrix, fails.

Not covered by this gate test (done by the lanes' own route tests or by the row policies): what a *permitted* role may see inside a route
(for example the accountant seeing names but not phone numbers, D35), and the assigned-club rule for a specialist (RLS-P10, tested in
`packages/db`).

## Files and PDFs

The receipt PDF routes and the export file path are covered by the lanes' tests: `apps/web/src/api/receipts/routes.test.ts` (another player's and another club's receipt are 404, staff always get a copy, the PDF is 503 when the language files are missing, only the owner voids), `packages/receipts/src/pdf.test.ts` (same file byte for byte, copy mark, longest Thai and English names), `packages/db/src/import-export.test.ts` (the export file path must be under the club id; a finished export cannot change who asked) and `packages/auth/src/serve.test.ts` (files are sent with their type, `no-store` and `nosniff`). QA adds no duplicate; if a file route is mounted without those, the role matrix above still gates it.
