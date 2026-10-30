-- F04-T05 / migration 0305 (the design's 0306): BOOQ staff and the price tables. F04 design 8.
-- Class S: the support view shows "products and pricing" (D27). Same rule as every setup table
-- (migration 0008): an admin sees all clubs, a specialist the assigned ones; edits only while the
-- club is in Draft or Testing or the owner's window is open. BOOQ staff have no privilege at all on
-- orders, order lines, promo codes, redemptions, partners or birthday uses (class D, migration 0302/0303).
do $$
declare t text;
begin
  foreach t in array array['price_group', 'court_price_rule', 'coach_tier', 'coach_tier_price', 'add_on'] loop
    execute format('grant select, insert, update, delete on public.%I to booq_platform', t);
    execute format($f$create policy %1$s_platform_read on public.%1$I for select to booq_platform using (platform.can_see_club(club_id))$f$, t);
    execute format($f$create policy %1$s_platform_write on public.%1$I for all to booq_platform
                      using (platform.can_see_club(club_id) and platform.club_editable(club_id))
                      with check (platform.can_see_club(club_id) and platform.club_editable(club_id))$f$, t);
  end loop;
end $$;
