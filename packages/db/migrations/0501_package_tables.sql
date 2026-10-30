-- F06-T01 / migration 0501: package_product, customer_package, package_extension, wallet_account.
-- F06 design 3.1 and 3.2; FA 2.3. Requirements: PKG-02-AC1, AC4, CC-1.
--
-- package_product is setup data (class S; F04 lists it but no F04 migration creates it). Prices are
-- integer satang; a null price means "not set" and the product is not offered (PKG-02-AC7). Nothing
-- here invents a product or a price: Hunter's arrive as template data.
-- customer_package keeps a snapshot of the product at purchase, so a later edit of the product
-- never changes a package already sold (PKG-02-AC4). Status is derived, never stored (design 3.3).
-- wallet_account is a lock anchor only: there is no balance column anywhere (FA 2.3).
-- Read policies and grants for the app roles are F06-T11 (0513); until then the tenant policy alone
-- applies and only the definer functions of 0505 to 0511 write.

create table public.package_product (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  name_th text not null check (btrim(name_th) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  credit_type text not null,
  credits integer not null check (credits > 0),
  validity_months integer not null check (validity_months > 0),
  price_group_id uuid,
  coach_tier_id uuid,
  price_satang integer check (price_satang is null or price_satang >= 0),   -- null: not set, not offered
  active boolean not null default true,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, price_group_id) references public.price_group (club_id, id),
  foreign key (club_id, coach_tier_id) references public.coach_tier (club_id, id),
  constraint package_product_credit_type_values check (credit_type in ('court_hour', 'solo_class', 'group_session')),
  -- A solo pack is for one coach tier; solo and group packs come in Student and Adult versions.
  constraint package_product_tier check ((credit_type = 'solo_class') = (coach_tier_id is not null)),
  constraint package_product_price_group check (credit_type = 'court_hour' or price_group_id is not null)
);

-- A package line names a product of the order's own club.
alter table public.order_line
  add constraint order_line_package_product foreign key (club_id, package_product_id) references public.package_product (club_id, id);

create table public.customer_package (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  product_id uuid not null,
  product_snapshot jsonb not null,               -- credit type, tier, price group, validity months, price paid
  credits_total integer not null check (credits_total > 0),
  purchased_at timestamptz not null default app.now(),
  purchase_date date not null,                   -- the Bangkok date of purchased_at, set at insert
  expires_at timestamptz not null,               -- changed only by extend_package and extend_for_pause (0508)
  order_id uuid,                                 -- null for an imported package and a claim transfer (design 4.8)
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, customer_id) references public.app_user (club_id, id),
  foreign key (club_id, product_id) references public.package_product (club_id, id),
  foreign key (club_id, order_id) references public.orders (club_id, id),
  constraint customer_package_snapshot_shape check (jsonb_typeof(product_snapshot) = 'object'),
  constraint customer_package_expiry_after_purchase check (expires_at > purchased_at),
  -- A repeated payment callback cannot grant twice.
  constraint customer_package_once_per_order unique (club_id, order_id, product_id)
);
create index customer_package_by_customer on public.customer_package (club_id, customer_id, expires_at);
create index customer_package_by_expiry on public.customer_package (club_id, expires_at);

-- purchase_date is the Bangkok date of the purchase (PKG-02-AC2), never the UTC date.
create function app.set_package_purchase_date() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  new.purchase_date := (new.purchased_at at time zone 'Asia/Bangkok')::date;
  return new;
end $$;
alter function app.set_package_purchase_date() owner to booq_owner;
revoke all on function app.set_package_purchase_date() from public;
create trigger customer_package_purchase_date before insert on public.customer_package
  for each row execute function app.set_package_purchase_date();

-- Only expires_at may change after insert; credits_total and the snapshot never do (PKG-02-AC4, FA 2.3).
create function app.keep_customer_package() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if (to_jsonb(new) - 'expires_at') <> (to_jsonb(old) - 'expires_at') then
    raise exception 'a customer package changes only its expiry' using errcode = 'P0001';
  end if;
  return new;
end $$;
alter function app.keep_customer_package() owner to booq_owner;
revoke all on function app.keep_customer_package() from public;
create trigger customer_package_keep before update on public.customer_package
  for each row execute function app.keep_customer_package();
create trigger customer_package_no_delete before delete on public.customer_package
  for each row execute function app.refuse_change();
create trigger customer_package_no_truncate before truncate on public.customer_package
  for each statement execute function app.refuse_change();

create table public.package_extension (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  package_id uuid not null,
  kind text not null,
  old_expires_at timestamptz not null,
  new_expires_at timestamptz not null,
  reason text,
  staff_id uuid,
  pause_id uuid,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, package_id) references public.customer_package (club_id, id),
  foreign key (club_id, staff_id) references public.app_user (club_id, id),
  foreign key (club_id, pause_id) references public.club_pause (club_id, id),
  constraint package_extension_kind_values check (kind in ('owner', 'pause')),
  constraint package_extension_later check (new_expires_at > old_expires_at),
  -- An owner extension names the staff member and a reason (PKG-03-AC5); a pause names its pause (D90).
  constraint package_extension_owner_shape check (kind <> 'owner' or (
    staff_id is not null and pause_id is null and nullif(btrim(coalesce(reason, '')), '') is not null)),
  constraint package_extension_pause_shape check (kind <> 'pause' or (pause_id is not null and staff_id is null))
);
create index package_extension_by_package on public.package_extension (club_id, package_id, created_at);
create trigger package_extension_append_only before update or delete on public.package_extension
  for each row execute function app.refuse_change();
create trigger package_extension_no_truncate before truncate on public.package_extension
  for each statement execute function app.refuse_change();

create table public.wallet_account (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, customer_id) references public.app_user (club_id, id),
  constraint wallet_account_one_per_customer unique (club_id, customer_id)
);
create trigger wallet_account_append_only before update or delete on public.wallet_account
  for each row execute function app.refuse_change();
create trigger wallet_account_no_truncate before truncate on public.wallet_account
  for each statement execute function app.refuse_change();

do $$
declare t text;
begin
  foreach t in array array['package_product', 'customer_package', 'package_extension', 'wallet_account'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
  end loop;
end $$;

-- Purge order (children first): order_line 150 and booking 200 go before; payment 260 and orders 300
-- after the packages. The F06 ledgers (0502) reference bookings too and take numbers below 200.
select app.register_test_table('public.package_extension', 265);
select app.register_test_table('public.customer_package', 270);
select app.register_test_table('public.wallet_account', 280);

select audit.register('public.package_product', array['id']);
select audit.register('public.customer_package', array['id']);
select audit.register('public.package_extension', array['id']);
