-- F09-T04 / migration 1004: app.cancel_outcome(booking, by_staff, club_cancel). F09 design 4.1.
-- Requirements: CANCEL-01-AC1 to AC10, AC11, AC15, AC18, AC20, AC23; decisions D21, D67, D85, D111, D158.
--
-- The one place the cancel rule lives: the cancel sheet (AC1) and app.cancel_booking (F09-T06b) ask this function, so
-- they always agree, and the client never sends an outcome. Read only.
--   * full, whatever the time: a staff club cancel (AC20; a closure cancels as a club cancel, CANCEL-03-AC2), a solo
--     class whose coach the club changed (F07 app.coach_was_changed, AC18), a seat in a group session the owner edited
--     (F08 class_session.edited).
--   * otherwise in_time when start_at - now() >= cancel_window_hours (seconds count: 12:00:00 is in time, 11:59:59 is
--     late, AC2; 0 hours is in time until the start), else late. The window is the club's setting; unset refuses
--     (cancel:window_unset), no default. A staff cancel that is not a club cancel follows the same window (AC20).
--   * refused: a booking that has started, for everyone (cancel:started, AC15; staff mark after the slot instead);
--     a booking that is not confirmed (cancel:not_confirmed; a hold is released, AC16); another player's booking or
--     another club's (cancel:not_found); a staff or club cancel asked by someone who is not front desk or owner
--     (cancel:forbidden).
--   * per order line of the booking (court hour, coach, and the add-ons of the first hour, D111), the stored
--     allocation, never a recomputation: in time or full, credit units back to their package, the wallet part back to
--     the wallet, the money part into the wallet (refund, AC4). Late: nothing returns and `forfeit` totals the credit,
--     wallet and money parts (the wallet part too, D158).
--   * creditLost: credit units whose package has expired, on an in time cancel that is not a club cancel (D85,
--     AC11); app.credit_return makes the same decision. A full outcome never loses a credit (CANCEL-03-AC12).
--   * codeRestore: the promo code use or birthday entitlement comes back when value returns and this is the last live
--     hour of the order (D67, AC8).
-- Result: {outcome, windowHours, returned, forfeited, lines: [{line, kind, credits, walletSatang, moneyToWalletSatang}],
-- forfeit: {credits, walletSatang, moneySatang}, creditLost, codeRestore}. Numbers only, no text (CC-5).
-- Errors are raised as 'cancel:<code>' with SQLSTATE P0001, like F04's promo and F06's credit errors.

create function app.cancel_outcome(p_booking uuid, p_by_staff boolean default false, p_club_cancel boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_now timestamptz := app.now();
  v_staff boolean := app.has_any_role('owner', 'front_desk');
  b public.booking%rowtype;
  o public.orders%rowtype;
  v_window_text text;
  v_window integer;
  v_full boolean;
  v_outcome text;
  v_returned boolean;
  l record;
  v_lost integer;
  v_lines jsonb := '[]'::jsonb;
  v_lost_total integer := 0;
  v_forfeit_credits integer := 0;
  v_forfeit_wallet integer := 0;
  v_forfeit_money integer := 0;
  v_code_restore boolean;
begin
  if v_club is null then
    raise exception 'cancel:not_found' using errcode = 'P0001';
  end if;
  if (coalesce(p_by_staff, false) or coalesce(p_club_cancel, false)) and not v_staff then
    raise exception 'cancel:forbidden' using errcode = 'P0001';
  end if;
  select * into b from public.booking where club_id = v_club and id = p_booking;
  if not found or (not v_staff and (v_user is null or b.customer_id is distinct from v_user)) then
    raise exception 'cancel:not_found' using errcode = 'P0001';
  end if;
  if b.status <> 'confirmed' then
    raise exception 'cancel:not_confirmed' using errcode = 'P0001';
  end if;
  if b.start_at <= v_now then
    raise exception 'cancel:started' using errcode = 'P0001';
  end if;

  v_full := coalesce(p_club_cancel, false)
            or (b.type = 'solo_class' and app.coach_was_changed(b.id))
            or (b.type = 'class_seat' and exists (select 1 from public.class_session s
                                                   where s.club_id = v_club and s.id = b.class_session_id and s.edited));
  v_window_text := app.club_setting_text('cancel_window_hours');
  if v_window_text is not null and v_window_text <> '' then
    v_window := v_window_text::integer;
  end if;
  if v_full then
    v_outcome := 'full';
  elsif v_window is null then
    raise exception 'cancel:window_unset' using errcode = 'P0001';
  elsif b.start_at - v_now >= make_interval(hours => v_window) then
    v_outcome := 'in_time';
  else
    v_outcome := 'late';
  end if;
  v_returned := v_outcome <> 'late';

  for l in select ol.id, ol.kind, ol.credit_units, ol.wallet_satang, ol.money_satang,
                  (ol.credit_package_id is not null and exists (
                     select 1 from public.customer_package cp
                      where cp.club_id = v_club and cp.id = ol.credit_package_id and cp.expires_at <= v_now)) as expired
             from public.order_line ol
            where ol.club_id = v_club and ol.booking_id = b.id
            order by ol.position loop
    v_lost := case when v_outcome = 'in_time' and l.expired then l.credit_units else 0 end;
    v_lost_total := v_lost_total + v_lost;
    if not v_returned then
      v_forfeit_credits := v_forfeit_credits + l.credit_units;
      v_forfeit_wallet := v_forfeit_wallet + l.wallet_satang;
      v_forfeit_money := v_forfeit_money + l.money_satang;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line', l.id,
      'kind', l.kind,
      'credits', case when v_returned then l.credit_units - v_lost else 0 end,
      'walletSatang', case when v_returned then l.wallet_satang else 0 end,
      'moneyToWalletSatang', case when v_returned then l.money_satang else 0 end));
  end loop;

  select * into o from public.orders where club_id = v_club and id = b.order_id;
  v_code_restore := v_returned
    and (o.promo_code_id is not null or coalesce(o.birthday_entitlement, false))
    and not exists (select 1 from public.booking x where x.club_id = v_club and x.order_id = b.order_id and x.id <> b.id
                      and x.status in ('confirmed', 'awaiting_payment'));

  return jsonb_build_object(
    'outcome', v_outcome,
    'windowHours', v_window,
    'returned', v_returned,
    'forfeited', not v_returned,
    'lines', v_lines,
    'forfeit', jsonb_build_object('credits', v_forfeit_credits, 'walletSatang', v_forfeit_wallet, 'moneySatang', v_forfeit_money),
    'creditLost', v_lost_total,
    'codeRestore', v_code_restore);
end $$;
alter function app.cancel_outcome(uuid, boolean, boolean) owner to booq_owner;
revoke all on function app.cancel_outcome(uuid, boolean, boolean) from public;
grant execute on function app.cancel_outcome(uuid, boolean, boolean) to booq_app, booq_worker;
