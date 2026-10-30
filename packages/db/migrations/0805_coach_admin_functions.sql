-- F07-T05 / migration 0805: how a coach is set up and kept (COACH-02, R2-AC1 to AC7, R6-AC3, CC-1, CC-3; D120). F07 design 5.6, 5.8, 5.9.
-- Every function is SECURITY DEFINER, takes the club from app.club_id() and checks the caller's role itself (SR-07):
--   app.save_coach(person, profile)            owner. Creates the coach row and gives the person the coach role (the row and
--                                              the role go together), or changes the profile fields and tier sent.
--   app.record_coach_consent(coach, given)     owner. Records (or withdraws) the coach's agreement to a public profile.
--                                              Withdrawing also unpublishes. (Not in the T05 list; publish needs it, D120.)
--   app.publish_coach_profile(coach, publish)  owner. Publishing needs the consent record: consent_required.
--   app.set_coach_active(coach, active)        owner. Deactivating refuses coach_has_future_sessions while any confirmed or
--                                              unexpired held session of the coach is ahead (app.coach_future_sessions).
--   app.set_coach_price_override(coach, group, price)  owner. null removes the override (the tier price applies).
--   app.set_availability(coach, rules)         the coach for themselves, the owner for any coach. Replaces all rules.
--   app.request_leave(coach, ...)              the coach for themselves, the owner for any coach. A pending request.
--   app.decide_leave(leave, approve)           owner. Approve or decline once; the coach is told (leave_decision).
-- Saving a rule, approving leave or deactivating never deletes or moves a booking (COACH-01-AC8, R6-AC2). Each change
-- is audited by the trigger of the table it changes. Refusals that a screen shows are typed (SQLSTATE BK001, the code
-- is the message); others are 'coach: ...' messages. app.coach_message_hook is the no op that F10 replaces (A-7); it is
-- created here because decide_leave is the first caller (design 4.1 lists it with 0807, which does not redefine it).

create function app.coach_message_hook(p_kind text, p_user uuid, p_params jsonb, p_dedupe_key text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$ begin null; end $$;
alter function app.coach_message_hook(text, uuid, jsonb, text) owner to booq_owner;
revoke all on function app.coach_message_hook(text, uuid, jsonb, text) from public;

-- The caller must be the owner, or (own = true) the coach themselves.
create function app.coach_caller_ok(p_coach uuid, p_own boolean) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select app.club_id() is not null and app.user_id() is not null
           and (app.has_any_role('owner') or (p_own and p_coach = app.user_id() and app.has_any_role('coach'))) $$;
alter function app.coach_caller_ok(uuid, boolean) owner to booq_owner;
revoke all on function app.coach_caller_ok(uuid, boolean) from public;

create function app.coach_future_sessions(p_coach uuid) returns integer
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select count(*)::integer from public.occupancy o
   where o.club_id = app.club_id() and o.coach_id = p_coach and o.start_at > app.now()
     and (o.state = 'confirmed' or o.hold_expires_at > app.now())
$$;
alter function app.coach_future_sessions(uuid) owner to booq_owner;
revoke all on function app.coach_future_sessions(uuid) from public;
grant execute on function app.coach_future_sessions(uuid) to booq_app;

create function app.save_coach(p_user uuid, p_profile jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_new boolean;
  p jsonb := coalesce(p_profile, '{}'::jsonb);
begin
  if not app.coach_caller_ok(p_user, false) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'coach: invalid profile' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.app_user u where u.club_id = v_club and u.id = p_user and u.active) then
    raise exception 'coach: unknown person' using errcode = 'P0001';
  end if;
  v_new := not exists (select 1 from public.coach c where c.club_id = v_club and c.id = p_user);
  begin
    if v_new then
      insert into public.coach (club_id, id) values (v_club, p_user);
      insert into public.app_user_role (club_id, user_id, role) values (v_club, p_user, 'coach') on conflict do nothing;
    end if;
    update public.coach c set
      tier_id = case when p ? 'tier_id' then nullif(p ->> 'tier_id', '')::uuid else c.tier_id end,
      bio_th = case when p ? 'bio_th' then p ->> 'bio_th' else c.bio_th end,
      bio_en = case when p ? 'bio_en' then p ->> 'bio_en' else c.bio_en end,
      certifications_th = case when p ? 'certifications_th' then p ->> 'certifications_th' else c.certifications_th end,
      certifications_en = case when p ? 'certifications_en' then p ->> 'certifications_en' else c.certifications_en end,
      specialties_th = case when p ? 'specialties_th' then array(select jsonb_array_elements_text(p -> 'specialties_th')) else c.specialties_th end,
      specialties_en = case when p ? 'specialties_en' then array(select jsonb_array_elements_text(p -> 'specialties_en')) else c.specialties_en end,
      ages_levels_th = case when p ? 'ages_levels_th' then p ->> 'ages_levels_th' else c.ages_levels_th end,
      ages_levels_en = case when p ? 'ages_levels_en' then p ->> 'ages_levels_en' else c.ages_levels_en end,
      languages = case when p ? 'languages' then array(select jsonb_array_elements_text(p -> 'languages')) else c.languages end,
      photo_path = case when p ? 'photo_path' then nullif(p ->> 'photo_path', '') else c.photo_path end
     where c.club_id = v_club and c.id = p_user;
  exception
    when invalid_text_representation or foreign_key_violation or check_violation or invalid_parameter_value or datatype_mismatch then
      raise exception 'coach: invalid profile (%)', sqlerrm using errcode = 'P0001';
  end;
end $$;

create function app.record_coach_consent(p_coach uuid, p_given boolean) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_club uuid := app.club_id();
begin
  if not app.coach_caller_ok(p_coach, false) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  if p_given is null then
    raise exception 'coach: invalid consent' using errcode = 'P0001';
  end if;
  update public.coach c
     set profile_consent_at = case when p_given then app.now() end,
         profile_consent_by = case when p_given then app.user_id() end,
         published = c.published and p_given
   where c.club_id = v_club and c.id = p_coach;
  if not found then
    raise exception 'coach: unknown coach' using errcode = 'P0001';
  end if;
end $$;

create function app.publish_coach_profile(p_coach uuid, p_publish boolean) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  c public.coach%rowtype;
begin
  if not app.coach_caller_ok(p_coach, false) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  if p_publish is null then
    raise exception 'coach: invalid publish' using errcode = 'P0001';
  end if;
  select * into c from public.coach where club_id = v_club and id = p_coach for update;
  if not found then
    raise exception 'coach: unknown coach' using errcode = 'P0001';
  end if;
  if p_publish and c.profile_consent_at is null then
    perform app.refuse('consent_required');
  end if;
  update public.coach set published = p_publish where club_id = v_club and id = p_coach;
end $$;

create function app.set_coach_active(p_coach uuid, p_active boolean) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_club uuid := app.club_id();
begin
  if not app.coach_caller_ok(p_coach, false) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'coach: invalid active' using errcode = 'P0001';
  end if;
  perform 1 from public.coach where club_id = v_club and id = p_coach for update;
  if not found then
    raise exception 'coach: unknown coach' using errcode = 'P0001';
  end if;
  if not p_active and app.coach_future_sessions(p_coach) > 0 then
    perform app.refuse('coach_has_future_sessions');
  end if;
  update public.coach set active = p_active where club_id = v_club and id = p_coach;
end $$;

create function app.set_coach_price_override(p_coach uuid, p_price_group uuid, p_price integer) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_club uuid := app.club_id();
begin
  if not app.coach_caller_ok(p_coach, false) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.coach where club_id = v_club and id = p_coach)
     or not exists (select 1 from public.price_group g where g.club_id = v_club and g.id = p_price_group) then
    raise exception 'coach: unknown coach or price group' using errcode = 'P0001';
  end if;
  if p_price is null then
    delete from public.coach_price_override where club_id = v_club and coach_id = p_coach and price_group_id = p_price_group;
  elsif p_price < 0 then
    raise exception 'coach: invalid price' using errcode = 'P0001';
  else
    insert into public.coach_price_override (club_id, coach_id, price_group_id, price_satang) values (v_club, p_coach, p_price_group, p_price)
    on conflict (club_id, coach_id, price_group_id) do update set price_satang = excluded.price_satang;
  end if;
end $$;

-- rules: [{kind: weekly|open|closed, weekday 0 (Sunday) to 6, on_date, start_time, end_time}], whole hours, end up to 24:00.
create function app.set_availability(p_coach uuid, p_rules jsonb) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  r jsonb;
  n integer := 0;
begin
  if not app.coach_caller_ok(p_coach, true) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    raise exception 'coach: invalid rules' using errcode = 'P0001';
  end if;
  perform 1 from public.coach where club_id = v_club and id = p_coach for update;
  if not found then
    raise exception 'coach: unknown coach' using errcode = 'P0001';
  end if;
  delete from public.coach_availability_rule where club_id = v_club and coach_id = p_coach;
  for r in select * from jsonb_array_elements(p_rules) loop
    begin
      insert into public.coach_availability_rule (club_id, coach_id, kind, weekday, on_date, start_time, end_time)
      values (v_club, p_coach, r ->> 'kind', (r ->> 'weekday')::smallint, (r ->> 'on_date')::date, (r ->> 'start_time')::time, (r ->> 'end_time')::time);
      n := n + 1;
    exception
      when check_violation or not_null_violation or invalid_text_representation or datetime_field_overflow or invalid_datetime_format
           or numeric_value_out_of_range or datatype_mismatch then
        raise exception 'coach: invalid rule (%)', sqlerrm using errcode = 'P0001';
    end;
  end loop;
  return n;
end $$;

create function app.request_leave(p_coach uuid, p_start date, p_end date, p_from_hour smallint default null, p_to_hour smallint default null,
                                  p_type text default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_id uuid;
begin
  if not app.coach_caller_ok(p_coach, true) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.coach where club_id = v_club and id = p_coach) then
    raise exception 'coach: unknown coach' using errcode = 'P0001';
  end if;
  if p_start is null or p_end is null or p_start < (app.now() at time zone 'Asia/Bangkok')::date then
    raise exception 'coach: invalid leave' using errcode = 'P0001';
  end if;
  begin
    insert into public.coach_leave (club_id, coach_id, start_date, end_date, from_hour, to_hour, type, note)
    values (v_club, p_coach, p_start, p_end, p_from_hour, p_to_hour, nullif(btrim(p_type), ''), nullif(btrim(p_note), ''))
    returning id into v_id;
  exception
    when check_violation or not_null_violation then
      raise exception 'coach: invalid leave (%)', sqlerrm using errcode = 'P0001';
  end;
  return v_id;
end $$;

create function app.decide_leave(p_leave uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  l public.coach_leave%rowtype;
  v_status text;
begin
  if not app.coach_caller_ok(null, false) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'coach: invalid decision' using errcode = 'P0001';
  end if;
  select * into l from public.coach_leave where club_id = v_club and id = p_leave for update;
  if not found then
    raise exception 'coach: unknown leave' using errcode = 'P0001';
  end if;
  if l.status <> 'pending' then
    raise exception 'coach: the leave is already decided' using errcode = 'P0001';
  end if;
  v_status := case when p_approve then 'approved' else 'declined' end;
  update public.coach_leave set status = v_status, decided_by = app.user_id(), decided_at = app.now() where club_id = v_club and id = p_leave;
  perform app.coach_message_hook('leave_decision', l.coach_id, jsonb_build_object('leave_id', p_leave, 'status', v_status), 'leave:' || p_leave || ':' || v_status);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.save_coach(uuid, jsonb)', 'app.record_coach_consent(uuid, boolean)', 'app.publish_coach_profile(uuid, boolean)',
    'app.set_coach_active(uuid, boolean)', 'app.set_coach_price_override(uuid, uuid, integer)', 'app.set_availability(uuid, jsonb)',
    'app.request_leave(uuid, date, date, smallint, smallint, text, text)', 'app.decide_leave(uuid, boolean)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
