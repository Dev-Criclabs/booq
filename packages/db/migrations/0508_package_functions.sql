-- F06-T07 / migration 0508: granting a package, expiry, extensions, pause and wallet expiry.
-- F06 design 4.4, 4.5, 4.7; FA 7. Requirements: PKG-02-AC2, AC3, AC6, PKG-03-AC5, AC7, AC10;
-- decisions D20, D84, D88, D89, D90.
--   app.package_expiry          calendar months from a Bangkok date, clamped to the month end, at 23:59:59.999 Bangkok
--   app.grant_package           a paid order's package lines become customer packages, each once
--   app.extend_package          the owner moves one package's expiry to a later day, with a reason (D88)
--   app.extend_for_pause        on resume, every package expiry moves by the exact pause length, then to 23:59 (D90)
--   app.wallet_value_expires_at when a wallet credit expires, if the club set wallet_expiry_months (D89)
--   app.wallet_expire           writes the expired remainder of one customer's wallet, oldest value first
--   app.package_reminder_hook   a no-op until F06-T14 (0514) replaces it with the reminder enqueue (design 4.5)
-- All times are computed on Bangkok dates, never UTC dates (FA 7). Numbers come from the product or from
-- club settings; an unset wallet_expiry_months means wallet value never expires and the function refuses.

-- The end of a Bangkok day: 23:59:59.999 Asia/Bangkok.
create function app.bangkok_day_end(p_day date) returns timestamptz
language sql immutable set search_path = pg_catalog
as $$ select ((p_day + 1)::timestamp at time zone 'Asia/Bangkok') - interval '1 millisecond' $$;

-- D20: the same day p_months calendar months later; a day that does not exist is the month's last day
-- (date + interval months clamps: 30 Nov plus 3 months is 28 Feb, or 29 in a leap year).
create function app.package_expiry(p_purchase_date date, p_months integer) returns timestamptz
language sql immutable set search_path = pg_catalog
as $$ select app.bangkok_day_end((p_purchase_date + make_interval(months => p_months))::date) $$;

-- D90: move by the exact length, then run to the end of the resulting Bangkok day.
create function app.shift_expiry(p_expires_at timestamptz, p_length interval) returns timestamptz
language sql immutable set search_path = pg_catalog
as $$ select app.bangkok_day_end(((p_expires_at + p_length) at time zone 'Asia/Bangkok')::date) $$;

-- Replaced by 0514 (F06-T14) with the expiry reminder enqueue; called at grant, extension and pause.
create function app.package_reminder_hook(p_package uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  return;
end $$;

-- A buyer fits a product's price group by age on the purchase date: a Student product refuses a buyer
-- of 18 or more (PKG-02-AC6). No date of birth means Adult (D12), so it fits no group with a maximum age.
create function app.buyer_fits_group(p_customer uuid, p_group uuid, p_on date) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_rule jsonb;
  v_dob date;
  v_age integer;
begin
  if p_group is null then
    return true;
  end if;
  select g.rule into v_rule from public.price_group g where g.club_id = app.club_id() and g.id = p_group;
  select u.date_of_birth into v_dob from public.app_user u where u.club_id = app.club_id() and u.id = p_customer;
  if v_dob is null then
    return not (v_rule ? 'max_age');
  end if;
  v_age := extract(year from age(p_on, v_dob))::integer;
  return v_age >= coalesce((v_rule ->> 'min_age')::integer, 0) and v_age <= coalesce((v_rule ->> 'max_age')::integer, 1000);
end $$;

-- The grant_package port (design 4.4, 4.9): called by app.apply_payment (F05) and the staff cash sale,
-- inside their transaction. Every package line of the order becomes one customer_package with the
-- product snapshot (what eligible_credits matches on), credits_total and the D20 expiry from the Bangkok
-- date of now. Unique (club_id, order_id, product_id) makes a repeat or a parallel call grant once.
-- Raises (rolling the payment back rather than taking money without a package) when the order has no
-- package line, a product is gone, or a Student product's buyer is 18 or older.
create function app.grant_package(p_order uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  o public.orders%rowtype;
  l record;
  pr public.package_product%rowtype;
  v_now timestamptz := app.now();
  v_day date := (app.now() at time zone 'Asia/Bangkok')::date;
  v_id uuid;
begin
  select * into o from public.orders where club_id = v_club and id = p_order;
  if not found or o.customer_id is null
     or not exists (select 1 from public.order_line ol where ol.club_id = v_club and ol.order_id = p_order and ol.kind = 'package') then
    raise exception 'payment:grant:order_not_package' using errcode = 'P0001';
  end if;
  for l in select ol.id, ol.package_product_id, ol.net_satang from public.order_line ol
            where ol.club_id = v_club and ol.order_id = p_order and ol.kind = 'package' order by ol.position loop
    select * into pr from public.package_product p where p.club_id = v_club and p.id = l.package_product_id;
    if not found then
      raise exception 'payment:grant:product_missing' using errcode = 'P0001';
    end if;
    if not app.buyer_fits_group(o.customer_id, pr.price_group_id, v_day) then
      raise exception 'package:not_for_this_buyer' using errcode = 'P0001';
    end if;
    insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at, order_id)
      values (v_club, o.customer_id, pr.id,
              jsonb_build_object('credit_type', pr.credit_type, 'coach_tier_id', pr.coach_tier_id, 'price_group_id', pr.price_group_id,
                                 'credits', pr.credits, 'validity_months', pr.validity_months, 'price_satang', l.net_satang,
                                 'name_th', pr.name_th, 'name_en', pr.name_en),
              pr.credits, v_now, app.package_expiry(v_day, pr.validity_months), p_order)
      on conflict (club_id, order_id, product_id) do nothing
      returning id into v_id;
    if v_id is not null then
      perform app.package_reminder_hook(v_id);
    end if;
  end loop;
end $$;

-- PKG-03-AC5, D88: the owner, one package at a time, a written reason, a later day, still ending 23:59
-- Bangkok. The extension row and the package change are audited by their triggers.
create function app.extend_package(p_package uuid, p_new_expires_at timestamptz, p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := app.user_id();
  p public.customer_package%rowtype;
  v_id uuid;
begin
  if v_club is null or v_staff is null or not app.has_any_role('owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'package:reason_required' using errcode = 'P0001';
  end if;
  select * into p from public.customer_package cp where cp.club_id = v_club and cp.id = p_package;
  if not found then
    raise exception 'package:not_found' using errcode = 'P0001';
  end if;
  perform app.lock_customer(p.customer_id);
  select * into p from public.customer_package cp where cp.club_id = v_club and cp.id = p_package for update;
  if p_new_expires_at is null or p_new_expires_at <> app.bangkok_day_end((p_new_expires_at at time zone 'Asia/Bangkok')::date)
     or (p_new_expires_at at time zone 'Asia/Bangkok')::date <= (p.expires_at at time zone 'Asia/Bangkok')::date then
    raise exception 'package:expiry_not_later_day' using errcode = 'P0001';
  end if;
  insert into public.package_extension (club_id, package_id, kind, old_expires_at, new_expires_at, reason, staff_id)
    values (v_club, p_package, 'owner', p.expires_at, p_new_expires_at, btrim(p_reason), v_staff)
    returning id into v_id;
  update public.customer_package set expires_at = p_new_expires_at where club_id = v_club and id = p_package;
  perform app.package_reminder_hook(p_package);
  return v_id;
end $$;

-- Registered in app.pause_handlers: app.resume_club runs it in its transaction (PLAT-03-AC7, D90). Every
-- package whose expiry had not passed when the pause began moves by the exact pause length, then to 23:59
-- Bangkok on the resulting day; one pause extension row each. Wallet expiry needs no row here: it is
-- derived from the club's pause records (app.wallet_value_expires_at).
create function app.extend_for_pause(p_club uuid, p_paused_at timestamptz, p_resumed_at timestamptz) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_pause uuid;
  p record;
  v_new timestamptz;
begin
  if v_club is null or p_club is distinct from v_club then
    raise exception 'package: pause for another club' using errcode = 'P0001';
  end if;
  select cp.id into v_pause from public.club_pause cp where cp.club_id = v_club and cp.paused_at = p_paused_at and cp.resumed_at = p_resumed_at;
  if not found then
    raise exception 'package:pause_not_found' using errcode = 'P0001';
  end if;
  for p in select cp.id, cp.expires_at from public.customer_package cp
            where cp.club_id = v_club and cp.expires_at >= p_paused_at order by cp.id for update loop
    v_new := app.shift_expiry(p.expires_at, p_resumed_at - p_paused_at);
    if v_new > p.expires_at then
      insert into public.package_extension (club_id, package_id, kind, old_expires_at, new_expires_at, reason, pause_id)
        values (v_club, p.id, 'pause', p.expires_at, v_new, 'pause', v_pause);
      update public.customer_package set expires_at = v_new where club_id = v_club and id = p.id;
      perform app.package_reminder_hook(p.id);
    end if;
  end loop;
end $$;

-- D89: with wallet_expiry_months set, value credited at a time expires that many calendar months after
-- its Bangkok date, at 23:59 Bangkok (D20), moved by each later pause that began before it expired
-- (D90, PKG-03-AC7). Null when the setting is unset: wallet value never expires.
create function app.wallet_value_expires_at(p_credited_at timestamptz) returns timestamptz
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_months integer := app.club_setting_text('wallet_expiry_months')::integer;
  v_at timestamptz;
  z record;
begin
  if v_months is null then
    return null;
  end if;
  v_at := app.package_expiry((p_credited_at at time zone 'Asia/Bangkok')::date, v_months);
  for z in select cp.paused_at, cp.resumed_at from public.club_pause cp
            where cp.club_id = app.club_id() and cp.resumed_at is not null and cp.paused_at >= p_credited_at
            order by cp.paused_at loop
    if z.paused_at <= v_at then
      v_at := app.shift_expiry(v_at, z.resumed_at - z.paused_at);
    end if;
  end loop;
  return v_at;
end $$;

-- Writes one expire row for the customer's wallet value that has passed its expiry and is not yet spent.
-- Oldest value is used first (assumption A-3): money in counts from its own date, every spend, negative
-- adjustment and earlier expiry has consumed the oldest value first, and a return cancels its spend
-- rather than counting as new value. Refuses when the club has not set wallet_expiry_months (D89); does
-- nothing while the club is paused (the resume moves the expiry first). Once per customer per Bangkok day.
-- Returns the satang written off.
create function app.wallet_expire(p_customer uuid) returns bigint
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_now timestamptz := app.now();
  v_in_expired bigint;
  v_out bigint;
  v_balance bigint;
  v_amount bigint;
begin
  if app.club_setting_text('wallet_expiry_months') is null then
    raise exception 'wallet:expiry_not_set' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.club c where c.id = v_club and c.status = 'paused') then
    return 0;
  end if;
  perform app.lock_wallet(p_customer);
  select coalesce(sum(l.change_satang) filter (where l.change_satang > 0 and l.reason <> 'return'
                                                  and app.wallet_value_expires_at(l.created_at) <= v_now), 0),
         coalesce(-sum(l.change_satang) filter (where l.change_satang < 0), 0)
           - coalesce(sum(l.change_satang) filter (where l.reason = 'return'), 0),
         coalesce(sum(l.change_satang), 0)
    into v_in_expired, v_out, v_balance
    from public.wallet_ledger l where l.club_id = v_club and l.customer_id = p_customer;
  v_amount := least(greatest(v_in_expired - v_out, 0), v_balance);
  if v_amount <= 0 then
    return 0;
  end if;
  insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key)
    values (v_club, p_customer, -v_amount, 'expire', 'expire:' || p_customer::text || ':' || (v_now at time zone 'Asia/Bangkok')::date::text)
    on conflict (club_id, dedupe_key) do nothing;
  if not found then
    return 0;
  end if;
  return v_amount;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.bangkok_day_end(date)', 'app.package_expiry(date, integer)', 'app.shift_expiry(timestamptz, interval)',
    'app.package_reminder_hook(uuid)', 'app.buyer_fits_group(uuid, uuid, date)', 'app.grant_package(uuid)',
    'app.extend_package(uuid, timestamptz, text)', 'app.extend_for_pause(uuid, timestamptz, timestamptz)',
    'app.wallet_value_expires_at(timestamptz)', 'app.wallet_expire(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
-- The owner's extension is called from the admin route (F06-T16) as booq_app and checks the role inside.
grant execute on function app.extend_package(uuid, timestamptz, text) to booq_app;

insert into app.pause_handlers (handler_key, handler)
  values ('f06_package_expiry', 'app.extend_for_pause(uuid, timestamptz, timestamptz)'::regprocedure);
