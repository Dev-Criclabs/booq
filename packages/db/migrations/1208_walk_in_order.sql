-- F04 / lane 2 A2 (D168): the desk sells to a walk in with no customer record. app.create_priced_walk_in_order(priced) is
-- app.create_priced_order (0318) for an order whose customer_id stays null ("null only for a staff walk-in without a customer record", 0201).
-- Owner and front desk only; source is 'staff'. There is no customer to lock, so the customer lock of FA 3.4 is not taken; the order locks
-- that follow (the court, the coach) are the claim's own. A new function rather than a change to create_priced_order, whose null customer
-- means the caller. Same checks, same columns, same frozen amounts.
create function app.create_priced_walk_in_order(p_priced jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_id uuid;
begin
  if v_club is null then
    raise exception 'create_priced_walk_in_order needs a club in the context' using errcode = 'P0001';
  end if;
  if app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'order: not allowed' using errcode = '42501';
  end if;
  if p_priced is null or jsonb_typeof(p_priced) <> 'object' or jsonb_typeof(p_priced -> 'price_group_snapshot') <> 'object' then
    raise exception 'order: invalid priced order' using errcode = 'P0001';
  end if;
  begin
    insert into public.orders (club_id, customer_id, source, status, price_group_snapshot, subtotal_satang, discount_satang, total_satang,
                               credit_value_satang, wallet_satang, money_satang, promo_code_id, birthday_entitlement, quote_hash, priced_at)
    values (v_club, null, 'staff', 'open', p_priced -> 'price_group_snapshot',
            (p_priced ->> 'subtotal_satang')::integer, (p_priced ->> 'discount_satang')::integer, (p_priced ->> 'total_satang')::integer,
            (p_priced ->> 'credit_value_satang')::integer, (p_priced ->> 'wallet_satang')::integer, (p_priced ->> 'money_satang')::integer,
            null, false, p_priced ->> 'quote_hash', app.now())
    returning id into v_id;
  exception
    when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or foreign_key_violation then
      raise exception 'order: invalid priced order (%)', sqlerrm using errcode = 'P0001';
  end;
  return v_id;
end $$;
alter function app.create_priced_walk_in_order(jsonb) owner to booq_owner;
revoke all on function app.create_priced_walk_in_order(jsonb) from public;
grant execute on function app.create_priced_walk_in_order(jsonb) to booq_app;
