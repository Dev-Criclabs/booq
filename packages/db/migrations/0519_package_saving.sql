-- F06 / migration 0519: the saving shown on C9 (decision D173). F06 design 5; PKG-02-AC9.
-- saving = credits x the matching single price - the package price, where the matching single price is:
--   court_hour    the court hour price of the product's price group (court_price_rule, F04 0301);
--   solo_class    the solo price of the product's coach tier and price group (coach_tier_price, 0301);
--   group_session the group drop-in price of the product's price group (class_template.drop_in_price_satang, F08 0901),
--                 the group's audience read as F08 reads it (0905: a group whose max_age is under 18 is 'student').
-- The single price counts only when there is exactly one: when it is unset (no row, or a row with no price), or when it
-- differs by day type, time or class, there is no saving and the column is null; nothing is guessed (D173).
-- A product with no price group (the Tennis template's court bundles, D166) takes the price every group shares, and
-- none when the groups differ. Court rules: only peak 'any' rows count (peak and off_peak have no definition in v1,
-- assumption A-4, so the lookup never uses them), and the day must be covered: a day_type 'any' rule, or both a
-- weekday and a weekend rule. Group classes: the active weekly classes not yet ended.
-- plpgsql, so its body is checked when it runs: class_template comes with F08 (0901), numbered after this one.
-- The club is the caller's (app.club_id()), never an argument; the prices it reads are the ones C9 and checkout show.
-- A saving that is not above zero is not a saving and reads null (the package costs the same or more than singles).
create function app.package_single_price(p_credit_type text, p_group uuid, p_tier uuid) returns integer
language plpgsql stable security definer set search_path = pg_catalog
as $$
begin
  return (
  with club as (select app.club_id() as id),
  g as (
    select g.id,
           case when g.rule ? 'max_age' and (g.rule ->> 'max_age')::int < 18 then 'student' else 'adult' end as audience
      from public.price_group g
     where g.club_id = (select id from club) and (p_group is null or g.id = p_group)
  ),
  court as (
    select r.price_group_id, r.day_type, r.price_satang as price
      from public.court_price_rule r join g on g.id = r.price_group_id
     where r.club_id = (select id from club) and r.peak = 'any'
  ),
  court_covered as (
    -- every group in scope has its whole week priced
    select coalesce(bool_and(exists (select 1 from court c where c.price_group_id = g.id and c.day_type = 'any')
                             or (exists (select 1 from court c where c.price_group_id = g.id and c.day_type = 'weekday')
                                 and exists (select 1 from court c where c.price_group_id = g.id and c.day_type = 'weekend'))), false) as ok
      from g
  ),
  prices as (
    select c.price from court c, court_covered v where p_credit_type = 'court_hour' and v.ok
    union all
    select t.price_satang
      from g left join public.coach_tier_price t on t.club_id = (select id from club) and t.tier_id = p_tier and t.price_group_id = g.id
     where p_credit_type = 'solo_class' and p_tier is not null
    union all
    select ct.drop_in_price_satang
      from public.class_template ct
     where p_credit_type = 'group_session' and ct.club_id = (select id from club) and ct.active
       and (ct.ended_on is null or ct.ended_on >= (app.now() at time zone 'Asia/Bangkok')::date)
       and ct.audience in (select g.audience from g)
  )
  select case when count(*) > 0 and count(*) = count(price) and count(distinct price) = 1 then min(price) end
    from prices);
end $$;
alter function app.package_single_price(text, uuid, uuid) owner to booq_owner;
revoke all on function app.package_single_price(text, uuid, uuid) from public;
-- The view calls it as its reader (a function in a view runs with the caller's execute right): guests and players read C9.
grant execute on function app.package_single_price(text, uuid, uuid) to booq_app;

-- 0518's view with saving_satang added as the last column.
create or replace view public.public_package_product with (security_barrier = true) as
select p.club_id, p.id, p.name_th, p.name_en, p.credit_type, p.credits, p.validity_months, p.price_group_id, p.coach_tier_id,
       p.price_satang, round(p.price_satang::numeric / p.credits)::integer as price_per_credit_satang,
       nullif(greatest(p.credits::bigint * app.package_single_price(p.credit_type, p.price_group_id, p.coach_tier_id) - p.price_satang, 0), 0)::integer
         as saving_satang
  from public.package_product p
  join public.club c on c.id = p.club_id
 where p.club_id = app.club_id()
   and p.active and p.price_satang is not null
   and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester()));
