-- Reviewer F4-2: the price tables must not be readable by a guest before the club is open.
-- Migration 0301 let every role of the app read them (using true). A guest, or any player, of a club in
-- Draft or Testing could read its prices. The rule is the one the public views use (migration 0220):
--   Live or Paused: everyone in the club's context (the schedule and quote need the prices);
--   Testing: the club's testers (app.is_club_tester: the owner and the named testers);
--   Draft: nobody but the club's own staff, who set the prices up.
-- Owner, front desk and accountant always read, whatever the status (they configure and report).
-- The worker keeps reading in the club's context.
do $$
declare t text;
begin
  foreach t in array array['price_group', 'court_price_rule', 'coach_tier', 'coach_tier_price', 'add_on'] loop
    execute format('drop policy %1$s_read on public.%1$I', t);
    execute format($f$create policy %1$s_read on public.%1$I for select to booq_app using (
        app.has_any_role('owner', 'front_desk', 'accountant')
        or exists (select 1 from public.club c where c.id = %1$I.club_id
                    and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester()))))$f$, t);
    execute format('create policy %1$s_worker_read on public.%1$I for select to booq_worker using (true)', t);
  end loop;
end $$;
