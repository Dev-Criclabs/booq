-- F04-T01 / migration 0301: the price tables. F04 design 3.2. Requirements: R1, R2-AC3, R3-AC1, CC-1.
-- Class S (setup): BOOQ staff may see them in the support view as "products and pricing" (D27);
-- their grants for that come with F04-T05. Prices are integer satang. A null price means "not set"
-- and the thing is not offered (a coach tier with no price, an add-on with no price). Nothing here
-- invents a price: Hunter's values arrive as template data (F04-T06).

create table public.price_group (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  name_th text not null check (btrim(name_th) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  rule jsonb not null,                       -- {min_age, max_age}; the player's group is computed, never stored on the player
  position integer not null default 0,
  primary key (club_id, id),
  constraint price_group_rule_shape check (
    jsonb_typeof(rule) = 'object'
    and (rule ? 'min_age' or rule ? 'max_age')
    and coalesce((rule ->> 'min_age')::int, 0) >= 0
    and coalesce((rule ->> 'min_age')::int, 0) <= coalesce((rule ->> 'max_age')::int, 200)
  )
);

create table public.court_price_rule (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  price_group_id uuid not null,
  day_type text not null default 'any',
  peak text not null default 'any',          -- 'peak' and 'off_peak' have no definition in v1 (assumption A-4): the lookup rejects them
  price_satang integer not null check (price_satang >= 0),
  primary key (club_id, id),
  foreign key (club_id, price_group_id) references public.price_group (club_id, id),
  constraint court_price_rule_day_type_values check (day_type in ('any', 'weekday', 'weekend')),
  constraint court_price_rule_peak_values check (peak in ('any', 'peak', 'off_peak')),
  constraint court_price_rule_key unique (club_id, price_group_id, day_type, peak)
);

create table public.coach_tier (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  name_th text not null check (btrim(name_th) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  primary key (club_id, id)
);

create table public.coach_tier_price (
  club_id uuid not null,
  tier_id uuid not null,
  price_group_id uuid not null,
  price_satang integer check (price_satang is null or price_satang >= 0),   -- null: not set, the coach cannot be picked
  primary key (club_id, tier_id, price_group_id),
  foreign key (club_id, tier_id) references public.coach_tier (club_id, id),
  foreign key (club_id, price_group_id) references public.price_group (club_id, id)
);

create table public.add_on (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  name_th text not null check (btrim(name_th) <> ''),
  name_en text not null check (btrim(name_en) <> ''),
  price_satang integer check (price_satang is null or price_satang >= 0),   -- null: not for sale
  active boolean not null default true,
  position integer not null default 0,
  primary key (club_id, id)
);

-- Ownership, RLS, policies, grants: the club's people read them (a player needs the prices to see
-- a quote); the owner writes. Orders keep copies, so editing or deactivating never changes history.
do $$
declare t text;
begin
  foreach t in array array['price_group', 'court_price_rule', 'coach_tier', 'coach_tier_price', 'add_on'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    execute format('create policy %1$s_definer_read on public.%1$I for select to booq_owner using (true)', t);
    execute format('create policy %1$s_read on public.%1$I for select to booq_app, booq_worker using (true)', t);
    execute format($f$create policy %1$s_owner on public.%1$I for all to booq_app
                      using (app.has_any_role('owner')) with check (app.has_any_role('owner'))$f$, t);
    execute format('grant select on public.%I to booq_app, booq_worker', t);
    execute format('grant insert, update, delete on public.%I to booq_app', t);
  end loop;
end $$;

select audit.register('public.price_group', array['id']);
select audit.register('public.court_price_rule', array['id']);
select audit.register('public.coach_tier', array['id']);
select audit.register('public.coach_tier_price', array['tier_id', 'price_group_id']);
select audit.register('public.add_on', array['id']);
