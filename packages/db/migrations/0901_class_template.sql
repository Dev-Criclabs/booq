-- F08-T01 / migration 0901: class_template, the owner's weekly group class (CLASS-01-AC1, AC5, AC10; D157). F08 design 3.2.
-- One row is one class a week at one hour with one coach on one court. The database stores what was saved: the form
-- pre-fills min_players and max_players from the club settings group_min_players and group_max_players, but no setting is
-- read here and no number is chosen. drop_in_price_satang is null until the owner sets it, and null means no drop in
-- price (credit or wallet only), never a default (D157). Class D, composite keys with club_id. Policies and grants for
-- the application roles come with 0911; this migration gives the table row security with the tenant and definer
-- policies and nothing else, as the F07 tables did.

create table public.class_template (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  name_th text not null,
  name_en text not null,
  audience text not null,
  level text,
  coach_id uuid not null,
  resource_id uuid not null,
  weekday smallint not null,                  -- 0 Sunday to 6 Saturday, Bangkok week
  start_time time not null,                   -- on the hour; the class is one hour
  duration_minutes smallint not null default 60,
  min_players smallint not null,
  max_players smallint not null,
  drop_in_price_satang integer,
  active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default app.now(),
  ended_on date,
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, coach_id) references public.coach (club_id, id),
  foreign key (club_id, resource_id) references public.resource (club_id, id),
  foreign key (club_id, created_by) references public.app_user (club_id, id),
  constraint class_template_names check (btrim(name_th) <> '' and btrim(name_en) <> ''),
  constraint class_template_audience check (audience in ('adult', 'student')),
  constraint class_template_weekday check (weekday between 0 and 6),
  constraint class_template_on_the_hour check (extract(minute from start_time) = 0 and extract(second from start_time) = 0 and start_time < time '24:00'),
  constraint class_template_one_hour check (duration_minutes = 60),
  constraint class_template_players check (min_players >= 1 and min_players <= max_players),
  constraint class_template_drop_in check (drop_in_price_satang is null or drop_in_price_satang >= 0)
);
create index class_template_active on public.class_template (club_id, weekday, start_time) where active;

alter table public.class_template owner to booq_owner;
alter table public.class_template enable row level security;
alter table public.class_template force row level security;
revoke all on public.class_template from public;
create policy class_template_tenant on public.class_template as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy class_template_definer on public.class_template for all to booq_owner using (true) with check (true);

-- Deleted after the sessions made from it, before the coach and the court it points at.
select app.register_test_table('public.class_template', 845);
select audit.register('public.class_template', array['id']);
