-- F04-T11 request from BE-C / migration 0315: the reads the quote engine needs, without a lock.
-- app.quote_promo_code(code, customer): the terms of a code and the counts, for the club in the context. The match is
-- upper(btrim(code)) in this club only, so an unknown code and another club's code look the same (null). An inactive
-- code is returned with active false. The customer is the caller (app.user_id()); a staff member (owner, front desk)
-- may ask about another customer. The counts are counted redemptions only (a restored use does not count, D70).
-- customer_has_paid_booking is the first booking rule's input: a confirmed, no show or late cancelled booking.
-- Scope, audience, minimum spend and value are the engine's decisions; the lock and the final check stay in
-- count_promo_use at Pay (PROMO-01-AC7).
-- app.birthday_discount(): the club's birthday discount {kind, value}, or null when the club has not set it (R5-AC1).
create function app.quote_promo_code(p_code text, p_customer uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  c public.promo_code%rowtype;
begin
  if v_club is null then
    raise exception 'quote_promo_code needs a club in the context' using errcode = 'P0001';
  end if;
  if p_customer is not null and p_customer is distinct from app.user_id() and not app.has_any_role('owner', 'front_desk') then
    raise exception 'promo: not allowed to ask about another customer' using errcode = '42501';
  end if;
  v_customer := coalesce(p_customer, app.user_id());
  select * into c from public.promo_code where club_id = v_club and code_upper = upper(btrim(coalesce(p_code, '')));
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'value', c.value, 'applies_to', to_jsonb(c.applies_to), 'includes_add_ons', c.includes_add_ons,
    'audience', c.audience, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'first_time_only', c.first_time_only,
    'total_cap', c.total_cap, 'per_customer_cap', c.per_customer_cap, 'min_spend_satang', c.min_spend_satang,
    'stackable_with_birthday', c.stackable_with_birthday, 'partner_id', c.partner_id, 'active', c.active,
    'uses_counted', (select count(*) from public.promo_redemption r where r.club_id = v_club and r.code_id = c.id and r.status = 'counted'),
    'customer_uses_counted', case when v_customer is null then 0 else
      (select count(*) from public.promo_redemption r where r.club_id = v_club and r.code_id = c.id and r.customer_id = v_customer and r.status = 'counted') end,
    'customer_has_paid_booking', case when v_customer is null then false else
      exists (select 1 from public.booking b where b.club_id = v_club and b.customer_id = v_customer and b.status in ('confirmed', 'no_show', 'late_cancelled')) end);
end $$;

create function app.birthday_discount() returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select s.value from public.club_setting s where s.club_id = app.club_id() and s.key = 'birthday_discount' $$;

do $$
declare f text;
begin
  foreach f in array array['app.quote_promo_code(text, uuid)', 'app.birthday_discount()'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
