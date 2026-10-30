-- F06-T10 / migration 0512: what the F06 jobs act on. F06 design 4.6, 4.7 and 6; FA 5.1, 5.4.
-- Requirements: PKG-03-AC3, AC10, R1-AC3; decisions D85, D89, D90.
--
-- Like app.due_hold_orders (0223): the worker lists, across clubs, the work that is due, and then does each item in
-- its own club-context transaction with the F06 function, which re-checks under its locks. The lists return ids only.
--   app.due_package_expiry(limit)   packages past their expiry with credits left       -> app.credit_expire(package)
--   app.due_wallet_expiry(limit)    customers with wallet value in clubs that set wallet_expiry_months
--                                                                                       -> app.wallet_expire(customer)
--   app.due_session_credits(limit)  confirmed bookings that started with a credit still reserved
--                                                                                       -> app.f06_session_start(booking)
-- A paused club is skipped by every expiry sweep: the resume moves the expiry first (D90, PKG-03-AC7), and an expire
-- row written during the pause could not be undone. Time rules live in these predicates, not in the jobs (FA 5.1).
-- Each movement is written once by its dedupe key (0502): expire:{package}, expire:{customer}:{day}, use:{reserve}.
--
-- Brought forward from F06-T11 at the orchestrator's request, for F04's quote (BE-C): booq_app may call
-- app.eligible_credits and read the wallet_balance view, a player for themselves only, the front desk and the owner for
-- the club. Definer functions and the worker (not booq_app) are unaffected. The other grants and policies stay in T11.

create function app.due_package_expiry(p_limit integer default 200)
returns table (club_id uuid, package_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.club_id, p.id
      from public.customer_package p
      join public.club c on c.id = p.club_id
     where p.expires_at <= app.now()
       and c.status <> 'paused'
       and p.credits_total + coalesce((select sum(l.change) from public.credit_ledger l
                                        where l.club_id = p.club_id and l.package_id = p.id), 0) > 0
       and not exists (select 1 from public.credit_ledger e where e.club_id = p.club_id and e.dedupe_key = 'expire:' || p.id::text)
     order by p.expires_at, p.id
     limit greatest(1, p_limit);
end $$;

create function app.due_wallet_expiry(p_limit integer default 200)
returns table (club_id uuid, customer_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select l.club_id, l.customer_id
      from public.wallet_ledger l
      join public.club c on c.id = l.club_id
      join public.club_setting s on s.club_id = l.club_id and s.key = 'wallet_expiry_months'
     where c.status <> 'paused'
       and s.value is not null and s.value <> 'null'::jsonb
     group by l.club_id, l.customer_id
    having sum(l.change_satang) > 0
       and not bool_or(l.dedupe_key = 'expire:' || l.customer_id::text || ':' || (app.now() at time zone 'Asia/Bangkok')::date::text)
     order by l.club_id, l.customer_id
     limit greatest(1, p_limit);
end $$;

create function app.due_session_credits(p_limit integer default 200)
returns table (club_id uuid, booking_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select distinct b.club_id, b.id
      from public.booking b
      join public.credit_ledger r on r.club_id = b.club_id and r.booking_id = b.id and r.reason = 'reserve'
     where b.status = 'confirmed' and b.start_at <= app.now()
       and not exists (select 1 from public.credit_ledger x where x.club_id = r.club_id
                        and x.dedupe_key in ('return:' || r.id::text, 'use:' || r.id::text, 'forfeit:' || r.id::text))
     limit greatest(1, p_limit);
end $$;

-- The session_start job's F06 step (FA 5.4, R1-AC3): the reserved credits of a booking that started become used.
-- A booking cancelled or released meanwhile writes nothing (app.credit_use).
create function app.f06_session_start(p_booking uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  return app.credit_use(p_booking);
end $$;

-- The sweeps read by club, customer and reason.
create index credit_ledger_expire on public.credit_ledger (club_id, package_id) where reason = 'expire';
create index wallet_ledger_expire on public.wallet_ledger (club_id, customer_id, created_at) where reason = 'expire';

do $$
declare f text;
begin
  foreach f in array array['app.due_package_expiry(integer)', 'app.due_wallet_expiry(integer)', 'app.due_session_credits(integer)',
                           'app.f06_session_start(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_worker', f);
  end loop;
  -- The jobs act through these, in a club-context transaction, as the worker.
  grant execute on function app.credit_expire(uuid) to booq_worker;
  grant execute on function app.wallet_expire(uuid) to booq_worker;
end $$;

-- The quote reads the player's credits (F04 4.3). As booq_app the customer must be the caller, or the caller the club's
-- front desk or owner; the rest of the function is 0506's.
create or replace function app.eligible_credits(p_customer uuid, p_line jsonb, p_at timestamptz default null)
returns table (package_id uuid, expires_at timestamptz, credits_left integer)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_at timestamptz := coalesce(p_at, app.now());
  v_type text := p_line ->> 'credit_type';
begin
  if v_club is null then
    raise exception 'credit: no club in the context' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('role', true), '') = 'booq_app'
     and app.user_id() is distinct from p_customer and not app.has_any_role('owner', 'front_desk') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app.require_claimed_customer(p_customer);
  if v_type is null or v_type not in ('court_hour', 'solo_class', 'group_session') then
    raise exception 'credit:line_spec' using errcode = 'P0001';
  end if;
  if v_type = 'solo_class' and coalesce(p_line ->> 'coach_source', '') = 'checkout' then
    return;
  end if;
  return query
    select p.id, p.expires_at, app.package_credits_left(p.id)
      from public.customer_package p
     where p.club_id = v_club and p.customer_id = p_customer
       and p.expires_at > v_at
       and p.product_snapshot ->> 'credit_type' = v_type
       and (v_type <> 'solo_class' or p.product_snapshot ->> 'coach_tier_id' = p_line ->> 'coach_tier_id')
       and (p.product_snapshot ->> 'price_group_id' is null or p.product_snapshot ->> 'price_group_id' = p_line ->> 'price_group_id')
       and app.package_credits_left(p.id) > 0
     order by p.expires_at, p.id;
end $$;
grant execute on function app.eligible_credits(uuid, jsonb, timestamptz) to booq_app;

-- The wallet balance as the quote and C14 read it: a player sees their own row only, the front desk and the owner the
-- club's. Callers that are not booq_app (definer functions, the worker) see the club's, as before.
create or replace view public.wallet_balance with (security_barrier = true) as
select l.club_id, l.customer_id, sum(l.change_satang)::bigint as balance_satang
  from public.wallet_ledger l
 where l.club_id = app.club_id()
   and (coalesce(current_setting('role', true), '') <> 'booq_app'
        or l.customer_id = app.user_id()
        or app.has_any_role('owner', 'front_desk'))
 group by l.club_id, l.customer_id;
grant select on public.wallet_balance to booq_app;
