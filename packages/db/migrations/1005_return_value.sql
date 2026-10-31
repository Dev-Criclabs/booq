-- F09-T05 / migration 1005: app.return_booking_value(booking, kind). F09 design 4.2 step 3 and 4.4.
-- Requirements: CANCEL-01-AC1 to AC10, CANCEL-02-AC1 to AC6; decisions D21, D85, D111, D158.
--
-- The value of one booking goes back, or is forfeited, through F06's functions only; no ledger row is written here
-- and nothing ever goes back as cash or through Beam (CANCEL-02). Called by app.cancel_booking (F09-T06b) before it
-- sets the status, and by F08's app.cancel_session (kind club_cancel) after the seat is marked cancelled, so it does
-- not read the booking's status. kind is a booking_cancel kind:
--   * returning: player_cancel, staff_cancel, club_cancel, closure. Per line of the booking (court hour, coach, the
--     add-ons of the first hour, D111), from the stored allocation:
--       credit   app.credit_return(booking, reason): player_cancel and staff_cancel as 'player_cancel' (a credit whose
--                package has expired is lost, D85), club_cancel and closure as themselves (always returned).
--       wallet   app.wallet_return_line(line, kind) (0515): the line's own spend, keyed return:{spend}.
--       money    app.wallet_credit(customer, money, 'refund', 'refund:{line}:{version}', order, null, booking): the
--                version is the booking's next booking_cancel version, so a repeat inside one cancel writes nothing
--                and a cancel after a reversal returns again. No customer (a walk in) has no wallet: nothing.
--   * forfeiting: late_cancel_mark, no_show_mark. app.credit_forfeit(booking, staff, note): staff and note are the
--     caller and the request's written reason (app.reason) when the caller is front desk or owner and gave one;
--     otherwise null, the automatic late cancel. The wallet part stays spent and money paid is not returned (D158).
--   * reversal is F09-T07's (credit_reverse_forfeit) and is refused here, as is any other kind (cancel:kind).
-- Returns {credits, creditLost, walletSatang, moneyToWalletSatang, forfeitedCredits}: what this call wrote. Numbers only.
-- Not granted to an app role: the F09 and F08 definer functions call it.

create function app.return_booking_value(p_booking uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  v_version integer;
  v_credit jsonb;
  v_credits integer := 0;
  v_lost integer := 0;
  v_wallet bigint := 0;
  v_money bigint := 0;
  v_forfeited integer := 0;
  v_before bigint;
  v_after bigint;
  v_key text;
  v_note text;
  v_staff uuid;
  l record;
begin
  if p_kind is null or p_kind not in ('player_cancel', 'staff_cancel', 'club_cancel', 'closure', 'late_cancel_mark', 'no_show_mark') then
    raise exception 'cancel:kind' using errcode = 'P0001';
  end if;
  select * into b from public.booking where club_id = v_club and id = p_booking;
  if not found then
    raise exception 'cancel:not_found' using errcode = 'P0001';
  end if;

  if p_kind in ('late_cancel_mark', 'no_show_mark') then
    v_note := nullif(btrim(coalesce(current_setting('app.reason', true), '')), '');
    if v_note is not null and app.has_any_role('owner', 'front_desk') then
      v_staff := app.user_id();
    else
      v_note := null;
    end if;
    v_forfeited := app.credit_forfeit(b.id, v_staff, v_note);
    return jsonb_build_object('credits', 0, 'creditLost', 0, 'walletSatang', 0, 'moneyToWalletSatang', 0, 'forfeitedCredits', v_forfeited);
  end if;

  if exists (select 1 from public.order_line ol where ol.club_id = v_club and ol.booking_id = b.id and ol.credit_units > 0) then
    v_credit := app.credit_return(b.id, case when p_kind in ('player_cancel', 'staff_cancel') then 'player_cancel' else p_kind end);
    v_credits := coalesce((v_credit ->> 'returned')::integer, 0);
    v_lost := coalesce((v_credit ->> 'lost')::integer, 0);
  end if;

  select coalesce(max(c.version), 0) + 1 into v_version from public.booking_cancel c where c.club_id = v_club and c.booking_id = b.id;
  for l in select ol.id, ol.wallet_satang, ol.money_satang from public.order_line ol
            where ol.club_id = v_club and ol.booking_id = b.id order by ol.position loop
    if l.wallet_satang > 0 then
      select coalesce(sum(w.change_satang), 0) into v_before from public.wallet_ledger w
       where w.club_id = v_club and w.order_line_id = l.id and w.reason = 'return';
      perform app.wallet_return_line(l.id, p_kind);
      select coalesce(sum(w.change_satang), 0) into v_after from public.wallet_ledger w
       where w.club_id = v_club and w.order_line_id = l.id and w.reason = 'return';
      v_wallet := v_wallet + (v_after - v_before);
    end if;
    if l.money_satang > 0 and b.customer_id is not null then
      v_key := 'refund:' || l.id::text || ':' || v_version::text;
      if not exists (select 1 from public.wallet_ledger w where w.club_id = v_club and w.dedupe_key = v_key) then
        perform app.wallet_credit(b.customer_id, l.money_satang, 'refund', v_key, b.order_id, null, b.id, null);
        v_money := v_money + l.money_satang;
      end if;
    end if;
  end loop;

  return jsonb_build_object('credits', v_credits, 'creditLost', v_lost, 'walletSatang', v_wallet, 'moneyToWalletSatang', v_money,
                            'forfeitedCredits', 0);
end $$;
alter function app.return_booking_value(uuid, text) owner to booq_owner;
revoke all on function app.return_booking_value(uuid, text) from public;
