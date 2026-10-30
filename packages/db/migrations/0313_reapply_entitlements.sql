-- F04-T19 / migration 0313 (the task said 0308; 0308 to 0312 were taken): app.reapply_order_entitlements(order).
-- Requirements: PAY-03-AC7, PROMO-01-AC7; decisions D107, D109. F04 design 4.5; F05 design 5.4.
-- A late payment that reclaims an order (F03 reclaim_order) takes back what the release gave up: the code use and
-- the birthday entitlement. The rows are kept (a restored row is flipped back, not duplicated, because an order
-- has one redemption), under the same locks and rules as the first count (count_promo_use, use_birthday_entitlement):
--   code:     active, within its dates today, under the total and per customer caps, and for a first-booking code
--             the customer has no other confirmed booking.
--   birthday: the customer has not used that kind in the entitlement's year on another order. The birth month is
--             not checked again: the discount was granted when the order was priced and a late payment is days
--             later, not a new entitlement.
-- All or nothing: when either cannot be taken back nothing changes and the reason is returned, so F05 sends the
-- money to the wallet instead (D107). Not callable by the application roles; F05's apply_payment calls it.
-- Result: {ok: true, promo: bool, birthday: bool} (what was flipped back) or {ok: false, reason}.
create function app.reapply_order_entitlements(p_order uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_today date := (app.now() at time zone 'Asia/Bangkok')::date;
  rd public.promo_redemption%rowtype;
  c public.promo_code%rowtype;
  b public.birthday_entitlement_use%rowtype;
  v_promo boolean := false;
  v_birthday boolean := false;
begin
  if v_club is null then
    raise exception 'reapply_order_entitlements needs a club in the context' using errcode = 'P0001';
  end if;

  select * into rd from public.promo_redemption where club_id = v_club and order_id = p_order and status = 'restored' for update;
  if found then
    select * into c from public.promo_code where club_id = v_club and id = rd.code_id for update;
    if not found or not c.active then
      return jsonb_build_object('ok', false, 'reason', 'code_not_valid');
    end if;
    if (c.starts_on is not null and v_today < c.starts_on) or (c.ends_on is not null and v_today > c.ends_on) then
      return jsonb_build_object('ok', false, 'reason', 'code_expired');
    end if;
    if c.total_cap is not null and (select count(*) from public.promo_redemption r
                                     where r.club_id = v_club and r.code_id = c.id and r.status = 'counted') >= c.total_cap then
      return jsonb_build_object('ok', false, 'reason', 'code_used_up');
    end if;
    if c.per_customer_cap is not null and rd.customer_id is not null
       and (select count(*) from public.promo_redemption r
             where r.club_id = v_club and r.code_id = c.id and r.customer_id = rd.customer_id and r.status = 'counted') >= c.per_customer_cap then
      return jsonb_build_object('ok', false, 'reason', 'code_used_up');
    end if;
    if c.first_time_only and rd.customer_id is not null and exists (
         select 1 from public.booking bk
          where bk.club_id = v_club and bk.customer_id = rd.customer_id and bk.order_id <> p_order
            and bk.status in ('confirmed', 'no_show', 'late_cancelled')) then
      return jsonb_build_object('ok', false, 'reason', 'code_first_booking_only');
    end if;
    v_promo := true;
  end if;

  select * into b from public.birthday_entitlement_use where club_id = v_club and order_id = p_order and status = 'restored' for update;
  if found then
    if exists (select 1 from public.birthday_entitlement_use u
                where u.club_id = v_club and u.customer_id = b.customer_id and u.year = b.year and u.kind = b.kind and u.status = 'used') then
      return jsonb_build_object('ok', false, 'reason', 'birthday_already_used');
    end if;
    v_birthday := true;
  end if;

  -- Everything can be taken back: do it.
  if v_promo then
    update public.promo_redemption set status = 'counted', restored_at = null, restore_reason = null where club_id = v_club and id = rd.id;
  end if;
  if v_birthday then
    update public.birthday_entitlement_use set status = 'used', restored_at = null where club_id = v_club and id = b.id;
  end if;
  return jsonb_build_object('ok', true, 'promo', v_promo, 'birthday', v_birthday);
end $$;
alter function app.reapply_order_entitlements(uuid) owner to booq_owner;
revoke all on function app.reapply_order_entitlements(uuid) from public;
