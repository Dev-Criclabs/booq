-- F13 follow-up / migration 0714: group percent pay (D170). A group seat has no separate coaching portion, so a percentage applies to the
-- full listed seat price of each seat booked in the session, before promotions, credits or wallet: the session's listed drop in price
-- (`class_session.drop_in_price_satang`, D157) times the seats booked in it (confirmed or no show, the same rule that makes a session
-- count), in basis points, rounded once on the month's sum. The flag `group_percent_no_base` of 0709 is retired. A delivered session with
-- seats and no listed price cannot be priced, so it takes the new flag `group_price_unset` and the amount stays null (no guess). The
-- value `group_percent_no_base` stays allowed in the flags check only for rows computed before this file; an open row is recomputed
-- whenever it is listed and a paid row can never have a flag. Redefines app.payout_figures of 0709 (numbered above it, D159).
alter table public.coach_payout drop constraint coach_payout_flags_values;
alter table public.coach_payout add constraint coach_payout_flags_values
  check (flags <@ array['solo_pay_unset', 'group_pay_unset', 'group_percent_no_base', 'group_price_unset', 'solo_portion_missing']);

create or replace function app.payout_figures(p_club uuid, p_coach uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_from timestamptz := p_month::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok';
  v_test boolean := coalesce((select u.is_test from public.app_user u where u.club_id = p_club and u.id = p_coach), false);
  pay record;
  v_solo integer;
  v_portion bigint;
  v_missing integer;
  v_group integer;
  v_group_base bigint;
  v_group_missing integer;
  v_flags text[] := '{}';
  v_solo_pay bigint;
  v_group_pay bigint;
  v_amount bigint;
begin
  select cp.monthly_base_satang, cp.solo_pay_kind, cp.solo_pay_value, cp.group_pay_kind, cp.group_pay_value into pay
    from public.coach_pay cp where cp.club_id = p_club and cp.coach_id = p_coach;

  select count(*)::integer, coalesce(sum(l.coach_net), 0), count(*) filter (where l.coach_net is null)::integer into v_solo, v_portion, v_missing
    from public.booking b
    left join lateral (select sum(ol.net_satang) as coach_net from public.order_line ol where ol.club_id = b.club_id and ol.booking_id = b.id and ol.kind = 'coach') l on true
   where b.club_id = p_club and b.type = 'solo_class' and b.coach_id = p_coach and b.is_test = v_test
     and b.start_at >= v_from and b.start_at < v_to
     and ((b.status = 'confirmed' and b.end_at <= app.now()) or b.status = 'no_show');

  -- A delivered group session: the seats booked in it (confirmed or no show) and its listed seat price (D170).
  select count(*)::integer, coalesce(sum(seats.n * s.drop_in_price_satang), 0), count(*) filter (where s.drop_in_price_satang is null)::integer into v_group, v_group_base, v_group_missing
    from public.class_session s
    cross join lateral (select count(*) as n from public.booking b where b.club_id = s.club_id and b.class_session_id = s.id and b.status in ('confirmed', 'no_show')) seats
   where s.club_id = p_club and s.coach_id = p_coach and s.is_test = v_test and s.status = 'scheduled'
     and s.start_at >= v_from and s.start_at < v_to and s.end_at <= app.now() and seats.n > 0;

  if v_solo = 0 then
    v_solo_pay := 0;
  elsif pay.solo_pay_kind is null then
    v_flags := v_flags || 'solo_pay_unset'::text;
  elsif pay.solo_pay_kind = 'fixed' then
    v_solo_pay := v_solo::bigint * pay.solo_pay_value;
  elsif v_missing > 0 then
    v_flags := v_flags || 'solo_portion_missing'::text;
  else
    v_solo_pay := round(v_portion * pay.solo_pay_value / 10000.0);
  end if;

  if v_group = 0 then
    v_group_pay := 0;
  elsif pay.group_pay_kind is null then
    v_flags := v_flags || 'group_pay_unset'::text;
  elsif pay.group_pay_kind = 'fixed' then
    v_group_pay := v_group::bigint * pay.group_pay_value;
  elsif v_group_missing > 0 then
    v_flags := v_flags || 'group_price_unset'::text;
  else
    v_group_pay := round(v_group_base * pay.group_pay_value / 10000.0);
  end if;

  if cardinality(v_flags) = 0 then
    v_amount := coalesce(pay.monthly_base_satang, 0) + v_solo_pay + v_group_pay;
  end if;
  return jsonb_build_object('solo_sessions', v_solo, 'group_sessions', v_group, 'base_satang', pay.monthly_base_satang,
                            'solo_pay_satang', v_solo_pay, 'group_pay_satang', v_group_pay, 'flags', to_jsonb(v_flags), 'amount_satang', v_amount);
end $$;
