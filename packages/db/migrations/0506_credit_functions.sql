-- F06-T06a / migration 0506: credit functions, part one. F06 design 4.2, 4.3, 4.8; FA 2.3, 3.4.
-- Requirements: PKG-01-AC8, PKG-02-AC5, AC10, PKG-03-AC8, AC9, R1-AC1, AC2, AC9; decisions D84, D85.
--   app.eligible_credits   packages that fit a line: type, tier and price group; nearest expiry first
--   app.credit_reserve     one credit of a package for one order line, keyed reserve:{order_line}:{attempt}
--   app.credit_return      gives back the reserved credits of a booking (return:{reserve_row}); a player
--                          cancel after the package expired returns nothing and the credit is lost (D85)
-- The package matching reads the product snapshot taken at purchase (credit_type, coach_tier_id,
-- price_group_id; written by grant_package, 0508), so a later product edit never changes what a
-- package sold fits (PKG-02-AC4). A Student credit fits the Student item it was bought for, also
-- after its holder turns 18: the match is on the item's price group, never on the holder's age (D84).
-- Lock order (FA 3.4): the customer's advisory lock, then customer_package rows in ascending id.

-- The credit type an order line can be covered by: a court hour by a court bundle hour, a coach line
-- by a solo pack credit (the coaching part only, R1-AC10), a class seat by a group credit.
create function app.credit_type_for_line(p_kind text) returns text
language sql immutable set search_path = pg_catalog
as $$
  select case p_kind when 'court_hour' then 'court_hour' when 'coach' then 'solo_class' when 'class_seat' then 'group_session' end
$$;

create function app.package_credits_left(p_package uuid) returns integer
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select (p.credits_total + coalesce((select sum(l.change) from public.credit_ledger l
                                       where l.club_id = p.club_id and l.package_id = p.id), 0))::integer
    from public.customer_package p where p.club_id = app.club_id() and p.id = p_package
$$;

-- p_line: {"credit_type": "court_hour" | "solo_class" | "group_session", "coach_tier_id": uuid (solo),
-- "price_group_id": uuid (the item's group), "coach_source": "checkout" | "classes" (solo)}. A coach
-- picked at court checkout never uses solo pack credit (COACH-03, R1-AC9). A court bundle fits any hour
-- on any court and a solo credit any coach of its tier (PKG-02-AC10): no court or coach is matched.
create function app.eligible_credits(p_customer uuid, p_line jsonb, p_at timestamptz default null)
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

-- A reserve row that is still standing: not returned, and its line not used or forfeited.
create function app.credit_reserve_open(p_reserve uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select not exists (select 1 from public.credit_ledger r where r.club_id = app.club_id() and r.dedupe_key = 'return:' || p_reserve::text)
$$;

-- One credit for one order line, in the booking's transaction (R1-AC1, CC-4). The line must be a court
-- hour, coach or class seat line of that booking, the customer's own, allocated to this package (or to
-- the package bought in this order, the marker of design 4.4, resolved by the caller). A standing
-- reserve of the line is returned as it is and nothing is written; after a return (a released hold)
-- the next reserve is the next attempt (A-13). Two parallel reserves of the last credit: one succeeds.
create function app.credit_reserve(p_package uuid, p_booking uuid, p_line uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  p public.customer_package%rowtype;
  l public.order_line%rowtype;
  v_customer uuid;
  v_id uuid;
  v_attempt integer;
begin
  select cp.customer_id into v_customer from public.customer_package cp where cp.club_id = v_club and cp.id = p_package;
  if not found then
    raise exception 'credit:package_not_found' using errcode = 'P0001';
  end if;
  perform app.lock_customer(v_customer);
  select * into p from public.customer_package cp where cp.club_id = v_club and cp.id = p_package for update;
  perform app.require_claimed_customer(v_customer);
  select * into l from public.order_line ol where ol.club_id = v_club and ol.id = p_line;
  if not found or l.booking_id is distinct from p_booking
     or not exists (select 1 from public.orders o where o.club_id = v_club and o.id = l.order_id and o.customer_id = v_customer) then
    raise exception 'credit:line_not_found' using errcode = 'P0001';
  end if;
  if app.credit_type_for_line(l.kind) is distinct from p.product_snapshot ->> 'credit_type'
     or (l.credit_package_id is not null and l.credit_package_id <> p_package) then
    raise exception 'credit:does_not_fit' using errcode = 'P0001';
  end if;
  select r.id into v_id from public.credit_ledger r
   where r.club_id = v_club and r.order_line_id = p_line and r.reason = 'reserve' and app.credit_reserve_open(r.id)
   order by r.created_at desc limit 1;
  if found then
    return v_id;
  end if;
  if p.expires_at <= app.now() then
    raise exception 'credit:expired' using errcode = 'P0001';
  end if;
  if app.package_credits_left(p_package) < 1 then
    raise exception 'credit:used_up' using errcode = 'P0001';
  end if;
  select count(*) + 1 into v_attempt from public.credit_ledger r
   where r.club_id = v_club and r.order_line_id = p_line and r.reason = 'reserve';
  insert into public.credit_ledger (club_id, package_id, change, reason, booking_id, order_line_id, dedupe_key)
    values (v_club, p_package, -1, 'reserve', p_booking, p_line, 'reserve:' || p_line::text || ':' || v_attempt)
    returning id into v_id;
  return v_id;
end $$;

-- Gives back every standing reserve of a booking, each once, to its own package (R1-AC2, D21). A line
-- whose credit was used (the session started) or forfeited (late cancel, no show) has nothing to give
-- back. p_reason: 'release' (a hold ended, F03 and F04), 'player_cancel', 'club_cancel' or 'closure'
-- (F09). After the package expired a player cancel writes nothing and the credit is lost (D85,
-- CANCEL-01-AC11); a club cancel or a closure still returns it (CANCEL-03-AC12; extending is the
-- owner's action, D118). Returns {"returned": n, "lost": n}.
create function app.credit_return(p_booking uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  r record;
  v_returned integer := 0;
  v_lost integer := 0;
begin
  if p_reason is null or p_reason not in ('release', 'player_cancel', 'club_cancel', 'closure') then
    raise exception 'credit:reason' using errcode = 'P0001';
  end if;
  select b.customer_id into v_customer from public.booking b where b.club_id = v_club and b.id = p_booking;
  if not found then
    raise exception 'credit:booking_not_found' using errcode = 'P0001';
  end if;
  if v_customer is not null then
    perform app.lock_customer(v_customer);
  end if;
  perform 1 from public.customer_package cp
   where cp.club_id = v_club
     and cp.id in (select l.package_id from public.credit_ledger l where l.club_id = v_club and l.booking_id = p_booking and l.reason = 'reserve')
   order by cp.id for update;
  for r in select l.id, l.package_id, l.order_line_id, cp.expires_at
             from public.credit_ledger l join public.customer_package cp on cp.club_id = l.club_id and cp.id = l.package_id
            where l.club_id = v_club and l.booking_id = p_booking and l.reason = 'reserve' and app.credit_reserve_open(l.id)
              and not exists (select 1 from public.credit_ledger u where u.club_id = v_club and u.order_line_id = l.order_line_id
                                 and u.reason in ('use', 'forfeit') and u.created_at >= l.created_at)
            order by l.id loop
    if p_reason = 'player_cancel' and r.expires_at <= app.now() then
      v_lost := v_lost + 1;
      continue;
    end if;
    insert into public.credit_ledger (club_id, package_id, change, reason, booking_id, order_line_id, dedupe_key)
      values (v_club, r.package_id, 1, 'return', p_booking, r.order_line_id, 'return:' || r.id::text)
      on conflict (club_id, dedupe_key) do nothing;
    if found then
      v_returned := v_returned + 1;
    end if;
  end loop;
  return jsonb_build_object('returned', v_returned, 'lost', v_lost);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.credit_type_for_line(text)', 'app.package_credits_left(uuid)', 'app.eligible_credits(uuid, jsonb, timestamptz)',
    'app.credit_reserve_open(uuid)', 'app.credit_reserve(uuid, uuid, uuid)', 'app.credit_return(uuid, text)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
-- Callers are definer functions (F04 Pay and quote, the late reclaim, F09); grants for routes are F06-T11.
