# infra

Owned by the DevOps role. No secrets here, no product code.

- `env/.env.example`: names of environment variables, empty values.
- `checks/forbid-liff-fake.mjs`: deploy guard (D162). Fails a hosted build when `NEXT_PUBLIC_LIFF_FAKE` is on. Hosting build command for `apps/web`: `node ../../infra/checks/forbid-liff-fake.mjs && next build` (Root Directory `apps/web`, with source files outside the root included). Tested in CI (`infra tests`).
- `.github/workflows/build.yml` (not in this folder) builds both Next.js apps on every push; see `docs/ops/plan.md` section 7.
- `keys-generate.mjs`: creates the club secrets key pair (private key to a 0600 file, public key and key id to stdout). Tested in CI (`infra tests`). See `docs/ops/secrets.md`.
- `line-parity/`: throwaway receiver for F02-T00, done; delete with the Vercel project `booq-line-parity`.
- Planned, not written yet because they need accounts (`docs/ops/accounts.md`): backup job, restore drill script, monitor config, hosting config.

Plan: `docs/ops/plan.md`. Secrets: `docs/ops/secrets.md`. Runbooks: `docs/ops/runbooks.md`.
