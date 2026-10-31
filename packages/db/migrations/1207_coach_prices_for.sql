-- F07 / lane 2 A2: the coach picker at the desk shows each coach's price for the CUSTOMER's price group, not the staff member's own.
-- app.coach_prices_for(customer) is app.coach_prices (0811) for a named customer. Owner and front desk only; the club comes from
-- app.club_id(). The group comes from the customer's date of birth through app.customer_dob_for_pricing (0320: a missing, other-club,
-- inactive or unclaimed person is refused with the same message). A null customer is a walk in with no record: no date of birth, so the
-- group with no upper age (the standard price). A coach with no price for that group has a null price (cannot be picked). Display only:
-- Pay prices again from the same rows.
create function app.coach_prices_for(p_customer uuid) returns table (coach_id uuid, price_satang integer)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_dob date;
  v_today date := (app.now() at time zone 'Asia/Bangkok')::date;
  v_group uuid;
  v_n integer;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'coach prices: not allowed' using errcode = '42501';
  end if;
  if p_customer is not null then
    v_dob := app.customer_dob_for_pricing(p_customer);
  end if;
  select (array_agg(g.id))[1], count(*)::integer into v_group, v_n
    from public.price_group g
   where g.club_id = v_club
     and case when v_dob is null then not (g.rule ? 'max_age')
              else ((not (g.rule ? 'min_age')) or date_part('year', age(v_today, v_dob)) >= (g.rule ->> 'min_age')::int)
               and ((not (g.rule ? 'max_age')) or date_part('year', age(v_today, v_dob)) <= (g.rule ->> 'max_age')::int) end;
  return query
    select c.id,
           case when v_n = 1 then coalesce(o.price_satang, tp.price_satang) end
      from public.coach c
      left join public.coach_price_override o on o.club_id = c.club_id and o.coach_id = c.id and o.price_group_id = v_group
      left join public.coach_tier_price tp on tp.club_id = c.club_id and tp.tier_id = c.tier_id and tp.price_group_id = v_group
     where c.club_id = v_club and c.active and c.published;
end $$;
alter function app.coach_prices_for(uuid) owner to booq_owner;
revoke all on function app.coach_prices_for(uuid) from public;
grant execute on function app.coach_prices_for(uuid) to booq_app;

-- The coaches who could be added to one confirmed court booking: the check add_coach_to_booking runs (app.coach_check with the booking
-- named, so its own court hour does not count against it). app.coaches_offerable cannot be used, it wants a free court and this booking
-- already holds one. Owner and front desk only; a booking that is not a confirmed court booking without a coach, or has an add under way,
-- returns nothing.
create function app.coaches_for_booking(p_booking uuid) returns setof uuid
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  c record;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'coaches: not allowed' using errcode = '42501';
  end if;
  select * into b from public.booking x where x.club_id = v_club and x.id = p_booking;
  if b.id is null or b.status <> 'confirmed' or b.type <> 'court' or b.coach_id is not null
     or exists (select 1 from public.booking_coach_add a where a.club_id = v_club and a.booking_id = p_booking and a.status in ('pending', 'confirmed')) then
    return;
  end if;
  for c in select co.id from public.coach co where co.club_id = v_club and co.active order by co.id loop
    if app.coach_check(v_club, c.id, array[b.start_at], p_booking) is null then
      return next c.id;
    end if;
  end loop;
end $$;
alter function app.coaches_for_booking(uuid) owner to booq_owner;
revoke all on function app.coaches_for_booking(uuid) from public;
grant execute on function app.coaches_for_booking(uuid) to booq_app;
