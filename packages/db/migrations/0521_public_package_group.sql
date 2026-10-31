-- F06-T17 / migration 0521: the price group's name on C9 (PKG-02-AC6; F06 design 5; D103).
-- A product for one price group (the Student and Adult packs of the Tennis template share a name) is labelled with
-- that group's name, so a player sees which is theirs; the server still refuses a Student pack to an adult
-- (PKG-02-AC6). The group's names are the owner's text, as shown on the club's prices. 0519's view with two columns
-- added last; a product with no price group has null names.
create or replace view public.public_package_product with (security_barrier = true) as
select p.club_id, p.id, p.name_th, p.name_en, p.credit_type, p.credits, p.validity_months, p.price_group_id, p.coach_tier_id,
       p.price_satang, round(p.price_satang::numeric / p.credits)::integer as price_per_credit_satang,
       nullif(greatest(p.credits::bigint * app.package_single_price(p.credit_type, p.price_group_id, p.coach_tier_id) - p.price_satang, 0), 0)::integer
         as saving_satang,
       g.name_th as price_group_name_th, g.name_en as price_group_name_en
  from public.package_product p
  join public.club c on c.id = p.club_id
  left join public.price_group g on g.club_id = p.club_id and g.id = p.price_group_id
 where p.club_id = app.club_id()
   and p.active and p.price_satang is not null
   and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester()));
