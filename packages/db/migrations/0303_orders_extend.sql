-- F04-T03 / migration 0303: the frozen price on orders, and order_line. F04 design 3.2 and 4.3.
-- Requirements: R4-AC4, R7-AC1, AC2; decisions D23, D40, D111.
--
-- The order shell (F03-T01) is created with the hold; Pay then prices it. Until priced_at is set
-- every amount is null and the order needs payment (never treated as free). Once priced the
-- amounts never change (R4-AC9). The sum invariant is checked at commit, so the lines and the
-- order columns can be written in any order inside the Pay transaction.

alter table public.orders
  add column price_group_snapshot jsonb,         -- {id, name_th, name_en} as at Pay
  add column subtotal_satang integer,
  add column discount_satang integer,
  add column total_satang integer,              -- after discounts
  add column credit_value_satang integer,
  add column wallet_satang integer,
  add column money_satang integer,               -- the amount due
  add column promo_code_id uuid,
  add column birthday_entitlement boolean,
  add column quote_hash text,
  add column priced_at timestamptz,
  add foreign key (club_id, promo_code_id) references public.promo_code (club_id, id),
  add constraint orders_priced_together check (
    (priced_at is null) = (subtotal_satang is null and discount_satang is null and total_satang is null
                           and credit_value_satang is null and wallet_satang is null and money_satang is null
                           and quote_hash is null and price_group_snapshot is null)
  ),
  add constraint orders_amounts_not_negative check (
    coalesce(subtotal_satang, 0) >= 0 and coalesce(discount_satang, 0) >= 0 and coalesce(total_satang, 0) >= 0
    and coalesce(credit_value_satang, 0) >= 0 and coalesce(wallet_satang, 0) >= 0 and coalesce(money_satang, 0) >= 0),
  add constraint orders_total_is_subtotal_less_discount check (priced_at is null or total_satang = subtotal_satang - discount_satang),
  add constraint orders_total_is_split check (priced_at is null or total_satang = credit_value_satang + wallet_satang + money_satang),
  add constraint orders_quote_hash_shape check (quote_hash is null or quote_hash ~ '^[0-9a-f]{64}$');

create table public.order_line (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  position integer not null check (position > 0),
  kind text not null,
  booking_id uuid,
  add_on_id uuid,
  package_product_id uuid,                       -- plain uuid until F06 creates the product table
  description_key text not null check (description_key <> ''),
  name_th text not null check (btrim(name_th) <> ''),     -- copied in at Pay so a later rename never changes a held or paid order (R7-AC2)
  name_en text not null check (btrim(name_en) <> ''),
  unit_price_satang integer not null check (unit_price_satang >= 0),
  discount_satang integer not null default 0 check (discount_satang >= 0),
  net_satang integer not null check (net_satang >= 0),
  credit_package_id uuid,                        -- plain uuid until F06
  credit_units integer not null default 0 check (credit_units >= 0),
  credit_value_satang integer not null default 0 check (credit_value_satang >= 0),
  wallet_satang integer not null default 0 check (wallet_satang >= 0),
  money_satang integer not null default 0 check (money_satang >= 0),
  scope jsonb not null default '{}',
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, order_id) references public.orders (club_id, id),
  foreign key (club_id, booking_id) references public.booking (club_id, id),
  foreign key (club_id, add_on_id) references public.add_on (club_id, id),
  constraint order_line_position unique (club_id, order_id, position),
  constraint order_line_kind_values check (kind in ('court_hour', 'coach', 'add_on', 'package')),
  constraint order_line_discount_within_price check (discount_satang <= unit_price_satang),
  constraint order_line_net check (net_satang = unit_price_satang - discount_satang),
  constraint order_line_split check (net_satang = credit_value_satang + wallet_satang + money_satang),
  -- A court hour or coach line links its booking so F09 can return value hour by hour (D21, D40); an
  -- add-on links the booking of the first hour of its order (D111).
  constraint order_line_booking_link check (kind not in ('court_hour', 'coach', 'add_on') or booking_id is not null),
  constraint order_line_add_on_link check ((kind = 'add_on') = (add_on_id is not null)),
  constraint order_line_package_link check ((kind = 'package') = (package_product_id is not null))
);
create index order_line_by_order on public.order_line (club_id, order_id, position);
create index order_line_by_booking on public.order_line (club_id, booking_id) where booking_id is not null;

-- Lines are written once by Pay and never changed; the frozen amounts of a priced order likewise.
create trigger order_line_append_only before update or delete on public.order_line
  for each row execute function app.refuse_change();
create trigger order_line_no_truncate before truncate on public.order_line
  for each statement execute function app.refuse_change();

create function app.keep_priced_order() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if old.priced_at is not null and (
       new.price_group_snapshot is distinct from old.price_group_snapshot or new.subtotal_satang is distinct from old.subtotal_satang
    or new.discount_satang is distinct from old.discount_satang or new.total_satang is distinct from old.total_satang
    or new.credit_value_satang is distinct from old.credit_value_satang or new.wallet_satang is distinct from old.wallet_satang
    or new.money_satang is distinct from old.money_satang or new.promo_code_id is distinct from old.promo_code_id
    or new.birthday_entitlement is distinct from old.birthday_entitlement or new.quote_hash is distinct from old.quote_hash
    or new.priced_at is distinct from old.priced_at) then
    raise exception 'a priced order does not change' using errcode = 'P0001';
  end if;
  return new;
end $$;
alter function app.keep_priced_order() owner to booq_owner;
revoke all on function app.keep_priced_order() from public;
create trigger orders_keep_priced before update on public.orders for each row execute function app.keep_priced_order();

-- At commit, a priced order's amounts equal the sums over its lines (R4-AC4). SECURITY DEFINER to
-- read the lines whatever policy the writer has.
create function app.check_order_lines() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'club_id')::uuid;
  v_order uuid := (coalesce(to_jsonb(new), to_jsonb(old)) ->> case when tg_table_name = 'orders' then 'id' else 'order_id' end)::uuid;
  o public.orders%rowtype;
  s record;
begin
  select * into o from public.orders where club_id = v_club and id = v_order;
  if not found or o.priced_at is null then
    return null;
  end if;
  select coalesce(sum(unit_price_satang), 0) as sub, coalesce(sum(discount_satang), 0) as disc, coalesce(sum(net_satang), 0) as net,
         coalesce(sum(credit_value_satang), 0) as credit, coalesce(sum(wallet_satang), 0) as wallet, coalesce(sum(money_satang), 0) as money,
         count(*) as n
    into s from public.order_line where club_id = v_club and order_id = v_order;
  if s.n = 0 or s.sub <> o.subtotal_satang or s.disc <> o.discount_satang or s.net <> o.total_satang
     or s.credit <> o.credit_value_satang or s.wallet <> o.wallet_satang or s.money <> o.money_satang then
    raise exception 'order % lines do not add up to its amounts', v_order using errcode = 'P0001';
  end if;
  return null;
end $$;
alter function app.check_order_lines() owner to booq_owner;
revoke all on function app.check_order_lines() from public;
create constraint trigger orders_lines_add_up after insert or update on public.orders
  deferrable initially deferred for each row execute function app.check_order_lines();
create constraint trigger order_line_adds_up after insert on public.order_line
  deferrable initially deferred for each row execute function app.check_order_lines();

alter table public.order_line owner to booq_owner;
alter table public.order_line enable row level security;
alter table public.order_line force row level security;
revoke all on public.order_line from public;
create policy order_line_tenant on public.order_line as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy order_line_definer on public.order_line for all to booq_owner using (true) with check (true);
-- Reads follow the order: staff roles read the club's, a player their own order's lines.
create policy order_line_staff_read on public.order_line for select to booq_app using (app.has_any_role('owner', 'front_desk', 'accountant'));
create policy order_line_own_read on public.order_line for select to booq_app
  using (exists (select 1 from public.orders o where o.club_id = order_line.club_id and o.id = order_line.order_id and o.customer_id = app.user_id()));
create policy order_line_worker_read on public.order_line for select to booq_worker using (true);
grant select on public.order_line to booq_app, booq_worker;

-- Lines go before the bookings and orders they point at (purge order 150: occupancy 100, booking 200, orders 300).
select app.register_test_table('public.order_line', 150);
select audit.register('public.order_line', array['id']);
