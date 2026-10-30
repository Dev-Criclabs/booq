-- F04-T12b-db / migration 0317: the two writes Pay needs, as SECURITY DEFINER functions (CC-2, SR-07).
-- booq_app has no table privilege on orders or order_line, so Pay (F04-T12b) cannot insert a priced order or its lines
-- itself. The amounts come from the server's quote engine, never from the client; these functions only write them down
-- with the checks that belong to the database, and the CHECKs and the deferred sum trigger of 0303 apply.
--   app.create_priced_order(customer, priced): the club comes from the context. The customer is the caller (app.user_id())
--     when p_customer is null or the caller; owner and front desk may name another active person of the club (staff
--     Pay, F04-T13). source is 'staff' for staff and 'online' for everyone else. One orders row, status open, priced_at
--     = app.now(), the frozen amounts from p_priced {price_group_snapshot {id, name_th, name_en}, subtotal_satang,
--     discount_satang, total_satang, credit_value_satang, wallet_satang, money_satang, promo_code_id,
--     birthday_entitlement, quote_hash}. Pay calls it before reserve_court.
--   app.add_order_lines(order, lines): the caller's own open priced order with no lines yet (staff: any such order of
--     the club). Each booking_id must belong to the order; a line is a court_hour, coach, add_on, package or class_seat
--     line (class_seat is the F08 seat of F04-T22b); a wallet_credit line is written only by the wallet port and is
--     refused here. Called after reserve_court (D111: an add-on line links the first hour's booking).
create function app.create_priced_order(p_customer uuid, p_priced jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_staff boolean := app.has_any_role('owner', 'front_desk');
  v_customer uuid;
  v_id uuid;
begin
  if v_club is null then
    raise exception 'create_priced_order needs a club in the context' using errcode = 'P0001';
  end if;
  if v_user is null then
    raise exception 'order: not allowed' using errcode = '42501';
  end if;
  v_customer := coalesce(p_customer, v_user);
  if v_customer <> v_user then
    if not v_staff then
      raise exception 'order: not allowed' using errcode = '42501';
    end if;
    if not exists (select 1 from public.app_user u where u.club_id = v_club and u.id = v_customer and u.active) then
      raise exception 'order: unknown customer' using errcode = 'P0001';
    end if;
  end if;
  if p_priced is null or jsonb_typeof(p_priced) <> 'object' or jsonb_typeof(p_priced -> 'price_group_snapshot') <> 'object' then
    raise exception 'order: invalid priced order' using errcode = 'P0001';
  end if;
  begin
    insert into public.orders (club_id, customer_id, source, status, price_group_snapshot, subtotal_satang, discount_satang, total_satang,
                               credit_value_satang, wallet_satang, money_satang, promo_code_id, birthday_entitlement, quote_hash, priced_at)
    values (v_club, v_customer, case when v_staff then 'staff' else 'online' end, 'open', p_priced -> 'price_group_snapshot',
            (p_priced ->> 'subtotal_satang')::integer, (p_priced ->> 'discount_satang')::integer, (p_priced ->> 'total_satang')::integer,
            (p_priced ->> 'credit_value_satang')::integer, (p_priced ->> 'wallet_satang')::integer, (p_priced ->> 'money_satang')::integer,
            nullif(p_priced ->> 'promo_code_id', '')::uuid, coalesce((p_priced ->> 'birthday_entitlement')::boolean, false),
            p_priced ->> 'quote_hash', app.now())
    returning id into v_id;
  exception
    when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or foreign_key_violation then
      raise exception 'order: invalid priced order (%)', sqlerrm using errcode = 'P0001';
  end;
  return v_id;
end $$;

create function app.add_order_lines(p_order uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  o public.orders%rowtype;
  l jsonb;
begin
  if v_club is null then
    raise exception 'add_order_lines needs a club in the context' using errcode = 'P0001';
  end if;
  if v_user is null then
    raise exception 'order: not allowed' using errcode = '42501';
  end if;
  select * into o from public.orders where club_id = v_club and id = p_order for update;
  if not found or (o.customer_id is distinct from v_user and not app.has_any_role('owner', 'front_desk')) then
    raise exception 'order: no such order' using errcode = 'P0001';       -- missing and not yours look the same
  end if;
  if o.status <> 'open' or o.priced_at is null or o.kind <> 'sale' then
    raise exception 'order: not an open priced sale' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.order_line x where x.club_id = v_club and x.order_id = p_order) then
    raise exception 'order: the lines are already written' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'order: invalid lines' using errcode = 'P0001';
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l) <> 'object' or l ->> 'kind' not in ('court_hour', 'coach', 'add_on', 'package', 'class_seat') then
      raise exception 'order: invalid line kind' using errcode = 'P0001';
    end if;
    if (l ->> 'booking_id') is not null and not exists (
         select 1 from public.booking b where b.club_id = v_club and b.id = (l ->> 'booking_id')::uuid and b.order_id = p_order) then
      raise exception 'order: a line names a booking of another order' using errcode = 'P0001';
    end if;
    begin
      insert into public.order_line (club_id, order_id, position, kind, booking_id, add_on_id, package_product_id, description_key, name_th, name_en,
                                     unit_price_satang, discount_satang, net_satang, credit_package_id, credit_units, credit_value_satang,
                                     wallet_satang, money_satang, scope)
      values (v_club, p_order, (l ->> 'position')::integer, l ->> 'kind', nullif(l ->> 'booking_id', '')::uuid, nullif(l ->> 'add_on_id', '')::uuid,
              nullif(l ->> 'package_product_id', '')::uuid, l ->> 'description_key', l ->> 'name_th', l ->> 'name_en',
              (l ->> 'unit_price_satang')::integer, coalesce((l ->> 'discount_satang')::integer, 0), (l ->> 'net_satang')::integer,
              nullif(l ->> 'credit_package_id', '')::uuid, coalesce((l ->> 'credit_units')::integer, 0), coalesce((l ->> 'credit_value_satang')::integer, 0),
              coalesce((l ->> 'wallet_satang')::integer, 0), coalesce((l ->> 'money_satang')::integer, 0), coalesce(l -> 'scope', '{}'::jsonb));
    exception
      when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or foreign_key_violation or unique_violation then
        raise exception 'order: invalid line (%)', sqlerrm using errcode = 'P0001';
    end;
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.create_priced_order(uuid, jsonb)', 'app.add_order_lines(uuid, jsonb)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
