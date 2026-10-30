# Privacy notice and terms: storage, publishing, and how sign-up checks the version (D152, Architect)

No legal text is written here. This fixes where it lives, who publishes it, what a version is, and how `sign_up_player` knows which version the player accepted. Recommended defaults (D147) are marked.

## What is stored (data rows, not files)
- A **release** is one published set: the privacy notice and the terms, each in Thai and English, under one version label. `platform.legal_release (version text primary key, published_at, published_by)`.
- `platform.legal_text (version, kind, language, title, body)`: `kind` is `privacy` or `terms`, `language` is `th` or `en`; four rows per release, all required. `body` is the template, with club fields written as `{clubName}` and `{legalName}`. Both tables are class P, append-only (a published release is never edited; a correction is a new release), and read by the app roles only through the functions below.
- Data rows rather than files because the version has to be checked in the database at sign-up, kept for ever as the proof of what a person accepted, and published without a deploy. The wording is the lawyer's and the writers'; BOOQ staff paste it in the platform console (an English-only X screen).
- The version label is a plain increasing label made by the server when it publishes (`v1`, `v2`, ...). The client never makes one: the interim `text-sha256:` fingerprint in `apps/web/src/client/consent.ts` goes away.

## Who publishes
Only a BOOQ platform admin, through `platform.publish_legal_release(texts jsonb)`: all four texts present, every `{field}` in them one of the two allowed fields (anything else is refused, so a typo cannot ship), and a P6 entry with the new version and a hash of each text (no text in the audit detail). A club cannot edit or publish the notice: the template is BOOQ's, the club's name and legal name are filled in at render time.

## How a player and the app get it
- **Current version:** `app.current_notice_version()` returns the latest published label, or null when nothing is published. `public.public_club_config` gains a `notice_version` column with it (same view the sign-in page already reads, so `GET /public/config` carries it with no new route for the version).
- **The text:** `app.render_notice(kind, language)` is SECURITY DEFINER, takes the club from the context and returns `{version, language, title, body}` with `{clubName}` replaced by the club's name in that language and `{legalName}` by its legal name. The legal name is a business column that guests cannot read after migration 0026; this function is the one deliberate public route to it, for this purpose only. The registered address, tax id and any owner contact are not fields, because the app never shows the address (PRD) and owner contact is the owner's. `GET /c/{slug}/privacy` and `/terms` call it with the page language and may cache by version.
- With no release published, `render_notice` returns nothing (404) and sign-up is refused (below).

## How `sign_up_player` validates
`p_notice_version` must equal `app.current_notice_version()` at that moment, else `sign_up:notice_version_stale` (`sign_up:no_notice` when nothing is published). The client then reloads the config, shows the current text again, and resubmits; this guarantees a consent is always for the text that was current when it was given. The consent row stores the version and the language the player saw (`user_consent.notice_version`, `user_consent.language`, already there).

## Launch
Nothing is published at first, so no player can sign up and no tester can join. A Draft to Testing blocker `legal_notice` (owed by BOOQ, done when a release exists) is added to the setup steps (`app.setup_steps`) so the club never reaches Testing with sign-up closed.

## Not decided here (parked with the legal input)
Whether a new release forces existing players to accept again. The data allows it (compare their latest consent version with the current one); no rule is built until someone decides. Retention of old releases: kept for ever as proof, no deletion is built.

## Migration (0048, this branch)
`platform.legal_release`, `platform.legal_text` and their append-only triggers, the three functions, the view column, the replaced `app.sign_up_player` (same signature, adds the version check), the setup step.
