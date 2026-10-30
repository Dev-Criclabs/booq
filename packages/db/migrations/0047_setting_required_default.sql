-- F01-T27b follow-up: a setting key added later by another feature is not required for Go live unless its migration
-- says so. Migration 0046 marked the keys that existed then and defaulted the rest to required; this runs before the
-- later keys (such as the birthday discount of F04, which has no value until F14) are inserted, so they never block
-- Go live by surprise (PLAT-05-AC16 lists only the template's rule values).
alter table app.setting_keys alter column required set default false;
