-- F06-T04 / migration 0505: the wallet functions. F06 design 4.1, 4.8 and 4.9; FA 2.3, 2.4 and 3.4.
-- Requirements: PKG-01-AC4, AC7, AC8, R2; decisions D37, D83, D109.
--
-- The only writers of wallet_ledger. All run as booq_owner with a fixed search path and take the club
-- from app.club_id(), never from an argument. Lock order (FA 3.4): the customer's advisory lock, then
-- the wallet_account anchor row. A spend checks the balance after the lock, so two parallel spends of
-- the last baht give exactly one success (PKG-01-AC8); the deferred trigger of 0502 is the backstop.
--   app.wallet_credit         money into the wallet for a listed reason, once per dedupe key
--   app.wallet_credit_order   the same plus the order of kind wallet_credit and its one line (D37), for the
--                             credit_wallet port (registered by 0511); returns the order id
--   app.wallet_spend          the wallet part of one order line, keyed spend:{order_line}:{attempt}
--   app.wallet_return         returns every spend of an order once (return:{spend_row})
--   app.wallet_adjust         a staff adjustment with a written note, never below zero
-- Typed errors are codes: customer_not_claimed, wallet:insufficient, wallet:below_zero, wallet:*.

-- The lock anchor exists from the first movement on; it is created here and locked in the same step.
create function app.lock_wallet(p_customer uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_id uuid;
begin
  if v_club is null then
    raise exception 'wallet: no club in the context' using errcode = 'P0001';
  end if;
  perform app.lock_customer(p_customer);
  if not exists (select 1 from public.app_user u where u.club_id = v_club and u.id = p_customer) then
    raise exception 'wallet:customer_not_found' using errcode = 'P0001';
  end if;
  insert into public.wallet_account (club_id, customer_id) values (v_club, p_customer)
    on conflict (club_id, customer_id) do nothing;
  select a.id into v_id from public.wallet_account a where a.club_id = v_club and a.customer_id = p_customer for update;
  return v_id;
end $$;

-- An imported (unclaimed), merged or inactive record cannot have value taken from it (design 4.8).
create function app.require_claimed_customer(p_customer uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if not exists (select 1 from public.app_user u
                  where u.club_id = app.club_id() and u.id = p_customer and u.active and u.claim_state is null) then
    raise exception 'customer_not_claimed' using errcode = 'P0001';
  end if;
end $$;

create function app.wallet_sum(p_customer uuid) returns bigint
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select coalesce(sum(l.change_satang), 0)::bigint from public.wallet_ledger l
   where l.club_id = app.club_id() and l.customer_id = p_customer
$$;

-- Money in. The caller names the reason and supplies the dedupe key (for example late_payment:{payment},
-- referral:{referral}); a repeat returns the first row and writes nothing. A deleted (anonymised)
-- account still receives value (D109), so this does not require a claimed customer. A staff
-- adjustment goes through app.wallet_adjust, never here.
create function app.wallet_credit(
  p_customer uuid, p_amount_satang bigint, p_reason text, p_dedupe_key text,
  p_order uuid default null, p_payment uuid default null, p_booking uuid default null, p_referral uuid default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_id uuid;
begin
  if p_reason is null or p_reason not in ('refund', 'late_payment', 'wrong_amount', 'duplicate_payment', 'referral_reward', 'return', 'import') then
    raise exception 'wallet:reason' using errcode = 'P0001';
  end if;
  if p_amount_satang is null or p_amount_satang <= 0 then
    raise exception 'wallet:amount' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_dedupe_key, '')), '') is null then
    raise exception 'wallet:dedupe_key' using errcode = 'P0001';
  end if;
  perform app.lock_wallet(p_customer);
  select l.id into v_id from public.wallet_ledger l where l.club_id = v_club and l.dedupe_key = p_dedupe_key;
  if found then
    return v_id;
  end if;
  insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, order_id, payment_id, booking_id, referral_id, dedupe_key)
    values (v_club, p_customer, p_amount_satang, p_reason, p_order, p_payment, p_booking, p_referral, p_dedupe_key)
    returning id into v_id;
  return v_id;
end $$;

-- Money that cannot confirm anything becomes wallet value plus an order the receipt can attach to (D37):
-- one order of kind wallet_credit, paid, with one wallet_credit line for the amount, and the wallet row
-- tied to both and to the payment, in the caller's transaction. The same dedupe key returns the same
-- order and creates nothing (design 4.9). The line's description is a text key: the receipt reads the
-- wording from the language files, so the name columns carry the key too (no text in code).
create function app.wallet_credit_order(
  p_customer uuid, p_amount_satang bigint, p_reason text, p_dedupe_key text, p_payment uuid default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_key constant text := 'L-new.wallet_credit_line';
  v_order uuid;
  v_line uuid;
  v_source text := 'staff';
begin
  if p_reason is null or p_reason not in ('late_payment', 'duplicate_payment', 'wrong_amount', 'refund') then
    raise exception 'wallet:reason' using errcode = 'P0001';
  end if;
  if p_amount_satang is null or p_amount_satang <= 0 or p_amount_satang > 2147483647 then
    raise exception 'wallet:amount' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_dedupe_key, '')), '') is null then
    raise exception 'wallet:dedupe_key' using errcode = 'P0001';
  end if;
  perform app.lock_wallet(p_customer);
  select l.order_id into v_order from public.wallet_ledger l where l.club_id = v_club and l.dedupe_key = p_dedupe_key;
  if found then
    if v_order is null then
      raise exception 'wallet:dedupe_key_used' using errcode = 'P0001';
    end if;
    return v_order;
  end if;
  if p_payment is not null then
    select o.source into v_source from public.payment p join public.orders o on o.club_id = p.club_id and o.id = p.order_id
     where p.club_id = v_club and p.id = p_payment;
    if not found then
      raise exception 'payment:not_found' using errcode = 'P0001';
    end if;
  end if;
  insert into public.orders (club_id, customer_id, source, status, kind, price_group_snapshot, subtotal_satang, discount_satang,
                             total_satang, credit_value_satang, wallet_satang, money_satang, quote_hash, priced_at)
    values (v_club, p_customer, v_source, 'paid', 'wallet_credit', '{}', p_amount_satang, 0,
            p_amount_satang, 0, 0, p_amount_satang, encode(sha256(convert_to('wallet_credit:' || p_dedupe_key, 'UTF8')), 'hex'), app.now())
    returning id into v_order;
  insert into public.order_line (club_id, order_id, position, kind, description_key, name_th, name_en,
                                 unit_price_satang, discount_satang, net_satang, money_satang)
    values (v_club, v_order, 1, 'wallet_credit', v_key, v_key, v_key, p_amount_satang, 0, p_amount_satang, p_amount_satang)
    returning id into v_line;
  insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, order_id, order_line_id, payment_id, dedupe_key)
    values (v_club, p_customer, p_amount_satang, p_reason, v_order, v_line, p_payment, p_dedupe_key);
  return v_order;
end $$;

-- The wallet part of one order line (F04 Pay, the late reclaim). The amount is the line's frozen wallet
-- part (CC-2). A spend of the line that has not been returned stands: calling again writes nothing and
-- returns it. After a return (a released hold), the next spend is the next attempt, so a late payment
-- that reclaims the order can spend again (design 4.1, A-13).
create function app.wallet_spend(p_customer uuid, p_amount_satang bigint, p_order uuid, p_line uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  l public.order_line%rowtype;
  v_id uuid;
  v_attempt integer;
begin
  if p_amount_satang is null or p_amount_satang <= 0 then
    raise exception 'wallet:amount' using errcode = 'P0001';
  end if;
  perform app.lock_wallet(p_customer);
  perform app.require_claimed_customer(p_customer);
  select * into l from public.order_line ol where ol.club_id = v_club and ol.id = p_line and ol.order_id = p_order;
  if not found or not exists (select 1 from public.orders o where o.club_id = v_club and o.id = p_order and o.customer_id = p_customer) then
    raise exception 'wallet:line_not_found' using errcode = 'P0001';
  end if;
  if l.wallet_satang <> p_amount_satang then
    raise exception 'wallet:amount' using errcode = 'P0001';
  end if;
  select s.id into v_id from public.wallet_ledger s
   where s.club_id = v_club and s.order_line_id = p_line and s.reason = 'spend'
     and not exists (select 1 from public.wallet_ledger r where r.club_id = v_club and r.dedupe_key = 'return:' || s.id::text)
   order by s.created_at desc limit 1;
  if found then
    return v_id;
  end if;
  if app.wallet_sum(p_customer) < p_amount_satang then
    raise exception 'wallet:insufficient' using errcode = 'P0001';
  end if;
  select count(*) + 1 into v_attempt from public.wallet_ledger s
   where s.club_id = v_club and s.order_line_id = p_line and s.reason = 'spend';
  insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, booking_id, order_id, order_line_id, dedupe_key)
    values (v_club, p_customer, -p_amount_satang, 'spend', l.booking_id, p_order, p_line, 'spend:' || p_line::text || ':' || v_attempt)
    returning id into v_id;
  return v_id;
end $$;

-- Gives back every spend of an order, in id order, each once (return:{spend_row}): a hold that ended
-- (F04 R7-AC6), a release (F03), a cancel that returns wallet use (D21). p_reason is the caller's cause;
-- the ledger reason is always return. Returns the number of rows written.
create function app.wallet_return(p_order uuid, p_reason text) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  s record;
  v_n integer := 0;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'wallet:reason' using errcode = 'P0001';
  end if;
  select o.customer_id into v_customer from public.orders o where o.club_id = v_club and o.id = p_order;
  if not found then
    raise exception 'wallet:order_not_found' using errcode = 'P0001';
  end if;
  if v_customer is null then
    return 0;                               -- a walk-in without a customer spends no wallet
  end if;
  perform app.lock_wallet(v_customer);
  for s in select w.* from public.wallet_ledger w
            where w.club_id = v_club and w.order_id = p_order and w.reason = 'spend' order by w.id loop
    insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, booking_id, order_id, order_line_id, dedupe_key)
      values (v_club, s.customer_id, -s.change_satang, 'return', s.booking_id, s.order_id, s.order_line_id, 'return:' || s.id::text)
      on conflict (club_id, dedupe_key) do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- A staff adjustment (front desk or owner): a written note always (PKG-01-AC4), never below zero (D83),
-- never taking value from an unclaimed record (design 4.8). The row is audited by its trigger.
create function app.wallet_adjust(p_customer uuid, p_delta_satang bigint, p_note text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := app.user_id();
  v_id uuid;
begin
  if v_club is null or v_staff is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'wallet:note_required' using errcode = 'P0001';
  end if;
  if p_delta_satang is null or p_delta_satang = 0 then
    raise exception 'wallet:amount' using errcode = 'P0001';
  end if;
  perform app.lock_wallet(p_customer);
  if p_delta_satang < 0 then
    perform app.require_claimed_customer(p_customer);
    if app.wallet_sum(p_customer) + p_delta_satang < 0 then
      raise exception 'wallet:below_zero' using errcode = 'P0001';
    end if;
  end if;
  insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, staff_id, note)
    values (v_club, p_customer, p_delta_satang, 'adjust', v_staff, btrim(p_note))
    returning id into v_id;
  return v_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.lock_wallet(uuid)', 'app.require_claimed_customer(uuid)', 'app.wallet_sum(uuid)',
    'app.wallet_credit(uuid, bigint, text, text, uuid, uuid, uuid, uuid)',
    'app.wallet_credit_order(uuid, bigint, text, text, uuid)',
    'app.wallet_spend(uuid, bigint, uuid, uuid)', 'app.wallet_return(uuid, text)', 'app.wallet_adjust(uuid, bigint, text)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
-- The staff action is called from the admin route (F06-T16) as booq_app and checks the role inside. The
-- rest are called by other definer functions (F04 Pay, F05, F09, F14) and need no grant.
grant execute on function app.wallet_adjust(uuid, bigint, text) to booq_app;
