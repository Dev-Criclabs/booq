-- F10 follow-up (orchestrator, 31 Oct; from BE-B, F03 design 4.5, D48) / migration 0616: the booking_released release
-- handler (0605, ord 60) also skips the reason closed. A closure ends the hold and the closure message (club_closed_slot,
-- F09) tells the player; before this, a held player whose hold a closure ended got both. The other reasons are as 0605:
-- payment_unavailable (the checkout says it) and offer_ended (the waitlist offer's own end) are skipped; expired, player
-- and staff are told. Redefined here, above 0605 (D159).
create or replace function app.f10_released(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_customer uuid;
begin
  if p_reason in ('payment_unavailable', 'offer_ended', 'closed') then
    return;
  end if;
  select o.customer_id into v_customer from public.orders o where o.club_id = app.club_id() and o.id = p_order;
  perform app.enqueue_message('booking_released', v_customer, jsonb_build_object('order_id', p_order),
                              'released:' || p_order::text, app.now());
end $$;
