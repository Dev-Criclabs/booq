-- F06-T03b / migration 0504: orders.kind and the order line kind wallet_credit (PKG-01-AC4; D37, D74, D79).
-- Money that arrives and cannot confirm anything (a late payment, a duplicate, a wrong amount) becomes wallet value, and
-- the receipt for it (RCPT-02-AC11) needs an order to attach to. That order has kind wallet_credit and one line of kind
-- wallet_credit for the amount credited: no credit part, no wallet part, no discount, and no booking, add-on or
-- package (the credit is not a sale). Every other order is a sale; an order's kind never changes. The sum check of
-- 0303 applies unchanged: the line equals the order, and money equals the amount credited.
-- Redefines the kind CHECK of order_line, which 0303 defines (numbered above it, D159); F04-T22a (0516) redefines it
-- again on top of this one.
alter table public.orders add column kind text not null default 'sale';
alter table public.orders add constraint orders_kind_values check (kind in ('sale', 'wallet_credit'));
alter table public.orders add constraint orders_wallet_credit_shape check (
  kind <> 'wallet_credit'
  or priced_at is null
  or (credit_value_satang = 0 and wallet_satang = 0 and discount_satang = 0 and money_satang = total_satang and total_satang > 0));

create function app.keep_order_kind() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'the kind of an order never changes' using errcode = 'P0001';
  end if;
  return new;
end $$;
alter function app.keep_order_kind() owner to booq_owner;
revoke all on function app.keep_order_kind() from public;
create trigger orders_keep_kind before update on public.orders for each row execute function app.keep_order_kind();

alter table public.order_line drop constraint order_line_kind_values;
alter table public.order_line add constraint order_line_kind_values check (kind in ('court_hour', 'coach', 'add_on', 'package', 'wallet_credit'));
alter table public.order_line add constraint order_line_wallet_credit_shape check (
  kind <> 'wallet_credit'
  or (credit_units = 0 and credit_value_satang = 0 and wallet_satang = 0 and discount_satang = 0 and money_satang = net_satang
      and booking_id is null and add_on_id is null and package_product_id is null));

-- At commit: a wallet_credit order has exactly one line and it is a wallet_credit line; a wallet_credit line is only on
-- a wallet_credit order. SECURITY DEFINER so it reads the lines whatever policy the writer has.
create function app.check_order_kind_lines() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'club_id')::uuid;
  v_order uuid := (coalesce(to_jsonb(new), to_jsonb(old)) ->> case when tg_table_name = 'orders' then 'id' else 'order_id' end)::uuid;
  v_kind text;
  v_lines integer;
  v_credit_lines integer;
begin
  select o.kind into v_kind from public.orders o where o.club_id = v_club and o.id = v_order;
  if v_kind is null then
    return null;
  end if;
  select count(*), count(*) filter (where l.kind = 'wallet_credit')
    into v_lines, v_credit_lines from public.order_line l where l.club_id = v_club and l.order_id = v_order;
  if v_kind = 'wallet_credit' and v_lines > 0 and (v_lines <> 1 or v_credit_lines <> 1) then
    raise exception 'order %: a wallet_credit order has exactly one line and it is a wallet_credit line', v_order using errcode = 'P0001';
  end if;
  if v_kind <> 'wallet_credit' and v_credit_lines > 0 then
    raise exception 'order %: a wallet_credit line is only on a wallet_credit order', v_order using errcode = 'P0001';
  end if;
  return null;
end $$;
alter function app.check_order_kind_lines() owner to booq_owner;
revoke all on function app.check_order_kind_lines() from public;
create constraint trigger order_kind_lines_on_order after insert or update on public.orders
  deferrable initially deferred for each row execute function app.check_order_kind_lines();
create constraint trigger order_kind_lines_on_line after insert on public.order_line
  deferrable initially deferred for each row execute function app.check_order_kind_lines();
