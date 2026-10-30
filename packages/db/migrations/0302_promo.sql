-- F04-T02 / migration 0302: partners, promo codes, redemptions and birthday entitlements (class D).
-- F04 design 3.2 and 4.4. Requirements: PROMO-01-AC1, AC7, R5-AC3; decisions D65 to D70.
-- Codes are matched by (club_id, code_upper), so a code of another club looks exactly like a code
-- that does not exist. A redemption is counted at Pay and restored (the row stays, no longer
-- counting) when the hold ends or a cancellation of 12 hours or more is made (D66, D70).

create table public.partner (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  type text,
  contact text,
  primary key (club_id, id)
);

create table public.promo_code (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  code_upper text not null,
  kind text not null,
  value integer not null,                     -- basis points for 'percent', satang for 'fixed'
  applies_to text[] not null,
  includes_add_ons boolean not null default false,
  audience text not null default 'any',
  starts_on date,
  ends_on date,
  first_time_only boolean not null default false,
  total_cap integer,
  per_customer_cap integer,
  min_spend_satang integer,
  stackable_with_birthday boolean not null default false,
  partner_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, partner_id) references public.partner (club_id, id),
  constraint promo_code_unique unique (club_id, code_upper),
  constraint promo_code_upper check (code_upper ~ '^[A-Z0-9][A-Z0-9_-]*$'),
  constraint promo_code_kind_values check (kind in ('percent', 'fixed')),
  constraint promo_code_value check ((kind = 'percent' and value between 1 and 10000) or (kind = 'fixed' and value > 0)),
  constraint promo_code_audience_values check (audience in ('adult', 'student', 'any')),
  constraint promo_code_applies_to check (
    cardinality(applies_to) > 0
    and applies_to <@ array['court_hour', 'coach', 'add_on', 'package', 'solo_class', 'group_class']),
  constraint promo_code_dates check (starts_on is null or ends_on is null or ends_on >= starts_on),
  constraint promo_code_caps check ((total_cap is null or total_cap > 0) and (per_customer_cap is null or per_customer_cap > 0)),
  constraint promo_code_min_spend check (min_spend_satang is null or min_spend_satang >= 0)
);

create table public.promo_redemption (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  code_id uuid not null,
  order_id uuid not null,
  customer_id uuid,
  status text not null default 'counted',
  counted_at timestamptz not null default app.now(),
  restored_at timestamptz,
  restore_reason text,
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, code_id) references public.promo_code (club_id, id),
  foreign key (club_id, order_id) references public.orders (club_id, id),
  constraint promo_redemption_one_per_order unique (club_id, order_id),    -- one code per order (PROMO-01-AC1)
  constraint promo_redemption_status_values check (status in ('counted', 'restored')),
  constraint promo_redemption_restored_together check ((status = 'restored') = (restored_at is not null and restore_reason is not null))
);
create index promo_redemption_code on public.promo_redemption (club_id, code_id, status);
create index promo_redemption_customer on public.promo_redemption (club_id, customer_id, code_id, status);

create table public.birthday_entitlement_use (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  year integer not null check (year between 2000 and 2200),
  kind text not null,
  order_id uuid not null,
  status text not null default 'used',
  used_at timestamptz not null default app.now(),
  restored_at timestamptz,
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, order_id) references public.orders (club_id, id),
  foreign key (club_id, customer_id) references public.app_user (club_id, id),
  constraint birthday_use_kind_values check (kind in ('package', 'solo_class')),
  constraint birthday_use_status_values check (status in ('used', 'restored')),
  constraint birthday_use_restored_together check ((status = 'restored') = (restored_at is not null))
);
-- Once per kind per calendar year while used; a restored row frees the entitlement (R5-AC3, AC5).
create unique index birthday_use_once on public.birthday_entitlement_use (club_id, customer_id, year, kind) where status = 'used';

do $$
declare t text;
begin
  foreach t in array array['partner', 'promo_code', 'promo_redemption', 'birthday_entitlement_use'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
  end loop;
end $$;

-- Staff set up partners and codes (owner writes, front desk reads to take bookings); the quote
-- looks a code up through the definer functions of F04-T04, so a player never reads this table.
create policy partner_owner on public.partner for all to booq_app using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
create policy partner_read on public.partner for select to booq_app using (app.has_any_role('front_desk', 'accountant'));
create policy promo_code_owner on public.promo_code for all to booq_app using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
create policy promo_code_read on public.promo_code for select to booq_app using (app.has_any_role('front_desk', 'accountant'));
create policy promo_redemption_read on public.promo_redemption for select to booq_app using (app.has_any_role('owner', 'front_desk', 'accountant'));
create policy birthday_use_read on public.birthday_entitlement_use for select to booq_app using (app.has_any_role('owner', 'front_desk', 'accountant') or customer_id = app.user_id());
grant select, insert, update, delete on public.partner, public.promo_code to booq_app;
grant select on public.promo_redemption, public.birthday_entitlement_use to booq_app;
grant select on public.promo_code, public.promo_redemption, public.birthday_entitlement_use to booq_worker;
create policy promo_code_worker on public.promo_code for select to booq_worker using (true);
create policy promo_redemption_worker on public.promo_redemption for select to booq_worker using (true);
create policy birthday_use_worker on public.birthday_entitlement_use for select to booq_worker using (true);

-- Test data and audit. Redemptions and entitlement uses made in Testing are test rows; they point at
-- orders (purge order 300), so they go first.
select app.register_test_table('public.promo_redemption', 250);
select app.register_test_table('public.birthday_entitlement_use', 250);
select audit.register('public.partner', array['id'], 'club_id', array['contact']);
select audit.register('public.promo_code', array['id']);
select audit.register('public.promo_redemption', array['id']);
select audit.register('public.birthday_entitlement_use', array['id']);
