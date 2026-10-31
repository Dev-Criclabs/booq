-- F12-T05 / migration 1205: K6 Earnings. F12 design 5.7. Requirements: CPORT-06, R3, D115, D170.
--   app.my_earnings(month)             the signed-in coach's month: sessions, base, solo and group pay, their own rates, flags, amount,
--                                      adjustments, total, status, paid at
--   app.my_payout_history()            the coach's paid months, newest first, with the total paid
--   app.my_payout_adjustments(month)   the month's adjustments with the owner's written reason (the board's "See reason")
-- The figures are F13's own (app.payout_figures, the same function the owner's payout uses), so the coach's number and the owner's number
-- cannot differ; once the owner marks a month paid the stored, frozen figures are shown. A null amount (a pay setting not set, or a rule
-- flagged) stays null and is never shown as zero. The coach reads their own pay rates only (kind and value from their own coach_pay row,
-- A-8), never another coach's, never the club's revenue. The coach is the signed-in person; no argument names a coach.
-- Errors: portal:forbidden, portal:invalid_month.

create function app.my_earnings(p_month date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_me uuid := app.portal_coach();
  v_club uuid := app.club_id();
  p public.coach_payout%rowtype;
  f jsonb;
  pay record;
  v_adj bigint := 0;
  v_amount integer;
begin
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'portal:invalid_month' using errcode = 'P0001';
  end if;
  select * into p from public.coach_payout cp where cp.club_id = v_club and cp.coach_id = v_me and cp.month = p_month;
  if found then
    select coalesce(sum(a.delta_satang), 0) into v_adj from public.coach_payout_adjustment a where a.club_id = v_club and a.payout_id = p.id;
  end if;
  select cp.solo_pay_kind, cp.solo_pay_value, cp.group_pay_kind, cp.group_pay_value into pay
    from public.coach_pay cp where cp.club_id = v_club and cp.coach_id = v_me;
  if p.status = 'paid' then
    f := jsonb_build_object('solo_sessions', p.solo_sessions, 'group_sessions', p.group_sessions, 'base_satang', p.base_satang,
                            'solo_pay_satang', p.solo_pay_satang, 'group_pay_satang', p.group_pay_satang, 'flags', to_jsonb(p.flags), 'amount_satang', p.amount_satang);
  else
    f := app.payout_figures(v_club, v_me, p_month);
  end if;
  v_amount := (f ->> 'amount_satang')::integer;
  return f || jsonb_build_object(
    'month', p_month,
    'status', coalesce(p.status, 'open'),
    'solo_rate', case when pay.solo_pay_kind is null then null else jsonb_build_object('kind', pay.solo_pay_kind, 'value', pay.solo_pay_value) end,
    'group_rate', case when pay.group_pay_kind is null then null else jsonb_build_object('kind', pay.group_pay_kind, 'value', pay.group_pay_value) end,
    'adjustments_satang', v_adj,
    'total_satang', case when v_amount is null then null else v_amount + v_adj end,
    'paid_at', p.paid_at);
end $$;
alter function app.my_earnings(date) owner to booq_owner;
revoke all on function app.my_earnings(date) from public;

create function app.my_payout_history() returns table (month date, total_satang bigint, paid_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_me uuid := app.portal_coach();
begin
  return query
    select p.month, p.amount_satang + coalesce((select sum(a.delta_satang) from public.coach_payout_adjustment a where a.club_id = p.club_id and a.payout_id = p.id), 0)::bigint, p.paid_at
      from public.coach_payout p
     where p.club_id = app.club_id() and p.coach_id = v_me and p.status = 'paid'
     order by p.month desc;
end $$;
alter function app.my_payout_history() owner to booq_owner;
revoke all on function app.my_payout_history() from public;

create function app.my_payout_adjustments(p_month date) returns table (delta_satang integer, reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_me uuid := app.portal_coach();
begin
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'portal:invalid_month' using errcode = 'P0001';
  end if;
  return query
    select a.delta_satang, a.reason, a.created_at
      from public.coach_payout p
      join public.coach_payout_adjustment a on a.club_id = p.club_id and a.payout_id = p.id
     where p.club_id = app.club_id() and p.coach_id = v_me and p.month = p_month
     order by a.created_at, a.id;
end $$;
alter function app.my_payout_adjustments(date) owner to booq_owner;
revoke all on function app.my_payout_adjustments(date) from public;

grant execute on function app.my_earnings(date), app.my_payout_history(), app.my_payout_adjustments(date) to booq_app;
