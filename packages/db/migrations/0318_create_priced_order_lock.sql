-- F04-T12b-db / migration 0318: app.create_priced_order takes the customer lock first (FA 3.4 lock order).
-- Redefines the function of 0317 (rule D159). Pay locked the promo row before the customer because app.lock_customer is
-- not granted to booq_app and reserve_court takes it later; paths that lock the customer first and the promo row second
-- could then deadlock with Pay. The function is the first thing Pay calls in its transaction, so locking here puts the
-- customer first for every caller. Nothing else changes.

create or replace function app.create_priced_order(p_customer uuid, p_priced jsonb) returns uuid
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
  -- Lock order of FA 3.4: the customer first, before anything Pay locks after it (wallet, packages, promo row, claim).
  -- app.reserve_court takes the same advisory lock later in the transaction, which is harmless (advisory locks are re-entrant).
  perform app.lock_customer(v_customer);
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
