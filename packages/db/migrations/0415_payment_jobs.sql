-- F05-T09 / migration 0415: what the payment jobs read and write (PAY-02-AC15, PAY-04-AC1 to AC7; D73, D74; F05 design
-- 5.2, 5.10). Built by BE-C on the orchestrator's instruction of 31 Oct. Every function is SECURITY DEFINER, executable by
-- booq_worker only, and takes the club from app.club_id(); none takes a club argument.
--   * app.beam_merchant(set): the merchant id of the club's test or live key set, or null. The reconcile lookup needs it
--     and the worker has no read on payment_connection.
--   * app.beam_reconcile_candidates(): the club's pending Beam payments that have a charge and are older than the
--     platform setting beam_reconcile_age_seconds. None while the setting is unset (no value in code). Only pending
--     payments: the design's "recently expired" window has no setting of its own, so none is invented; an expired
--     package payment that is paid later still arrives through the webhook.
--   * app.package_order_expiry_candidates() and app.expire_package_order(order): a package order with no booking, still
--     open, whose pending Beam payment's QR time has passed, is cancelled and its payment set expired with the QR
--     cleared. No ledger row and no receipt (PAY-04-AC2). A payment that arrives after it goes to the wallet with its own
--     receipt through apply_payment's cancelled-order path (D74).
--   * app.clear_final_qr_images(): a final payment keeps no QR image.

create function app.require_worker() returns void
language plpgsql set search_path = pg_catalog
as $$
begin
  if app.club_id() is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create function app.beam_merchant(p_set text) returns text
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  perform app.require_worker();
  if p_set is null or p_set not in ('test', 'live') then
    raise exception 'payment: unknown key set' using errcode = '22023';
  end if;
  return (select case when p_set = 'live' then c.merchant_id_live else c.merchant_id_test end
            from public.payment_connection c where c.club_id = app.club_id());
end $$;

create function app.beam_reconcile_candidates()
returns table (payment_id uuid, gateway_charge_id text, environment text, amount_satang integer)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_age integer;
begin
  perform app.require_worker();
  select case when jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric >= 0 then floor((value #>> '{}')::numeric)::integer end
    into v_age from platform.config where key = 'beam_reconcile_age_seconds';
  if v_age is null then
    return;
  end if;
  return query
    select p.id, p.gateway_charge_id, p.environment, p.amount_satang
      from public.payment p
     where p.club_id = app.club_id() and p.method = 'beam' and p.status = 'pending'
       and p.gateway_charge_id is not null and p.created_at <= app.now() - make_interval(secs => v_age)
     order by p.created_at, p.id;
end $$;

create function app.package_order_expiry_candidates() returns setof uuid
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  perform app.require_worker();
  return query
    select o.id from public.orders o
     where o.club_id = app.club_id() and o.status = 'open'
       and not exists (select 1 from public.booking b where b.club_id = o.club_id and b.order_id = o.id)
       and exists (select 1 from public.payment p where p.club_id = o.club_id and p.order_id = o.id and p.method = 'beam'
                    and p.status = 'pending' and p.qr_expires_at is not null and p.qr_expires_at <= app.now())
     order by o.created_at, o.id;
end $$;

create function app.expire_package_order(p_order uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  o public.orders%rowtype;
  v_rows integer;
begin
  perform app.require_worker();
  -- Lock order: the order, then its payment (FA 3.4), as apply_payment does, so a payment and the expiry cannot both win.
  select * into o from public.orders where club_id = v_club and id = p_order for update;
  if not found or o.status <> 'open'
     or exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order) then
    return false;
  end if;
  update public.payment set status = 'expired', qr_image = null
   where club_id = v_club and order_id = p_order and method = 'beam' and status = 'pending'
     and qr_expires_at is not null and qr_expires_at <= app.now();
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;                                  -- paid or not yet due: nothing changes
  end if;
  update public.orders set status = 'cancelled' where club_id = v_club and id = p_order;
  return true;
end $$;

create function app.clear_final_qr_images() returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_rows integer;
begin
  perform app.require_worker();
  update public.payment set qr_image = null
   where club_id = app.club_id() and qr_image is not null and status in ('succeeded', 'failed', 'expired', 'cancelled');
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.require_worker()', 'app.beam_merchant(text)', 'app.beam_reconcile_candidates()',
                           'app.package_order_expiry_candidates()', 'app.expire_package_order(uuid)', 'app.clear_final_qr_images()'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
  foreach f in array array['app.beam_merchant(text)', 'app.beam_reconcile_candidates()', 'app.package_order_expiry_candidates()',
                           'app.expire_package_order(uuid)', 'app.clear_final_qr_images()'] loop
    execute format('grant execute on function %s to booq_worker', f);
  end loop;
end $$;
