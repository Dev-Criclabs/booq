-- F08-T02 / migration 0902: class_session, one dated class (CLASS-01-AC2, AC3, AC9). F08 design 3.2, 4.2, 4.3.
-- A session keeps a snapshot of the template's details as they were when it was made (name, audience, level, coach, court,
-- players, drop in price), so editing a template never changes a session that has players (D121). Statuses: scheduled,
-- needs_attention (the court or the coach could not be claimed or does not work: attention_reason says why, and there is no
-- occupancy row), cancelled (cancel_reason says why). edited marks a session the owner changed by hand. A scheduled session
-- has an occupancy row of kind group_class, which this migration lets point at the session with a composite foreign key.
-- Class D. Policies and grants come with 0911.

create table public.class_session (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  template_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  name_th text not null,
  name_en text not null,
  audience text not null,
  level text,
  coach_id uuid not null,
  resource_id uuid not null,
  min_players smallint not null,
  max_players smallint not null,
  drop_in_price_satang integer,
  status text not null default 'scheduled',
  attention_reason text,
  cancel_reason text,
  edited boolean not null default false,
  cancelled_by uuid,
  cancelled_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, template_id) references public.class_template (club_id, id),
  foreign key (club_id, coach_id) references public.coach (club_id, id),
  foreign key (club_id, resource_id) references public.resource (club_id, id),
  foreign key (club_id, cancelled_by) references public.app_user (club_id, id),
  constraint class_session_one_per_start unique (club_id, template_id, start_at),
  -- 60 minutes on the hour in Bangkok, as every booking (CLASS-01-AC1).
  constraint class_session_one_hour check (end_at - start_at = interval '1 hour'),
  constraint class_session_on_the_hour check (date_trunc('hour', start_at at time zone 'Asia/Bangkok') = start_at at time zone 'Asia/Bangkok'),
  constraint class_session_audience check (audience in ('adult', 'student')),
  constraint class_session_names check (btrim(name_th) <> '' and btrim(name_en) <> ''),
  constraint class_session_players check (min_players >= 1 and min_players <= max_players),
  constraint class_session_drop_in check (drop_in_price_satang is null or drop_in_price_satang >= 0),
  constraint class_session_status_values check (status in ('scheduled', 'needs_attention', 'cancelled')),
  constraint class_session_attention_values check (attention_reason in ('court_clash', 'coach_clash', 'coach_leave', 'coach_rest', 'outside_hours')),
  constraint class_session_cancel_values check (cancel_reason in ('below_minimum', 'owner', 'template', 'coach')),
  constraint class_session_attention_matches check ((status = 'needs_attention') = (attention_reason is not null)),
  constraint class_session_cancel_matches check ((status = 'cancelled') = (cancel_reason is not null and cancelled_at is not null))
);
create index class_session_by_start on public.class_session (club_id, start_at) where status <> 'cancelled';
create index class_session_by_template on public.class_session (club_id, template_id, start_at);

-- The occupancy row of a scheduled session (F03 0203 left the column without a key for F08).
alter table public.occupancy add constraint occupancy_class_session_fk foreign key (club_id, class_session_id) references public.class_session (club_id, id);

alter table public.class_session owner to booq_owner;
alter table public.class_session enable row level security;
alter table public.class_session force row level security;
revoke all on public.class_session from public;
create policy class_session_tenant on public.class_session as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy class_session_definer on public.class_session for all to booq_owner using (true) with check (true);

-- Deleted after the seats and the occupancy rows that point at it, before its template.
select app.register_test_table('public.class_session', 220);
select audit.register('public.class_session', array['id']);
