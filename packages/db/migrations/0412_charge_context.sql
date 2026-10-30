-- F05-T04b-db / migration 0412: what the charge code needs from the database, and where it writes the charge back.
-- Requirements: PAY-02-AC1 to AC3, PAY-01-AC1, AC4, AC7; decisions D47, D72, D75. F05 design 5.1.
--   app.payment_charge_context(payment) returns jsonb {merchant_id, environment, amount_satang, hold_expires_at,
--     qr_expiry_margin_seconds}: for the pending Beam payment of the caller's own order, or any such payment for
--     staff. merchant_id is the id of the key set the payment uses (test or live, never mixed), or null when the club
--     has none; qr_expiry_margin_seconds is the platform setting, null while unset; hold_expires_at is the earliest
--     expiry of the order's running hold, null when none runs. The API key and the webhook token are never returned;
--     the server reads the key through the secret reader.
--   app.record_charge(payment, charge_id, qr_image, qr_expires_at): writes the charge Beam created onto a pending Beam
--     payment that has none yet. A second write is refused (the first charge stands, D72).
-- Both are SECURITY DEFINER, club from app.club_id(), granted to booq_app. Refusals are 'payment: ...' messages.

create function app.payment_charge_context(p_payment uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  p public.payment%rowtype;
  o public.orders%rowtype;
  v_merchant text;
  v_margin text;
  v_hold timestamptz;
begin
  if v_club is null then
    raise exception 'payment_charge_context needs a club in the context' using errcode = 'P0001';
  end if;
  select * into p from public.payment where club_id = v_club and id = p_payment;
  if not found or p.method <> 'beam' or p.status <> 'pending' then
    raise exception 'payment: no pending Beam payment' using errcode = 'P0001';
  end if;
  select * into o from public.orders where club_id = v_club and id = p.order_id;
  if not (app.has_any_role('owner', 'front_desk') or (app.user_id() is not null and o.customer_id = app.user_id())) then
    raise exception 'payment: no pending Beam payment' using errcode = 'P0001';   -- not yours looks like missing
  end if;
  select case p.environment when 'test' then c.merchant_id_test else c.merchant_id_live end into v_merchant
    from public.payment_connection c where c.club_id = v_club;
  select c.value #>> '{}' into v_margin from platform.config c where c.key = 'qr_expiry_margin_seconds';
  select min(b.hold_expires_at) into v_hold from public.booking b
   where b.club_id = v_club and b.order_id = p.order_id and b.status = 'awaiting_payment' and b.hold_expires_at > app.now();
  return jsonb_build_object('merchant_id', nullif(btrim(coalesce(v_merchant, '')), ''), 'environment', p.environment,
                            'amount_satang', p.amount_satang, 'hold_expires_at', v_hold,
                            'qr_expiry_margin_seconds', case when v_margin ~ '^[0-9]+$' then v_margin::integer end);
end $$;

create function app.record_charge(p_payment uuid, p_charge_id text, p_qr_image text, p_qr_expires_at timestamptz) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  p public.payment%rowtype;
  o public.orders%rowtype;
begin
  if v_club is null then
    raise exception 'record_charge needs a club in the context' using errcode = 'P0001';
  end if;
  select * into p from public.payment where club_id = v_club and id = p_payment for update;
  if found then
    select * into o from public.orders where club_id = v_club and id = p.order_id;
  end if;
  if not found or p.method <> 'beam' or p.status <> 'pending'
     or not (app.has_any_role('owner', 'front_desk') or (app.user_id() is not null and o.customer_id = app.user_id())) then
    raise exception 'payment: no pending Beam payment' using errcode = 'P0001';
  end if;
  if p.gateway_charge_id is not null then
    raise exception 'payment: the charge is already recorded' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_charge_id, '')), '') is null or nullif(btrim(coalesce(p_qr_image, '')), '') is null or p_qr_expires_at is null then
    raise exception 'payment: invalid charge' using errcode = 'P0001';
  end if;
  begin
    update public.payment set gateway_charge_id = p_charge_id, qr_image = p_qr_image, qr_expires_at = p_qr_expires_at
     where club_id = v_club and id = p_payment;
  exception when unique_violation then
    raise exception 'payment: the charge belongs to another payment' using errcode = 'P0001';
  end;
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.payment_charge_context(uuid)', 'app.record_charge(uuid, text, text, timestamptz)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
