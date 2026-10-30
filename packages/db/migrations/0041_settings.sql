-- F01-T08 / migration 0041: the list of club setting keys, and the hold time check.
-- Requirements: PLAT-05 (settings), BOOK-03-AC3, PLAT-04-AC1; F01 design 10.
--
-- The types and validation live in the settings registry (packages/domain/src/club/settings-registry.ts),
-- which the routes use. This is the database's own guard, so a write that skips the routes still cannot
-- invent a setting: only the listed keys can exist, and the hold time is 10, 15 or 20 minutes. There is no
-- key for the booking length (60 minutes on the hour for every club) and none can be added without a
-- migration. A test in packages/domain keeps this list and the registry equal.

create table app.setting_keys (
  setting_key text primary key check (setting_key <> '')
);
alter table app.setting_keys owner to booq_owner;
revoke all on app.setting_keys from public;
grant select on app.setting_keys to booq_app, booq_worker, booq_platform;

insert into app.setting_keys (setting_key) values
  ('hold_minutes'), ('booking_window_days'), ('cancel_window_hours'), ('max_future_court_hours'),
  ('waitlist_claim_minutes'), ('waitlist_no_offer_hours'), ('rest_cap_hours'), ('group_min_players'),
  ('group_max_players'), ('below_min_alert_minutes'), ('package_expiry_reminder_days'), ('wallet_expiry_months'),
  ('package_qr_minutes'), ('vat_enabled'), ('auto_slip_check'),
  ('resource_label');   -- the sport label (court, table or lane) a template sets (PLAT-05-AC10)

alter table public.club_setting add constraint club_setting_key_fk foreign key (key) references app.setting_keys (setting_key);
alter table public.club_setting add constraint club_setting_hold_minutes
  check (key <> 'hold_minutes' or value in ('10'::jsonb, '15'::jsonb, '20'::jsonb));
