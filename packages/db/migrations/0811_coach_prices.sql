-- F07-T11 / migration 0811: the coaching price the caller sees (COACH-02-AC1 to AC4, AC7; R1; D120, D156). F07 design 5.2, 5.3.
-- app.coach_prices() returns, for every active published coach of the club, the price in satang for the CALLER's price group: the
-- coach's own override for that group if there is one, else the tier price for that group, else null (not set: the coach is shown with
-- no price and no pick action, COACH-02-AC4). The caller's group follows packages/domain checkout groupFor: by age on the Bangkok
-- date from the caller's own date of birth; a guest or no date of birth is the group with no upper age (D12); a date that matches
-- no group or more than one gives no price. The date of birth is read inside and never returned; the override table stays owner only.
-- Display only: Pay (F04) prices again from the same rows and the player pays what Pay says (R5-AC6).
create function app.coach_prices() returns table (coach_id uuid, price_satang integer)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_dob date;
  v_today date := (app.now() at time zone 'Asia/Bangkok')::date;
  v_group uuid;
  v_n integer;
begin
  if v_club is null then
    return;
  end if;
  if app.user_id() is not null then
    select u.date_of_birth into v_dob from public.app_user u where u.club_id = v_club and u.id = app.user_id();
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
alter function app.coach_prices() owner to booq_owner;
revoke all on function app.coach_prices() from public;
grant execute on function app.coach_prices() to booq_app, booq_worker;
