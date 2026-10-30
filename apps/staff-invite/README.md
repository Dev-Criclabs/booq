# apps/staff-invite

The one small function that holds the identity provider's admin key (SR-06, D124, D148). It invites BOOQ staff, resets a
second factor, deactivates a teammate, and answers the console's sign-in and enrolment calls. Every call is signed by
`apps/platform`; see `src/handler.ts` for the routes and `src/env.ts` for the settings (none has a default).

## First admin (D163): run once per deployment, by DevOps

Nobody can invite the first admin, so this one-off command does it. It is never a web route.

What it does: creates the provider user and the admin's record, writes one P6 entry (`staff.bootstrapped`, no link in it),
and prints **one** enrolment link on standard output. The admin opens the link, sets a password and adds an authenticator
(F01-T17c); after that, admins invite everyone else in the console.

Where to run it: a machine that holds the database owner's connection and the provider's admin key (a DevOps laptop or
a one-off job), not the console's or the web app's host.

```sh
export BOOTSTRAP_DATABASE_URL=...        # the database OWNER role (booq_owner), not an app role
export SUPABASE_URL=...                  # the project address
export SUPABASE_SERVICE_ROLE_KEY=...     # the provider's admin key
export PLATFORM_BASE_URL=https://...     # the console's public address, for the link

pnpm run bootstrap:admin -- --email first.admin@example.com --name "First Admin" --ttl-hours 24
```

- Nothing has a default. `--email`, `--name` and `--ttl-hours` are all required, and so are the four settings above.
  `--ttl-hours` is how long this one link lives; the platform setting `console_enrolment_ttl_hours` is **not** written
  (an admin sets it in the console with `PUT /config/console_enrolment_ttl_hours` before inviting anyone else).
- The link goes to standard output and nowhere else, once. Send it to the person over a private channel. It works once and
  expires; it is stored only as a hash.
- It refuses to run while **any active admin exists** (exit 3), or if the email is already a teammate (exit 4). So a second
  run, or a run on a live team, changes nothing.
  Known gap: if the first link expires before the admin enrols, the record is already an active admin, so the command
  refuses. There is no automatic re-issue yet. Recover with the database owner: delete the unenrolled admin's
  `platform.staff_enrolment` and `platform.platform_staff` rows (and the provider user, in the provider's dashboard), then
  run the command again. Ask the orchestrator to add a re-issue command if this happens more than once.
- Exit codes: 0 done, 1 failed before finishing (nothing kept; a provider user made on the way is removed), 2 a missing or
  bad setting or argument, 3 an active admin exists, 4 email already a teammate, 5 the provider failed.
- Two runs at the same moment make one admin (the check holds a lock).
- Keep the database owner's connection and the admin key out of shell history and CI logs.
