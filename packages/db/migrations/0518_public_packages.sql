-- F06-T15 / migration 0518: what a guest may read of the club's package products (C9). F06 design 5; D103.
-- Requirements: PKG-02-AC7, AC8, AC9, CC-3.
-- package_product is readable to the club's people only (0513); a guest reads products through this view and nothing
-- else: the named public columns, for a product that is active and has a price (no price is not offered, PKG-02-AC7;
-- inactive is not offered, AC8). The club-visibility rule of the other public views (0220): a Live or Paused club shows
-- to everyone, a club in Testing to its testers, a Draft club to nobody. The price per credit is rounded half up to
-- the satang (D23).
create view public.public_package_product with (security_barrier = true) as
select p.club_id, p.id, p.name_th, p.name_en, p.credit_type, p.credits, p.validity_months, p.price_group_id, p.coach_tier_id,
       p.price_satang, round(p.price_satang::numeric / p.credits)::integer as price_per_credit_satang
  from public.package_product p
  join public.club c on c.id = p.club_id
 where p.club_id = app.club_id()
   and p.active and p.price_satang is not null
   and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester()));
alter view public.public_package_product owner to booq_owner;
revoke all on public.public_package_product from public;
grant select on public.public_package_product to booq_app;
