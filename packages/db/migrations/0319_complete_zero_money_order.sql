-- F04-T12d-db / migration 0319: the zero money path of Pay (PAY-07-AC1 to AC6, decision D64). F04 design 5.1.
-- An order whose money due is 0 (paid in full by credit, wallet, a code or a free hour) takes no Beam charge. Its hours are
-- already confirmed by reserve_court (app.order_needs_payment is false), so what is left is to mark the order paid, issue the
-- receipt and tell the player, in the Pay transaction.
--   app.complete_zero_money_order(order) returns uuid, the receipt id. The caller's own order, or owner and front desk for
--   the club's. The order must be open, priced, money_satang = 0, have lines, and every booking confirmed; otherwise an
--   'order: ...' message. It sets the order paid, calls the issue_receipt port (order, no payment, kind 'order': the same
--   numbered series, credit and wallet as the methods, the test series for a Testing club) and, when the order has hours, the
--   enqueue_message port with the arguments apply_payment uses. A second call on the paid order returns the same receipt id
--   (kept on the order in zero_money_receipt_id, because the F13 receipt table does not exist yet).
-- Granted to booq_app. Fails closed when a port is not registered (payment:port_missing:<port>).

alter table public.orders add column zero_money_receipt_id uuid;

create function app.complete_zero_money_order(p_order uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  o public.orders%rowtype;
  v_receipt uuid;
  v_has_bookings boolean;
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
  if exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order and b.status <> 'confirmed') then
    raise exception 'order: a booking of the order is not confirmed' using errcode = 'P0001';
  end if;
  update public.orders set status = 'paid' where club_id = v_club and id = p_order;
  execute format('select %s($1, $2, $3)', app.port_of('issue_receipt')) into v_receipt using p_order, null::uuid, 'order';
  update public.orders set zero_money_receipt_id = v_receipt where club_id = v_club and id = p_order;
  if v_has_bookings then
    execute format('select %s($1, $2, $3, $4, $5)', app.port_of('enqueue_message'))
      using 'booking_confirmed', o.customer_id, jsonb_build_object('order_id', p_order), 'confirmed:' || p_order::text, app.now();
  end if;
  return v_receipt;
end $$;
alter function app.complete_zero_money_order(uuid) owner to booq_owner;
revoke all on function app.complete_zero_money_order(uuid) from public;
grant execute on function app.complete_zero_money_order(uuid) to booq_app;
