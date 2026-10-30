-- F04-T04 / migration 0304: what the Pay transaction and the release path call. F04 design 4.4, 4.5, 4.8.
-- Requirements: PAY-07-AC1, PROMO-01-AC7, R5-AC3, AC5; decisions D64, D66, D67, D70.
-- All SECURITY DEFINER with a fixed search path; the club comes from app.club_id() and never from
-- an argument (SR-07). Errors are raised as 'promo:<code>' / 'birthday:<code>' with SQLSTATE P0001.

-- 1. Does an order still need payment? An order not yet priced always does (never treated as
--    free). A priced order does when it has money due. (F05 adds the cash payment record.)
--    reserve_court asks this after Pay has written the frozen amounts, so a zero money order takes
--    no hold and is confirmed in the claim (PAY-07).
create or replace function app.order_needs_payment(p_order uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select o.priced_at is null or o.money_satang > 0
       from public.orders o where o.club_id = app.club_id() and o.id = p_order),
    true)
$$;

-- 2. Count one use of a code for an order, under the code row's lock (FA 3.4 step 2b): total cap,
--    per customer cap and first-time-only are checked against counted redemptions, so two players
--    taking the last use in parallel give exactly one success (PROMO-01-AC7). Dates and activity
--    are checked again here; scope, audience, minimum spend and value are the engine's.
create function app.count_promo_use(p_code uuid, p_order uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  c public.promo_code%rowtype;
  o public.orders%rowtype;
  v_today date := (app.now() at time zone 'Asia/Bangkok')::date;
  v_id uuid;
begin
  if v_club is null then
    raise exception 'promo:no_club_context' using errcode = 'P0001';
  end if;
  select * into o from public.orders where club_id = v_club and id = p_order;
  if not found or (o.customer_id is distinct from v_user and not app.has_any_role('owner', 'front_desk')) then
    raise exception 'promo:order_not_found' using errcode = 'P0001';
  end if;
  select * into c from public.promo_code where club_id = v_club and id = p_code for update;
  -- missing and foreign codes answer the same
  if not found or not c.active then
    raise exception 'promo:code_not_valid' using errcode = 'P0001';
  end if;
  if (c.starts_on is not null and v_today < c.starts_on) or (c.ends_on is not null and v_today > c.ends_on) then
    raise exception 'promo:code_expired' using errcode = 'P0001';
  end if;
  if c.total_cap is not null and (select count(*) from public.promo_redemption r
                                   where r.club_id = v_club and r.code_id = c.id and r.status = 'counted') >= c.total_cap then
    raise exception 'promo:code_used_up' using errcode = 'P0001';
  end if;
  if c.per_customer_cap is not null and o.customer_id is not null
     and (select count(*) from public.promo_redemption r
           where r.club_id = v_club and r.code_id = c.id and r.customer_id = o.customer_id and r.status = 'counted') >= c.per_customer_cap then
    raise exception 'promo:code_used_up' using errcode = 'P0001';
  end if;
  if c.first_time_only and o.customer_id is not null and exists (
       select 1 from public.booking b
        where b.club_id = v_club and b.customer_id = o.customer_id and b.order_id <> p_order
          and b.status in ('confirmed', 'no_show', 'late_cancelled')) then
    raise exception 'promo:code_first_booking_only' using errcode = 'P0001';
  end if;
  begin
    insert into public.promo_redemption (club_id, code_id, order_id, customer_id) values (v_club, c.id, p_order, o.customer_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'promo:one_code_per_order' using errcode = 'P0001';
  end;
  return v_id;
end $$;

-- 3. Record a birthday entitlement for an order: once per kind per calendar year, only in the
--    customer's birth month, only with a date of birth on file (R5-AC1 to AC4).
create function app.use_birthday_entitlement(p_kind text, p_order uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  o public.orders%rowtype;
  v_dob date;
  v_now timestamp := app.now() at time zone 'Asia/Bangkok';
  v_id uuid;
begin
  if v_club is null then
    raise exception 'birthday:no_club_context' using errcode = 'P0001';
  end if;
  select * into o from public.orders where club_id = v_club and id = p_order;
  if not found or o.customer_id is null or (o.customer_id is distinct from v_user and not app.has_any_role('owner', 'front_desk')) then
    raise exception 'birthday:order_not_found' using errcode = 'P0001';
  end if;
  select u.date_of_birth into v_dob from public.app_user u where u.club_id = v_club and u.id = o.customer_id;
  if v_dob is null or extract(month from v_dob) <> extract(month from v_now) then
    raise exception 'birthday:not_entitled' using errcode = 'P0001';
  end if;
  begin
    insert into public.birthday_entitlement_use (club_id, customer_id, year, kind, order_id)
    values (v_club, o.customer_id, extract(year from v_now)::int, p_kind, p_order)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'birthday:already_used' using errcode = 'P0001';
  end;
  return v_id;
end $$;

-- 4. Give back what an order had used up: the code use and the birthday entitlement (rows stay,
--    marked restored; a restored use no longer counts, D70). Registered as a release handler, so a
--    hold that ends restores them (R7-AC6); F09 calls it for a cancellation of 12 hours or more.
create function app.restore_order_entitlements(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null then
    raise exception 'restore_order_entitlements needs a club in the context' using errcode = 'P0001';
  end if;
  update public.promo_redemption
     set status = 'restored', restored_at = app.now(), restore_reason = coalesce(nullif(btrim(p_reason), ''), 'restored')
   where club_id = v_club and order_id = p_order and status = 'counted';
  update public.birthday_entitlement_use
     set status = 'restored', restored_at = app.now()
   where club_id = v_club and order_id = p_order and status = 'used';
end $$;

-- 5. F09 cancels one hour: report that line's stored parts so value goes back to where it came from
--    (package credit to the package, money to the wallet, wallet use to the wallet; D21), and restore
--    the code use and birthday entitlement only when every hour of the order is cancelled or released
--    (D67). Call it after the booking's status has been set.
create function app.restore_line(p_line uuid, p_reason text) returns table (
  kind text, booking_id uuid, credit_package_id uuid, credit_units integer, credit_value_satang integer, wallet_satang integer, money_satang integer, order_restored boolean)
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  l public.order_line%rowtype;
  v_all boolean;
begin
  if v_club is null then
    raise exception 'restore_line needs a club in the context' using errcode = 'P0001';
  end if;
  select * into l from public.order_line where club_id = v_club and id = p_line;
  if not found then
    raise exception 'restore_line: no such line' using errcode = 'P0001';
  end if;
  select not exists (
    select 1 from public.order_line x join public.booking b on b.club_id = x.club_id and b.id = x.booking_id
     where x.club_id = v_club and x.order_id = l.order_id and b.status not in ('cancelled', 'released')
  ) into v_all;
  if v_all then
    perform app.restore_order_entitlements(l.order_id, p_reason);
  end if;
  kind := l.kind; booking_id := l.booking_id; credit_package_id := l.credit_package_id; credit_units := l.credit_units;
  credit_value_satang := l.credit_value_satang; wallet_satang := l.wallet_satang; money_satang := l.money_satang;
  order_restored := v_all;
  return next;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.order_needs_payment(uuid)', 'app.count_promo_use(uuid, uuid)', 'app.use_birthday_entitlement(text, uuid)',
    'app.restore_order_entitlements(uuid, text)', 'app.restore_line(uuid, text)'
  ] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
-- Pay (a player or staff booking as one) counts and records; nobody but a definer function restores.
grant execute on function app.count_promo_use(uuid, uuid) to booq_app;
grant execute on function app.use_birthday_entitlement(text, uuid) to booq_app;

select app.register_release_handler('f04_entitlements', 'app.restore_order_entitlements(uuid, text)'::regprocedure::regproc, 10);
