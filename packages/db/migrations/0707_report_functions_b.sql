-- F13-T09 / migration 0707: reports, second set. F13 design 4.7. Requirements: R2-AC3, AC4, AC5, AC8, AC10, AC11; decisions D33, D35, D57, D70, D119.
-- Same rules as 0706: owner and accountant only from the context, the caller's club, test rows left out, no phone number or date of
-- birth selected. Formulas are proposals until the user approves them (D119 fixes revenue earned and occupancy):
--   report_revenue_earned(from, to): credits used in the range (credit_ledger `use` rows) at their package's price per credit (the price
--     paid in the package snapshot over the credits it holds; an imported package has no price and counts 0), plus single sales: the
--     court hour, coach and add-on lines of sale orders whose receipt was issued in the range and is not void, less the part paid by
--     credit (that part is counted when the credit is used). Package sales are the money received for packages (report_package_sales, 0706).
--   report_value_owed(as_of): at the end of that day, the unused credit of the packages not yet expired (credits left times price per
--     credit), and the wallet balances above zero, as two separate lines; value held by players who have not claimed their imported record
--     is its own line (credit and wallet apart), not mixed into the others (F06 A-10).
--   report_occupancy(from, to): per court, ISO weekday and hour, the hours booked over the hours bookable. Bookable is every hour the
--     club is open on that weekday for each active court, less the hours inside a closure; booked is a confirmed hour of a court booking, a
--     solo class or a group class. Held hours are not counted and cancelled bookings have no confirmed hour (D119).
--   report_partner(from, to): per partner, redemptions counted in the range (a restored use is not counted, D70), the money of those paid
--     orders, new customers (their first paid order ever is the redeemed order) and how many of those came back with another paid order
--     within 30 days and within 60 days of it.

create function app.report_value_owed(p_as_of date) returns table (line text, packages integer, credits bigint, amount_satang bigint)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.report_caller(p_as_of, p_as_of);
  v_end timestamptz := (p_as_of + 1)::timestamp at time zone 'Asia/Bangkok';
begin
  return query
  with pk as (
    select p.id, p.customer_id, p.credits_total,
           coalesce((p.product_snapshot ->> 'price_satang')::numeric, 0) / p.credits_total as per_credit,
           p.credits_total + coalesce((select sum(l.change) from public.credit_ledger l where l.club_id = p.club_id and l.package_id = p.id and l.created_at < v_end), 0) as credits_left,
           coalesce(u.claim_state = 'unclaimed', false) as unclaimed
      from public.customer_package p
      join public.app_user u on u.club_id = p.club_id and u.id = p.customer_id
     where p.club_id = v_club and not p.is_test and p.purchased_at < v_end and p.expires_at > v_end),
  wal as (
    select w.customer_id, sum(w.change_satang) as bal, coalesce(u.claim_state = 'unclaimed', false) as unclaimed
      from public.wallet_ledger w
      join public.app_user u on u.club_id = w.club_id and u.id = w.customer_id
     where w.club_id = v_club and not w.is_test and w.created_at < v_end
     group by w.customer_id, u.claim_state)
  select 'credit'::text, (count(*) filter (where credits_left > 0))::integer, coalesce(sum(credits_left) filter (where credits_left > 0), 0)::bigint,
         coalesce(round(sum(credits_left * per_credit) filter (where credits_left > 0)), 0)::bigint
    from pk where not unclaimed
  union all
  select 'wallet', (count(*) filter (where bal > 0))::integer, 0::bigint, coalesce(sum(bal) filter (where bal > 0), 0)::bigint from wal where not unclaimed
  union all
  select 'imported_credit', (count(*) filter (where credits_left > 0))::integer, coalesce(sum(credits_left) filter (where credits_left > 0), 0)::bigint,
         coalesce(round(sum(credits_left * per_credit) filter (where credits_left > 0)), 0)::bigint
    from pk where unclaimed
  union all
  select 'imported_wallet', (count(*) filter (where bal > 0))::integer, 0::bigint, coalesce(sum(bal) filter (where bal > 0), 0)::bigint from wal where unclaimed;
end $$;

create function app.report_revenue_earned(p_from date, p_to date) returns table (credits_used integer, credit_value_satang bigint, single_sales_satang bigint, total_satang bigint)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.report_caller(p_from, p_to);
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
  v_n integer;
  v_credit bigint;
  v_single bigint;
begin
  select count(*)::integer, coalesce(round(sum(coalesce((pk.product_snapshot ->> 'price_satang')::numeric, 0) / pk.credits_total)), 0)::bigint
    into v_n, v_credit
    from public.credit_ledger u join public.customer_package pk on pk.club_id = u.club_id and pk.id = u.package_id
   where u.club_id = v_club and u.reason = 'use' and not u.is_test and u.created_at >= v_from and u.created_at < v_to;
  select coalesce(sum(l.net_satang - l.credit_value_satang), 0)::bigint
    into v_single
    from public.receipt r
    join public.order_line l on l.club_id = r.club_id and l.order_id = r.order_id and l.kind in ('court_hour', 'coach', 'add_on')
   where r.club_id = v_club and r.kind = 'sale' and r.status = 'issued' and not r.is_test and r.issued_at >= v_from and r.issued_at < v_to;
  return query select v_n, v_credit, v_single, v_credit + v_single;
end $$;

create function app.report_occupancy(p_from date, p_to date) returns table (resource_id uuid, weekday integer, hour integer, booked integer, bookable integer)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.report_caller(p_from, p_to);
begin
  return query
  with slots as (
    select r.id as rid, d::date as day, extract(isodow from d)::integer as wd, h as hr,
           (d::date + make_interval(hours => h))::timestamp at time zone 'Asia/Bangkok' as s_at
      from public.resource r
      cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
      join public.opening_hours oh on oh.club_id = r.club_id and oh.weekday = extract(isodow from d)::integer
      cross join generate_series(0, 23) h
     where r.club_id = v_club and r.active
       and h >= extract(hour from oh.open)::integer and make_interval(hours => h + 1) <= (oh.close - time '00:00')),
  open_slots as (
    select s.* from slots s
     where not exists (select 1 from public.occupancy c where c.club_id = v_club and c.kind = 'closure' and not c.is_test and c.resource_id = s.rid
                         and c.start_at < s.s_at + interval '1 hour' and c.end_at > s.s_at))
  select s.rid, s.wd, s.hr, (count(*) filter (where exists (
           select 1 from public.occupancy o where o.club_id = v_club and o.resource_id = s.rid and o.state = 'confirmed' and not o.is_test
              and o.kind in ('court_booking', 'solo_class', 'group_class') and o.start_at = s.s_at)))::integer, count(*)::integer
    from open_slots s group by s.rid, s.wd, s.hr order by s.rid, s.wd, s.hr;
end $$;

create function app.report_partner(p_from date, p_to date)
returns table (partner_id uuid, partner_name text, redemptions integer, revenue_satang bigint, new_customers integer, repeat_30 integer, repeat_60 integer)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.report_caller(p_from, p_to);
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
begin
  return query
  with red as (
    select pa.id as pid, pa.name as pname, o.id as oid, o.customer_id, o.created_at, o.money_satang
      from public.partner pa
      join public.promo_code c on c.club_id = pa.club_id and c.partner_id = pa.id
      join public.promo_redemption x on x.club_id = c.club_id and x.code_id = c.id and x.status = 'counted' and not x.is_test and x.counted_at >= v_from and x.counted_at < v_to
      join public.orders o on o.club_id = x.club_id and o.id = x.order_id and o.status = 'paid' and not o.is_test
     where pa.club_id = v_club
       and not exists (select 1 from public.receipt r where r.club_id = o.club_id and r.kind = 'sale' and r.order_id = o.id and r.status = 'void')),
  firsts as (
    select r.*, not exists (select 1 from public.orders p where p.club_id = v_club and p.customer_id = r.customer_id and p.status = 'paid' and p.kind = 'sale'
                              and not p.is_test and p.id <> r.oid and p.created_at < r.created_at) as is_new
      from red r),
  newc as (
    select f.pid, f.customer_id, f.created_at from firsts f where f.is_new and f.customer_id is not null)
  select pa.id, pa.name,
         (select count(*) from red r where r.pid = pa.id)::integer,
         (select coalesce(sum(r.money_satang), 0) from red r where r.pid = pa.id)::bigint,
         (select count(distinct n.customer_id) from newc n where n.pid = pa.id)::integer,
         (select count(distinct n.customer_id) from newc n where n.pid = pa.id and exists (
            select 1 from public.orders p where p.club_id = v_club and p.customer_id = n.customer_id and p.status = 'paid' and p.kind = 'sale' and not p.is_test
               and p.created_at > n.created_at and p.created_at <= n.created_at + interval '30 days'))::integer,
         (select count(distinct n.customer_id) from newc n where n.pid = pa.id and exists (
            select 1 from public.orders p where p.club_id = v_club and p.customer_id = n.customer_id and p.status = 'paid' and p.kind = 'sale' and not p.is_test
               and p.created_at > n.created_at and p.created_at <= n.created_at + interval '60 days'))::integer
    from public.partner pa where pa.club_id = v_club order by pa.name, pa.id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.report_value_owed(date)', 'app.report_revenue_earned(date, date)', 'app.report_occupancy(date, date)', 'app.report_partner(date, date)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
