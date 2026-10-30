-- F05-T03b / migration 0409: platform config keys for Beam that have no default (PAY-02-AC2, decisions D73, D80).
-- A JSON null means "not configured" (as in migration 0016): the feature that needs the value refuses until a
-- platform admin sets it in platform.config. No number is chosen here.
--   qr_expiry_margin_seconds           how long before the QR runs out the hold must still last
--   beam_reconcile_interval_seconds    how often the reconcile job runs
--   beam_reconcile_age_seconds         how old an unresolved charge must be before the job asks Beam
-- package_qr_minutes is a club setting registered by F01 (0041), not repeated here.
insert into platform.config (key, value) values
  ('qr_expiry_margin_seconds', 'null'::jsonb),
  ('beam_reconcile_interval_seconds', 'null'::jsonb),
  ('beam_reconcile_age_seconds', 'null'::jsonb)
on conflict (key) do nothing;
