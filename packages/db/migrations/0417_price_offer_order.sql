-- F04-T22c / migration 0417: Pay for a waitlist offer (CLASS-02-AC3, AC6, WAIT-01-AC2; F08 design 4.11; FA 3.6). Built by
-- BE-C, approved by the orchestrator on 31 Oct (the task line said no migration; pricing the shell needs one).
-- app.offer_hold (0908) makes the offer as a held booking in an unpriced order shell. Pay takes that hold as the claim
-- instead of reserving again, so it must price the shell, which booq_app cannot write.
--   * app.price_offer_order(order, priced) (new): the caller's own open, unpriced sale order whose only booking is the
--     live offer hold of an offered waitlist entry gets the frozen amounts of the quote (the same fields as
--     app.create_priced_order). The customer lock first (FA 3.4). Returns false, writing nothing, when the order is already
--     priced (a second tap, D47); an offer that has ended raises offer:gone.
--   * app.complete_zero_money_order (0416, redefined, D159): an order whose bookings are all confirmed, as before; and now
--     also the live offer hold of a waitlist entry, confirmed here (booking, occupancy, reminders) when nothing is left to
--     pay. Called last in Pay, after the promo row, so the booking rows and the court lock come after it (FA 3.4). The
--     confirm trigger of 0908 marks the entry claimed. Everything else is 0416's.

create function app.price_offer_order(p_order uuid, p_priced jsonb) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  o public.orders%rowtype;
begin
  if v_club is null or v_user is null then
    raise exception 'order: not allowed' using errcode = '42501';
  end if;
  -- Lock order of FA 3.4: the customer first. Only the player of the offer prices it.
  perform app.lock_customer(v_user);
  select * into o from public.orders where club_id = v_club and id = p_order for update;
  if not found or o.customer_id is distinct from v_user then
    raise exception 'offer:gone' using errcode = 'P0001';                 -- missing and not yours look the same
  end if;
  if o.status = 'open' and o.priced_at is not null then
    return false;                                                         -- a second tap: priced already
  end if;
  if o.status <> 'open' or o.kind <> 'sale'
     or (select count(*) from public.booking b where b.club_id = v_club and b.order_id = p_order) <> 1
     or not exists (
       select 1 from public.booking b join public.waitlist_entry w on w.club_id = b.club_id and w.offer_booking_id = b.id
        where b.club_id = v_club and b.order_id = p_order and b.customer_id = v_user and b.waitlist_entry_id = w.id
          and b.status = 'awaiting_payment' and b.hold_expires_at > app.now() and w.status = 'offered') then
    raise exception 'offer:gone' using errcode = 'P0001';
  end if;
  if p_priced is null or jsonb_typeof(p_priced) <> 'object' or jsonb_typeof(p_priced -> 'price_group_snapshot') <> 'object' then
    raise exception 'order: invalid priced order' using errcode = 'P0001';
  end if;
  begin
    update public.orders
       set price_group_snapshot = p_priced -> 'price_group_snapshot',
           subtotal_satang = (p_priced ->> 'subtotal_satang')::integer, discount_satang = (p_priced ->> 'discount_satang')::integer,
           total_satang = (p_priced ->> 'total_satang')::integer, credit_value_satang = (p_priced ->> 'credit_value_satang')::integer,
           wallet_satang = (p_priced ->> 'wallet_satang')::integer, money_satang = (p_priced ->> 'money_satang')::integer,
           promo_code_id = nullif(p_priced ->> 'promo_code_id', '')::uuid,
           birthday_entitlement = coalesce((p_priced ->> 'birthday_entitlement')::boolean, false),
           quote_hash = p_priced ->> 'quote_hash', priced_at = app.now()
     where club_id = v_club and id = p_order;
  exception
    when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or foreign_key_violation then
      raise exception 'order: invalid priced order (%)', sqlerrm using errcode = 'P0001';
  end;
  return true;
end $$;

create or replace function app.complete_zero_money_order(p_order uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  o public.orders%rowtype;
  v_receipt uuid;
  v_has_bookings boolean;
  v_now timestamptz := app.now();
  v_offer uuid[];
begin
  if v_club is null or app.user_id() is null then
    raise exception 'order: not allowed' using errcode = '42501';
  end if;
  select * into o from public.orders where club_id = v_club and id = p_order for update;
  if not found or not (o.customer_id = app.user_id() or app.has_any_role('owner', 'front_desk')) then
    raise exception 'order: no such order' using errcode = 'P0001';       -- missing and not yours look the same
  end if;
  if o.status = 'paid' and o.zero_money_receipt_id is not null then
    return o.zero_money_receipt_id;                                       -- a second call
  end if;
  if o.status <> 'open' or o.priced_at is null or o.kind <> 'sale' or o.money_satang <> 0 then
    raise exception 'order: not an open priced order with nothing to pay' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.order_line l where l.club_id = v_club and l.order_id = p_order) then
    raise exception 'order: the order has no lines' using errcode = 'P0001';
  end if;
  select exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order) into v_has_bookings;
  -- A waitlist offer's live hold is confirmed here: nothing is left to pay for it (0417).
  select array_agg(id order by id) into v_offer
    from (select b.id from public.booking b join public.waitlist_entry w on w.club_id = b.club_id and w.offer_booking_id = b.id
           where b.club_id = v_club and b.order_id = p_order and b.waitlist_entry_id = w.id and w.status = 'offered'
             and b.status = 'awaiting_payment' and b.hold_expires_at > v_now
           order by b.id for update of b) x;
  if v_offer is not null then
    update public.booking set status = 'confirmed', hold_expires_at = null, confirmed_at = v_now, updated_at = v_now
     where club_id = v_club and id = any (v_offer);
    perform app.lock_resource(x.r) from (select distinct resource_id as r from public.booking
                                           where club_id = v_club and id = any (v_offer)) x order by x.r;
    update public.occupancy set state = 'confirmed', hold_expires_at = null
     where club_id = v_club and booking_id = any (v_offer) and state = 'held';
    perform app.enqueue_booking_reminders(x.id) from unnest(v_offer) x(id) order by x.id;
  end if;
  if exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order and b.status <> 'confirmed') then
    raise exception 'order: a booking of the order is not confirmed' using errcode = 'P0001';
  end if;
  update public.orders set status = 'paid' where club_id = v_club and id = p_order;
  -- A package covered in full (a code or the wallet) is created now, as apply_payment does after a paid charge.
  if exists (select 1 from public.order_line l where l.club_id = v_club and l.order_id = p_order and l.kind = 'package') then
    execute format('select %s($1)', app.port_of('grant_package')) using p_order;
  end if;
  execute format('select %s($1, $2, $3)', app.port_of('issue_receipt')) into v_receipt using p_order, null::uuid, 'order';
  update public.orders set zero_money_receipt_id = v_receipt where club_id = v_club and id = p_order;
  if v_has_bookings then
    execute format('select %s($1, $2, $3, $4, $5)', app.port_of('enqueue_message'))
      using 'booking_confirmed', o.customer_id, jsonb_build_object('order_id', p_order), 'confirmed:' || p_order::text, app.now();
  end if;
  return v_receipt;
end $$;

alter function app.price_offer_order(uuid, jsonb) owner to booq_owner;
revoke all on function app.price_offer_order(uuid, jsonb) from public;
grant execute on function app.price_offer_order(uuid, jsonb) to booq_app;
