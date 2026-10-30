-- F13-T09 follow-up / migration 0708: the daily close prices credit use per package, like the revenue report (D119).
-- Migration 0705 priced each credit used at its order line's frozen credit value over its credit units. D119 says a credit is worth
-- its package's price per credit, and report_revenue_earned (0707) uses that, so the close and the report must agree: here a `use`
-- row is worth the price paid in its package's snapshot over the credits the package holds (an imported package has no price and
-- counts 0). Replaces app.daily_close_totals from 0705, which is numbered below this file (D159); a close already stored is never
-- changed (it is append-only), so only closes run from now on use this rule.
create or replace function app.daily_close_totals(p_club uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_from timestamptz := p_day::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_day + 1)::timestamp at time zone 'Asia/Bangkok';
  v_beam bigint;
  v_cash bigint;
  v_voided_pay jsonb;
  v_credit jsonb;
  v_wallet_used bigint;
  v_wallet_returned bigint;
  v_wallet_credited jsonb;
  v_receipts jsonb;
  v_voids jsonb;
begin
  -- Payments received in the day, with the state of their receipt now.
  with pay as (
    select p.method, p.amount_satang as amount, r.number as receipt_number, r.status as receipt_status
      from public.payment p
      left join lateral (
        select rr.number, rr.status from public.receipt rr
         where rr.club_id = p.club_id and ((rr.kind = 'sale' and rr.order_id = p.order_id) or (rr.kind = 'wallet_credit' and rr.payment_id = p.id))
         order by rr.issued_at limit 1) r on true
     where p.club_id = p_club and p.status = 'succeeded' and not p.is_test and p.confirmed_at >= v_from and p.confirmed_at < v_to)
  select coalesce(sum(amount) filter (where method = 'beam' and receipt_status is distinct from 'void'), 0),
         coalesce(sum(amount) filter (where method = 'cash' and receipt_status is distinct from 'void'), 0),
         coalesce(jsonb_agg(jsonb_build_object('number', receipt_number, 'method', method, 'amount_satang', amount) order by receipt_number) filter (where receipt_status = 'void'), '[]'::jsonb)
    into v_beam, v_cash, v_voided_pay from pay;

  select jsonb_build_object('count', count(*), 'value_satang', coalesce(round(sum(coalesce((pk.product_snapshot ->> 'price_satang')::numeric, 0) / pk.credits_total)), 0)::bigint)
    into v_credit
    from public.credit_ledger u
    join public.customer_package pk on pk.club_id = u.club_id and pk.id = u.package_id
   where u.club_id = p_club and u.reason = 'use' and not u.is_test and u.created_at >= v_from and u.created_at < v_to;

  select coalesce(sum(-w.change_satang) filter (where w.reason = 'spend'), 0), coalesce(sum(w.change_satang) filter (where w.reason = 'return'), 0)
    into v_wallet_used, v_wallet_returned
    from public.wallet_ledger w where w.club_id = p_club and not w.is_test and w.created_at >= v_from and w.created_at < v_to;

  select coalesce(jsonb_agg(jsonb_build_object('reason', w.reason, 'amount_satang', w.change_satang, 'receipt_number', r.number) order by w.created_at, w.id), '[]'::jsonb)
    into v_wallet_credited
    from public.wallet_ledger w
    left join public.receipt r on r.club_id = w.club_id and r.kind = 'wallet_credit' and r.payment_id = w.payment_id
   where w.club_id = p_club and not w.is_test and w.reason in ('late_payment', 'wrong_amount', 'duplicate_payment')
     and w.created_at >= v_from and w.created_at < v_to;

  select coalesce(jsonb_agg(jsonb_build_object('number', r.number, 'kind', r.kind, 'status', r.status, 'customer_name', r.customer_name_snapshot, 'total_satang', r.total_satang) order by r.issued_at, r.id), '[]'::jsonb)
    into v_receipts from public.receipt r where r.club_id = p_club and not r.is_test and r.issued_at >= v_from and r.issued_at < v_to;

  select coalesce(jsonb_agg(jsonb_build_object('number', r.number, 'total_satang', r.total_satang, 'reason', v.reason) order by v.voided_at, v.id), '[]'::jsonb)
    into v_voids
    from public.receipt_void v join public.receipt r on r.club_id = v.club_id and r.id = v.receipt_id
   where v.club_id = p_club and not v.is_test and v.voided_at >= v_from and v.voided_at < v_to;

  return jsonb_build_object(
    'day', p_day,
    'methods', jsonb_build_object('beam', v_beam, 'cash', v_cash),
    'money_total_satang', v_beam + v_cash,
    'voided_payments', v_voided_pay,
    'credit_used', v_credit,
    'wallet_used_satang', v_wallet_used,
    'wallet_returned_satang', v_wallet_returned,
    'wallet_credited', v_wallet_credited,
    'receipts', v_receipts,
    'voids_made', v_voids);
end $$;
alter function app.daily_close_totals(uuid, date) owner to booq_owner;
revoke all on function app.daily_close_totals(uuid, date) from public;
