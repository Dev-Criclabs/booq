-- F06-T06b / migration 0507: credit functions, part two. F06 design 4.2 and 4.6; FA 2.3, 3.4, 10.1 Q4.
-- Requirements: R1-AC3 to AC5, PKG-03-AC3, AC4; decisions D28, D83, D85.
--   app.credit_use              the session started: a use row (change 0) per standing reserve, use:{reserve}
--   app.credit_forfeit          late cancel or no show: a forfeit row (change 0) per reserve, forfeit:{reserve}
--   app.credit_reverse_forfeit  staff undo a no show or late cancel: a return row (+1) with the note,
--                               keyed return:{reserve} like any return, never an edit (R1-AC5)
--   app.credit_adjust           a staff adjustment with a written note, never below zero (D83)
--   app.credit_expire           one expire row for the unreserved remainder of an expired package (D85)
-- Every row names the reserve it acts on through its key, and its order line, so a return skips a credit
-- that was used or forfeited (0506) and each movement happens once.

-- A no show is marked after the slot ended (F09, D118), when the use row already exists: a forfeit
-- applies to a used credit too. A late cancel is forfeited before the start, so it is never used.
create function app.credit_use(p_booking uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  r record;
  v_n integer := 0;
begin
  select * into b from public.booking bk where bk.club_id = v_club and bk.id = p_booking;
  if not found then
    raise exception 'credit:booking_not_found' using errcode = 'P0001';
  end if;
  if b.start_at > app.now() then
    raise exception 'credit:not_started' using errcode = 'P0001';
  end if;
  if b.status <> 'confirmed' then
    return 0;                               -- cancelled or released meanwhile: its credit went the other way
  end if;
  for r in select l.id, l.package_id, l.order_line_id from public.credit_ledger l
            where l.club_id = v_club and l.booking_id = p_booking and l.reason = 'reserve' and app.credit_reserve_open(l.id)
            order by l.id loop
    insert into public.credit_ledger (club_id, package_id, change, reason, booking_id, order_line_id, dedupe_key)
      values (v_club, r.package_id, 0, 'use', p_booking, r.order_line_id, 'use:' || r.id::text)
      on conflict (club_id, dedupe_key) do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- p_staff is the staff member marking a no show (it must be the caller); null for F09's automatic late
-- cancel. A staff row carries a written note (the ledger check refuses one without).
create function app.credit_forfeit(p_booking uuid, p_staff uuid, p_note text) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  r record;
  v_n integer := 0;
begin
  if p_staff is not null and p_staff is distinct from app.user_id() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_staff is not null and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'credit:note_required' using errcode = 'P0001';
  end if;
  select bk.customer_id into v_customer from public.booking bk where bk.club_id = v_club and bk.id = p_booking;
  if not found then
    raise exception 'credit:booking_not_found' using errcode = 'P0001';
  end if;
  if v_customer is not null then
    perform app.lock_customer(v_customer);
  end if;
  for r in select l.id, l.package_id, l.order_line_id from public.credit_ledger l
            where l.club_id = v_club and l.booking_id = p_booking and l.reason = 'reserve' and app.credit_reserve_open(l.id)
            order by l.id loop
    insert into public.credit_ledger (club_id, package_id, change, reason, booking_id, order_line_id, staff_id, note, dedupe_key)
      values (v_club, r.package_id, 0, 'forfeit', p_booking, r.order_line_id, p_staff,
              case when p_staff is null then null else btrim(p_note) end, 'forfeit:' || r.id::text)
      on conflict (club_id, dedupe_key) do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- The credit comes back by a new row, never by editing the forfeit (R1-AC5). It returns to its own
-- package whatever the date: a staff correction, not a cancel (D85 concerns the player's cancel).
create function app.credit_reverse_forfeit(p_booking uuid, p_staff uuid, p_note text) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  r record;
  v_n integer := 0;
begin
  if v_club is null or p_staff is null or p_staff is distinct from app.user_id() or not app.has_any_role('owner', 'front_desk') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'credit:note_required' using errcode = 'P0001';
  end if;
  select bk.customer_id into v_customer from public.booking bk where bk.club_id = v_club and bk.id = p_booking;
  if not found then
    raise exception 'credit:booking_not_found' using errcode = 'P0001';
  end if;
  if v_customer is not null then
    perform app.lock_customer(v_customer);
  end if;
  for r in select f.package_id, f.order_line_id, substr(f.dedupe_key, length('forfeit:') + 1) as reserve_id
             from public.credit_ledger f
            where f.club_id = v_club and f.booking_id = p_booking and f.reason = 'forfeit' and f.dedupe_key like 'forfeit:%'
            order by f.id loop
    insert into public.credit_ledger (club_id, package_id, change, reason, booking_id, order_line_id, staff_id, note, dedupe_key)
      values (v_club, r.package_id, 1, 'return', p_booking, r.order_line_id, p_staff, btrim(p_note), 'return:' || r.reserve_id)
      on conflict (club_id, dedupe_key) do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- A staff adjustment (front desk or owner, design 7): a written note always, never below zero (D83),
-- never taking credit from an unclaimed record (design 4.8). The row is audited by its trigger.
create function app.credit_adjust(p_package uuid, p_delta integer, p_note text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := app.user_id();
  v_customer uuid;
  v_id uuid;
begin
  if v_club is null or v_staff is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'credit:note_required' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'credit:amount' using errcode = 'P0001';
  end if;
  select cp.customer_id into v_customer from public.customer_package cp where cp.club_id = v_club and cp.id = p_package;
  if not found then
    raise exception 'credit:package_not_found' using errcode = 'P0001';
  end if;
  perform app.lock_customer(v_customer);
  perform 1 from public.customer_package cp where cp.club_id = v_club and cp.id = p_package for update;
  if p_delta < 0 then
    perform app.require_claimed_customer(v_customer);
    if app.package_credits_left(p_package) + p_delta < 0 then
      raise exception 'credit:below_zero' using errcode = 'P0001';
    end if;
  end if;
  insert into public.credit_ledger (club_id, package_id, change, reason, staff_id, note)
    values (v_club, p_package, p_delta, 'adjust', v_staff, btrim(p_note))
    returning id into v_id;
  return v_id;
end $$;

-- The expiry sweep (F06-T10, FA 5.4): an expired package with credits left gets one expire row for them.
-- Credits left are after reserves, so a credit reserved before expiry stays valid for its session and is
-- not expired (D85, PKG-03-AC8). Once per package (expire:{package}). Returns the credits written off.
create function app.credit_expire(p_package uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  p public.customer_package%rowtype;
  v_left integer;
begin
  select * into p from public.customer_package cp where cp.club_id = v_club and cp.id = p_package;
  if not found then
    raise exception 'credit:package_not_found' using errcode = 'P0001';
  end if;
  perform app.lock_customer(p.customer_id);
  perform 1 from public.customer_package cp where cp.club_id = v_club and cp.id = p_package for update;
  if p.expires_at > app.now() then
    return 0;
  end if;
  v_left := app.package_credits_left(p_package);
  if v_left <= 0 then
    return 0;
  end if;
  insert into public.credit_ledger (club_id, package_id, change, reason, dedupe_key)
    values (v_club, p_package, -v_left, 'expire', 'expire:' || p_package::text)
    on conflict (club_id, dedupe_key) do nothing;
  if not found then
    return 0;
  end if;
  return v_left;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.credit_use(uuid)', 'app.credit_forfeit(uuid, uuid, text)', 'app.credit_reverse_forfeit(uuid, uuid, text)',
    'app.credit_adjust(uuid, integer, text)', 'app.credit_expire(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
-- The staff adjustment is called from the admin route (F06-T16) as booq_app and checks the role inside.
-- The rest are called by definer functions (F09, the session_start and expiry jobs).
grant execute on function app.credit_adjust(uuid, integer, text) to booq_app;
