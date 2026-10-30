-- F13-T08 / migration 0706: reports, first set. F13 design 4.7. Requirements: R2-AC1, AC2, AC3, AC6, AC7, AC10, AC11, AC12; decisions D33, D35, D119.
-- Each report is a function of a date range (Bangkok dates, both ends included). Owner and accountant only, from the context
-- (R2-AC11: front desk, a coach and a player are refused). Every one reads the caller's club, leaves out test rows (D33), and
-- selects no phone number or date of birth (D35): the Accountant sees counts and amounts, never contact details.
-- Formulas are the proposals of design 4.7 until the user approves them (D119 fixes revenue earned and occupancy):
--   report_cash_by_type: money received by method, from payment (confirmed in the range, not test), never by adding receipts (4.2);
--     a payment whose receipt is void is left out.
--   report_package_sales: the money part of the package lines of orders paid in the range, with how many orders and packages.
--   report_online_vs_staff: bookings played or no show (confirmed or no_show) with a start in the range, by source.
--   report_no_show_rate: no shows over played plus no shows; played is a confirmed booking whose hour has ended. Rate in basis points,
--     null when there is nothing to divide.
--   report_new_vs_returning: customers with a booking (confirmed or no_show) in the range, new when their first such booking, ever,
--     is in the range.
-- Errors are report:<code> (P0001): forbidden, invalid_range.

create function app.report_caller(p_from date, p_to date) returns uuid
language plpgsql stable set search_path = pg_catalog
as $$
begin
  if app.club_id() is null or app.user_id() is null or not app.has_any_role('owner', 'accountant') then
    raise exception 'report:forbidden' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'report:invalid_range' using errcode = 'P0001';
  end if;
  return app.club_id();
end $$;
alter function app.report_caller(date, date) owner to booq_owner;
revoke all on function app.report_caller(date, date) from public;

create function app.report_cash_by_type(p_from date, p_to date) returns table (method text, payments integer, amount_satang bigint)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.report_caller(p_from, p_to);
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
begin
  return query
    select m.method, count(p.id)::integer, coalesce(sum(p.amount_satang), 0)::bigint
      from (values ('beam'), ('cash')) as m(method)
      left join public.payment p
        on p.club_id = v_club and p.method = m.method and p.status = 'succeeded' and not p.is_test and p.confirmed_at >= v_from and p.confirmed_at < v_to
       and not exists (select 1 from public.receipt r where r.club_id = p.club_id and r.status = 'void'
                         and ((r.kind = 'sale' and r.order_id = p.order_id) or (r.kind = 'wallet_credit' and r.payment_id = p.id)))
     group by m.method order by m.method;
end $$;

create function app.report_package_sales(p_from date, p_to date) returns table (orders integer, packages integer, money_satang bigint)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.report_caller(p_from, p_to);
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
begin
  return query
    select count(distinct l.order_id)::integer, count(l.id)::integer, coalesce(sum(l.money_satang), 0)::bigint
      from public.order_line l
      join public.orders o on o.club_id = l.club_id and o.id = l.order_id and o.kind = 'sale' and o.status = 'paid' and not o.is_test
     where l.club_id = v_club and l.kind = 'package'
       and exists (select 1 from public.payment p where p.club_id = o.club_id and p.order_id = o.id and p.status = 'succeeded' and not p.is_test
                      and p.confirmed_at >= v_from and p.confirmed_at < v_to)
       and not exists (select 1 from public.receipt r where r.club_id = o.club_id and r.kind = 'sale' and r.order_id = o.id and r.status = 'void');
end $$;

create function app.report_online_vs_staff(p_from date, p_to date) returns table (source text, bookings integer)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.report_caller(p_from, p_to);
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
begin
  return query
    select s.source, count(b.id)::integer
      from (values ('online'), ('staff')) as s(source)
      left join public.booking b
        on b.club_id = v_club and b.source = s.source and b.status in ('confirmed', 'no_show') and not b.is_test and b.start_at >= v_from and b.start_at < v_to
     group by s.source order by s.source;
end $$;

create function app.report_no_show_rate(p_from date, p_to date) returns table (played integer, no_shows integer, rate_basis_points integer)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.report_caller(p_from, p_to);
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
  v_played integer;
  v_no integer;
begin
  select count(*) filter (where b.status = 'confirmed' and b.end_at <= app.now()), count(*) filter (where b.status = 'no_show')
    into v_played, v_no
    from public.booking b
   where b.club_id = v_club and not b.is_test and b.start_at >= v_from and b.start_at < v_to and b.status in ('confirmed', 'no_show');
  return query select v_played, v_no, case when v_played + v_no = 0 then null else round(10000.0 * v_no / (v_played + v_no))::integer end;
end $$;

create function app.report_new_vs_returning(p_from date, p_to date) returns table (new_customers integer, returning_customers integer)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.report_caller(p_from, p_to);
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
begin
  return query
    with firsts as (
      select b.customer_id, min(b.start_at) as first_at
        from public.booking b
       where b.club_id = v_club and b.customer_id is not null and not b.is_test and b.status in ('confirmed', 'no_show')
       group by b.customer_id),
    inrange as (
      select distinct b.customer_id
        from public.booking b
       where b.club_id = v_club and b.customer_id is not null and not b.is_test and b.status in ('confirmed', 'no_show')
         and b.start_at >= v_from and b.start_at < v_to)
    select (count(*) filter (where f.first_at >= v_from and f.first_at < v_to))::integer,
           (count(*) filter (where f.first_at < v_from))::integer
      from inrange i join firsts f on f.customer_id = i.customer_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.report_cash_by_type(date, date)', 'app.report_package_sales(date, date)', 'app.report_online_vs_staff(date, date)',
                           'app.report_no_show_rate(date, date)', 'app.report_new_vs_returning(date, date)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
