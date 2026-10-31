-- F09-T06a / migration 1006: app.cancel_order_effects(booking, kind). F09 design 4.2 step 4.
-- Requirements: CANCEL-01-AC8, AC11, AC12, AC15; decisions D67, D70.
--
-- What a cancel changes on the order, called by app.cancel_booking (F09-T06b) after the booking's status is set:
--   * F04's app.restore_line(line, kind) for each line of the booking. It restores the promo code use and the birthday
--     entitlement only when every booking of the order is cancelled or released (D67), and restores each once (rows
--     move from counted or used to restored). A restored use no longer counts toward the partner's redemptions (D70).
--     A late cancelled hour is not cancelled for this purpose, so a late cancel restores nothing (its value is
--     forfeited, D21).
--   * The order becomes cancelled when every one of its lines belongs to a booking that is cancelled, late cancelled or
--     released. An order with a line that is not a booking (a package bought with it) stays as it is.
-- kind is a cancel kind of booking_cancel: player_cancel, staff_cancel, club_cancel or closure for a cancelled booking,
-- late_cancel_mark for a late cancelled one. Returns {codeRestored, orderCancelled}: what this call changed. Not
-- granted to an app role.

create function app.cancel_order_effects(p_booking uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  v_before integer;
  v_after integer;
  v_cancelled boolean := false;
  l record;
begin
  if p_kind is null or p_kind not in ('player_cancel', 'staff_cancel', 'club_cancel', 'closure', 'late_cancel_mark') then
    raise exception 'cancel:kind' using errcode = 'P0001';
  end if;
  select * into b from public.booking where club_id = v_club and id = p_booking;
  if not found then
    raise exception 'cancel:not_found' using errcode = 'P0001';
  end if;
  if b.status not in ('cancelled', 'late_cancelled') then
    raise exception 'cancel:not_cancelled' using errcode = 'P0001';
  end if;

  select (select count(*) from public.promo_redemption r where r.club_id = v_club and r.order_id = b.order_id and r.status = 'restored')
       + (select count(*) from public.birthday_entitlement_use u where u.club_id = v_club and u.order_id = b.order_id and u.status = 'restored')
    into v_before;
  for l in select ol.id from public.order_line ol where ol.club_id = v_club and ol.booking_id = b.id order by ol.position loop
    perform app.restore_line(l.id, p_kind);
  end loop;
  select (select count(*) from public.promo_redemption r where r.club_id = v_club and r.order_id = b.order_id and r.status = 'restored')
       + (select count(*) from public.birthday_entitlement_use u where u.club_id = v_club and u.order_id = b.order_id and u.status = 'restored')
    into v_after;

  if exists (select 1 from public.order_line ol where ol.club_id = v_club and ol.order_id = b.order_id)
     and not exists (
       select 1 from public.order_line ol
         left join public.booking x on x.club_id = ol.club_id and x.id = ol.booking_id
        where ol.club_id = v_club and ol.order_id = b.order_id
          and (x.id is null or x.status not in ('cancelled', 'late_cancelled', 'released'))) then
    update public.orders set status = 'cancelled' where club_id = v_club and id = b.order_id and status <> 'cancelled';
    v_cancelled := found;
  end if;

  return jsonb_build_object('codeRestored', v_after > v_before, 'orderCancelled', v_cancelled);
end $$;
alter function app.cancel_order_effects(uuid, text) owner to booq_owner;
revoke all on function app.cancel_order_effects(uuid, text) from public;
