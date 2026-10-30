-- Platform config keys that have no default (PLAT-06-AC10, AC13; the Orchestrator's note of 30 Oct 2026).
-- A value of JSON null means "not configured": the feature that needs it refuses (the import route
-- answers 503 import_not_configured) and P3 shows it as missing. An admin sets it in platform.config.
--   import_max_rows       rows accepted in one import file
--   import_staging_hours  how long parsed staging rows may wait before they are removed
insert into platform.config (key, value) values
  ('import_max_rows', 'null'::jsonb),
  ('import_staging_hours', 'null'::jsonb)
on conflict (key) do nothing;
