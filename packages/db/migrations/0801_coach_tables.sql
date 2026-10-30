-- F07-T01 / migration 0801: the coach tables (COACH-01, COACH-02-AC3, R2, CC-1; D111, D120, D156). F07 design 4.1, 4.2.
-- coach (the profile and the working state), coach_availability_rule (when a coach works), coach_leave (time off, a
-- time range on whole hours; no list of types and no half-day length is invented, D156), coach_price_override (one
-- nullable price per price group; no row means the tier price). Foreign keys from booking.coach_id and
-- occupancy.coach_id to coach, which F03's 0213 left to F07. Class D (a coach's profile is personal data), every key
-- composite with club_id. Policies and grants for the application roles come with the functions (design 0808): this
-- migration gives the tables row security with the tenant and definer policies and nothing else.
-- The profile fields are personal data kept in the audit log apart from the facts (pii columns), and a coach cannot be
-- anonymised while future solo sessions are booked (the F01 data request handlers below).

create table public.coach (
  club_id uuid not null,
  id uuid not null,                              -- = app_user.id: a coach is a person who also holds the coach role
  tier_id uuid,                                  -- null until the owner sets it
  bio_th text,
  bio_en text,
  certifications_th text,
  certifications_en text,
  specialties_th text[],
  specialties_en text[],
  ages_levels_th text,
  ages_levels_en text,
  languages text[],
  photo_path text,                               -- an object path in the club's storage area, never a URL
  profile_consent_at timestamptz,
  profile_consent_by uuid,                       -- the owner who recorded the coach's agreement (D120)
  published boolean not null default false,      -- public only with consent (R1-AC7, CC-3); set through publish_coach_profile
  active boolean not null default true,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, id) references public.app_user (club_id, id),
  foreign key (club_id, tier_id) references public.coach_tier (club_id, id),
  foreign key (club_id, profile_consent_by) references public.app_user (club_id, id),
  constraint coach_published_needs_consent check (not published or (profile_consent_at is not null and profile_consent_by is not null)),
  constraint coach_photo_is_a_path check (photo_path is null or photo_path !~* '^[a-z][a-z0-9+.-]*:')
);

create table public.coach_availability_rule (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  coach_id uuid not null,
  kind text not null,
  weekday smallint,                              -- 0 to 6, Bangkok week, only for weekly
  on_date date,                                  -- only for open and closed
  start_time time not null,
  end_time time not null,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, coach_id) references public.coach (club_id, id),
  constraint coach_rule_kind_values check (kind in ('weekly', 'open', 'closed')),
  constraint coach_rule_weekday_range check (weekday is null or weekday between 0 and 6),
  constraint coach_rule_shape check (
    (kind = 'weekly' and weekday is not null and on_date is null)
    or (kind in ('open', 'closed') and on_date is not null and weekday is null)),
  -- bookings are 60 minutes on the hour, so rules are whole hours (end may be 24:00)
  constraint coach_rule_whole_hours check (extract(minute from start_time) = 0 and extract(second from start_time) = 0
                                           and extract(minute from end_time) = 0 and extract(second from end_time) = 0),
  constraint coach_rule_order check (end_time > start_time)
);
create index coach_rule_by_coach on public.coach_availability_rule (club_id, coach_id, kind);

create table public.coach_leave (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  coach_id uuid not null,
  start_date date not null,
  end_date date not null,
  from_hour smallint,                            -- whole Bangkok hours; both null = full days; both set = a part day on one date
  to_hour smallint,
  type text,                                     -- free text; no list of leave types is built (D156)
  note text,
  status text not null default 'pending',
  decided_by uuid,
  decided_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, coach_id) references public.coach (club_id, id),
  foreign key (club_id, decided_by) references public.app_user (club_id, id),
  constraint coach_leave_status_values check (status in ('pending', 'approved', 'declined')),
  constraint coach_leave_dates check (end_date >= start_date),
  constraint coach_leave_hours check (
    (from_hour is null and to_hour is null)
    or (from_hour is not null and to_hour is not null and from_hour between 0 and 23 and to_hour between 1 and 24
        and to_hour > from_hour and start_date = end_date)),
  constraint coach_leave_decided check ((status = 'pending') = (decided_by is null and decided_at is null))
);
create index coach_leave_by_coach on public.coach_leave (club_id, coach_id, start_date);

create table public.coach_price_override (
  club_id uuid not null,
  coach_id uuid not null,
  price_group_id uuid not null,
  price_satang integer not null check (price_satang >= 0),   -- no row means the tier price (COACH-02-AC3)
  is_test boolean not null default false,
  primary key (club_id, coach_id, price_group_id),
  foreign key (club_id, coach_id) references public.coach (club_id, id),
  foreign key (club_id, price_group_id) references public.price_group (club_id, id)
);

-- The two tables that point at a coach (0213 left these foreign keys to F07).
alter table public.booking add constraint booking_coach_fk foreign key (club_id, coach_id) references public.coach (club_id, id);
alter table public.occupancy add constraint occupancy_coach_fk foreign key (club_id, coach_id) references public.coach (club_id, id);

-- Ownership, row security and the policies every class D table has: the tenant filter for the application roles and
-- a definer policy for the functions that read and write them. No role has a table grant yet.
do $$
declare t text;
begin
  foreach t in array array['coach', 'coach_availability_rule', 'coach_leave', 'coach_price_override'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
  end loop;
end $$;

-- A coach row, and everything that hangs on it, is test data when the person is (D100).
create function app.copy_coach_is_test() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_coach uuid := (to_jsonb(new) ->> case when tg_table_name = 'coach' then 'id' else 'coach_id' end)::uuid;
begin
  new.is_test := coalesce((select u.is_test from public.app_user u where u.club_id = new.club_id and u.id = v_coach), false);
  return new;
end $$;
alter function app.copy_coach_is_test() owner to booq_owner;
revoke all on function app.copy_coach_is_test() from public;
do $$
declare t text;
begin
  foreach t in array array['coach', 'coach_availability_rule', 'coach_leave', 'coach_price_override'] loop
    execute format('create trigger is_test_copy before insert on public.%I for each row execute function app.copy_coach_is_test()', t);
  end loop;
end $$;
select app.register_test_table('public.coach_availability_rule', 840, false);
select app.register_test_table('public.coach_leave', 840, false);
select app.register_test_table('public.coach_price_override', 840, false);
select app.register_test_table('public.coach', 850, false);

select audit.register('public.coach', array['id'], 'club_id',
  array['bio_th', 'bio_en', 'certifications_th', 'certifications_en', 'specialties_th', 'specialties_en', 'ages_levels_th', 'ages_levels_en', 'languages', 'photo_path']);
select audit.register('public.coach_availability_rule', array['id']);
select audit.register('public.coach_leave', array['id'], 'club_id', array['type', 'note']);
select audit.register('public.coach_price_override', array['coach_id', 'price_group_id']);

-- Data requests (PDPA-01): a coach with future solo sessions cannot be anonymised; the person is told how many.
create function app.f07_deletion_impact(p_club uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object('coach_future_sessions',
    (select count(*) from public.booking b
      where b.club_id = p_club and b.coach_id = p_user and b.status in ('confirmed', 'awaiting_payment') and b.start_at > app.now()))
$$;
create function app.f07_anonymise(p_club uuid, p_user uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if (app.f07_deletion_impact(p_club, p_user) ->> 'coach_future_sessions')::integer > 0 then
    raise exception 'anonymise: the coach has future sessions' using errcode = 'P0001';
  end if;
  -- The profile and the leave notes are personal data; the facts (hours worked, bookings) stay under the pseudonym.
  update public.coach set bio_th = null, bio_en = null, certifications_th = null, certifications_en = null,
         specialties_th = null, specialties_en = null, ages_levels_th = null, ages_levels_en = null, languages = null,
         photo_path = null, published = false, active = false
   where club_id = p_club and id = p_user;
  update public.coach_leave set type = null, note = null where club_id = p_club and coach_id = p_user;
end $$;
do $$
declare f text;
begin
  foreach f in array array['app.f07_deletion_impact(uuid, uuid)', 'app.f07_anonymise(uuid, uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
insert into app.deletion_impact_handlers (handler_key, handler) values ('f07_coach', 'app.f07_deletion_impact(uuid, uuid)'::regprocedure);
insert into app.anonymise_handlers (handler_key, handler) values ('f07_coach', 'app.f07_anonymise(uuid, uuid)'::regprocedure);
